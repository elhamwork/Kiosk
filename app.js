const EMERGENCY_KEYWORDS = [
  "chest pain", "difficulty breathing", "can't breathe", "cant breathe",
  "severe allergic", "anaphylaxis", "stroke", "face drooping",
  "unconscious", "passed out", "seizure", "heavy bleeding",
  "poison", "overdose", "suicid", "severe burn", "infant fever",
  "high fever in a baby",
];

const DISCLAIMER = "This kiosk provides information about over-the-counter products only. It does not provide medical advice or diagnoses. Always read the product label before use and consult a pharmacist or healthcare professional if you have questions or if your symptoms worsen or do not improve.";

const EMERGENCY_MESSAGE = "Your symptoms may require immediate medical attention. Please seek emergency care or speak with a healthcare professional immediately.";

const FOLLOW_UPS = [
  { key: "age", question: "Got it. What is your age?" },
  { key: "duration", question: "How long have you had these symptoms?" },
  { key: "allergies", question: "Do you have any allergies?" },
  { key: "pregnancy", question: "Are you pregnant or nursing? (yes/no/not applicable)" },
  { key: "medications", question: "Are you currently taking any other medications?" },
];

const chatEl = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("input");

let step = "symptoms";
let followUpIndex = 0;
let answers = {};

addMessage("ai", "Hi, what symptoms are you experiencing today?");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addMessage("user", text);
  input.value = "";
  handleInput(text);
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

  // conversation finished, restart
  resetFlow();
  addMessage("ai", "What symptoms are you experiencing today?");
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
      "No suitable OTC product is available for these symptoms. Please consult a pharmacist."
    );
  } else {
    const card = buildProductCard(match);
    addMessageWithDisclaimer("ai", "Based on what you shared, here is an OTC option:", card);
  }
  resetFlow();
}

function buildProductCard(p) {
  const div = document.createElement("div");
  div.className = "product";
  div.innerHTML = `
    <h4>${p.name}</h4>
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

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addMessageWithDisclaimer(role, text, extraNode) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const textNode = document.createElement("span");
  textNode.textContent = text;
  div.appendChild(textNode);
  if (extraNode) div.appendChild(extraNode);
  const disc = document.createElement("span");
  disc.className = "disclaimer";
  disc.textContent = DISCLAIMER;
  div.appendChild(disc);
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}
