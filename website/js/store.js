// MedOS Web — state and scheduling, all in the browser.
//
// Ports medos/scheduler.py (dynamic priority + aging + pre-emption + multi-server ETA), medos/pharmacy.py
// (FCFS) and medos/ambulance.py (SJF hospital choice and dispatch). State lives in localStorage, so every
// open tab (reception, doctor, TV display, the patient's phone view) sees the same queue, and a change in
// one tab reaches the others through the browser's `storage` event — the web version of the Pi's
// Server-Sent Events.
"use strict";

const STATE_KEY = "medos.web.state.v1";
const PREEMPT_FLOOR = 1450;
const EMERGENCY_BONUS = 5000;
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const LEVEL_WAIT_FACTOR = { critical: 0, high: 0.3, medium: 1.0, low: 1.5 };   // share of a reported wait each level actually waits
const AMB_AGING_PER_MIN = 0.5;
const LOAD_MIN = 2, HANDOVER_MIN = 3;   // at the pickup, and at the hospital door (5 min in total, as on the Pi)
const SPECIALIST_FOR = [["chest pain", "Cardiology"], ["heart", "Cardiology"], ["cardiac", "Cardiology"], ["stroke", "Neurology"], ["seizure", "Neurology"],
  ["trauma", "Orthopaedics"], ["fracture", "Orthopaedics"], ["burn", "Burns"], ["pregnan", "Obstetrics"]];

const DEFAULT_SETTINGS = {
  hospital_name: "City General Hospital", aging_rate: 5, aging_cap: 450, preemption: "emergency", auto_dispatch: true,
  dur: { critical: 25, high: 15, medium: 10, low: 7 }, ml_triage: true, ambulance_speed_kmh: 30, pharmacy_prep_min: 4, demo_speed: 10, announce: true,
  notify_ahead: 2,
};

let S = null;
const listeners = new Set();
const TAB_ID = Math.random().toString(36).slice(2);

// ------------------------------------------------------------------ persistence and cross-tab sync
function load() {
  const saved = store(STATE_KEY);
  if (saved && saved.v === 1) { S = saved; S.settings = { ...DEFAULT_SETTINGS, ...S.settings, dur: { ...DEFAULT_SETTINGS.dur, ...(S.settings || {}).dur } }; return; }
  freshState();
  seedDemo();
}
function save(reason = "change") {
  if (S.events.length > 400) S.events = S.events.slice(-300);
  try { localStorage.setItem(STATE_KEY, JSON.stringify(S)); }
  catch (e) { // storage full: drop the oldest finished history and retry
    S.patients = S.patients.filter((p) => p.status === "waiting" || p.status === "in_consultation" || Date.now() - p.arrived < 6 * 3600e3);
    S.events = S.events.slice(-100);
    try { localStorage.setItem(STATE_KEY, JSON.stringify(S)); } catch { /* keep running in memory */ }
  }
  emit(reason);
}
function emit(reason) { listeners.forEach((fn) => { try { fn(reason); } catch (e) { console.error(e); } }); }
function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
window.addEventListener("storage", (e) => {
  if (e.key === STATE_KEY && e.newValue) { try { S = JSON.parse(e.newValue); emit("sync"); } catch { /* ignore */ } }
});

