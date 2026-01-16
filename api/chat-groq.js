import fetch from "node-fetch";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ---- TELEMETRY STORE (in-memory, safe for Vercel) ----
const telemetry = {
  hallucinationAttempts: 0,
  regenerations: 0
};

// ---- HALLUCINATION DETECTOR ----
function violatesRules(text) {
  const forbidden = [
    "🏨", "🍽️", "⭐",
    "hotel ", "restaurant ",
    "specialty", "famous for",
    "best ", "top ", "must visit",
    "rated", "open at", "price"
  ];

  return forbidden.some(k =>
    text.toLowerCase().includes(k)
  );
}

// ---- SYSTEM PROMPT (GLOBAL, STRICT) ----
const SYSTEM_PROMPT = `
You are an assistant embedded inside a deterministic travel application.

CRITICAL RULES:
1. You MUST NOT name real hotels, restaurants, cafes, or shops.
2. You MUST NOT invent food specialties, ratings, hours, or prices.
3. You MUST NOT present guesses as facts.
4. Use abstract categories only.
5. Use conditional language ("may", "if available").
6. If factual data is requested, defer to external verification.

If you break these rules, your response is invalid.
`;

async function callGroq(messages) {
  const res = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama3-70b-8192",
        messages,
        temperature: 0.2
      })
    }
  );

  const data = await res.json();
  return data.choices[0].message.content;
}

export default async function handler(req, res) {
  try {
    const userMessage = req.body.message;

    const baseMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage }
    ];

    let output = await callGroq(baseMessages);

    // ---- RULE CHECK ----
    if (violatesRules(output)) {
      telemetry.hallucinationAttempts++;
      telemetry.regenerations++;

      // REGENERATE ONCE WITH STRONGER WARNING
      output = await callGroq([
        ...baseMessages,
        {
          role: "system",
          content: "Your previous response violated the rules. Regenerate using ONLY abstract, non-factual language."
        }
      ]);

      // FINAL GUARD
      if (violatesRules(output)) {
        output =
          "I can outline the structure and intent, but specific recommendations are selected using verified location data.";
      }
    }

    res.status(200).json({
      text: output,
      meta: {
        verified: false,
        source: "LLM (structure only)",
        telemetry
      }
    });

  } catch (err) {
    res.status(500).json({ error: "LLM failure" });
  }
}
