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

// Tamil and Tanglish words for every condition (js/triage_tamil.js, generated from medos/triage_tamil.py).
if (typeof TAMIL_KEYWORDS !== "undefined") {
  DEFAULT_CONDITIONS.forEach((c) => (TAMIL_KEYWORDS[c.name] || []).forEach((k) => { if (!c.keywords.includes(k)) c.keywords.push(k); }));
}
const NEGATION = /\b(no|not|without|denies|deny|denied|never|nil|free of|absence of)\b/;
// A keyword must start a word: not preceded by a Latin letter, digit or Tamil character.
const WORD_START = "(?<![a-z0-9\\u0B80-\\u0BFF])";
const TEMP_RE = /(?:fever|temperature|temp)\D{0,20}?(\d{2,3}(?:\.\d)?)\s*(?:°|degrees?|deg)?\s*(f|c|fahrenheit|celsius)?|(\d{2,3}(?:\.\d)?)\s*(?:°|degrees?|deg)\s*(f|c|fahrenheit|celsius)?/gi;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalise(text) {
  return (text || "").toLowerCase().replace(/[’‘]/g, "'").replace(/[ \t]+/g, " ");
}
function _negated(text, start, end = null) {
  let w = text.slice(Math.max(0, start - 40), start);
  w = w.split(/[,.;!?\n]| but | however /).pop();
  if (NEGATION.test(w)) return true;
  // Tamil negates after the word: "நெஞ்சு வலி இல்லை" (no chest pain)
  return end != null && typeof TAMIL_NEGATION !== "undefined" && TAMIL_NEGATION.test(text.slice(end, end + 24));
}
const PHRASE_RE = new Map();
function phraseRegex(phrase) {
  let re = PHRASE_RE.get(phrase);   // compiled once per keyword (there are hundreds with the Tamil words)
  if (!re) {
    re = new RegExp(phrase.endsWith("*")
      ? WORD_START + reEsc(phrase.slice(0, -1)) + "[a-z\\u0B80-\\u0BFF]*"   // prefix: highlight the whole word
      : WORD_START + reEsc(phrase) + "(?:s|es|d|ed|ing)?(?![a-z0-9])", "g");
    PHRASE_RE.set(phrase, re);
  }
  re.lastIndex = 0;
  return re;
}
// First non-negated whole-word match of a phrase, as {index, len}. A trailing '*' makes it a prefix.
function _findPhrase(text, phrase, offset = 0, tamilAfter = true) {
  phrase = phrase.trim();
  if (!phrase) return null;
  const re = phraseRegex(phrase);
  let m;
  while ((m = re.exec(text))) {
    if (!_negated(text, m.index, tamilAfter ? m.index + m[0].length : null)) return { index: m.index + offset, len: m[0].length };
    if (!m[0].length) re.lastIndex++;
  }
  return null;
}
// A keyword is a phrase, or phrases joined by '+' that must share a sentence. Returns the matched spans.
// Tamil puts negation after the whole phrase ("நெஞ்சு வலி இல்லை"), so for a multi-part keyword it is checked once,
// after the last part — not after each part, which would read "ரத்தம் நிற்கவே இல்லை" (won't stop) as "no bleeding".
function keywordSpans(text, keyword) {
  const parts = keyword.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) { const s = _findPhrase(text, parts[0]); return s ? [s] : null; }
  const sentence = /[^.;!?\n]+/g;
  let m;
  while ((m = sentence.exec(text))) {
    const spans = parts.map((p) => _findPhrase(m[0], p, m.index, false));
    if (spans.every(Boolean)) {
      const lastEnd = Math.max(...spans.map((s) => s.index - m.index + s.len));
      if (!(typeof TAMIL_NEGATION !== "undefined" && TAMIL_NEGATION.test(m[0].slice(lastEnd, lastEnd + 24)))) return spans;
    }
  }
  return null;
}

