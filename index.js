const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

// BUSINESS FINDER
async function findBusinesses(industry, location, limit) {
  const geoURL =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
    encodeURIComponent(location);

  const geoResponse = await fetchWithTimeout(geoURL, {
    headers: {
      "User-Agent": "SalesPilotAI/1.0"
    }
  }, 15000);

  if (!geoResponse.ok) {
    throw new Error("Location search is temporarily unavailable.");
  }

  const geoData = await geoResponse.json();

  if (!geoData.length) {
    throw new Error("Location not found. Try another location.");
  }

  const place = geoData[0];

  const south = Number(place.boundingbox[0]);
  const north = Number(place.boundingbox[1]);
  const west = Number(place.boundingbox[2]);
  const east = Number(place.boundingbox[3]);

  const query = `
[out:json][timeout:20];
(
  nwr["name"]["shop"](${south},${west},${north},${east});
  nwr["name"]["office"](${south},${west},${north},${east});
  nwr["name"]["craft"](${south},${west},${north},${east});
  nwr["name"]["amenity"~"restaurant|cafe|fast_food|clinic|dentist|bank|pharmacy"](${south},${west},${north},${east});
  nwr["name"]["tourism"~"hotel|guest_house|attraction"](${south},${west},${north},${east});
);
out center tags ${Math.min(limit * 8, 300)};
`;

  const servers = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter"
  ];

  let elements = null;

  for (const server of servers) {
    try {
      const response = await fetchWithTimeout(server, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: "data=" + encodeURIComponent(query)
      }, 30000);

      if (!response.ok) continue;

      const data = await response.json();
      elements = data.elements || [];
      break;

    } catch (error) {
      continue;
    }
  }

  if (!elements) {
    throw new Error("Business search servers are busy. Try again shortly.");
  }

  const results = [];
  const seen = new Set();

  for (const item of elements) {
    const tags = item.tags || {};

    if (!tags.name) continue;

    const category =
      tags.shop ||
      tags.office ||
      tags.craft ||
      tags.amenity ||
      tags.tourism ||
      "business";

    const lat = item.lat ?? item.center?.lat;
    const lon = item.lon ?? item.center?.lon;

    const key = tags.name.toLowerCase() + "|" + lat + "|" + lon;

    if (seen.has(key)) continue;
    seen.add(key);

    const address = [
      tags["addr:housenumber"],
      tags["addr:street"],
      tags["addr:city"] || tags["addr:town"] || tags["addr:village"]
    ].filter(Boolean).join(" ");

    results.push({
      name: tags.name,
      address: address || place.display_name || location,
      website: tags.website || tags["contact:website"] || "",
      phone: tags.phone || tags["contact:phone"] || "",
      category,
      latitude: lat ?? null,
      longitude: lon ?? null,
      source: "OpenStreetMap"
    });

    if (results.length >= limit) break;
  }

  return {
    location: place.display_name || location,
    industry,
    total: results.length,
    businesses: results,
    notice: "Business listings may be incomplete or outdated. Verify details before contacting."
  };
}

// OPENAI SALES ASSISTANT
async function askOpenAI(message, apiKey) {

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",

      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        model: "gpt-4.1-mini",

        instructions: `
You are SalesPilot AI, an intelligent professional sales assistant.

Your responsibilities include:

1. Writing personalised sales emails.
2. Analysing potential business customers.
3. Creating effective sales strategies.
4. Generating professional follow-up messages.
5. Helping users qualify potential customers.
6. Identifying business development opportunities.
7. Improving sales conversion strategies.

Your personality:
- Professional.
- Intelligent.
- Confident.
- Friendly.
- Clear and practical.

Never invent business information, website problems,
phone numbers or customer details.

When information is missing, explain that clearly.

Always provide useful, actionable answers.
        `,

        input: message,

        max_output_tokens: 900
      })
    },
    45000
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || "OpenAI request failed."
    );
  }

  let reply = "";

  for (const item of data.output || []) {

    if (item.type === "message" && Array.isArray(item.content)) {

      for (const part of item.content) {

        if (part.type === "output_text") {
          reply += part.text;
        }

      }

    }

  }

  if (!reply && data.output_text) {
    reply = data.output_text;
  }

  if (!reply) {
    throw new Error("OpenAI returned an empty response.");
  }

  return {
    reply,
    model: data.model || "gpt-4.1-mini"
  };
}

// MAIN WORKER
export default {

  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (request.method === "GET") {

      return json({
        message: "SalesPilot AI backend is running.",
        aiProvider: "OpenAI",
        aiConfigured: Boolean(env.OPENAI_API_KEY),
        features: [
          "OpenAI Sales Assistant",
          "Business Discovery",
          "Lead Research"
        ]
      });

    }

    if (request.method !== "POST") {
      return json({
        error: "Method not allowed."
      }, 405);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({
        error: "Invalid JSON request."
      }, 400);
    }

    // BUSINESS SEARCH
    if (body.action === "findBusinesses") {

      const industry = String(body.industry || "").trim();
      const location = String(body.location || "").trim();

      const limit = Math.max(
        1,
        Math.min(Number(body.limit) || 10, 50)
      );

      if (!industry || !location) {
        return json({
          error: "Industry and location are required."
        }, 400);
      }

      try {

        const result = await findBusinesses(
          industry,
          location,
          limit
        );

        return json(result);

      } catch (error) {

        return json({
          error: error.message || "Business search failed."
        }, 502);

      }

    }

    // OPENAI CONFIGURATION
    if (!env.OPENAI_API_KEY) {

      return json({
        error: "OpenAI API key is missing. Add OPENAI_API_KEY to Cloudflare Worker secrets."
      }, 500);

    }

    const message = String(body.message || "").trim();

    if (!message) {
      return json({
        error: "Message is required."
      }, 400);
    }

    if (message.length > 12000) {
      return json({
        error: "Message is too long."
      }, 413);
    }

    try {

      const result = await askOpenAI(
        message,
        env.OPENAI_API_KEY
      );

      return json(result);

    } catch (error) {

      return json({
        error: error.name === "AbortError"
          ? "OpenAI took too long to respond. Please try again."
          : error.message || "AI request failed."
      }, 502);

    }

  }

};