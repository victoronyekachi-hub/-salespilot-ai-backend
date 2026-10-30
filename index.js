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

export default {
  async fetch(request, env) {
    try {
      // Handle browser CORS requests
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      // Test backend connection
      if (request.method === "GET") {
        return jsonResponse({
          message: "SalesPilot AI backend is running."
        });
      }

      // Allow POST requests only
      if (request.method !== "POST") {
        return jsonResponse({
          error: "Method not allowed."
        }, 405);
      }

      // Check API key
      if (!env.GEMINI_API_KEY) {
        return jsonResponse({
          error: "Gemini API key is missing from Worker environment."
        }, 500);
      }

      // Read incoming message
      const body = await request.json();

      const message = typeof body.message === "string"
        ? body.message.trim()
        : "";

      if (!message) {
        return jsonResponse({
          error: "Please enter a message."
        }, 400);
      }

      // Send request to Gemini
      const aiResponse = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: "You are SalesPilot AI, a sales assistant for small web design agencies. Help users qualify leads, research prospects, write personalized outreach messages, and plan follow-ups. Never invent facts about prospects. Be professional, helpful, and concise."
              }]
            },
            contents: [{
              role: "user",
              parts: [{
                text: message.slice(0, 5000)
              }]
            }]
          })
        }
      );

      // Read Gemini response only once
      const responseText = await aiResponse.text();

      // Handle Gemini errors
      if (!aiResponse.ok) {
        return jsonResponse({
          error: "Gemini API request failed.",
          status: aiResponse.status,
          details: responseText.slice(0, 1000)
        }, 502);
      }

      // Convert response to JSON
      const data = JSON.parse(responseText);

      // Extract AI response
      const reply = data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") || "No response generated.";

      return jsonResponse({
        reply: reply
      });

    } catch (error) {
      return jsonResponse({
        error: "Worker execution failed.",
        details: String(error)
      }, 500);
    }
  }
};