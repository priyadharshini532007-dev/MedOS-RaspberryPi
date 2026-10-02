// MedOS Web — rule-based symptom analysis (a faithful port of medos/triage.py) and the
// spoken check-in parser (medos/voice.py parse_checkin). Runs fully offline in the browser.
"use strict";

const LEVEL_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const LEVEL_BASE = { critical: 1500, high: 600, medium: 300, low: 0 };

// Ten red flags (rank 0, always Critical) above the project's 15-row priority table.
const DEFAULT_CONDITIONS = [
  { name: "Chest pain / suspected heart attack", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "Possible cardiac event — minutes matter",
    keywords: ["chest pain", "pain in chest", "chest tightness", "tight chest", "heart attack", "crushing chest", "chest pressure", "cardiac", "left arm pain+sweat", "pain in my chest", "chest+tight*", "chest+heavy", "chest+squeez*"] },
  { name: "Breathing difficulty", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "Airway or breathing compromise",
    keywords: ["difficulty breathing", "difficulty in breathing", "can't breathe", "cannot breathe", "cant breathe", "unable to breathe", "shortness of breath", "short of breath", "breathless", "gasping", "choking", "severe asthma", "blue lips", "not able to breathe", "breathing difficulty", "breath*+difficult*", "breath*+trouble", "hard to breathe", "can't catch my breath", "lips+blu*", "struggling to breathe"] },
  { name: "Stroke signs", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "Time-critical brain injury",
    keywords: ["stroke", "face drooping", "facial droop", "slurred speech", "one side weak", "weakness on one side", "paralysis", "paralysed", "paralyzed", "sudden confusion", "can't move one side", "face+droop*", "slurr*", "mouth+droop*"] },
  { name: "Unconscious / collapsed", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "Unresponsive patient",
    keywords: ["unconscious", "unresponsive", "fainted", "collapsed", "passed out", "not responding", "not breathing", "blacked out", "not waking up", "fainting"] },
  { name: "Severe bleeding", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "Risk of shock from blood loss",
    keywords: ["heavy bleeding", "bleeding heavily", "severe bleeding", "profuse bleeding", "won't stop bleeding", "not stopping bleeding", "vomiting blood", "coughing blood", "blood in vomit", "hemorrhage", "haemorrhage", "lot of blood", "bleeding+a lot", "vomited blood", "coughing up blood", "blood in sputum", "blood in cough"] },
  { name: "Seizure", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "Active or recent seizure",
    keywords: ["seizure", "fits", "fitting", "convulsion", "epileptic attack"] },
  { name: "Severe allergic reaction", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "Possible anaphylaxis",
    keywords: ["anaphylaxis", "anaphylactic", "throat swelling", "swollen throat", "tongue swelling", "severe allergic", "face swelling+allergy", "lips swelling+allergy", "swell*+throat", "swell*+tongue"] },
  { name: "Major trauma", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "High-energy injury",
    keywords: ["road accident", "accident", "head injury", "fall from height", "stab wound", "stabbed", "stabbing", "gunshot", "crush injury", "hit by a", "hit by car", "hit by bike", "hit+head", "fell from height", "fell from the roof", "fell from a building", "fell from a tree", "fell from the terrace"] },
  { name: "Poisoning / bite / overdose", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "Toxic exposure",
    keywords: ["poison", "overdose", "snake bite", "snakebite", "scorpion sting", "pesticide", "swallowed chemical", "suicide attempt", "consumed poison", "rat poison", "kerosene", "snake+bit*", "bitten by a snake"] },
  { name: "Severe burns / electric shock", rank: 0, level: "critical", red_flag: true, department: "Emergency", reason: "Burn or electrical injury",
    keywords: ["severe burn", "major burn", "electric shock", "electrocuted", "burnt badly", "badly burned", "burn+face", "caught fire", "acid attack", "burn*+severe"] },
  // ---- the project's priority table
  { name: "Severe abdominal pain", rank: 1, level: "high", department: "General Surgery", reason: "Could require urgent treatment",
    keywords: ["severe+abdominal pain", "severe+stomach pain", "severe+abdomen", "severe+belly", "stomach+paining a lot", "stomach+unbearable", "stomach+very severe", "severe+tummy", "unbearable+stomach", "unbearable+abdominal", "intense+abdominal", "acute abdomen", "appendicitis", "very bad stomach pain", "severe abdominal"] },
  { name: "Fracture", rank: 2, level: "high", department: "Orthopaedics", reason: "Painful, risk of further injury",
    keywords: ["fracture", "broken bone", "broken arm", "broken leg", "broken wrist", "broken ankle", "bone broke", "dislocat*", "cannot move my arm", "cannot move my leg"] },
  { name: "High fever (>102°F)", rank: 3, level: "high", department: "General Medicine", reason: "May indicate serious infection",
    keywords: ["high fever", "very high fever", "high temperature", "burning with fever", "fever+shivering"] },
  { name: "Severe migraine/headache", rank: 4, level: "medium", department: "Neurology", reason: "Needs attention but usually stable",
    keywords: ["migraine", "severe+headache", "bad headache", "splitting headache", "worst headache", "severe head pain"] },
  { name: "Persistent vomiting", rank: 5, level: "medium", department: "General Medicine", reason: "Risk of dehydration",
    keywords: ["persistent vomiting", "keeps vomiting", "keep vomiting", "continuous vomiting", "repeated vomiting", "can't stop vomiting", "vomiting since", "vomiting+diarrhea", "vomiting+diarrhoea", "dehydrat*", "vomiting many times"] },
  { name: "Asthma attack (mild)", rank: 6, level: "medium", department: "Pulmonology", reason: "Monitor closely", keywords: ["asthma", "wheez*", "inhaler"] },
  { name: "Chest infection", rank: 7, level: "medium", department: "Pulmonology", reason: "Moderate priority",
    keywords: ["chest infection", "bronchitis", "pneumonia", "phlegm", "chest congestion", "productive cough", "cough with sputum"] },
  { name: "Back pain", rank: 8, level: "low", department: "Orthopaedics", reason: "Non-life-threatening",
    keywords: ["back pain", "backache", "back ache", "lower back", "spine pain", "neck pain"] },
  { name: "Stomach pain (mild)", rank: 9, level: "low", department: "Gastroenterology", reason: "Moderate discomfort",
    keywords: ["stomach pain", "stomach ache", "stomachache", "abdominal pain", "tummy ache", "belly pain", "stomach+pain*", "abdomen+pain*", "tummy+pain*", "belly+pain*", "gastric", "acidity", "indigestion", "stomach upset", "vomiting", "loose motion", "diarrhea", "diarrhoea"] },
  { name: "Ear pain", rank: 10, level: "low", department: "ENT", reason: "Low urgency",
    keywords: ["ear pain", "earache", "ear ache", "ear infection", "pain in ear", "pain in my ear"] },
  { name: "Sore throat", rank: 11, level: "low", department: "ENT", reason: "Low urgency",
    keywords: ["sore throat", "throat pain", "tonsil", "tonsillitis", "throat infection", "pain in throat", "difficulty swallowing"] },
  { name: "Skin allergy/rash", rank: 12, level: "low", department: "Dermatology", reason: "Usually non-urgent",
    keywords: ["rash", "itching", "itchy", "skin allergy", "hives", "eczema", "allergy"] },
  { name: "Cold & cough", rank: 13, level: "low", department: "General Medicine", reason: "Common illness",
    keywords: ["cold", "cough", "runny nose", "sneez*", "blocked nose", "nasal congestion"] },
  { name: "Mild fever", rank: 14, level: "low", department: "General Medicine", reason: "Lowest among fever cases",
    keywords: ["fever", "feverish", "temperature", "chills", "body ache", "kaichal", "bukhar"] },
  { name: "Routine check-up", rank: 15, level: "low", department: "General Medicine", reason: "Can wait the longest",
    keywords: ["check-up", "checkup", "check up", "routine", "follow-up", "follow up", "review visit", "prescription", "bp check", "sugar check", "blood pressure check", "medical certificate", "vaccination"] },
];

