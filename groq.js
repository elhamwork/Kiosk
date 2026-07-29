// Thin wrapper around the Groq chat completions API.
//
// Safety model: the LLM is only ever used for two low-stakes jobs —
// (1) phrasing a warm, friendly acknowledgment, and (2) picking a product
// id from a fixed whitelist. It never sees or controls the disclaimer,
// the emergency check, or the actual product data shown to the user —
// those are enforced entirely in app.js in plain code, so no amount of
// prompt injection in the chat box can change what gets recommended or
// suppress a safety message. If the LLM is unreachable or returns
// anything outside the expected shape, callers fall back to deterministic
// local logic.

async function groqChat(messages, { maxTokens = 200, timeoutMs = 8000 } = {}) {
  if (typeof GROQ_API_KEY !== "string" || !GROQ_API_KEY || GROQ_API_KEY.includes("YOUR_GROQ_API_KEY")) {
    throw new Error("Groq API key not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: typeof GROQ_MODEL === "string" ? GROQ_MODEL : "llama-3.3-70b-versatile",
        messages,
        temperature: 0.4,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Groq API error ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("Malformed Groq response");
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

// Asks the LLM to react warmly to what the user just said, in one short
// sentence. Never allowed to mention products, dosages, or diagnoses —
// enforced by instruction here, and harmless even if ignored since this
// text is only ever shown as a lead-in before the next fixed follow-up
// question or fixed disclaimer text, never as the safety-critical content
// itself.
async function groqFriendlyReply(userText) {
  const messages = [
    {
      role: "system",
      content:
        "You are a warm, upbeat pharmacy kiosk assistant chatting like a caring friend. " +
        "Reply in ONE short casual sentence reacting to what the customer just said. " +
        "Never suggest a product, dosage, diagnosis, or medical advice in this reply — " +
        "just a brief, friendly acknowledgment.",
    },
    { role: "user", content: userText },
  ];
  return groqChat(messages, { maxTokens: 60 });
}

// Asks the LLM to classify the conversation into exactly one product id
// from the given whitelist (or "none"). The raw text response is NEVER
// trusted directly — app.js strictly validates it against the same
// whitelist before using it for anything.
async function groqClassifyProduct(summary, allowedIds) {
  const messages = [
    {
      role: "system",
      content:
        "You are a strict classifier for an over-the-counter pharmacy kiosk. " +
        `Given a customer's symptoms and answers, respond with ONLY one of these exact ids, nothing else, no punctuation: ${allowedIds.join(", ")}, none. ` +
        "Pick the single best-matching OTC product id. If nothing fits well, or the symptoms sound like they need a doctor or pharmacist rather than a simple OTC product, respond with exactly: none",
    },
    { role: "user", content: summary },
  ];
  const raw = await groqChat(messages, { maxTokens: 10 });
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Secondary, best-effort emergency classifier. This is purely additive —
// it can only ever ADD a positive, never remove the deterministic keyword
// check in app.js, which stays the real safety net.
async function groqIsEmergency(userText) {
  const messages = [
    {
      role: "system",
      content:
        "Does the following message describe symptoms that could be a medical emergency " +
        "requiring immediate care (e.g. chest pain, trouble breathing, severe allergic reaction, " +
        "stroke signs, unconsciousness, seizure, heavy bleeding, poisoning, suicidal thoughts, " +
        "severe burns, high fever in an infant)? Reply with ONLY the single word yes or no.",
    },
    { role: "user", content: userText },
  ];
  const raw = await groqChat(messages, { maxTokens: 5 });
  return raw.trim().toLowerCase().startsWith("yes");
}