// Whether a keyword occurs at all, negated or not (a multi-part keyword: all parts in one sentence).
function keywordPresent(text, keyword) {
  const parts = keyword.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return false;
  const has = (t, p) => phraseRegex(p).test(t);
  if (parts.length === 1) return has(text, parts[0]);
  return text.split(/[.;!?\n]+/).some((sentence) => parts.every((p) => has(sentence, p)));
}
// True when the text names this condition (one of its keywords) only to deny it: "no chest pain", "நெஞ்சு வலி இல்லை".
// The ML model uses this so it never acts on a symptom the patient said they do NOT have.
function conditionDenied(text, conditionName, conditions = DEFAULT_CONDITIONS) {
  text = normalise(text);
  const c = conditions.find((x) => x.name === conditionName);
  if (!c) return false;
  let mentioned = false;
  for (const kw of c.keywords) {
    if (!kw.trim()) continue;
    if (keywordSpans(text, kw)) return false;       // affirmed somewhere in the text
    if (keywordPresent(text, kw)) mentioned = true;
  }
  // The protocol keywords are phrases ("heavy bleeding"); the simple stems catch "no bleeding" too.
  if (typeof DENIAL_STEMS !== "undefined") {
    for (const stem of DENIAL_STEMS[conditionName] || []) {
      const re = phraseRegex(stem);
      let m;
      while ((m = re.exec(text))) {
        if (!_negated(text, m.index, m.index + m[0].length)) return false;   // mentioned, and not denied
        mentioned = true;
        if (!m[0].length) re.lastIndex++;
      }
    }
  }
  return mentioned;
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

// ---------------------------------------------------------------- check-in parsing (port of medos/checkin.py)
// Same rules as the Python module; tests/test_checkin.py runs both on tests/checkin_cases.json.
const NAME_STOP = new Set(["having", "suffering", "feeling", "not", "very", "a", "an", "the", "sick", "in", "here", "with", "experiencing", "getting", "unable", "so", "really", "from", "coming", "bleeding", "pregnant", "male", "female", "okay", "fine", "going", "also", "age", "aged"]);
const NAME_STOP_EXTRA = new Set(["and", "i", "my", "years", "year", "old", "speaking", "is", "am", "but", "because", "have", "has"]);
const TAMIL_NAME_STOP = new Set(["தான்", "வயசு", "வயது", "எனக்கு", "ஆகுது", "வந்து", "இருக்கேன்", "பேசுறேன்", "ங்க", "சார்", "மேடம்",
  "நான்", "என்", "பெயர்", "பேரு", "பேர்", "thaan", "than", "enakku", "vayasu"]);

// Tamil number words. Spoken Tamil joins tens and units ("இருபத்தஞ்சு" = 25, "முப்பத்தி நாலு" = 34);
// the joined forms are generated from the parts so every combination 1–99 is recognised.
const TA_TEEN = [["பத்தொன்பது|பத்தொம்பது", 19], ["பதினெட்டு", 18], ["பதினேழு", 17], ["பதினாறு", 16], ["பதினைந்து|பதினஞ்சு", 15],
  ["பதினான்கு|பதினாலு", 14], ["பதின்மூன்று|பதிமூணு|பதிமூனு", 13], ["பன்னிரண்டு|பன்னெண்டு|பன்னண்டு", 12],
  ["பதினொன்று|பதினொன்னு|பதினோரு", 11], ["பத்து", 10]];
const TA_UNIT = [["ஒன்பது|ஒம்பது", 9], ["எட்டு", 8], ["ஏழு", 7], ["ஆறு", 6], ["ஐந்து|அஞ்சு", 5], ["நான்கு|நாலு", 4],
  ["மூன்று|மூணு|மூனு", 3], ["இரண்டு|ரெண்டு", 2], ["ஒன்று|ஒன்னு|ஒண்ணு|ஒரு", 1]];
const TA_TENS = [["இருப", 20], ["இருவ", 20], ["முப்ப", 30], ["நாற்ப", 40], ["நாப்ப", 40], ["ஐம்ப", 50], ["அம்ப", 50],
  ["அறுப", 60], ["எழுப", 70], ["எண்ப", 80], ["தொண்ணூ", 90]];
const TA_VOWEL_SIGN = { "அ": "", "ஆ": "ா", "இ": "ி", "ஈ": "ீ", "உ": "ு", "ஊ": "ூ", "எ": "ெ", "ஏ": "ே", "ஐ": "ை", "ஒ": "ொ", "ஓ": "ோ" };
const TA_UNIT_FORMS = [];   // [form, value, joined]
TA_UNIT.forEach(([alts, n]) => alts.split("|").forEach((w) => {
  if (w === "ஒரு") return;                                   // "ஒரு" (a/one) is never part of a joined number
  TA_UNIT_FORMS.push([w, n, false]);
  if (w[0] in TA_VOWEL_SIGN) TA_UNIT_FORMS.push(["த" + TA_VOWEL_SIGN[w[0]] + w.slice(1), n, true]);   // அஞ்சு → தஞ்சு
}));
const TA_UNIT_VALUE = Object.fromEntries(TA_UNIT_FORMS.map(([f, n]) => [f, n]));
const byLenDesc = (a, b) => b.length - a.length;
const TA_PLAIN = [...new Set(TA_UNIT_FORMS.filter((x) => !x[2]).map((x) => x[0]).concat(["ஒரு"]))].sort(byLenDesc).join("|");
const TA_JOINED = [...new Set(TA_UNIT_FORMS.filter((x) => x[2]).map((x) => x[0]))].sort(byLenDesc).join("|");
const TA_NUMBER = new RegExp("(?<![\\u0B80-\\u0BFF])(?:"
  + "(?<stem>" + TA_TENS.map((t) => t[0]).join("|") + ")(?:த்(?:தி|து)?\\s?(?<unit>" + TA_PLAIN + ")|த்(?<joined>" + TA_JOINED + ")|(?<ten>து))"
  + "|(?<ninety>தொண்ணூறு)|(?<teen>" + TA_TEEN.map((t) => t[0]).join("|") + ")|(?<single>" + TA_PLAIN + "))"
  + "(?=\\s|$|[,.!?]|வய|மாச|மாத|வருஷ|வருட)", "g");

function taValue(g) {
  if (g.stem) {
    const tens = TA_TENS.find((t) => t[0] === g.stem)[1];
    return g.ten ? tens : tens + TA_UNIT_VALUE[g.unit || g.joined];
  }
  if (g.ninety) return 90;
  if (g.teen) return TA_TEEN.find(([alts]) => alts.split("|").includes(g.teen))[1];
  return TA_UNIT.find(([alts]) => alts.split("|").includes(g.single))[1];
}
// "பதினெட்டு வயசு" → "18 வயசு". With onlyBeforeAge, only numbers followed by வயசு/வயது change.
function tamilNumbersToDigits(text, onlyBeforeAge = false) {
  return text.replace(TA_NUMBER, (...args) => {
    const groups = args[args.length - 1], offset = args[args.length - 3], match = args[0];
    if (onlyBeforeAge && !/^\s*வய/.test(text.slice(offset + match.length))) return match;
    return String(taValue(groups));
  });
}

// Name: formal and spoken Tamil ("என் பெயர்", "என்னோட பேரு", "என்னுடைய பெயர்") and Tanglish ("ennoda peru").
const TAMIL_NAME = /(?:(?:என்(?:னோட|னுடைய|னுட|து)?|எனது|எந்தன்)\s+(?:பெயர்|பேர்|பேரு|பெயரு)|(?:^|\s)(?:பெயர்|பேரு)|\b(?:en|ennoda|enoda|ennudaya)\s+(?:peru|per|peyar))\s*[:,]?\s*([^\s,.\d]+)/i;
const TAMIL_AGE = /(\d{1,3})\s*(?:வயது|வயசு|வயதாகிறது|வயசாகுது|வயதான|vayasu|vayathu|vayadhu)/;
const TAMIL_AGE_BEFORE = /(?:வயது|வயசு|vayasu|vayathu)\s*[:,]?\s*(\d{1,3})/;
// The whole age phrase, with the words around it: "எனக்கு 18 வயசு ஆகுது", "வயசு 18".
const TAMIL_AGE_STRIP = /(?:எனக்கு\s+)?(?:வந்து\s+)?(?:\d{1,3}\s*(?:வயது|வயசு|வயதாகிறது|வயசாகுது|vayasu|vayathu|vayadhu)\S*|(?:வயது|வயசு)\s*\d{1,3})(?:\s+(?:ஆகுது|ஆகிறது|ஆச்சு|ஆகுதுங்க|aaguthu|aachu))?\s*,?/gi;
// An explicit English age phrase — never a bare duration like "back pain for 3 years".
const AGE_PHRASE_EN = /(?:\b(?:i am|i'm|aged|age is|age)\s+\d{1,3}(?:\s*(?:years?|yrs?)(?:\s*old)?)?|\b\d{1,3}\s*(?:years?|yrs?)\s*old\b)\s*,?/gi;
const TAMIL_FEMALE = /பெண்|அம்மா|மனைவி|மகள்|அக்கா|தங்கை|பாட்டி|அவள்|கர்ப்ப/;
const TAMIL_MALE = /ஆண்|அப்பா|கணவர்|கணவன்|மகன்|அண்ணன்|அண்ணா|தம்பி|தாத்தா|அவன்/;
const TAMIL_PREGNANT = /கர்ப்ப|garbam|karbam/;
// Words that carry no symptom on their own; a clause made only of these is dropped ("எனக்கு வந்து ஆகுது").
const FILLER = new Set(["எனக்கு", "வந்து", "ஆகுது", "ஆகிறது", "ஆச்சு", "ஆகுதுங்க", "நான்", "நானு", "இருக்கேன்", "ங்க", "சார்", "மேடம்",
  "டாக்டர்", "ஹலோ", "வணக்கம்", "சரி", "அப்புறம்", "அது", "இது", "enakku", "vandhu", "aaguthu", "hello", "okay",
  "ok", "so", "and", "um", "uh", "then", "sir", "madam", "doctor"]);
const LEAD_FILLER_EN = new Set(["um", "uh", "so", "okay", "ok", "well", "hello", "hi", "and", "then", "actually", "yeah", "yes"]);
const DURATION_WORDS = new Set(["for", "since", "past", "last", "from", "about", "over", "nearly", "almost"]);
const nfc = (s) => (s || "").normalize("NFC");
const isTamilText = (s) => /[஀-௿]/.test(s || "");

function dropFillerClauses(text) {
  const parts = text.split(/([.,;!?\n]+)/);
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    const words = parts[i].trim().split(/\s+/).filter(Boolean);
    if (words.length && words.every((w) => FILLER.has(w.toLowerCase()))) continue;
    out += parts[i] + (i + 1 < parts.length ? parts[i + 1] : "");
  }
  return out;
}
function tidy(text) {
  const words = text.replace(/^[ ,.]+|[ ,.]+$/g, "").split(" ");
  while (words.length > 1 && LEAD_FILLER_EN.has(words[0].replace(/^[,.]+|[,.]+$/g, "").toLowerCase())) words.shift();   // "um, so I have…"
  text = words.join(" ").replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").replace(/^[ ,.]+|[ ,.]+$/g, "");
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
// [match, bare] for the age in a whole sentence. Explicit age phrases win; a bare "N years" counts only when
// it isn't a duration ("back pain for 3 years" is not an age).
function ageMatch(low) {
  let m = /\b(\d{1,3})\s*(?:years?|yrs?)\s*old\b/.exec(low) || /\b(?:i am|i'm|aged|age is|age)\s+(\d{1,3})\b/.exec(low)
    || TAMIL_AGE.exec(low) || TAMIL_AGE_BEFORE.exec(low);
  let bare = false;
  if (!m) {
    for (const b of low.matchAll(/\b(\d{1,3})\s*(?:years?|yrs?|yr)\b/g)) {
      const before = low.slice(0, b.index).split(/\s+/).filter(Boolean);
      if (!before.length || !DURATION_WORDS.has(before[before.length - 1])) { m = b; bare = true; break; }
    }
  }
  return m && +m[1] > 0 && +m[1] < 120 ? [m, bare] : [null, false];
}

// One free sentence → fields ("my name is Kavitha, 34, fever since two days").
function parseCheckin(text) {
  const raw = tamilNumbersToDigits(wordsToDigits(nfc(text)), true);
  const low = raw.toLowerCase();
  const out = { name: null, age: null, sex: null, phone: null, symptoms: raw.trim(), pregnant: false };

  let nameSpan = null;
  let m = /\b(?:my name is|name is|this is|i am|i'm|im|call me)\s+([a-z][a-z.]*(?:\s+[a-z][a-z.]*){0,2})/.exec(low);
  if (m) {
    const kept = [];
    const start1 = m.index + m[0].length - m[1].length;
    let end = start1;
    for (const w of m[1].matchAll(/[a-z.]+/g)) {
      if (NAME_STOP.has(w[0]) || ["and", "i", "my", "years", "year"].includes(w[0])) break;
      kept.push(w[0]); end = start1 + w.index + w[0].length;
    }
    if (kept.length) { out.name = kept.map((x) => x[0].toUpperCase() + x.slice(1)).join(" "); nameSpan = [m.index, end]; }
  }
  // Tamil / Tanglish: "என் பெயர் கவிதா", "என்னோட பேரு கிருத்திகா", "ennoda peru Kavitha"
  if (!out.name && (m = TAMIL_NAME.exec(raw))) {
    const n = m[1].replace(/^[ .,]+|[ .,]+$/g, "").replace(/ங்க$/, "");   // "கிருத்திகாங்க" → "கிருத்திகா"
    if (n) { out.name = n[0].toUpperCase() + n.slice(1); nameSpan = [m.index, m.index + m[0].length]; }
  }
  const [ageM, ageBare] = ageMatch(low);
  if (ageM) out.age = +ageM[1];
  if (/\b(female|woman|lady|girl|she|her|mother|wife|daughter|pregnant)\b/.test(low) || TAMIL_FEMALE.test(low)) out.sex = "female";
  else if (/\b(male|man|boy|he|his|father|husband|son)\b/.test(low) || TAMIL_MALE.test(low)) out.sex = "male";
  if (/\bpregnan/.test(low) || TAMIL_PREGNANT.test(low)) out.pregnant = true;
  m = /(\+?\d[\d\s-]{8,14}\d)/.exec(raw);
  if (m) { const d = m[1].replace(/\D/g, ""); if (d.length >= 10 && d.length <= 13) out.phone = d; }

  // Cut the name, and a bare "N years" age; the phrase rules below remove "I am 34 years old" and "34 வயசு" whole.
  let sym = raw;
  const spans = [];
  [nameSpan, ageM && ageBare ? [ageM.index, ageM.index + ageM[0].length] : null].filter(Boolean).sort((a, b) => a[0] - b[0]).forEach(([a, b]) => {
    if (spans.length && a <= spans[spans.length - 1][1]) spans[spans.length - 1][1] = Math.max(b, spans[spans.length - 1][1]);
    else spans.push([a, b]);
  });
  spans.reverse().forEach(([a, b]) => { sym = sym.slice(0, a) + " " + sym.slice(b); });
  sym = sym.replace(AGE_PHRASE_EN, "").replace(TAMIL_AGE_STRIP, "")
    .replace(/\b(?:my )?(?:phone|mobile|number)\s*(?:number)?\s*(?:is)?\s*\+?[\d\s-]{8,16}/gi, "");
  sym = tidy(dropFillerClauses(sym));
  if (sym) out.symptoms = sym;
  return out;
}

// ---------------------------------------------------------------- guided check-in: one answer, one field
const NAME_LEAD = [
  "(?:hi|hello|hey|ok|okay|yes|yeah|sir|madam|doctor|um|uh|so|well|good morning|good evening)\\b[\\s,]*",
  "(?:my name is|my name's|my name|name is|the name is|this is|i am|i'm|im|it is|it's|its|call me|myself|me)\\b\\s*",
  "(?:(?:என்(?:னோட|னுடைய|னுட|து)?|எனது|எந்தன்)\\s+(?:பெயர்|பேர்|பேரு|பெயரு))\\s*[:,]?\\s*",
  "(?:பெயர்|பேரு|பேர்)\\s*[:,]?\\s*",
  "(?:நான்|வணக்கம்|ஹலோ|சார்|மேடம்|டாக்டர்)(?=\\s|$|,)[\\s,]*",
  "(?:en|ennoda|enoda|ennudaya)\\s+(?:peru|per|peyar)\\b\\s*",
  "(?:naan|vanakkam)\\b[\\s,]*",
].map((p) => new RegExp("^(?:" + p + ")", "i"));

// The name in an answer to "What is your name?" — "Kavitha", "My name is Ravi Kumar", "என்னோட பேரு கிருத்திகா",
// "நான் கிருத்திகா தான்", "ennoda peru Krithika".
function extractName(answer) {
  let t = nfc(answer).trim().replace(/’/g, "'").replace(/[^A-Za-z0-9_\s.'À-ɏ஀-௿]/g, " ");
  let changed = true;
  while (changed) {                                     // peel off greetings and lead-ins, in any order
    changed = false;
    for (const lead of NAME_LEAD) {
      const m = lead.exec(t);
      if (m && m[0].length > 0) { t = t.slice(m[0].length).replace(/^[ ,.]+/, ""); changed = true; }
    }
  }
  const words = [];
  for (let w of t.split(/\s+/).filter(Boolean)) {
    w = w.replace(/^[.']+|[.']+$/g, "");
    const lw = w.toLowerCase();
    if (!w || NAME_STOP.has(lw) || NAME_STOP_EXTRA.has(lw) || TAMIL_NAME_STOP.has(lw) || /\d/.test(w)) break;
    if (w.length > 4) w = w.replace(/(?:ங்க|தான்)$/, "");   // "கிருத்திகாங்க", "ரவிதான்"
    words.push(w);
    if (words.length === 3) break;
  }
  if (!words.length) return null;
  return words.map((w) => (isTamilText(w) ? w : w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
}

// The age in an answer to "How old are you?" — "34", "thirty-four", "I'm 34 years old", "பதினெட்டு",
// "முப்பத்தி நாலு வயசு", "இருபத்தஞ்சு". A baby's "ஆறு மாசம்" / "6 months" gives 0.
function extractAge(answer) {
  let t = nfc(answer).replace(/(?<=[A-Za-z])-(?=[A-Za-z])/g, " ");
  t = tamilNumbersToDigits(wordsToDigits(t));
  const low = t.toLowerCase();
  const months = /மாச|மாத|\bmonths?\b|\bmnths?\b/.test(low);
  const m = /\b(\d{1,3})\s*(?:years?|yrs?|yr)\b/.exec(low) || /(\d{1,3})\s*(?:வய|வருஷ|வருட)/.exec(low) || /(?<!\d)(\d{1,3})(?!\d)/.exec(low);
  if (!m) return null;
  const n = +m[1];
  if (months && !/\b\d{1,3}\s*(?:years?|yrs?)\b|\d{1,3}\s*(?:வய|வருஷ|வருட)/.test(low)) return n <= 24 ? 0 : null;   // an infant
  return n > 0 && n < 120 ? n : null;
}

// The complaint in an answer to "What is the problem?". Only an explicit name or age phrase and empty filler
// are removed, so "I am diabetic and have fever" keeps every word.
function cleanSymptoms(answer) {
  let t = tamilNumbersToDigits(wordsToDigits(nfc(answer)), true);
  t = t.replace(/\b(?:my name is|my name's|name is)\s+[a-z]+\b[\s,.]*/gi, "");
  const m = TAMIL_NAME.exec(t);
  if (m) t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length);
  t = t.replace(AGE_PHRASE_EN, "").replace(TAMIL_AGE_STRIP, "");
  return tidy(dropFillerClauses(t));
}
