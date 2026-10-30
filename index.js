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

async function findBusinesses(industry, location, limit) {
  // Find the location using OpenStreetMap
  const geoURL =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
    encodeURIComponent(location);

  const geoResponse = await fetch(geoURL, {
    headers: {
      "User-Agent": "SalesPilotAI/1.0"
    }
  });

  if (!geoResponse.ok) {
    throw new Error("Location search is temporarily unavailable.");
  }

  const places = await geoResponse.json();

  if (!places.length) {
    throw new Error("Location not found. Try a larger city.");
  }

  const place = places[0];
  const box = place.boundingbox;

  const south = Number(box[0]);
  const north = Number(box[1]);
  const west = Number(box[2]);
  const east = Number(box[3]);

  // Search OpenStreetMap for named businesses
  const query = `
[out:json][timeout:25];
(
  nwr["name"]["shop"](${south},${west},${north},${east});
  nwr["name"]["office"](${south},${west},${north},${east});
  nwr["name"]["craft"](${south},${west},${north},${east});
  nwr["name"]["amenity"~"^(restaurant|cafe|fast_food|clinic|dentist|bank|pharmacy)$"](${south},${west},${north},${east});
  nwr["name"]["tourism"~"^(hotel|guest_house|attraction)$"](${south},${west},${north},${east});
);
out center tags ${Math.min(limit * 5, 250)};
`;

  const overpassResponse = await fetch(
    "https://overpass-api.de/api/interpreter",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "data=" + encodeURIComponent(query)
    }
  );

  if (!overpassResponse.ok) {
    throw new Error("Business search is busy. Please try again later.");
  }

  const data = await overpassResponse.json();

  const keyword = industry.toLowerCase();

  const businesses = data.elements
    .map(item => {
      const tags = item.tags || {};

      return {
        name: tags.name || "Unknown business",
        address: [
          tags["addr:housenumber"],
          tags["addr:street"],
          tags["addr:city"]
        ].filter(Boolean).join(" "),
        website: tags.website || tags["contact:website"] || "",
        phone: tags.phone || tags["contact:phone"] || "",
        category:
          tags.shop ||
          tags.office ||
          tags.craft ||
          tags.amenity ||
          tags.tourism ||
          "Business",
        latitude: item.lat || item.center?.lat || null,
        longitude: item.lon || item.center?.lon || null,
        source: "OpenStreetMap"
      };
    })
    .filter(item => {
      const text = (
        item.name + " " + item.category
      ).toLowerCase();

      return (
        keyword.includes("business") ||
        keyword.includes("company") ||
        text.includes(keyword) ||
        item.category.toLowerCase().includes(keyword)
      );
    })
    .slice(0, limit);

  return {
    location: place.display_name,
    industry,
    total: businesses.length,
    businesses
  };
}

async function askGemini(message, apiKey) {
  const models = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite"
  ];

  let lastError = "AI request failed.";

  for (const model of models) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: message }]
          }]
        })
      }
    );

    const result = await response.json();

    if (response.ok) {
      const reply =
        result.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("\n");

      if (reply) return { reply, model };
      lastError = "AI returned an empty response.";
    } else {
      lastError = result.error?.message || "Gemini request failed.";

      if (![429, 500, 502, 503, 504].includes(response.status)) {
        break;
      }
    }
  }

  throw new Error(lastError);
}

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
        features: ["AI Assistant", "Business Search"]
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    try {
      const body = await request.json();

      // Real business search
      if (body.action === "findBusinesses") {
        const industry = String(body.industry || "").trim();
        const location = String(body.location || "").trim();
        const limit = Math.min(
          Math.max(Number(body.limit) || 10, 1),
          20
        );

        if (!industry || !location) {
          return json({
            error: "Industry and location are required."
          }, 400);
        }

        const results = await findBusinesses(
          industry,
          location,
          limit
        );

        return json(results);
      }

      // Existing Gemini AI assistant
      if (!env.GEMINI_API_KEY) {
        return json({
          error: "Gemini API key is not configured."
        }, 500);
      }

      if (!body.message) {
        return json({
          error: "Message is required."
        }, 400);
      }

      const result = await askGemini(
        body.message,
        env.GEMINI_API_KEY
      );

      return json(result);

    } catch (error) {
      return json({
        error: error.message || "Unexpected server error."
      }, 500);
    }
  }
};