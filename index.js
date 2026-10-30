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
        message: "SalesPilot AI backend is running."
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    try {
      if (!env.GEMINI_API_KEY) {
        return json({ error: "API key is not configured." }, 500);
      }

      const body = await request.json();
      const message = body.message;

      if (!message) {
        return json({ error: "Message is required." }, 400);
      }

      const models = [
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite"
      ];

      let lastError = "AI request failed.";

      for (const model of models) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: message
                }]
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

          if (reply) {
            return json({
              reply,
              model
            });
          }

          lastError = "AI returned an empty response.";
        } else {
          lastError =
            result.error?.message || "Gemini request failed.";

          if (![429, 500, 502, 503, 504].includes(response.status)) {
            break;
          }
        }
      }

      return json({ error: lastError }, 502);

    } catch (error) {
      return json({
        error: error.message || "Unexpected server error."
      }, 500);
    }
  }
};