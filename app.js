const EMERGENCY_KEYWORDS = [
  "chest pain", "difficulty breathing", "can't breathe", "cant breathe",
  "severe allergic", "anaphylaxis", "stroke", "face drooping",
  "unconscious", "passed out", "seizure", "heavy bleeding",
  "poison", "overdose", "suicid", "severe burn", "infant fever",
  "high fever in a baby",
];

// Required exact text — do not reword. Always appended in code, never
// something the LLM generates or can omit.
const DISCLAIMER = "This kiosk provides information about over-the-counter products only. It does not provide medical advice or diagnoses. Always read the product label before use and consult a pharmacist or healthcare professional if you have questions or if your symptoms worsen or do not improve.";
const EMERGENCY_MESSAGE = "Your symptoms may require immediate medical attention. Please seek emergency care or speak with a healthcare professional immediately.";

// Fixed, code-enforced follow-up sequence. The LLM cannot skip, reorder,
// or talk its way out of any of these — app.js always asks all five,
// regardless of what the user's messages say.
const FOLLOW_UPS = [
  { key: "age", question: "Got it, thanks for telling me. How old are you?" },
  { key: "duration", question: "How long has this been going on?" },
  { key: "allergies", question: "Any allergies I should know about?" },
  { key: "pregnancy", question: "Are you pregnant or nursing? (just so I recommend safely) — yes, no, or n/a" },
  { key: "medications", question: "Last one — are you taking any other medications right now?" },
];

// Deterministic keyword fallback, used if the symptom text can't be
// classified locally and Groq is unavailable.
const SYMPTOM_KEYWORDS = [
  "headache", "fever", "pain", "sore throat", "body ache", "inflammation", "cramps",
  "allergy", "allergies", "runny nose", "sneezing", "itchy eyes", "hives", "itching",
  "insomnia", "cough", "congestion", "mucus", "heartburn", "indigestion",
  "upset stomach", "rash", "insect bite", "diarrhea", "nausea",
];

const chatEl = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("input");

let step = "symptoms";
let followUpIndex = 0;
let answers = {};

addMessage("ai", "Hey there 👋 I'm here to help. What's going on today?");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addMessage("user", text);
  input.value = "";
  handleInput(text);
});

async function handleInput(text) {
  const lower = text.toLowerCase();

  // Hard safety gate — runs in plain code, before any LLM call, on every
  // single message regardless of conversation state. Cannot be bypassed
  // by prompt injection because the LLM is never consulted to decide
  // whether this branch fires.
  if (EMERGENCY_KEYWORDS.some((k) => lower.includes(k))) {
    addMessage("emergency", EMERGENCY_MESSAGE);
    resetFlow();
    return;
  }

  // Secondary, LLM-assisted emergency check. Purely additive: it can only
  // add a positive on top of the keyword gate above, never remove it and
  // never suppress it — if this call fails or is inconclusive we simply
  // continue with the normal flow, so the kiosk never breaks because of it.
  try {
    if (await groqIsEmergency(text)) {
      addMessage("emergency", EMERGENCY_MESSAGE);
      resetFlow();
      return;
    }
  } catch (err) {
    // ignore — keyword gate above is the real safety net
  }

  if (step === "symptoms") {
    answers.symptoms = lower;
    step = "followups";
    followUpIndex = 0;
    await respondWarmly(text);
    askNextFollowUp();
    return;
  }

  if (step === "followups") {
    const current = FOLLOW_UPS[followUpIndex];
    answers[current.key] = lower;
    followUpIndex++;
    if (followUpIndex < FOLLOW_UPS.length) {
      askNextFollowUp();
    } else {
      await recommend();
    }
    return;
  }

  resetFlow();
  addMessage("ai", "What's going on today?");
}

async function respondWarmly(userText) {
  try {
    const reply = await groqFriendlyReply(userText);
    if (reply) addMessage("ai", reply);
  } catch (err) {
    // Groq unavailable — silently skip the extra warmth, flow continues.
  }
}

function askNextFollowUp() {
  addMessage("ai", FOLLOW_UPS[followUpIndex].question);
}

async function recommend() {
  addMessage("ai", "One sec, let me see what fits best...");

  const allowedIds = INVENTORY.map((p) => p.id);
  let matchedId = null;

  try {
    const summary = buildSummary();
    const classified = await groqClassifyProduct(summary, allowedIds);
    // Strict whitelist check — the raw LLM string is NEVER used directly.
    // Anything other than an exact, known id (including "none" or garbage
    // output from a prompt-injection attempt) falls through safely.
    if (allowedIds.includes(classified)) {
      matchedId = classified;
    }
  } catch (err) {
    // Groq unavailable — fall back to deterministic local matching below.
  }

  if (!matchedId) {
    const local = INVENTORY.find((p) => p.symptoms.some((s) => answers.symptoms.includes(s)));
    matchedId = local?.id || null;
  }

  const product = INVENTORY.find((p) => p.id === matchedId);

  if (!product) {
    addMessageWithDisclaimer(
      "ai",
      "Hmm, I don't have anything approved that's a great fit for that. Best to swing by and chat with our pharmacist — they'll take good care of you."
    );
  } else {
    const card = buildProductCard(product);
    addMessageWithDisclaimer("ai", "Okay, I think this could help you out:", card);
  }

  resetFlow();
}

function buildSummary() {
  return [
    `Symptoms: ${answers.symptoms}`,
    `Age: ${answers.age}`,
    `Duration: ${answers.duration}`,
    `Allergies: ${answers.allergies}`,
    `Pregnant/nursing: ${answers.pregnancy}`,
    `Other medications: ${answers.medications}`,
  ].join("\n");
}

function buildProductCard(p) {
  const div = document.createElement("div");
  div.className = "product";

  const rows = [
    ["Purpose", p.purpose],
    ["Directions", p.directions],
    ["Warnings", p.warnings],
    ["Age restriction", p.ageRestriction],
  ].filter(([, value]) => Boolean(value));

  const labelHtml = rows
    .map(([label, value]) => `<div><strong>${label}:</strong> ${value}</div>`)
    .join("");

  div.innerHTML = `
    <div class="product-head">
      <div class="product-icon">${p.icon}</div>
      <h4>${p.name}</h4>
    </div>
    <div class="label">${labelHtml}</div>
  `;
  return div;
}

function resetFlow() {
  step = "symptoms";
  followUpIndex = 0;
  answers = {};
}

function avatarFor(role) {
  if (role === "user") return "🙂";
  if (role === "emergency") return "⚠️";
  return "❤️";
}

function addMessage(role, text) {
  const row = document.createElement("div");
  row.className = `row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${role}`;
  avatar.textContent = avatarFor(role);

  const bubble = document.createElement("div");
  bubble.className = "msg";
  bubble.textContent = text;

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addMessageWithDisclaimer(role, text, extraNode) {
  const row = document.createElement("div");
  row.className = `row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${role}`;
  avatar.textContent = avatarFor(role);

  const bubble = document.createElement("div");
  bubble.className = "msg";

  const textNode = document.createElement("span");
  textNode.textContent = text;
  bubble.appendChild(textNode);
  if (extraNode) bubble.appendChild(extraNode);

  const disc = document.createElement("span");
  disc.className = "disclaimer";
  disc.textContent = DISCLAIMER;
  bubble.appendChild(disc);

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}