function freshState() {
  const t = Date.now();
  S = { v: 1, created: t, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    seq: { patient: 0, token: 0, alert: 0, order: 0, amb: 0, voice: 0, booking: 0, event: 0 },
    rooms: [], doctors: [], patients: [], alerts: [], events: [], pharmacy: [], ambRequests: [], ambulances: [], bookings: [], voice: [] };
  SEED_ROOMS.forEach(([name, kind], i) => S.rooms.push({ id: i + 1, name, kind, status: "open" }));
  SEED_DOCTORS.forEach(([name, specialty, room], i) => S.doctors.push({ id: i + 1, name, specialty, roomId: S.rooms.find((r) => r.name === room).id, status: "off_duty", currentId: null, since: t }));
  let n = 0;
  HOSPITALS.forEach((h) => { for (let k = 0; k < h.ambulances; k++) S.ambulances.push({ id: ++n, name: `AMB-${String(n).padStart(2, "0")}`, baseId: h.id, status: "available", requestId: null, since: t }); });
}
const nextId = (k) => ++S.seq[k];
const today = () => new Date().toISOString().slice(0, 10);
const settings = () => S.settings;
const randCode = (len = 6) => Array.from({ length: len }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

function log(kind, msg, patientId = null) {
  S.events.push({ id: nextId("event"), ts: Date.now(), kind, msg, patientId });
}

// ------------------------------------------------------------------ scoring
function scoreParts(p, t = Date.now()) {
  const waitMin = Math.max(0, (t - p.arrived) / 60000);
  const aging = Math.min(S.settings.aging_rate * waitMin, S.settings.aging_cap);
  const pre = p.preempted ? Math.max(0, PREEMPT_FLOOR - p.base - aging) : 0;
  const em = p.emergency ? EMERGENCY_BONUS : 0;
  return { base: p.base, aging: Math.round(aging * 10) / 10, preempt: pre, emergency: em, total: Math.round((p.base + aging + pre + em) * 10) / 10 };
}
// Which hospital a patient belongs to. Patients saved before bookings covered every hospital are City General's.
const SELF_ID = 1;
const hospOf = (p) => p.hospitalId || SELF_ID;
const isSelfPatient = (p) => hospOf(p) === SELF_ID;

// Waiting patients of one hospital in dispatch order (highest score first, ties by arrival — FCFS inside
// equal priority). City General's doctors only ever see City General's queue.
function readyQueue(t = Date.now(), hospitalId = SELF_ID) {
  const q = S.patients.filter((p) => p.status === "waiting" && hospOf(p) === hospitalId).map((p) => ({ ...p, score: scoreParts(p, t) }));
  q.sort((a, b) => b.score.total - a.score.total || a.arrived - b.arrived || a.id - b.id);
  q.forEach((p, i) => (p.position = i + 1));
  return q;
}
// Every waiting patient across all hospitals, in priority order, for the Reception list.
// position = rank in this combined list; hospPosition = place in their own hospital's queue.
function waitingAll(t = Date.now()) {
  const byHosp = {};
  const q = S.patients.filter((p) => p.status === "waiting").map((p) => ({ ...p, score: scoreParts(p, t) }));
  q.sort((a, b) => b.score.total - a.score.total || a.arrived - b.arrived || a.id - b.id);
  q.forEach((p, i) => { p.position = i + 1; const h = hospOf(p); byHosp[h] = (byHosp[h] || 0) + 1; p.hospPosition = byHosp[h]; });
  return q;
}
// Minutes until each waiting patient is seen: the scheduler's estimate at City General, the booking's
// projection from the reported queue elsewhere.
function etaAll(q, t = Date.now()) {
  const own = estimates(q.filter(isSelfPatient), t);
  const out = {};
  q.forEach((p) => {
    if (isSelfPatient(p)) { out[p.id] = own[p.id]; return; }
    const b = S.bookings.find((x) => x.patientId === p.id);
    const st = b ? bookingStatus(b, t) : null;
    out[p.id] = st && st.state === "waiting" ? Math.max(0, st.etaMin) : null;
  });
  return out;
}
// Expected consultation minutes per level: learned from today's finished consultations, defaults otherwise.
function durations() {
  const out = {};
  for (const l of LEVELS) {
    const def = S.settings.dur[l];
    const done = S.patients.filter((p) => p.status === "completed" && p.level === l && p.consult_s > 30 && isSelfPatient(p));
    out[l] = done.length >= 3 ? Math.round(((done.reduce((s, p) => s + p.consult_s / 60, 0)) + def * 3) / (done.length + 3) * 10) / 10 : def;
  }
  return out;
}
// Multi-server simulation: minutes until each queued patient reaches a doctor (null = no doctor on duty).
function estimates(queue, t = Date.now()) {
  const durs = durations();
  const docs = S.doctors.filter((d) => d.status === "available" || d.status === "busy");
  if (!docs.length) return Object.fromEntries(queue.map((p) => [p.id, null]));
  const free = docs.map((d) => {
    const cur = d.currentId && S.patients.find((p) => p.id === d.currentId);
    if (d.status === "busy" && cur && cur.called) return Math.max(1, durs[cur.level] - (t - cur.called) / 60000);
    return 0;
  });
  const eta = {};
  for (const p of queue) {
    free.sort((a, b) => a - b);
    const f = free.shift();
    eta[p.id] = Math.max(0, f);
    free.push(f + durs[p.level]);
  }
  return eta;
}

// ------------------------------------------------------------------ registration
function register(data, source = "reception", { arrived = Date.now(), dispatchNow = true, silent = false, hospitalId = SELF_ID, token: fixedToken = null } = {}) {
  const vitals = Object.fromEntries(Object.entries(data.vitals || {}).filter(([, v]) => v !== "" && v != null));
  const age = data.age === "" || data.age == null ? null : parseInt(data.age, 10);
  // A Tamil check-in may come with its English translation: the rules read both (a sentence apart, so
  // negation can't leak across), and the English-trained ML model reads the English.
  const en = (data.symptomsEn || "").trim();
  const r = analyse((data.symptoms || "") + (en ? ". " + en : ""), age, vitals, !!data.pregnant);
  let level = r.level, rank = r.rank, levelSource = "rules";
  const reasons = [...r.reasons];
  if (data.level_override && LEVEL_ORDER[data.level_override] < LEVEL_ORDER[level]) { level = data.level_override; rank = level === "critical" ? 0 : rank; levelSource = "manual"; }
  // Machine-learning second opinion (ml/train.py): may only RAISE the level, and only when confident.
  const ml = S.settings.ml_triage !== false && ML.available ? ML.predict(en || data.symptoms || "", age, vitals, !!data.pregnant) : null;
  const allText = (data.symptoms || "") + (en ? ". " + en : "");
  const mlUp = levelSource !== "manual" && !data.emergency ? ML.upgrade(level, ml, allText) : null;
  if (mlUp) {
    reasons.push(`ML model: ${LEVEL_LABEL[mlUp]} (${Math.round(ml.confidence * 100)}% confident${ml.topTerms.length ? ', from "' + ml.topTerms.slice(0, 2).join(", ") + '"' : ""}) — raised from ${LEVEL_LABEL[level]}`);
    level = mlUp; rank = level === "critical" ? 0 : rank; levelSource = "ml";
  }
  const id = nextId("patient");
  const token = fixedToken || String(nextId("token")).padStart(3, "0");
  const p = {
    id, token, code: randCode(), day: today(), hospitalId, name: (data.name || "").trim() || null, age, sex: data.sex || null, phone: data.phone || null,
    symptoms: (data.symptoms || "").trim(), symptomsEn: en || null, translationSource: en ? data.translationSource || null : null,
    vitals, pregnant: !!data.pregnant, level, rank, base: baseScore(level, rank, r.bonus),
    primary: r.primary_condition, conditions: r.conditions, red_flags: r.red_flags, reasons,
    // the model's confident condition sets the department (the specialist queue) unless it's an emergency
    department: mlOwnsDepartment(r, level, ml, ML.confidentCondition(ml, allText)) ? ml.department : r.department,
    rulesLevel: r.level, levelSource, mlLevel: ml ? ml.level : null, mlConfidence: ml ? ml.confidence : null,
    mlCondition: ML.confidentCondition(ml, allText), mlConditionConfidence: ml ? ml.conditionConfidence : null,
    source, emergency: !!data.emergency, preempted: false, status: "waiting", doctorId: null, roomId: null,
    arrived, called: null, completed: null, wait_s: null, consult_s: 0, outcome: null, notes: null, voiceId: data.voiceId || null,
  };
  S.patients.push(p);
  const where = hospitalId === SELF_ID ? "" : ` at ${hospitalById(hospitalId).name}`;
  if (!silent) log("ARRIVE", `Token ${token} via ${source}${where}: ${LEVEL_LABEL[level]} — ${r.primary_condition} (score ${Math.round(p.base)})`, id);
  if (!silent && ml) log("ML", `Token ${token}: model predicts ${LEVEL_LABEL[ml.level]} (${Math.round(ml.confidence * 100)}%)${mlUp ? " — raised the level from " + LEVEL_LABEL[r.level] : ", rules level kept"}`, id);
  if (data.voiceId) { const v = S.voice.find((x) => x.id === data.voiceId); if (v) { v.patientId = id; v.status = "registered"; } }
  if (dispatchNow && hospitalId === SELF_ID && S.settings.auto_dispatch) dispatch("arrival");
  if (!silent) save("arrival");
  // Tamil without a translation yet: translate in the background and add it when it arrives.
  if (!en && typeof Translate !== "undefined" && Translate.isTamil(p.symptoms)) {
    Translate.toEnglish(p.symptoms).then((t) => t && attachTranslation(p.id, t)).catch(() => {});
  }
  return p;
}

// Add an English translation to a patient who registered in Tamil. The queue shows it at once; if the
// English reads as more urgent (rules or a confident ML model), the level is raised — never lowered.
function attachTranslation(pid, en) {
  const p = getPatient(pid);
  if (!p || !en || !en.text || p.symptomsEn === en.text) return;
  p.symptomsEn = en.text; p.translationSource = en.source;
  if (p.status === "waiting" && p.levelSource !== "manual" && !p.emergency) {
    const t = analyse(p.symptoms + ". " + en.text, p.age, p.vitals, p.pregnant);
    let lvl = t.level, how = "the English translation";
    const ml = S.settings.ml_triage !== false && ML.available ? ML.predict(en.text, p.age, p.vitals, p.pregnant) : null;
    if (ml) {
      p.mlLevel = ml.level; p.mlConfidence = ml.confidence;
      const up = ML.upgrade(lvl, ml, p.symptoms + ". " + en.text);
      if (up) { lvl = up; how = `the ML model reading the English (${Math.round(ml.confidence * 100)}%)`; }
    }
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[p.level]) {
      p.reasons = [...p.reasons, `${LEVEL_LABEL[lvl]} from ${how} — raised from ${LEVEL_LABEL[p.level]}`];
      log("ML", `Token ${p.token}: English translation "${en.text}" raised the level from ${LEVEL_LABEL[p.level]} to ${LEVEL_LABEL[lvl]}`, p.id);
      p.level = lvl; p.rank = lvl === "critical" ? 0 : p.rank; p.base = baseScore(p.level, p.rank, t.bonus); p.levelSource = "translation";
      if (t.primary_condition && t.primary_condition !== "Unclassified complaint") { p.primary = t.primary_condition; p.department = t.department; }
    }
  }
  save("translation");
}
const getPatient = (id) => S.patients.find((p) => p.id === id);
const patientByCode = (code) => S.patients.find((p) => p.code === code);