const NEGATION = /\b(no|not|without|denies|deny|denied|never|nil|free of|absence of)\b/;
const TEMP_RE = /(?:fever|temperature|temp)\D{0,20}?(\d{2,3}(?:\.\d)?)\s*(?:°|degrees?|deg)?\s*(f|c|fahrenheit|celsius)?|(\d{2,3}(?:\.\d)?)\s*(?:°|degrees?|deg)\s*(f|c|fahrenheit|celsius)?/gi;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalise(text) {
  return (text || "").toLowerCase().replace(/[’‘]/g, "'").replace(/[ \t]+/g, " ");
}
function _negated(text, start) {
  let w = text.slice(Math.max(0, start - 40), start);
  w = w.split(/[,.;!?\n]| but | however /).pop();
  return NEGATION.test(w);
}
// First non-negated whole-word match of a phrase, as {index, len}. A trailing '*' makes it a prefix.
function _findPhrase(text, phrase, offset = 0) {
  phrase = phrase.trim();
  if (!phrase) return null;
  const pat = phrase.endsWith("*")
    ? "(?<![a-z0-9])" + reEsc(phrase.slice(0, -1)) + "[a-z]*"
    : "(?<![a-z0-9])" + reEsc(phrase) + "(?:s|es|d|ed|ing)?(?![a-z0-9])";
  const re = new RegExp(pat, "g");
  let m;
  while ((m = re.exec(text))) {
    if (!_negated(text, m.index)) return { index: m.index + offset, len: m[0].length };
    if (!m[0].length) re.lastIndex++;
  }
  return null;
}
// A keyword is a phrase, or phrases joined by '+' that must share a sentence. Returns the matched spans.
function keywordSpans(text, keyword) {
  const parts = keyword.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) { const s = _findPhrase(text, parts[0]); return s ? [s] : null; }
  const sentence = /[^.;!?\n]+/g;
  let m;
  while ((m = sentence.exec(text))) {
    const spans = parts.map((p) => _findPhrase(m[0], p, m.index));
    if (spans.every(Boolean)) return spans;
  }
  return null;
}

