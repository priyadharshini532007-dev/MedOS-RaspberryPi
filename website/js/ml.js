// MedOS Web — machine-learning priority model, running in the browser.
//
// The model is trained by ml/train.py (TF-IDF of the symptoms + standardised vital signs → multinomial
// logistic regression) on the synthetic dataset in ml/data/, and exported to ml/triage_model.js. This
// file reproduces scikit-learn's prediction in plain JavaScript, so nothing is sent to a server.
// Like on the Pi, the model is an upgrade-only second opinion: it can raise a priority when it is at
// least 75% confident, and never lowers one.
"use strict";

const ML = (() => {
  const m = window.MEDOS_ML_MODEL || null;
  const NUMERIC = ["age", "temp", "pulse", "spo2", "bp_sys", "pain"];
  // scikit-learn's default token pattern (?u)\b\w\w+\b: runs of 2+ word characters
  const TOKEN = /[\p{L}\p{M}\p{N}_]{2,}/gu;
  const num = (v) => (v === null || v === undefined || v === "" || isNaN(+v) ? null : +v);
  let inverse = null;

  function features(symptoms, age, vitals, pregnant) {
    const { vocabulary, idf, sublinear_tf } = m.tfidf;
    const tokens = (symptoms || "").toLowerCase().match(TOKEN) || [];
    const grams = tokens.concat(tokens.slice(0, -1).map((t, i) => t + " " + tokens[i + 1]));
    const counts = new Map();
    grams.forEach((g) => { if (g in vocabulary) counts.set(g, (counts.get(g) || 0) + 1); });
    const x = new Map();
    counts.forEach((c, g) => { const i = vocabulary[g]; x.set(i, (sublinear_tf ? 1 + Math.log(c) : c) * idf[i]); });
    const norm = Math.sqrt([...x.values()].reduce((s, v) => s + v * v, 0));
    if (norm) x.forEach((v, i) => x.set(i, v / norm));

    const values = { age: num(age) };
    NUMERIC.slice(1).forEach((k) => (values[k] = num((vitals || {})[k])));
    const raw = [];
    NUMERIC.forEach((k) => { const v = values[k]; raw.push(v == null ? 0 : v, v == null ? 0 : 1); });
    const a = values.age;
    raw.push(pregnant ? 1 : 0, a != null && (a >= 65 || a <= 5) ? 1 : 0);
    const base = idf.length;
    raw.forEach((v, j) => { const z = (v - m.numeric.mean[j]) / m.numeric.scale[j]; if (z) x.set(base + j, z); });
    return x;
  }

  // {level, confidence, probabilities, topTerms} — or null when there is no model or no symptoms.
  function predict(symptoms, age = null, vitals = {}, pregnant = false) {
    if (!m || !(symptoms || "").trim()) return null;
    const x = features(symptoms, age, vitals, pregnant);
    // The model was trained on English. If it recognises none of the words (e.g. a Tamil sentence) it
    // gives no opinion, rather than guessing from vital signs alone; the rules (which know Tamil) decide.
    if (![...x.keys()].some((i) => i < m.tfidf.idf.length)) return null;
    const logits = m.coef.map((w, k) => { let z = m.intercept[k]; x.forEach((v, i) => (z += w[i] * v)); return z; });
    const top = Math.max(...logits);
    const exps = logits.map((z) => Math.exp(z - top));
    const total = exps.reduce((s, e) => s + e, 0);
    const probabilities = {};
    m.classes.forEach((c, k) => (probabilities[c] = exps[k] / total));
    const level = m.classes.reduce((best, c) => (probabilities[c] > probabilities[best] ? c : best), m.classes[0]);
    if (!inverse) { inverse = []; Object.entries(m.tfidf.vocabulary).forEach(([t, i]) => (inverse[i] = t)); }
    const k = m.classes.indexOf(level);
    const topTerms = [...x.entries()].filter(([i]) => inverse[i]).map(([i, v]) => [m.coef[k][i] * v, inverse[i]])
      .filter(([s]) => s > 0).sort((p, q) => q[0] - p[0]).slice(0, 4).map(([, t]) => t);
    return { level, confidence: probabilities[level], probabilities, topTerms };
  }

  // The level to raise to, or null. Upgrade-only, and only when the model is confident enough.
  function upgrade(rulesLevel, pred) {
    if (!m || !pred) return null;
    return LEVEL_ORDER[pred.level] < LEVEL_ORDER[rulesLevel] && pred.confidence >= (m.upgrade_threshold || 0.75) ? pred.level : null;
  }

  return { available: !!m, predict, upgrade, model: m, metrics: m ? m.metrics : null };
})();

// A small panel showing the model's opinion next to the rules result.
function mlPanel(pred, rulesLevel, { compact = false } = {}) {
  if (!pred) return "";
  const up = ML.upgrade(rulesLevel, pred);
  const verdict = up ? `<b>Raises the priority to ${LEVEL_LABEL[up]}</b> (confident, and more urgent than the rules).`
    : pred.level === rulesLevel ? "Agrees with the rules."
    : LEVEL_ORDER[pred.level] > LEVEL_ORDER[rulesLevel] ? "Rates it lower — the model can never lower a priority, so the rules level stays."
    : `Rates it higher but is only ${Math.round(pred.confidence * 100)}% sure (needs 75%), so the rules level stays.`;
  return `<div class="ml-box"><div class="ml-title">${icon("cpu")}ML model: ${LEVEL_LABEL[pred.level]} · ${Math.round(pred.confidence * 100)}% confident</div>
    ${compact ? "" : `<div class="ml-bars">${LEVELS.map((l) => `<div class="ml-bar"><span>${LEVEL_LABEL[l]}</span><i><b style="width:${Math.round(pred.probabilities[l] * 100)}%;background:${LEVEL_COLOR[l]}"></b></i><em>${Math.round(pred.probabilities[l] * 100)}%</em></div>`).join("")}</div>`}
    <p class="t-small" style="margin-top:6px">${verdict}${pred.topTerms.length ? ` <span class="muted">Key words: ${pred.topTerms.map(esc).join(", ")}.</span>` : ""}</p></div>`;
}