function cancelPatient(id, reason = "left") {
  const p = getPatient(id);
  if (!p || p.status !== "waiting") return;
  p.status = "cancelled"; p.completed = Date.now();
  S.bookings.filter((b) => b.patientId === id && b.status !== "cancelled").forEach((b) => (b.status = "cancelled"));
  log("CANCEL", `Token ${p.token} left the queue (${reason})`, id);
  save();
}

// ------------------------------------------------------------------ dispatch (patients → doctors)
function dispatch(reason = "") {
  const assigned = [];
  const free = S.doctors.filter((d) => d.status === "available").sort((a, b) => a.since - b.since);
  if (!free.length) return assigned;
  const q = readyQueue();
  for (const d of free) {
    const head = q.shift();
    if (!head) break;
    assigned.push(assign(d, getPatient(head.id), head.score.total));
  }
  return assigned;
}
function assign(d, p, score = 0, preempt = false) {
  const t = Date.now();
  p.status = "in_consultation"; p.doctorId = d.id; p.roomId = d.roomId; p.called = t; p.wait_s = (p.wait_s || 0) + (t - p.arrived) / 1000;
  d.status = "busy"; d.currentId = p.id; d.since = t;
  const room = S.rooms.find((r) => r.id === d.roomId);
  log(preempt ? "PREEMPT" : "DISPATCH", `Token ${p.token} (${LEVEL_LABEL[p.level]}${score ? ", score " + Math.round(score) : ""}) → ${d.name}${room ? ", " + room.name : ""}`, p.id);
  S.lastCall = { ts: t, token: p.token, level: p.level, doctor: d.name, room: room ? room.name : "", patientId: p.id };
  return { patientId: p.id, token: p.token, doctor: d.name };
}
function setDoctorStatus(id, status) {
  const d = S.doctors.find((x) => x.id === id);
  if (!d || d.status === status) return;
  if (d.status === "busy" && status !== "busy") throw new Error("Finish the current consultation first");
  d.status = status; d.since = Date.now();
  log("DOCTOR", `${d.name} is now ${status.replace("_", " ")}`);
  if (status === "available" && S.settings.auto_dispatch) dispatch("doctor available");
  save();
}
function callNext(id) {
  const d = S.doctors.find((x) => x.id === id);
  if (d.status !== "available") { d.status = "available"; d.since = Date.now(); }
  const head = readyQueue()[0];
  if (!head) throw new Error("Nobody is waiting");
  assign(d, getPatient(head.id), head.score.total);
  save("called");
}
function finishConsult(doctorId, { outcome = "Treated", notes = "", medicines = "" } = {}) {
  const d = S.doctors.find((x) => x.id === doctorId);
  const p = d && getPatient(d.currentId);
  if (!p) throw new Error("No patient with this doctor");
  const t = Date.now();
  p.status = "completed"; p.completed = t; p.consult_s += (t - p.called) / 1000; p.outcome = outcome; p.notes = notes;
  d.currentId = null; d.status = "available"; d.since = t;
  log("FINISH", `Token ${p.token} finished with ${d.name} after ${Math.round(p.consult_s / 60)} min: ${outcome}`, p.id);
  if (medicines.trim()) createOrder(medicines.trim(), p, d.name);
  if (S.settings.auto_dispatch) dispatch("finish");
  save("called");
}
function noShow(doctorId) {
  const d = S.doctors.find((x) => x.id === doctorId);
  const p = d && getPatient(d.currentId);
  if (!p) return;
  p.status = "no_show"; p.completed = Date.now();
  d.currentId = null; d.status = "available"; d.since = Date.now();
  log("NO_SHOW", `Token ${p.token} did not come to ${d.name}`, p.id);
  if (S.settings.auto_dispatch) dispatch("no-show");
  save("called");
}
function recall(doctorId) {
  const d = S.doctors.find((x) => x.id === doctorId);
  const p = d && getPatient(d.currentId);
  if (!p) return;
  const room = S.rooms.find((r) => r.id === d.roomId);
  S.lastCall = { ts: Date.now(), token: p.token, level: p.level, doctor: d.name, room: room ? room.name : "", patientId: p.id, recall: true };
  save("called");
}

// ------------------------------------------------------------------ emergency interrupt and pre-emption
function raiseEmergency(source = "button", { name = null, complaint = null } = {}) {
  const p = register({ name: name || "Emergency patient", symptoms: complaint || "Emergency — patient brought in, assess immediately",
    emergency: true, level_override: "critical" }, source, { dispatchNow: false, silent: true });
  const alertId = nextId("alert");
  S.alerts.push({ id: alertId, ts: Date.now(), source, message: `Emergency: Token ${p.token}${name ? " (" + name + ")" : ""}`, patientId: p.id, ack: null });
  log("INTERRUPT", `Emergency raised from ${source} → Token ${p.token} jumps to the head of the queue (+${EMERGENCY_BONUS})`, p.id);
  const assigned = dispatch("emergency");
  if (!assigned.some((a) => a.patientId === p.id) && S.settings.preemption !== "off") preemptFor(p);
  save("emergency");
  return p;
}
function preemptFor(p) {
  const durs = durations();
  const victims = S.doctors.filter((d) => d.status === "busy" && d.currentId)
    .map((d) => ({ d, cur: getPatient(d.currentId) }))
    .filter(({ cur }) => cur && cur.level !== "critical" && !cur.emergency);
  if (!victims.length) { log("PREEMPT", `No doctor can be pre-empted — all are treating critical cases. Token ${p.token} waits at the head.`, p.id); return false; }
  victims.sort((a, b) => scoreParts(a.cur).total - scoreParts(b.cur).total);
  const { d, cur } = victims[0];
  const t = Date.now();
  cur.consult_s += (t - cur.called) / 1000; cur.status = "waiting"; cur.preempted = true; cur.doctorId = null; cur.roomId = null;
  void durs;
  log("PREEMPT", `${d.name} pre-empted: Token ${cur.token} (${LEVEL_LABEL[cur.level]}) returned to the queue head, Token ${p.token} takes the room`, cur.id);
  S.lastPreempt = { ts: t, doctorId: d.id, victim: cur.token, token: p.token };
  assign(d, p, scoreParts(p).total, true);
  return true;
}
function acknowledge(alertId, by = "staff") {
  S.alerts.filter((a) => !a.ack && (alertId == null || a.id === alertId)).forEach((a) => { a.ack = Date.now(); a.by = by; });
  log("ALERT", `Emergency alert acknowledged by ${by}`);
  save();
}
const openAlerts = () => S.alerts.filter((a) => !a.ack);