function parseTemperatureF(text) {
  TEMP_RE.lastIndex = 0;
  let m;
  while ((m = TEMP_RE.exec(text))) {
    const value = m[1] || m[3];
    const unit = (m[2] || m[4] || "").toLowerCase();
    if (!value) continue;
    let t = parseFloat(value);
    if (unit.startsWith("c") || (!unit && t >= 34 && t <= 43)) t = (t * 9) / 5 + 32;
    if (t >= 93 && t <= 110) return Math.round(t * 10) / 10;
  }
  return null;
}
const _num = (v) => (v === null || v === undefined || v === "" || isNaN(+v) ? null : +v);
function tempToF(v) { const t = _num(v); return t == null ? null : t < 50 ? Math.round(((t * 9) / 5 + 32) * 10) / 10 : t; }
function baseScore(level, rank, bonus = 0) { return (LEVEL_BASE[level] || 0) + (16 - Math.max(0, Math.min(rank, 15))) * 10 + bonus; }

// Return the triage decision for one patient.
function analyse(symptoms, age = null, vitals = {}, pregnant = false, conditions = DEFAULT_CONDITIONS) {
  const text = normalise(symptoms);
  vitals = vitals || {};
  const matched = [], reasons = [], redFlags = [], spans = [];

  for (const cond of conditions) {
    if (cond.active === false) continue;
    for (const kw of cond.keywords) {
      const s = kw.trim() && keywordSpans(text, kw);
      if (s) {
        matched.push({ name: cond.name, rank: cond.rank, level: cond.level, keyword: kw.trim(), reason: cond.reason, department: cond.department, red_flag: !!cond.red_flag });
        s.forEach((x) => spans.push({ ...x, level: cond.level }));
        break;
      }
    }
  }

  const tempF = tempToF(vitals.temp) || parseTemperatureF(text);
  if (tempF != null && tempF >= 102) {
    const c = conditions.find((c) => c.rank === 3);
    if (c && !matched.some((m) => m.rank === c.rank))
      matched.push({ name: c.name, rank: c.rank, level: c.level, keyword: tempF.toFixed(1) + "°F", reason: c.reason, department: c.department, red_flag: false });
  }

  let level = "low", rank = 15, primary = null, department = null;
  if (matched.length) {
    matched.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.rank - b.rank);
    const top = matched[0];
    ({ level, rank, name: primary, department } = top);
    matched.forEach((m) => m.red_flag && redFlags.push(m.name));
    reasons.push(`${top.name} — ${top.reason || "protocol match"}`);
  } else {
    rank = 12; primary = "Unclassified complaint"; department = "General Medicine";
    reasons.push("No protocol match — confirm at the desk");
  }

  let bonus = 0;
  const floor = (newLevel, why, flag = false) => {
    if (LEVEL_ORDER[newLevel] < LEVEL_ORDER[level]) {
      level = newLevel;
      if (newLevel === "critical") { rank = 0; primary = why; }
    }
    reasons.push(why);
    if (flag) redFlags.push(why);
  };
  const spo2 = _num(vitals.spo2), hr = _num(vitals.pulse), sbp = _num(vitals.bp_sys), pain = _num(vitals.pain);
  if (spo2 != null) { if (spo2 < 90) floor("critical", `SpO₂ ${spo2}% — low oxygen`, true); else if (spo2 < 94) floor("high", `SpO₂ ${spo2}% — below normal`); }
  if (hr != null) { if (hr >= 130 || hr <= 40) floor("critical", `Pulse ${hr} bpm — unstable`, true); else if (hr > 110) floor("medium", `Pulse ${hr} bpm — fast`); }
  if (sbp != null) { if (sbp < 90) floor("critical", `BP ${sbp} systolic — low`, true); else if (sbp >= 180) floor("high", `BP ${sbp} systolic — very high`); }
  if (tempF != null && tempF >= 104) floor("high", `Temperature ${tempF.toFixed(1)}°F — very high`);
  if (pain != null && pain >= 8) { floor("medium", `Pain score ${pain}/10`); bonus += 40; }

  const a = _num(age);
  if (a != null) {
    if (a >= 65) { bonus += 40; reasons.push(`Age ${a} — elderly`); }
    else if (a <= 5) { bonus += 40; reasons.push(`Age ${a} — young child`); }
  }
  if (pregnant) {
    bonus += 60; reasons.push("Pregnant");
    if (matched.some((m) => m.rank === 1 || m.rank === 9) || text.includes("bleeding")) floor("high", "Pregnancy with abdominal pain or bleeding");
  }
  if (redFlags.length && level !== "critical") { level = "critical"; rank = 0; }

  return {
    level, rank, base_score: baseScore(level, rank, bonus), primary_condition: primary, department,
    conditions: matched.map((m) => ({ name: m.name, rank: m.rank, level: m.level, keyword: m.keyword })),
    red_flags: [...new Set(redFlags)], reasons: [...new Set(reasons)], temp_f: tempF, bonus, spans,
  };
}

