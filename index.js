const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function callGemini(model, message, apiKey) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are SalesPilot AI, a professional sales assistant for small web design agencies. Help users qualify leads, research prospects, write personalized outreach messages, and plan follow-ups. Never invent facts about prospects."
          }]
        },
        contents: [{
          role: "user",
          parts: [{ text: message }]
        }]
      })
    }
  );
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      if (request.method === "GET") {
        return jsonResponse({
          message: "SalesPilot AI backend is running."
        });
      }

      if (request.method !== "POST") {
        return jsonResponse({
          error: "Method not allowed."
        }, 405);
      }

      if (!env.GEMINI_API_KEY) {
        return jsonResponse({
          error: "Gemini API key is missing."
        }, 500);
      }

      const body = await request.json();
      const message = typeof body.message === "string"
        ? body.message.trim()
        : "";

      if (!message) {
        return jsonResponse({
          error: "Please enter a message."
        }, 400);
      }

      let aiResponse = await callGemini(
        "gemini-3.8-flash",
        message.slice(0, 5000),
        env.GEMINI_API_KEY
      );

      let selectedModel = "gemini-3.8-flash";

      if ([429, 500, 502, 503, 504].includes(aiResponse.status)) {
        aiResponse = await callGemini(
          "gemini-3.5-flash-lite",
          message.slice(0, 5000),
          env.GEMINI_API_KEY
        );

        selectedModel = "gemini-3.5-flash-lite";
      }

      const responseText = await aiResponse.text();

      if (!aiResponse.ok) {
        return jsonResponse({
          error: "Both AI attempts were unsuccessful or the backup failed.",
          status: aiResponse.status,
          model: selectedModel,
          details: responseText.slice(0, 1000)
        }, 502);
      }

      const data = JSON.parse(responseText);

      const reply = data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") || "No response generated.";

      return jsonResponse({
        reply,
        model: selectedModel
      });

    } catch (error) {
      return jsonResponse({
        error: "Worker execution failed.",
        details: String(error)
      }, 500);
    }
  }
};