// ------------------------------------------------------------------ aging daemon (one tab runs it at a time)
function agingTick() {
  const q = readyQueue();
  const fixed = Object.fromEntries(q.map((p) => [p.id, p.score.total - p.score.aging]));
  const lastOrder = S._order || [];
  const pos = Object.fromEntries(lastOrder.map((id, i) => [id, i]));
  for (let i = 0; i < q.length; i++) {
    for (let j = i + 1; j < q.length; j++) {
      const a = q[i], b = q[j];
      if (pos[a.id] != null && pos[b.id] != null && pos[a.id] > pos[b.id] && fixed[a.id] < fixed[b.id]) {
        log("AGING", `Token ${a.token} (${LEVEL_LABEL[a.level]}, waited ${Math.floor((Date.now() - a.arrived) / 60000)} min, +${Math.round(a.score.aging)} aging) overtook Token ${b.token} (${LEVEL_LABEL[b.level]})`, a.id);
      }
    }
  }
  S._order = q.map((p) => p.id);
  if (S.settings.auto_dispatch) dispatch("tick");
  syncOtherHospitals();
  ambulanceTick();
  save("tick");
}
function startDaemon() {
  const LEASE = "medos.web.tick";
  const run = () => {
    const l = store(LEASE);
    if (!l || l.tab === TAB_ID || Date.now() - l.ts > 20000) { store(LEASE, { tab: TAB_ID, ts: Date.now() }); agingTick(); }
  };
  setTimeout(run, 1500);
  setInterval(run, 15000);
  setInterval(() => { // ambulances move in demo time, so check arrivals more often
    const l = store(LEASE);
    if (l && l.tab === TAB_ID && ambulanceTick()) save("ambulance");
  }, 3000);
}

// ------------------------------------------------------------------ pharmacy (FCFS)
function createOrder(items, p, by) {
  const id = nextId("order");
  S.pharmacy.push({ id, patientId: p ? p.id : null, token: p ? p.token : "—", name: p ? p.name : null, items, by: by || "Walk-in", status: "waiting", created: Date.now() });
  log("PHARMACY", `Order #${id} for Token ${p ? p.token : "—"} joined the pharmacy queue (FCFS)`);
}
function pharmacyQueue() { return S.pharmacy.filter((o) => o.status === "waiting").sort((a, b) => a.created - b.created || a.id - b.id); }
function pharmacyStep(id, to) {
  const o = S.pharmacy.find((x) => x.id === id);
  if (!o) return;
  if (to === "preparing") {
    const head = pharmacyQueue()[0];
    if (!head || head.id !== id) throw new Error("First come, first served: start the order at the head of the queue");
    o.started = Date.now();
  }
  if (to === "ready") o.ready = Date.now();
  if (to === "collected") o.collected = Date.now();
  o.status = to;
  log("PHARMACY", `Order #${id} (Token ${o.token}) → ${to}`);
  save();
}

// ------------------------------------------------------------------ hospitals: live status
function hospitalById(id) { return HOSPITALS.find((h) => h.id === id); }
function selfHospital() { return HOSPITALS.find((h) => h.self); }

// Other hospitals report their state; we simulate it with a seeded generator that changes every 3 minutes
// so the numbers move like a live feed but stay consistent across tabs and reloads.
function hospitalLive(h, t = Date.now()) {
  const durs = durations();
  if (h.self) {
    const docs = S.doctors.map((d) => ({ name: d.name, specialty: d.specialty, status: d.status, room: (S.rooms.find((r) => r.id === d.roomId) || {}).name }));
    const q = readyQueue(t);
    const byDept = {};
    q.forEach((p) => (byDept[p.department] = (byDept[p.department] || 0) + 1));
    const busy = S.ambRequests.filter((r) => r.hospitalId === h.id && (r.status === "dispatched")).length;
    return { doctors: docs, queue: q.length, byDept, beds: Math.max(0, h.beds - busy), er_wait: h.er_wait, live: true };
  }
  const slot = Math.floor(t / 180000), hour = new Date(t).getHours();
  const r = rng(h.id * 7919 + slot);
  const shift = rng(h.id * 104729 + Math.floor(t / 3600000));
  const docs = OTHER_DOCTORS[h.id].map(([name, specialty], i) => {
    const onDuty = shift() < (hour >= 22 || hour < 7 ? 0.55 : 0.85) || i === 0;
    const x = r();
    return { name, specialty, status: !onDuty ? "off_duty" : x < 0.08 ? "break" : x < 0.45 ? "available" : "busy" };
  });
  const rush = (hour >= 9 && hour <= 12) || (hour >= 17 && hour <= 20) ? 1.4 : 1;
  const byDept = {};
  h.specialties.forEach((s) => (byDept[s] = Math.floor(r() * (2 + (h.er_wait / 7) * rush))));
  const queue = Object.values(byDept).reduce((a, b) => a + b, 0);
  const er = Math.round(h.er_wait * (0.7 + r() * 0.6) * rush);
  const beds = Math.max(0, Math.round(h.beds * (0.5 + r() * 0.7)) - S.ambRequests.filter((q) => q.hospitalId === h.id && q.status === "dispatched").length);
  void durs;
  return { doctors: docs, queue, byDept, beds, er_wait: er, live: false };
}

// Live wait at City General for a new case of this level, from the real ready queue (ambulance.self_wait_min).
function selfWaitMin(level, rank, base) {
  if (level === "critical" && S.settings.preemption !== "off") return 0;
  base = base ?? baseScore(level, rank);
  const ahead = readyQueue().filter((p) => p.score.total >= base);
  const eta = estimates([...ahead, { id: -1, level }])[-1];
  return eta == null ? null : Math.round(eta * 10) / 10;
}