// Wrap the words that drove the decision in <mark>, coloured by the level they point to.
function highlightSymptoms(raw, spans) {
  if (!spans || !spans.length) return esc(raw);
  const norm = normalise(raw);
  if (norm.length !== raw.length) return esc(raw);   // spans index the normalised text; only safe when lengths match
  const sorted = [...spans].sort((a, b) => a.index - b.index);
  let out = "", at = 0;
  for (const s of sorted) {
    if (s.index < at) continue;
    out += esc(raw.slice(at, s.index)) + `<mark data-level="${s.level}">${esc(raw.slice(s.index, s.index + s.len))}</mark>`;
    at = s.index + s.len;
  }
  return out + esc(raw.slice(at));
}

// ---------------------------------------------------------------- spoken sentence → form fields
const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function wordsToDigits(text) {
  const tokens = text.match(/[a-zA-Z]+|\d+|[^\sa-zA-Z\d]+|\s+/g) || [];
  const isNum = (t) => { t = t.toLowerCase(); return t in UNITS || t in TENS || t === "hundred"; };
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isNum(tokens[i])) { out.push(tokens[i++]); continue; }
    let current = 0, j = i, lastJ = i;
    while (j < tokens.length) {
      const t = tokens[j].toLowerCase();
      if (/^\s+$/.test(t) || (t === "and" && current)) { j++; continue; }
      if (t in UNITS) current += UNITS[t];
      else if (t in TENS) current += TENS[t];
      else if (t === "hundred") current = Math.max(current, 1) * 100;
      else break;
      lastJ = j; j++;
    }
    const seq = tokens.slice(i, lastJ + 1).map((t) => t.toLowerCase()).filter((t) => t.trim() && t !== "and");
    out.push(seq.length >= 6 && seq.every((s) => s in UNITS) ? seq.map((s) => UNITS[s]).join("") : String(current));
    i = lastJ + 1;
  }
  return out.join("");
}

