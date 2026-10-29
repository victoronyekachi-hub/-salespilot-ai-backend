export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({ message: "SalesPilot AI backend is running." }),
        { headers }
      );
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Use POST to send a message." }),
        { status: 405, headers }
      );
    }

    try {
      const body = await request.json();
      const message = body.message;

      if (typeof message !== "string" || !message.trim()) {
        return new Response(
          JSON.stringify({ error: "Please enter a message." }),
          { status: 400, headers }
        );
      }

      if (!env.GEMINI_API_KEY) {
        return new Response(
          JSON.stringify({ error: "The AI service is not configured." }),
          { status: 500, headers }
        );
      }

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
                text: "You are SalesPilot AI, a sales assistant for small web design agencies. Help users qualify leads, write personalized outreach, and plan follow-ups. Never invent facts about prospects."
              }]
            },
            contents: [{
              role: "user",
              parts: [{ text: message.trim().slice(0, 5000) }]
            }]
          })
        }
      );

      const data = await aiResponse.json();

      if (!aiResponse.ok) {
const errorDetails = await aiResponse.text();

return new Response(
JSON.stringify({
error: “Gemini API request failed.”,
status: aiResponse.status,
details: errorDetails.slice(0, 1000)
}),
{
status: 502,
headers: {
…headers,
“Content-Type”: “application/json”
}
}
);
}
      const reply = data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") || "No response generated.";

      return new Response(JSON.stringify({ reply }), { headers });

    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Request failed. Please try again." }),
        { status: 500, headers }
      );
    }
  }
};
