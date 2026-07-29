const EMERGENCY_KEYWORDS = [
  "chest pain", "difficulty breathing", "can't breathe", "cant breathe",
  "severe allergic", "anaphylaxis", "stroke", "face drooping",
  "unconscious", "passed out", "seizure", "heavy bleeding",
  "poison", "overdose", "suicid", "severe burn", "infant fever",
  "high fever in a baby",
];

// Required exact text — do not reword.
const DISCLAIMER = "This kiosk provides information about over-the-counter products only. It does not provide medical advice or diagnoses. Always read the product label before use and consult a pharmacist or healthcare professional if you have questions or if your symptoms worsen or do not improve.";
const EMERGENCY_MESSAGE = "Your symptoms may require immediate medical attention. Please seek emergency care or speak with a healthcare professional immediately.";

const FOLLOW_UPS = [
  { key: "age", question: "Got it, thanks for telling me. How old are you?" },
  { key: "duration", question: "How long has this been going on?" },
  { key: "allergies", question: "Any allergies I should know about?" },
  { key: "pregnancy", question: "Are you pregnant or nursing? (just so I recommend safely) — yes, no, or n/a" },
  { key: "medications", question: "Last one — are you taking any other medications right now?" },
];

// Recognized symptom keywords used to query the real openFDA OTC drug label
// database (https://open.fda.gov/apis/drug/label/) — no local product list.
const SYMPTOM_KEYWORDS = [
  "headache", "fever", "pain", "sore throat", "body ache", "inflammation", "cramps",
  "allergy", "allergies", "runny nose", "sneezing", "itchy eyes", "hives", "itching",
  "insomnia", "cough", "congestion", "mucus", "heartburn", "indigestion",
  "upset stomach", "rash", "insect bite", "diarrhea", "constipation", "nausea",
];

const CATEGORY_ICONS = {
  headache: "💊", fever: "💊", pain: "💊", "sore throat": "💊",
  "body ache": "💊", inflammation: "💊", cramps: "💊",
  allergy: "🤧", allergies: "🤧", "runny nose": "🤧", sneezing: "🤧",
  "itchy eyes": "🤧", hives: "🤧", itching: "🤧", insomnia: "😴",
  cough: "🍯", congestion: "🍯", mucus: "🍯",
  heartburn: "🌿", indigestion: "🌿", "upset stomach": "🌿",
  rash: "🩹", "insect bite": "🩹", diarrhea: "🌿", constipation: "🌿", nausea: "🌿",
};

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
  setTimeout(() => handleInput(text), 300);
});

function handleInput(text) {
  const lower = text.toLowerCase();

  if (step === "symptoms") {
    if (isEmergency(lower)) {
      addMessage("emergency", EMERGENCY_MESSAGE);
      resetFlow();
      return;
    }
    answers.symptoms = lower;
    step = "followups";
    followUpIndex = 0;
    askNextFollowUp();
    return;
  }

  if (step === "followups") {
    if (isEmergency(lower)) {
      addMessage("emergency", EMERGENCY_MESSAGE);
      resetFlow();
      return;
    }
    const current = FOLLOW_UPS[followUpIndex];
    answers[current.key] = lower;
    followUpIndex++;
    if (followUpIndex < FOLLOW_UPS.length) {
      askNextFollowUp();
    } else {
      recommend();
    }
    return;
  }

  resetFlow();
  addMessage("ai", "What's going on today?");
}

function askNextFollowUp() {
  addMessage("ai", FOLLOW_UPS[followUpIndex].question);
}

function isEmergency(text) {
  return EMERGENCY_KEYWORDS.some((k) => text.includes(k));
}

function extractSymptomKeyword(text) {
  return SYMPTOM_KEYWORDS.find((k) => text.includes(k)) || null;
}

async function recommend() {
  const keyword = extractSymptomKeyword(answers.symptoms);

  if (!keyword) {
    addMessageWithDisclaimer(
      "ai",
      "I couldn't quite match that to something in our OTC database. Best to swing by and chat with our pharmacist — they'll take good care of you."
    );
    resetFlow();
    return;
  }

  addMessage("ai", "One sec, let me check what we've got for that...");

  try {
    const product = await fetchOtcProduct(keyword);
    if (!product) {
      addMessageWithDisclaimer(
        "ai",
        "Hmm, I don't have anything approved that's a great fit for that. Best to swing by and chat with our pharmacist — they'll take good care of you."
      );
    } else {
      const card = buildProductCard(product);
      addMessageWithDisclaimer("ai", "Okay, I think this could help you out:", card);
    }
  } catch (err) {
    addMessageWithDisclaimer(
      "ai",
      "I'm having trouble reaching our product database right now. Best to check with our pharmacist so you get the right thing."
    );
  }

  resetFlow();
}

// Queries the public, no-auth openFDA drug label API, restricted to
// HUMAN OTC DRUG products only — never prescription/controlled items.
async function fetchOtcProduct(keyword) {
  const query = `openfda.product_type:"HUMAN OTC DRUG" AND (purpose:"${keyword}" OR indications_and_usage:"${keyword}")`;
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(query)}&limit=5`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  let data;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    data = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  const results = data.results || [];
  const result = results.find((r) => firstOf(r.purpose) || firstOf(r.indications_and_usage));
  if (!result) return null;

  return {
    name: firstOf(result.openfda?.brand_name) || firstOf(result.openfda?.generic_name) || "OTC Product",
    icon: CATEGORY_ICONS[keyword] || "💊",
    purpose: firstOf(result.purpose),
    directions: firstOf(result.dosage_and_administration),
    warnings: firstOf(result.warnings) || firstOf(result.warnings_and_cautions) || firstOf(result.stop_use),
    ageRestriction: extractAgeRestriction(result),
  };
}

function firstOf(field) {
  return Array.isArray(field) && field.length ? field[0] : null;
}

function extractAgeRestriction(result) {
  const text = [
    firstOf(result.warnings),
    firstOf(result.warnings_and_cautions),
    firstOf(result.pediatric_use),
    firstOf(result.do_not_use),
  ]
    .filter(Boolean)
    .join(" ");

  const match = text.match(/[^.]*\b\d{1,2}\s*years?\s*of\s*age[^.]*\./i);
  return match ? match[0].trim() : "See product label for age restrictions.";
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
