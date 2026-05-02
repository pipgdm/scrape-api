require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

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

    const scrapeData = await scrapeRes.json();

    if (!scrapeData?.data?.markdown) {
      return res.status(500).json({
        error: "No markdown returned from Firecrawl",
        details: scrapeData,
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

    const aiData = await aiRes.json();

    let output = aiData.choices[0].message.content;

    output = output
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

    res.json({
    url,
    result: JSON.parse(output),
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