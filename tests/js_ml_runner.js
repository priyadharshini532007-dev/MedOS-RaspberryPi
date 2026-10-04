// Runs the website's ML model (website/ml/triage_model.js + website/js/ml.js) on the reference sentences and prints
// the predictions as JSON, so tests/test_ml.py can check the JavaScript gives the same answers as medos/ml_triage.py.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const web = path.join(__dirname, "..", "website");
const ctx = { console, atob: (s) => Buffer.from(s, "base64").toString("binary") };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext("const LEVEL_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };", ctx);
vm.runInContext(fs.readFileSync(path.join(web, "ml", "triage_model.js"), "utf8"), ctx, { filename: "triage_model.js" });
vm.runInContext(fs.readFileSync(path.join(web, "js", "ml.js"), "utf8"), ctx, { filename: "ml.js" });
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "ml", "reports", "reference_predictions.json"), "utf8"));
const out = ref.rows.map((r) => vm.runInContext(
  `(() => { const p = ML.predict(${JSON.stringify(r.text)}, ${JSON.stringify(r.age)}, ${JSON.stringify(r.vitals)}, ${!!r.pregnant});
    return p && { level: p.level, confidence: p.confidence, condition: p.condition, conditionConfidence: p.conditionConfidence, department: p.department }; })()`, ctx));
process.stdout.write(JSON.stringify(out));
