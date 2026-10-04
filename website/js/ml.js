// MedOS Web — machine-learning triage, running in the browser (port of medos/ml_triage.py).
//
// Trained by ml/train.py on the synthetic English / Tamil / Tanglish dataset in ml/data/. Two heads share one
// text representation:
//   priority   Critical / High / Medium / Low — an upgrade-only second opinion to the rules (it can raise a
//              priority when at least 75% confident, never lower one)
//   condition  which protocol condition the complaint describes, and so its department — booking uses it to
//              find the right specialist, and it explains a Tamil complaint in English even offline.
// Features: whole words, word pairs and 3–5 character pieces (TF-IDF) + standardised vitals; weights are 8-bit
// integers with one scale per class. tokens() must stay identical to the Python one — tests/test_ml.py checks
// this file against the Python predictions.
// The model file (ml/triage_model.js) loads in the background after the page appears; until then predict()
// returns null and pages redraw when it arrives.
"use strict";

const ML = (() => {
  const NUMERIC = ["age", "temp", "pulse", "spo2", "bp_sys", "pain"];
  const KEEP = /[^0-9a-z஀-௿]+/g;
  const CHAR_N = [3, 4, 5];
  let m = null, inverse = null, resolveReady;
  const ready = new Promise((res) => (resolveReady = res));

  function b64ToInt8(s) {
    const bin = atob(s);
    const out = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;   // byte → signed
    return out;
  }
  function init(model) {
    if (!model || m) return;
    model.priority.q = b64ToInt8(model.priority.w);
    model.condition.q = b64ToInt8(model.condition.w);
    model.nText = model.idf.length;
    m = model;
    resolveReady(m);
    if (typeof emit === "function") emit("ml");        // pages redraw their ML panels
  }
  if (typeof window !== "undefined" && window.MEDOS_ML_MODEL) init(window.MEDOS_ML_MODEL);
  else if (typeof document !== "undefined") {
    const load = () => {
      const s = document.createElement("script");
      s.src = "ml/triage_model.js";
      s.async = true;
      s.onload = () => init(window.MEDOS_ML_MODEL);
      s.onerror = () => console.warn("ML model could not be loaded; the rules still work");
      document.head.appendChild(s);
    };
    if (document.readyState === "complete") setTimeout(load, 0); else window.addEventListener("load", () => setTimeout(load, 0));
  }

  // The text features of one complaint — identical to medos/ml_triage.py tokens().
  function tokens(text) {
    const t = (text || "").normalize("NFC").toLowerCase();
    const words = t.replace(KEEP, " ").split(" ").filter(Boolean);
    const out = [];
    words.forEach((w) => { if (w.length >= 2) out.push("w:" + w); });
    for (let i = 0; i + 1 < words.length; i++) out.push("b:" + words[i] + " " + words[i + 1]);
    words.forEach((w) => {
      const p = " " + w + " ";
      CHAR_N.forEach((n) => { for (let i = 0; i + n <= p.length; i++) out.push("c:" + p.slice(i, i + n)); });
    });
    return out;
  }
  const num = (v) => (v === null || v === undefined || v === "" || isNaN(+v) ? null : +v);
  function numericRaw(age, vitals, pregnant) {
    const values = { age: num(age) };
    NUMERIC.slice(1).forEach((k) => (values[k] = num((vitals || {})[k])));
    const raw = [];
    NUMERIC.forEach((k) => { const v = values[k]; raw.push(v == null ? 0 : v, v == null ? 0 : 1); });
    const a = values.age;
    raw.push(pregnant ? 1 : 0, a != null && (a >= 65 || a <= 5) ? 1 : 0);
    return raw;
  }
  function textVector(text) {
    const counts = new Map();
    tokens(text).forEach((t) => { if (t in m.vocab) counts.set(t, (counts.get(t) || 0) + 1); });
    const x = new Map();
    counts.forEach((c, t) => { const i = m.vocab[t]; x.set(i, (1 + Math.log(c)) * m.idf[i]); });
    const norm = Math.sqrt([...x.values()].reduce((s, v) => s + v * v, 0));
    if (norm) x.forEach((v, i) => x.set(i, v / norm));
    return x;
  }
  function softmax(head, x, width) {
    const logits = head.intercept.map((b, k) => {
      let z = 0;
      const row = k * width;
      x.forEach((v, i) => (z += head.q[row + i] * v));
      return b + head.scale[k] * z;
    });
    const top = Math.max(...logits);
    const exps = logits.map((z) => Math.exp(z - top));
    const total = exps.reduce((s, e) => s + e, 0);
    const out = {};
    head.classes.forEach((c, k) => (out[c] = exps[k] / total));
    return out;
  }
  const argmax = (p) => Object.keys(p).reduce((best, c) => (p[c] > p[best] ? c : best));

  // Priority and condition for one complaint — or null when the model isn't loaded, there's no text, or it
  // recognises none of the words (it gives no opinion rather than guessing).
  function predict(symptoms, age = null, vitals = {}, pregnant = false) {
    if (!m || !(symptoms || "").trim()) return null;
    const xText = textVector(symptoms);
    if (!xText.size) return null;
    const n = m.nText, width = n + m.numeric.mean.length;
    const x = new Map(xText);
    numericRaw(age, vitals, pregnant).forEach((v, j) => { const z = (v - m.numeric.mean[j]) / m.numeric.scale[j]; if (z) x.set(n + j, z); });
    const probabilities = softmax(m.priority, x, width);
    const level = argmax(probabilities);
    const cond = softmax(m.condition, xText, n);
    const condition = argmax(cond);
    if (!inverse) { inverse = []; Object.entries(m.vocab).forEach(([t, i]) => (inverse[i] = t)); }
    const k = m.priority.classes.indexOf(level);
    const topTerms = [...xText.entries()].filter(([i]) => inverse[i].startsWith("w:"))
      .map(([i, v]) => [m.priority.q[k * width + i] * v, inverse[i].slice(2)])
      .filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 4).map(([, t]) => t);
    return { level, confidence: probabilities[level], probabilities, topTerms,
      condition, conditionConfidence: cond[condition], department: m.condition.department[condition], conditionLevel: m.condition.level[condition] };
  }
  // The level the model argues for: when it is confident which condition this is, that condition's protocol level
  // (Stroke signs → critical, Routine check-up → low); otherwise the priority head's answer, if it is confident
  // and the condition head agrees.
  function targetLevel(pred) {
    if (!m || !pred) return null;
    const cc = pred.conditionConfidence;
    // safety first: the more serious the condition, the less sure the model needs to be before it raises a priority
    const need = (m.condition_threshold_by_level || {})[pred.conditionLevel] ?? (m.condition_threshold || 0.55);
    if (cc >= need) return pred.conditionLevel;
    // the priority head may act alone only if it is confident AND the condition head leans the same way
    if (cc >= (m.condition_support || 0.25) && pred.confidence >= (m.upgrade_threshold || 0.75) && pred.level === pred.conditionLevel) return pred.level;
    return null;
  }
  // The text only mentions the predicted condition to deny it ("no chest pain", "நெஞ்சு வலி இல்லை").
  const denied = (pred, text) => !!text && typeof conditionDenied === "function" && conditionDenied(text, pred.condition);
  // The level to raise to, or null. Upgrade-only: the model can raise a priority, never lower it. With the text,
  // a symptom the patient denies never raises anything.
  function upgrade(rulesLevel, pred, text) {
    const t = targetLevel(pred);
    if (!t || LEVEL_ORDER[t] >= LEVEL_ORDER[rulesLevel]) return null;
    return denied(pred, text) ? null : t;
  }
  // The predicted condition when the model is sure enough to act on it (booking, offline explanation).
  function confidentCondition(pred, text) {
    if (!m || !pred) return null;
    if (pred.conditionConfidence >= (m.condition_threshold || 0.55) && pred.condition !== "Unclassified complaint") return denied(pred, text) ? null : pred.condition;
    return null;
  }

  return {
    get available() { return !!m; }, get model() { return m; }, get metrics() { return m ? m.metrics : null; },
    ready, predict, upgrade, targetLevel, confidentCondition, tokens,
  };
})();