// Doctors at a hospital who can see a patient routed to `dept`.
function doctorsFor(h, live, dept) {
  if (h.self) return { docs: live.doctors, specialist: h.specialties.includes(dept) || dept === "Emergency" };
  const want = DEPT_SPECIALTIES[dept] || ["General Medicine"];
  const spec = live.doctors.filter((d) => want.includes(d.specialty));
  if (spec.length) return { docs: spec, specialist: true };
  return { docs: live.doctors.filter((d) => d.specialty === "General Medicine" || d.specialty === "Emergency Medicine"), specialist: false };
}

// Rough drive time before road routing answers: straight line × road factor at city speed.
function estDrive(a, b, kmh) {
  const km = haversineKm(a, b) * 1.3;
  return { min: Math.round((km / kmh) * 60 + 1), km, source: "estimate" };
}
function trafficFactor(t = Date.now()) {
  const h = new Date(t).getHours();
  if ((h >= 8 && h < 11) || (h >= 17 && h < 21)) return { f: 1.9, label: "peak-hour traffic" };
  if (h >= 7 && h < 22) return { f: 1.5, label: "daytime traffic" };
  return { f: 1.2, label: "light night traffic" };
}

// ------------------------------------------------------------------ token booking: fastest time to a prescription
// total = max(travel, wait) + consultation — the queue keeps moving while the patient travels,
// so the shortest total, not the shortest drive or the shortest queue, wins.
// Who names the department: the model only when the rules found nothing, or found a condition of a different
// seriousness than the final priority while the model's condition matches it. When the rules matched a condition
// that agrees with the final level, they keep it ("ரொம்ப வயிறு வலி" stays Severe abdominal pain, not "mild").
function mlOwnsDepartment(rules, level, ml, mlCondition) {
  if (!mlCondition || level === "critical" || ml.department === "Emergency") return false;
  const rc = DEFAULT_CONDITIONS.find((c) => c.name === rules.primary_condition);
  return !rc || (rc.level !== level && ml.conditionLevel === level);
}

function recommendToken({ symptoms, age, pregnant, department, symptomsEn }, origin, travel = {}) {
  // What the complaint means: the rules read the words (Tamil and English, plus the translation when there is
  // one); the trained model reads the English (or the original) and names the condition and its department.
  const en = (symptomsEn || "").trim();
  const t = analyse((symptoms || "") + (en ? ". " + en : ""), age, {}, pregnant);
  const ml = ML.available ? ML.predict(en || symptoms || "", age, {}, pregnant) : null;
  const allText = (symptoms || "") + (en ? ". " + en : "");
  const mlCondition = ML.confidentCondition(ml, allText);
  const level = ML.upgrade(t.level, ml, allText) || t.level;          // upgrade-only, as at registration
  // Department for booking: an emergency stays Emergency; otherwise the patient's choice, then the model's
  // confident condition, then the rules.
  let dept, deptSource;
  if (level === "critical") { dept = "Emergency"; deptSource = "rules"; }
  else if (department) { dept = department; deptSource = "you"; }
  else if (mlOwnsDepartment(t, level, ml, mlCondition)) { dept = ml.department; deptSource = "ml"; }
  else { dept = t.department || "General Medicine"; deptSource = "rules"; }
  const understood = deptSource === "ml" ? { name: mlCondition, source: "ml", confidence: ml.conditionConfidence } : { name: t.primary_condition, source: "rules" };
  const tl = { ...t, level, base_score: baseScore(level, level === "critical" ? 0 : t.rank, t.bonus) };
  const durs = durations();
  const consult = durs[level];
  const rows = HOSPITALS.map((h) => {
    const live = hospitalLive(h);
    const { docs, specialist } = doctorsFor(h, live, dept);
    const onDuty = docs.filter((d) => d.status === "available" || d.status === "busy");
    const availableNow = docs.filter((d) => d.status === "available").length;
    let wait, ahead;
    if (h.self) {
      wait = selfWaitMin(tl.level, tl.rank, tl.base_score);
      ahead = readyQueue().filter((p) => p.score.total >= tl.base_score).length;
    } else {
      const share = { critical: 0, high: 0.3, medium: 0.7, low: 1 }[tl.level];
      ahead = Math.round((live.byDept[dept] ?? live.byDept["General Medicine"] ?? 0) * share);
      if (onDuty.length) {
        const r = rng(h.id * 31 + Math.floor(Date.now() / 180000));
        const free = onDuty.map((d) => (d.status === "available" ? 0 : r() * durs.medium));
        for (let i = 0; i < ahead; i++) { free.sort((a, b) => a - b); free[0] += durs.medium; }
        free.sort((a, b) => a - b);
        wait = free[0];
      } else wait = null;
    }
    const tr = travel[h.id] || estDrive(origin, h, 40 / trafficFactor().f);
    let reason = null;
    if (!onDuty.length || wait == null) reason = "No doctor on duty for this";
    else if (!docs.length) reason = `No ${dept} or general doctor`;
    const w = wait == null ? null : Math.round(wait);
    const total = w == null ? null : Math.round(Math.max(tr.min, w) + consult);
    return { id: h.id, h, live, dept, travelMin: tr.min, travelKm: tr.km, travelSource: tr.source, wait: w, onsiteWait: w == null ? null : Math.max(0, w - tr.min),
      consult, total, ahead, docs, onDuty: onDuty.length, availableNow, specialist, eligible: !reason, reason };
  });
  // Shortest time to a prescription wins (SJF); the fastest hospital with a specialist is offered alongside.
  rows.sort((a, b) => (b.eligible - a.eligible) || (a.total ?? 1e9) - (b.total ?? 1e9) || a.travelMin - b.travelMin);
  const best = rows[0] && rows[0].eligible ? rows[0] : null;
  const bestSpecialist = rows.find((r) => r.eligible && r.specialist) || null;
  return { triage: tl, dept, deptSource, understood, ml, mlCondition, consult, rows, best, bestSpecialist: bestSpecialist && bestSpecialist !== best ? bestSpecialist : null };
}

