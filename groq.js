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

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Groq API error ${res.status}: ${bodyText.slice(0, 300)}`);
    }
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

// Ranks/picks the best-matching product ids for the form's "top 3" results.
// Crucially, `candidateIds` here is already the *safety-filtered* list from
// app.js (age minimum, allergy tags, pregnancy caution already applied in
// plain code) — the LLM only gets to reorder/select within that safe set,
// never introduce or restore an item app.js already excluded. The raw
// response is still strictly validated against candidateIds before use.
async function groqRankProducts(summary, candidateIds) {
  if (candidateIds.length === 0) return [];
  const messages = [
    {
      role: "system",
      content:
        "You are a strict ranking assistant for an over-the-counter pharmacy kiosk. " +
        `Given a customer's symptoms and answers, rank these candidate product ids from best to worst match: ${candidateIds.join(", ")}. ` +
        "Respond with ONLY a comma-separated list of ids from that exact set, best match first, nothing else. " +
        "Do not include any id not in the list. If none of them are a good fit, respond with exactly: none",
    },
    { role: "user", content: summary },
  ];
  const raw = await groqChat(messages, { maxTokens: 40 });
  const cleaned = raw
    .toLowerCase()
    .split(",")
    .map((s) => s.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  const ranked = cleaned.filter((id) => candidateIds.includes(id));
  return [...new Set(ranked)];
}

// Asks whether a message actually describes a symptom/health concern, so
// app.js can catch greetings, gibberish, or off-topic messages ("hi",
// "huh", "what's up") instead of blindly walking them through the full
// follow-up questionnaire. Purely additive/advisory — app.js still falls
// back to the local keyword list if this fails or is unavailable.
async function groqIsSymptomDescription(userText) {
  const messages = [
    {
      role: "system",
      content:
        "Does the following message describe a symptom, health concern, or something a person " +
        "might want an over-the-counter product for (e.g. pain, allergy, cough, upset stomach)? " +
        "A greeting, small talk, or unclear/gibberish text is NOT a symptom description. " +
        "Reply with ONLY the single word yes or no.",
    },
    { role: "user", content: userText },
  ];
  const raw = await groqChat(messages, { maxTokens: 5 });
  return raw.trim().toLowerCase().startsWith("yes");
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
