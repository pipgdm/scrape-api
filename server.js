require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

/** Parse JSON from a fetch Response; throw if HTTP status indicates failure. */
async function readJsonResponse(response, serviceName) {
  let data = {};
  try {
    data = await response.json();
  } catch {
    // ignore non-JSON bodies
  }
  if (!response.ok) {
    const msg =
      data.error?.message ||
      data.message ||
      (typeof data.error === "string" ? data.error : null) ||
      `${serviceName} request failed (${response.status})`;
    const err = new Error(msg);
    err.status = response.status;
    err.upstream = data;
    throw err;
  }
  return data;
}

function httpStatusFromUpstreamError(error) {
  const s = Number(error.status);
  if (s === 429) return 429;
  if (s >= 500) return 502;
  return 500;
}

app.post("/api/signals", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // 1. Scrape website
    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
      }),
    });

    const scrapeData = await readJsonResponse(scrapeRes, "Firecrawl");

    if (!scrapeData?.data?.markdown) {
      return res.status(502).json({
        error: "No markdown returned from Firecrawl",
      });
    }

    const content = scrapeData.data.markdown;

    // 2. Analyse with OpenAI
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a sales assistant. Extract one GTM signal from the website text. Return only valid JSON with these keys: company, signal, why_it_matters, outbound_angle.",
          },
          {
            role: "user",
            content: content.slice(0, 5000),
          },
        ],
      }),
    });

    const aiData = await readJsonResponse(aiRes, "OpenAI");

    let output = aiData.choices?.[0]?.message?.content;
    if (typeof output !== "string" || !output.trim()) {
      return res.status(502).json({ error: "No completion from OpenAI" });
    }

    output = output
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let result;
    try {
      result = JSON.parse(output);
    } catch {
      return res.status(422).json({
        error: "Model returned invalid JSON",
        raw: output.slice(0, 500),
      });
    }

    res.json({ url, result });
  } catch (error) {
    console.error(error);
    res.status(httpStatusFromUpstreamError(error)).json({
      error: "Something went wrong",
      details: error.message,
    });
  }
});

app.post("/api/research-signal", async (req, res) => {
    try {
      const { company } = req.body;
  
      if (!company) {
        return res.status(400).json({ error: "Company is required" });
      }
  
      const perplexityRes = await fetch("https://api.perplexity.ai/v1/sonar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [
            {
              role: "system",
              content:
                "You are a B2B GTM research assistant. Analyse recent company activity and return structured insights for sales teams. Only return valid JSON.",
            },
            {
              role: "user",
              content: `
  Find recent news, signals and GTM opportunities for: ${company}.
  
  Return JSON with:
  {
    "company": "",
    "recent_news": [],
    "business_signals": [],
    "hiring_or_expansion": "",
    "product_or_partnerships": "",
    "possible_pain_points": [],
    "gtm_opportunity": "",
    "outreach_angles": [],
    "suggested_buyer_personas": [],
    "sources": []
  }
              `,
            },
          ],
        }),
      });
  
      const data = await readJsonResponse(perplexityRes, "Perplexity");

      let output = data.choices?.[0]?.message?.content;
      if (typeof output !== "string" || !output.trim()) {
        return res.status(502).json({ error: "No completion from Perplexity" });
      }

      output = output
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
  
      let parsed;
  
      try {
        parsed = JSON.parse(output);
      } catch {
        parsed = { raw: output };
      }
  
      res.json({
        company,
        result: parsed,
      });
    } catch (error) {
      console.error(error);
      res.status(httpStatusFromUpstreamError(error)).json({
        error: "Something went wrong",
        details: error.message,
      });
    }
  });

  app.post("/api/prospects", async (req, res) => {
    try {
      const { companyDomain, titles } = req.body;
  
      if (!companyDomain) {
        return res.status(400).json({ error: "companyDomain is required" });
      }
  
      const apolloRes = await fetch(
        "https://api.apollo.io/api/v1/mixed_people/api_search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          },
          body: JSON.stringify({
            api_key: process.env.APOLLO_API_KEY,
            q_organization_domains: [companyDomain],
            person_titles: titles || ["Marketing", "Growth", "Partnerships"],
            page: 1,
            per_page: 5,
          }),
        }
      );
  
      const data = await apolloRes.json();
  
      const people =
        data.people?.map((p) => ({
          name: `${p.first_name || ""} ${p.last_name || ""}`,
          title: p.title,
          linkedin: p.linkedin_url,
          company: p.organization?.name,
        })) || [];
  
      res.json({
        companyDomain,
        prospects: people,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Something went wrong",
        details: error.message,
      });
    }
  });
  
app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});