function bookToken({ name, age, sex, phone, symptoms, symptomsEn, translationSource, pregnant, voiceId }, row, origin) {
  const h = row.h;
  const id = nextId("booking");
  const b = { id, type: "token", hospitalId: h.id, hospitalName: h.name, created: Date.now(), name, age, phone, symptoms, origin,
    level: null, dept: row.dept, expectedWait: row.wait, travelMin: row.travelMin, consult: row.consult, total: row.total, ahead: row.ahead, status: "active" };
  // Every booking joins the Reception list at once. City General's goes into the live scheduler; another
  // hospital's is tagged with that hospital and follows its reported queue (see syncOtherHospitals).
  const token = h.self ? null : `${h.short.slice(0, 2).toUpperCase()}-${String(20 + Math.floor(Math.random() * 60) + row.ahead).padStart(3, "0")}`;
  const p = register({ name, age, sex, phone, symptoms, symptomsEn, translationSource, pregnant, voiceId }, "online booking", { hospitalId: h.id, token, silent: true });
  log("ARRIVE", `Token ${p.token} booked online for ${h.name}: ${LEVEL_LABEL[p.level]} — ${p.primary} (score ${Math.round(p.base)})`, p.id);
  b.patientId = p.id; b.token = p.token; b.code = p.code; b.level = p.level;
  S.bookings.push(b);
  log("BOOKING", `Token ${b.token} booked online at ${h.name} — ${fmtMin(row.total)} to a prescription (best of ${HOSPITALS.length})`);
  save("booking");
  return b;
}
function bookingByCode(code) { return S.bookings.find((b) => b.code === code); }

// Live position of a booking: real for City General, projected from the reported queue elsewhere.
function bookingStatus(b, t = Date.now()) {
  if (b.type === "ambulance") return null;
  if (b.patientId && (b.hospitalId || SELF_ID) === SELF_ID) {
    const p = getPatient(b.patientId);
    if (!p) return { state: "unknown" };
    if (p.status === "waiting") {
      const q = readyQueue(t), me = q.find((x) => x.id === p.id), eta = estimates(q, t);
      return { state: "waiting", position: me.position, ahead: me.position - 1, etaMin: eta[p.id], level: p.level, score: me.score };
    }
    if (p.status === "in_consultation") {
      const d = S.doctors.find((x) => x.id === p.doctorId), room = d && S.rooms.find((r) => r.id === d.roomId);
      return { state: "called", doctor: d && d.name, room: room && room.name, level: p.level };
    }
    return { state: p.status, level: p.level, outcome: p.outcome };
  }
  const el = (t - b.created) / 60000;
  const wait = b.expectedWait || 0;
  if (b.status === "cancelled") return { state: "cancelled" };
  if (el < wait) return { state: "waiting", position: Math.max(1, Math.ceil((b.ahead + 1) * (1 - el / Math.max(wait, 1)))), ahead: Math.max(0, Math.ceil(b.ahead * (1 - el / Math.max(wait, 1)))), etaMin: wait - el, level: b.level };
  if (el < wait + b.consult) return { state: "called", level: b.level, doctor: null };
  return { state: "completed", level: b.level };
}
function cancelBooking(id) {
  const b = S.bookings.find((x) => x.id === id);
  if (!b) return;
  b.status = "cancelled";
  if (b.patientId) cancelPatient(b.patientId, "cancelled online");
  if (b.ambRequestId) cancelAmbulance(b.ambRequestId);
  save();
}
// Patients booked at other hospitals move along that hospital's projected queue: waiting → with a
// doctor → done, so they leave the Reception list when they've been seen.
function syncOtherHospitals(t = Date.now()) {
  let changed = false;
  S.patients.filter((p) => !isSelfPatient(p) && (p.status === "waiting" || p.status === "in_consultation")).forEach((p) => {
    const b = S.bookings.find((x) => x.patientId === p.id);
    if (!b) return;
    const st = bookingStatus(b, t);
    if (st.state === "called" && p.status === "waiting") { p.status = "in_consultation"; p.called = t; p.wait_s = (t - p.arrived) / 1000; changed = true; }
    else if (st.state === "completed") { p.status = "completed"; p.completed = t; p.called = p.called || t; changed = true; }
  });
  return changed;
}

// ------------------------------------------------------------------ ambulance (SJF)
function needsFor(t, kind) {
  const text = ((t.primary_condition || "") + " " + (t.red_flags || []).join(" ")).toLowerCase();
  let specialist = (SPECIALIST_FOR.find(([k]) => text.includes(k)) || [])[1] || null;
  if (!specialist && !["Emergency", "General Medicine", null, undefined].includes(t.department)) specialist = t.department;
  return { er: ["critical", "high"].includes(t.level) || kind === "emergency", specialist };
}
function nearestAmbulance(pickup) {
  const kmh = S.settings.ambulance_speed_kmh;
  return S.ambulances.filter((a) => a.status === "available")
    .map((a) => ({ a, base: hospitalById(a.baseId), ...estDrive(hospitalById(a.baseId), pickup, kmh) }))
    .sort((x, y) => x.min - y.min)[0] || null;
}
// Rank every hospital by time to treatment = drive from the pickup + expected wait there; shortest wins.
function recommendAmbulance(condition, kind, pickup, age = null, travel = {}) {
  const t = analyse(condition || "", age);
  if (kind === "emergency" && (t.level === "low" || t.level === "medium")) { t.level = "high"; t.base_score = baseScore("high", t.rank); }
  const need = needsFor(t, kind);
  const kmh = S.settings.ambulance_speed_kmh;
  const amb = nearestAmbulance(pickup);
  const rows = HOSPITALS.map((h) => {
    const live = hospitalLive(h);
    let reason = null;
    if (need.er && !h.specialties.includes("Emergency")) reason = "No emergency department";
    else if (live.beds <= 0) reason = "No free beds";
    const tr = travel[h.id] || estDrive(pickup, h, kmh);
    let wait, src;
    if (h.self) {
      wait = selfWaitMin(t.level, t.rank, t.base_score); src = "live from the MedOS queue";
      if (wait == null) { wait = h.er_wait * LEVEL_WAIT_FACTOR[t.level]; src = "no doctor on duty, using reported wait"; }
    } else { wait = live.er_wait * LEVEL_WAIT_FACTOR[t.level]; src = "reported by the hospital"; }
    const hasSpec = !!(need.specialist && h.specialties.map((s) => s.toLowerCase()).includes(need.specialist.toLowerCase()));
    return { id: h.id, h, name: h.name, self: !!h.self, travelMin: tr.min, travelKm: tr.km, travelSource: tr.source, wait: Math.round(wait * 10) / 10, waitSource: src,
      total: Math.round((tr.min + wait) * 10) / 10, hasSpec, eligible: !reason, reason, beds: live.beds, live };
  });
  let note = null;
  if (need.specialist) {
    const withSpec = rows.filter((r) => r.eligible && r.hasSpec);
    if (withSpec.length) rows.forEach((r) => { if (r.eligible && !r.hasSpec) { r.eligible = false; r.reason = `No ${need.specialist}`; } });
    else note = `No hospital lists ${need.specialist}, so any suitable hospital is considered.`;
  }
  rows.sort((a, b) => (b.eligible - a.eligible) || a.total - b.total || a.travelMin - b.travelMin);
  return { triage: t, level: t.level, kind, needs: (need.er ? "Emergency department" : "Outpatient care") + (need.specialist ? " + " + need.specialist : ""),
    ambulance: amb, pickupMin: amb ? amb.min : null, rows, best: rows[0] && rows[0].eligible ? rows[0] : null, note };
}

