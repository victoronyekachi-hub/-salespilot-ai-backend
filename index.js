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

// GROQ SALES ASSISTANT
async function askGroq(message, apiKey) {
  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [
          {
            role: "system",
            content: "You are SalesPilot AI, a professional sales assistant. Help users find prospects, research businesses, write personalized outreach, and grow their sales. Be accurate, practical and concise. Never invent business information."
          },
          {
            role: "user",
            content: message
          }
        ],
        max_completion_tokens: 900,
        temperature: 0.7
      })
    },
    45000
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Groq API error: ${response.status}`
    );
  }

  return data.choices?.[0]?.message?.content ||
    "I couldn't generate a response. Please try again.";
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
    aiProvider: "Groq",
    aiConfigured: Boolean(env.GROQ_API_KEY),
    features: [
      "Groq AI Sales Assistant",
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

    // GROQ CONFIGURATION
// AI WEBSITE OPPORTUNITY ANALYZER
if (body.action === "analyzeWebsite") {

  const website = String(body.url || "").trim();
  const businessName = String(body.businessName || "").trim();

  if (!website) {
    return json({ error: "Website URL is required." }, 400);
  }

  let siteURL;

  try {
    siteURL = new URL(website);

    if (
      siteURL.protocol !== "https:" ||
      !siteURL.hostname.includes(".") ||
      siteURL.username ||
      siteURL.password ||
      siteURL.hostname === "localhost" ||
      siteURL.hostname.endsWith(".local") ||
      siteURL.hostname.endsWith(".internal") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(siteURL.hostname) ||
      siteURL.hostname.includes(":")
    ) {
      throw new Error("Invalid public website URL.");
    }

  } catch {
    return json({
      error: "Please provide a valid public HTTPS website URL."
    }, 400);
  }

  try {

    const response = await fetchWithTimeout(
      siteURL.href,
      {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "SalesPilotAI/1.0",
          "Accept": "text/html"
        }
      },
      12000
    );

    if (!response.ok) {
      return json({
        error: "Website could not be accessed. HTTP status: " + response.status
      }, 502);
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      return json({
        error: "This URL did not return an HTML webpage."
      }, 400);
    }

    const html = (await response.text()).slice(0, 150000);

    const title =
      (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";

    const description =
      (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i) || [])[1] || "";

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .slice(0, 10000);

    const prompt = `
You are SalesPilot AI Website Opportunity Analyst.

Business: ${businessName || "Unknown"}
Website: ${siteURL.href}

WEBSITE TITLE:
${title}

META DESCRIPTION:
${description}

VISIBLE PAGE CONTENT:
${text}

Analyse the available website information.

Return:
1. Overall website impression.
2. Possible design and usability weaknesses.
3. Missing or unclear business features.
4. Opportunities for improvement.
5. A personalized website redesign sales pitch.
6. An opportunity rating: High, Medium or Low.

Only report issues supported by the supplied page information.
Do not claim to have tested loading speed, mobile responsiveness,
security, accessibility or other technical metrics.
If information is insufficient, say so.

Make the recommendations practical and concise.
`;

    const analysis = await askGroq(
      prompt,
      env.GROQ_API_KEY
    );

    return json({
      success: true,
      website: siteURL.href,
      title: title,
      description: description,
      analysis: analysis
    });

  } catch (error) {

    return json({
      error: error.message || "Website analysis failed."
    }, 502);

  }
}
if (!env.GROQ_API_KEY) {
  return json({
    error: "Groq API key is missing. Add GROQ_API_KEY to Cloudflare Worker secrets."
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
  const result = await askGroq(
    message,
    env.GROQ_API_KEY
  );

  return json({ reply: result });

} catch (error) {
  return json({
    error: error.message || "Groq AI request failed."
  }, 502);
}

}

};