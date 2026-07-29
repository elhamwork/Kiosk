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

const SYMPTOM_KEYWORDS = [
  "headache", "fever", "pain", "sore throat", "body ache", "inflammation", "cramps",
  "allergy", "allergies", "runny nose", "sneezing", "itchy eyes", "hives", "itching",
  "insomnia", "cough", "congestion", "mucus", "heartburn", "indigestion",
  "upset stomach", "rash", "insect bite", "diarrhea", "nausea",
];

const NON_ANSWERS = new Set([
  "hi", "hello", "hey", "yo", "sup", "huh", "what", "?", "??", "idk",
  "i dont know", "i don't know", "dunno", "who", "hm", "hmm", "test",
]);

function isNonAnswer(text) {
  return NON_ANSWERS.has(text.trim().toLowerCase());
}

// Deterministic keyword match first; Groq can only ADD a rejection for
// things that dodge the keyword+non-answer check (e.g. "what's up"), never
// widen what counts as valid, and any failure just falls back to accepting
// the input so the kiosk keeps working offline.
async function looksLikeSymptom(text) {
  if (SYMPTOM_KEYWORDS.some((k) => text.includes(k))) return true;
  if (isNonAnswer(text)) return false;
  try {
    return await groqIsSymptomDescription(text);
  } catch (err) {
    console.warn("[groq] symptom-check unavailable, defaulting to accept:", err.message);
    return true;
  }
}

async function isEmergency(text) {
  // Hard safety gate — plain code, cannot be bypassed by prompt injection
  // because the LLM is never consulted to decide whether this fires.
  if (EMERGENCY_KEYWORDS.some((k) => text.includes(k))) return true;
  // Secondary, LLM-assisted check — purely additive, never removes the
  // keyword gate above, and any failure just means "no extra signal".
  try {
    return await groqIsEmergency(text);
  } catch (err) {
    console.warn("[groq] emergency-check unavailable, relying on keyword gate only:", err.message);
    return false;
  }
}

const form = document.getElementById("lookup-form");
const symptomInput = document.getElementById("symptom");
const ageSelect = document.getElementById("age");
const genderSelect = document.getElementById("gender");
const pregnancyField = document.getElementById("pregnancy-field");
const pregnancySelect = document.getElementById("pregnancy");
const allergySelect = document.getElementById("allergy");
const durationSelect = document.getElementById("duration");
const medicationsInput = document.getElementById("medications");
const goButton = form.querySelector(".go-button");
const resultsSection = document.getElementById("results");
const resultsList = document.getElementById("results-list");
const resultsDisclaimer = document.getElementById("results-disclaimer");

genderSelect.addEventListener("change", updatePregnancyVisibility);
updatePregnancyVisibility();

function updatePregnancyVisibility() {
  const hide = genderSelect.value === "male";
  pregnancyField.classList.toggle("hidden", hide);
  if (hide) pregnancySelect.value = "na";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const symptomText = symptomInput.value.trim();
  if (!symptomText) return;

  goButton.disabled = true;
  goButton.textContent = "Checking...";
  clearResults();

  try {
    const lower = symptomText.toLowerCase();

    if (await isEmergency(lower)) {
      showEmergency();
      return;
    }

    if (!(await looksLikeSymptom(lower))) {
      showNoMatch("Hmm, that doesn't sound like a symptom to me — could you tell me a bit more about what's bothering you?");
      return;
    }

    await runRecommendation(lower);
  } finally {
    goButton.disabled = false;
    goButton.textContent = "Go";
  }
});