const NAME_STOP = new Set(["having", "suffering", "feeling", "not", "very", "a", "an", "the", "sick", "in", "here", "with", "experiencing", "getting", "unable", "so", "really", "from", "coming", "bleeding", "pregnant", "male", "female", "okay", "fine", "going", "also", "age", "aged", "and", "i", "my", "years", "year"]);

function parseCheckin(text) {
  const raw = wordsToDigits(text || "");
  const low = raw.toLowerCase();
  const out = { name: null, age: null, sex: null, phone: null, symptoms: raw.trim(), pregnant: false };

  let nameSpan = null;
  let m = /\b(?:my name is|name is|this is|i am|i'm|im|call me)\s+([a-z][a-z.]*(?:\s+[a-z][a-z.]*){0,2})/.exec(low);
  if (m) {
    const kept = [];
    let end = m.index + m[0].length - m[1].length;
    const start1 = end;
    const wre = /[a-z.]+/g;
    let w;
    while ((w = wre.exec(m[1]))) {
      if (NAME_STOP.has(w[0])) break;
      kept.push(w[0]); end = start1 + w.index + w[0].length;
    }
    if (kept.length) { out.name = kept.map((x) => x[0].toUpperCase() + x.slice(1)).join(" "); nameSpan = [m.index, end]; }
  }
  m = /\b(\d{1,3})\s*(?:years?|yrs?|yr)(?:\s*old)?\b/.exec(low) || /\b(?:age|aged)\s*(?:is\s*)?(\d{1,3})\b/.exec(low);
  if (m && +m[1] > 0 && +m[1] < 120) out.age = +m[1];
  if (/\b(female|woman|lady|girl|she|her|mother|wife|daughter|pregnant)\b/.test(low)) out.sex = "female";
  else if (/\b(male|man|boy|he|his|father|husband|son)\b/.test(low)) out.sex = "male";
  if (/\bpregnan/.test(low)) out.pregnant = true;
  m = /(\+?\d[\d\s-]{8,14}\d)/.exec(raw);
  if (m) { const d = m[1].replace(/\D/g, ""); if (d.length >= 10 && d.length <= 13) out.phone = d; }

  let sym = raw;
  if (nameSpan) sym = sym.slice(0, nameSpan[0]) + " " + sym.slice(nameSpan[1]);
  sym = sym.replace(/\b(?:i am|i'm)\s+\d{1,3}\s*(?:years?|yrs?)(?:\s*old)?/gi, "")
    .replace(/\b(?:my )?(?:phone|mobile|number)\s*(?:number)?\s*(?:is)?\s*\+?[\d\s-]{8,16}/gi, "")
    .replace(/\s{2,}/g, " ").replace(/^[\s,.]+|[\s,.]+$/g, "");
  if (sym) out.symptoms = sym[0].toUpperCase() + sym.slice(1);
  return out;
}
