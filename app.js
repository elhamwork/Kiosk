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

function recommend() {
  const match = INVENTORY.find((p) =>
    p.symptoms.some((s) => answers.symptoms.includes(s))
  );

  if (!match) {
    addMessageWithDisclaimer(
      "ai",
      "Hmm, I don't have anything on our shelf that's a great fit for that. Best to swing by and chat with our pharmacist — they'll take good care of you."
    );
  } else {
    const card = buildProductCard(match);
    addMessageWithDisclaimer("ai", "Okay, I think this could help you out:", card);
  }
  resetFlow();
}

function buildProductCard(p) {
  const div = document.createElement("div");
  div.className = "product";
  div.innerHTML = `
    <div class="product-head">
      <div class="product-icon">${p.icon || "💊"}</div>
      <h4>${p.name}</h4>
    </div>
    <div class="label">
      <div><strong>Directions:</strong> ${p.directions}</div>
      <div><strong>Dosage:</strong> ${p.dosage}</div>
      <div><strong>Warnings:</strong> ${p.warnings}</div>
      <div><strong>Age restriction:</strong> ${p.ageRestriction}</div>
    </div>
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