async function runRecommendation(symptomText) {
  const age = Number(ageSelect.value);
  const allergy = allergySelect.value;
  const pregnant = pregnancySelect.value === "yes";

  // Deterministic, code-enforced safety filter — applied BEFORE the LLM
  // ever sees anything. The LLM (below) can only rank or drop items from
  // this already-safe candidate list; it can never add an item back that
  // was excluded here, no matter what a user types.
  const candidates = INVENTORY.filter((p) => {
    const symptomMatch = p.symptoms.some((s) => symptomText.includes(s));
    const ageOk = age >= p.ageMin;
    const allergyOk = allergy === "none" || allergy === "other" || !p.allergyTags.includes(allergy);
    const pregnancyOk = !(pregnant && p.pregnancyCaution);
    return symptomMatch && ageOk && allergyOk && pregnancyOk;
  });

  if (candidates.length === 0) {
    showNoMatch("I don't have anything approved that's a safe fit for that. Best to check with our pharmacist — they'll take good care of you.");
    return;
  }

  const candidateIds = candidates.map((p) => p.id);
  let rankedIds = [];

  try {
    const summary = buildSummary(symptomText);
    const ranked = await groqRankProducts(summary, candidateIds);
    // Strict whitelist check — every id must already be in our
    // safety-filtered candidate list, or it's discarded.
    rankedIds = ranked.filter((id) => candidateIds.includes(id));
    console.info("[groq] ranking succeeded:", rankedIds);
  } catch (err) {
    console.warn("[groq] ranking unavailable, falling back to local keyword scoring:", err.message);
  }

  if (rankedIds.length === 0) {
    rankedIds = [...candidates]
      .sort((a, b) => matchScore(b, symptomText) - matchScore(a, symptomText))
      .map((p) => p.id);
  }

  const top = rankedIds.slice(0, 3).map((id) => INVENTORY.find((p) => p.id === id));
  showResults(top);
}

function matchScore(product, symptomText) {
  return product.symptoms.filter((s) => symptomText.includes(s)).length;
}

function buildSummary(symptomText) {
  return [
    `Symptoms: ${symptomText}`,
    `Age: ${ageSelect.options[ageSelect.selectedIndex].text}`,
    `Gender: ${genderSelect.value}`,
    `Duration: ${durationSelect.options[durationSelect.selectedIndex].text}`,
    `Allergy: ${allergySelect.options[allergySelect.selectedIndex].text}`,
    `Pregnant/nursing: ${pregnancySelect.value}`,
    `Other medications: ${medicationsInput.value.trim() || "none"}`,
  ].join("\n");
}

function clearResults() {
  resultsSection.hidden = true;
  resultsSection.classList.remove("emergency");
  resultsList.innerHTML = "";
  resultsDisclaimer.textContent = "";
  const existingBanner = document.querySelector(".emergency-banner");
  if (existingBanner) existingBanner.remove();
}

function showEmergency() {
  clearResults();
  const banner = document.createElement("div");
  banner.className = "emergency-banner";
  banner.textContent = EMERGENCY_MESSAGE;
  form.insertAdjacentElement("afterend", banner);
}

function showNoMatch(message) {
  resultsSection.hidden = false;
  resultsList.innerHTML = "";
  const li = document.createElement("li");
  li.className = "no-match";
  li.textContent = message;
  resultsList.appendChild(li);
  resultsDisclaimer.textContent = DISCLAIMER;
}

function showResults(products) {
  resultsSection.hidden = false;
  resultsList.innerHTML = "";
  products.forEach((p, i) => {
    resultsList.appendChild(buildResultCard(p, i + 1));
  });
  resultsDisclaimer.textContent = DISCLAIMER;
}

function buildResultCard(p, rank) {
  const li = document.createElement("li");
  li.className = "result-card";

  const rows = [
    ["Purpose", p.purpose],
    ["Directions", p.directions],
    ["Warnings", p.warnings],
    ["Age restriction", p.ageRestriction],
  ];
  const detailsHtml = rows.map(([label, value]) => `<div><strong>${label}:</strong> ${value}</div>`).join("");

  li.innerHTML = `
    <div class="result-head">
      <div class="result-rank">${rank}</div>
      <div class="result-icon">${p.icon}</div>
      <div class="result-name">${p.name}</div>
    </div>
    <div class="result-details">${detailsHtml}</div>
  `;
  return li;
}