// A small panel showing the model's opinion next to the rules result.
function mlPanel(pred, rulesLevel, { compact = false, text = "" } = {}) {
  if (!pred) return "";
  // It doesn't know what this complaint is (unfamiliar wording, or not a symptom): say so, rather than show a
  // priority it has no basis for. The rules still decide.
  if (pred.conditionConfidence < 0.25 && pred.confidence < 0.85) {
    return `<div class="ml-box"><div class="ml-title">${icon("cpu")}ML model: not sure what this means yet</div>
      <p class="t-small" style="margin-top:4px">The rules decide the priority. Add a few more words (what hurts, since when) and it will try again.</p></div>`;
  }
  const up = ML.upgrade(rulesLevel, pred, text);
  const cond = ML.confidentCondition(pred, text);
  const t = ML.targetLevel(pred);
  const deniedHere = !up && !!text && t && LEVEL_ORDER[t] < LEVEL_ORDER[rulesLevel] && typeof conditionDenied === "function" && conditionDenied(text, pred.condition);
  const verdict = up ? `<b>Raises the priority to ${LEVEL_LABEL[up]}</b> (confident, and more urgent than the rules).`
    : deniedHere ? `You said you do <b>not</b> have ${esc(pred.condition.toLowerCase())}, so the rules level stays.`
    : pred.level === rulesLevel ? "Agrees with the rules."
    : LEVEL_ORDER[pred.level] > LEVEL_ORDER[rulesLevel] ? "Rates it lower — the model can never lower a priority, so the rules level stays."
    : `Rates it higher but is only ${Math.round(pred.confidence * 100)}% sure (needs 75%), so the rules level stays.`;
  return `<div class="ml-box"><div class="ml-title">${icon("cpu")}ML model: ${LEVEL_LABEL[pred.level]} · ${Math.round(pred.confidence * 100)}% confident</div>
    ${cond ? `<p class="t-small" style="margin-top:4px"><b>Understood as:</b> ${esc(cond)} <span class="muted">· ${esc(pred.department)} · ${Math.round(pred.conditionConfidence * 100)}%</span></p>` : ""}
    ${compact ? "" : `<div class="ml-bars">${LEVELS.map((l) => `<div class="ml-bar"><span>${LEVEL_LABEL[l]}</span><i><b style="width:${Math.round(pred.probabilities[l] * 100)}%;background:${LEVEL_COLOR[l]}"></b></i><em>${Math.round(pred.probabilities[l] * 100)}%</em></div>`).join("")}</div>`}
    <p class="t-small" style="margin-top:6px">${verdict}${pred.topTerms.length ? ` <span class="muted">Key words: ${pred.topTerms.map(esc).join(", ")}.</span>` : ""}</p></div>`;
}
