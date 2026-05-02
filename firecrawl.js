import fetch from "node-fetch";

const API_KEY = "fc-c7519f5f72c94526a949523bb181a329";

async function scrapeSite() {
  const response = await fetch("https://api.firecrawl.dev/v0/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      url: "https://www.gap.com", // test company
      pageOptions: {
        onlyMainContent: true,
      },
    }),
  });

  const data = await response.json();
  console.log(data);
}

scrapeSite();