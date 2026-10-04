// Runs the website's check-in parser (website/js/triage.js) on tests/checkin_cases.json and prints the results
// as JSON, so tests/test_checkin.py can check the JavaScript gives the same answers as medos/checkin.py.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const web = path.join(__dirname, "..", "website", "js");
const ctx = { console };
vm.createContext(ctx);
for (const f of ["triage_tamil.js", "denial.js", "triage.js"]) vm.runInContext(fs.readFileSync(path.join(web, f), "utf8"), ctx, { filename: f });
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "checkin_cases.json"), "utf8"));
const call = (fn, arg) => vm.runInContext(`${fn}(${JSON.stringify(arg)})`, ctx);
const out = {
  name: cases.name.map(([input]) => call("extractName", input)),
  age: cases.age.map(([input]) => call("extractAge", input)),
  symptoms: cases.symptoms.map(([input]) => call("cleanSymptoms", input)),
  parse: cases.parse.map(([input]) => call("parseCheckin", input)),
  denied: cases.denied.map(([text, cond]) => vm.runInContext(`conditionDenied(${JSON.stringify(text)}, ${JSON.stringify(cond)})`, ctx)),
  triage: cases.triage.map(([input]) => vm.runInContext(`(() => { const t = analyse(${JSON.stringify(input)}); return [t.level, t.primary_condition]; })()`, ctx)),
};
process.stdout.write(JSON.stringify(out));