function createAmbulanceRequest({ kind, name, age, phone, condition, pickup, voiceId }, rec, choiceId) {
  const choice = rec.rows.find((r) => r.id === choiceId) || rec.best;
  if (!choice) throw new Error("No hospital can take this case right now.");
  const id = nextId("amb");
  const r = { id, kind, name: name || null, age: age || null, phone: phone || null, condition, level: rec.level, needs: rec.needs, pickup,
    hospitalId: choice.id, hospitalName: choice.name, travelMin: choice.travelMin, waitMin: choice.wait, totalMin: choice.total,
    pickupMin: rec.pickupMin, ranking: rec.rows.map((x) => ({ id: x.id, name: x.name, travelMin: x.travelMin, wait: x.wait, total: x.total, eligible: x.eligible, reason: x.reason })),
    status: "waiting", created: Date.now(), ambulanceId: null, dispatched: null, arrived: null, voiceId: voiceId || null, routes: {} };
  S.ambRequests.push(r);
  const bid = nextId("booking");
  S.bookings.push({ id: bid, type: "ambulance", ambRequestId: id, hospitalId: choice.id, hospitalName: choice.name, created: Date.now(), name, condition, level: rec.level,
    code: randCode(), token: `AMB-${String(id).padStart(3, "0")}`, status: "active", origin: pickup });
  r.bookingId = bid;
  if (voiceId) { const v = S.voice.find((x) => x.id === voiceId); if (v) v.status = "booked"; }
  log("AMBULANCE", `Request #${id} (${kind === "emergency" ? "emergency" : "non-emergency"}, ${LEVEL_LABEL[rec.level]}) from ${pickup.label}: ${choice.name} chosen, ${Math.round(choice.total)} min to treatment (shortest of ${rec.rows.filter((x) => x.eligible).length})`);
  ambulanceDispatch();
  save("ambulance");
  return S.bookings.find((b) => b.id === bid);
}
const jobMin = (r) => (r.pickupMin || 0) + (r.travelMin || 0) + LOAD_MIN + HANDOVER_MIN;
function ambSortKey(r, t) {
  const waited = (t - r.created) / 60000;
  return r.kind === "emergency" ? [0, LEVEL_ORDER[r.level], jobMin(r), r.created] : [1, 0, jobMin(r) - AMB_AGING_PER_MIN * waited, r.created];
}
function ambulanceQueue(t = Date.now()) {
  const q = S.ambRequests.filter((r) => r.status === "waiting");
  q.sort((a, b) => { const x = ambSortKey(a, t), y = ambSortKey(b, t); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  q.forEach((r, i) => (r.position = i + 1));
  return q;
}
// Ambulances are the CPUs, requests the jobs: emergencies first, then the shortest trip (with aging).
function ambulanceDispatch() {
  const out = [];
  for (const r of ambulanceQueue()) {
    const near = nearestAmbulance(r.pickup);
    if (!near) break;
    const t = Date.now();
    Object.assign(r, { status: "dispatched", ambulanceId: near.a.id, dispatched: t, pickupMin: near.min, baseId: near.a.baseId, speed: S.settings.demo_speed || 1 });
    near.a.status = "on_trip"; near.a.requestId = r.id; near.a.since = t;
    out.push(r);
    log("AMBULANCE", `${near.a.name} (from ${near.base.short}) sent to ${r.pickup.label} for request #${r.id}, pickup in ${near.min} min → ${r.hospitalName}`);
  }
  return out;
}
// Where an ambulance is on its job, in demo time.
function ambulancePhase(r, t = Date.now()) {
  if (r.status === "waiting") return { phase: "queued", label: "Waiting for a free ambulance", progress: 0 };
  if (r.status === "cancelled") return { phase: "cancelled", label: "Cancelled", progress: 0 };
  if (r.status === "arrived") return { phase: "arrived", label: `Handed over at ${r.hospitalName}`, progress: 1, leg: 2, legProgress: 1 };
  const el = ((t - r.dispatched) / 60000) * (r.speed || 1);
  const a = r.pickupMin, b = a + LOAD_MIN, c = b + r.travelMin, d = c + HANDOVER_MIN;
  const total = d;
  if (el < a) return { phase: "to_pickup", label: "Ambulance on the way to you", leg: 1, legProgress: el / a, remaining: a - el, progress: el / total, el };
  if (el < b) return { phase: "loading", label: "Ambulance has reached you", leg: 1, legProgress: 1, remaining: b - el, progress: el / total, el };
  if (el < c) return { phase: "to_hospital", label: `On the way to ${r.hospitalName}`, leg: 2, legProgress: (el - b) / r.travelMin, remaining: c - el, progress: el / total, el };
  if (el < d) return { phase: "handover", label: `Arrived at ${r.hospitalName}`, leg: 2, legProgress: 1, remaining: d - el, progress: el / total, el };
  return { phase: "done", label: "Handed over", leg: 2, legProgress: 1, progress: 1, el };
}
function ambulanceArrived(r) {
  const t = Date.now();
  r.status = "arrived"; r.arrived = t;
  const a = S.ambulances.find((x) => x.id === r.ambulanceId);
  if (a) { a.status = "available"; a.requestId = null; a.since = t; a.baseId = r.hospitalId; }
  log("AMBULANCE", `Request #${r.id} arrived at ${r.hospitalName}`);
  const h = hospitalById(r.hospitalId);
  if (h && h.self) {
    const p = register({ name: r.name, age: r.age, symptoms: r.condition, level_override: r.kind === "emergency" ? r.level : null, voiceId: r.voiceId }, "ambulance", { silent: false });
    r.patientId = p.id;
    if (r.level === "critical" && r.kind === "emergency") {
      S.alerts.push({ id: nextId("alert"), ts: t, source: "ambulance", message: `Ambulance arrived: Token ${p.token}, ${LEVEL_LABEL[p.level]}`, patientId: p.id, ack: null });
    }
  }
}
function ambulanceTick() {
  let changed = false;
  S.ambRequests.filter((r) => r.status === "dispatched").forEach((r) => { if (ambulancePhase(r).phase === "done") { ambulanceArrived(r); changed = true; } });
  if (changed || ambulanceQueue().length) { if (ambulanceDispatch().length) changed = true; }
  return changed;
}
function cancelAmbulance(id) {
  const r = S.ambRequests.find((x) => x.id === id);
  if (!r || !["waiting", "dispatched"].includes(r.status)) return;
  if (r.status === "dispatched") { const a = S.ambulances.find((x) => x.id === r.ambulanceId); if (a) { a.status = "available"; a.requestId = null; a.since = Date.now(); } }
  r.status = "cancelled"; r.arrived = Date.now();
  log("AMBULANCE", `Request #${id} cancelled`);
  ambulanceDispatch();
  save("ambulance");
}
// Ambulance positions for the map (lat/lng along the stored route, or interpolated if none yet).
function ambulancePosition(r, t = Date.now()) {
  const ph = ambulancePhase(r, t);
  const base = hospitalById(r.baseId || 1), hosp = hospitalById(r.hospitalId);
  if (ph.phase === "queued" || ph.phase === "cancelled") return null;
  const along = (path, f, a, b) => (path && path.length > 1 ? pointAlong(path, f) : { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
  if (ph.leg === 1) return along(r.routes.toPickup, Math.min(1, ph.legProgress), base, r.pickup);
  return along(r.routes.toHospital, Math.min(1, ph.legProgress), r.pickup, hosp);
}
function pointAlong(path, f) {
  if (f <= 0) return { lat: path[0][0], lng: path[0][1] };
  const seg = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); seg.push(d); total += d; }
  let goal = total * Math.min(1, f);
  for (let i = 0; i < seg.length; i++) {
    if (goal <= seg[i]) { const k = seg[i] ? goal / seg[i] : 0; return { lat: path[i][0] + (path[i + 1][0] - path[i][0]) * k, lng: path[i][1] + (path[i + 1][1] - path[i][1]) * k, heading: Math.atan2(path[i + 1][1] - path[i][1], path[i + 1][0] - path[i][0]) }; }
    goal -= seg[i];
  }
  const l = path[path.length - 1];
  return { lat: l[0], lng: l[1] };
}

// ------------------------------------------------------------------ voice inputs (data collection)
function addVoiceInput({ transcript, fields, source, audioId, durationS, lang }) {
  const t = analyse(fields.symptoms || transcript, fields.age, {}, fields.pregnant);
  const v = { id: nextId("voice"), ts: Date.now(), transcript, fields, source, audioId: audioId || null, durationS: durationS || null, lang,
    level: t.level, rank: t.rank, base: t.base_score, primary: t.primary_condition, department: t.department, spans: t.spans, status: "captured", patientId: null };
  S.voice.push(v);
  if (S.voice.length > 80) S.voice = S.voice.slice(-80);
  log("VOICE", `Voice input #${v.id} (${source}, ${durationS ? durationS.toFixed(1) + " s" : "typed"}): ${LEVEL_LABEL[t.level]} — ${t.primary_condition}`);
  save("voice");
  // Tamil: add the English translation when it arrives (shown in Voice intake and used when registering).
  const sym = fields.symptoms || transcript;
  if (typeof Translate !== "undefined" && Translate.isTamil(sym)) {
    Translate.toEnglish(sym).then((en) => {
      const live = en && S.voice.find((x) => x.id === v.id);
      if (live) { live.symptomsEn = en.text; live.translationSource = en.source; save("translation"); }
    }).catch(() => {});
  }
  return v;
}
// Recorded inputs in priority order: live queue score if the patient is waiting, otherwise base score.
function voiceInPriorityOrder() {
  const t = Date.now();
  return S.voice.map((v) => {
    const p = v.patientId && getPatient(v.patientId);
    const score = p && p.status === "waiting" ? scoreParts(p, t).total : p && p.emergency ? v.base + EMERGENCY_BONUS : v.base;
    return { ...v, patient: p || null, score };
  }).sort((a, b) => b.score - a.score || a.ts - b.ts);
}

// ------------------------------------------------------------------ demo data (medos/demo.py)
function seedDemo() {
  const r = rng(7);
  const t = Date.now();
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const span = 4.5 * 3600e3;
  DEMO_EARLIER.forEach(([symptoms, vitals, outcome], i) => {
    const arrived = t - 3600e3 - span + (span * i) / DEMO_EARLIER.length;
    const p = register({ name: `${DEMO_NAMES[i % DEMO_NAMES.length]} ${pick("KMRSPV")}`, age: 6 + Math.floor(r() * 72), sex: pick(["male", "female"]), symptoms, vitals },
      pick(["reception", "reception", "voice", "kiosk"]), { arrived, dispatchNow: false, silent: true });
    const wait = { critical: 1, high: 6, medium: 14, low: 24 }[p.level] * 60 * (0.6 + r() * 0.8);
    const consult = { critical: 24, high: 14, medium: 10, low: 7 }[p.level] * 60 * (0.7 + r() * 0.6);
    const d = S.doctors[i % S.doctors.length];
    Object.assign(p, { status: "completed", called: arrived + wait * 1000, completed: arrived + (wait + consult) * 1000, wait_s: wait, consult_s: consult, outcome, doctorId: d.id, roomId: d.roomId });
  });
  DEMO_WAITING.forEach(([name, age, sex, symptoms, vitals, mins]) =>
    register({ name, age, sex, symptoms, vitals }, pick(["reception", "voice", "kiosk"]), { arrived: t - mins * 60000, dispatchNow: false, silent: true }));
  S.doctors.forEach((d, i) => { d.status = i === S.doctors.length - 1 ? "break" : "available"; d.since = t - 600000 + i; });
  const assigned = dispatch("demo");
  assigned.forEach((a, i) => { const p = getPatient(a.patientId); p.called = t - (4 + 3 * i) * 60000; p.wait_s = Math.max(0, (p.called - p.arrived) / 1000); });
  const done = S.patients.filter((p) => p.status === "completed").sort((a, b) => a.completed - b.completed).slice(-7);
  done.forEach((p, i) => {
    createOrder(DEMO_MEDS[i % DEMO_MEDS.length], p, "Dr. Karthik Menon");
    const o = S.pharmacy[S.pharmacy.length - 1];
    o.created = Math.min(p.completed + 60000, t - 60000 * (7 - i));
    if (i < 3) Object.assign(o, { status: "collected", started: o.created + 120000, ready: o.created + 360000, collected: o.created + 600000 });
    else if (i === 3) Object.assign(o, { status: "ready", started: o.created + 90000, ready: o.created + 300000 });
    else if (i === 4) Object.assign(o, { status: "preparing", started: t - 120000 });
  });
  S.events = [];
  log("SYSTEM", `Demo patients loaded: ${DEMO_WAITING.length} waiting, ${DEMO_EARLIER.length} earlier today`);
  S._order = readyQueue().map((p) => p.id);
  save("demo");
}
function resetDemo() { freshState(); seedDemo(); }
function clearPatients() {
  const keep = { settings: S.settings };
  freshState(); S.settings = keep.settings;
  S.doctors.forEach((d) => (d.status = "available"));
  log("SYSTEM", "Patient data cleared");
  save("clear");
}
