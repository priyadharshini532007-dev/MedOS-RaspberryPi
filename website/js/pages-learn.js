// MedOS Web — Scheduler Lab (port of medos/static/js/lab.js) and How it works.
"use strict";

const LAB_ALGOS = [
  { id: "fcfs", name: "First come, first served", color: "var(--muted)" },
  { id: "sjf", name: "Shortest job first", color: "var(--info)" },
  { id: "prio", name: "Priority", color: "var(--high)" },
  { id: "aging", name: "Priority + aging", color: "var(--med)" },
  { id: "preempt", name: "Pre-emptive + aging", color: "var(--crit)" },
];
const LAB_DUR = { critical: 25, high: 15, medium: 10, low: 7 };

function labPatients(n, win, emergencies, seed) {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const x = r();
    const level = x < 0.08 ? "critical" : x < 0.28 ? "high" : x < 0.6 ? "medium" : "low";
    const rank = level === "critical" ? 0 : level === "high" ? 1 + Math.floor(r() * 3) : level === "medium" ? 4 + Math.floor(r() * 4) : 8 + Math.floor(r() * 8);
    out.push({ arrival: r() * win, level, rank, base: LEVEL_BASE[level] + (16 - rank) * 10, duration: LAB_DUR[level] * (0.7 + r() * 0.6), emergency: false });
  }
  for (let k = 0; k < emergencies; k++) out.push({ arrival: win * (0.25 + r() * 0.6), level: "critical", rank: 0, base: LEVEL_BASE.critical + 160, duration: LAB_DUR.critical * (0.8 + r() * 0.4), emergency: true });
  out.sort((a, b) => a.arrival - b.arrival);
  out.forEach((p, i) => (p.token = String(i + 1).padStart(3, "0")));
  return out;
}

function labSimulate(patients, { doctors, rate, cap, policy }) {
  const dt = 0.25;
  const jobs = patients.map((p, i) => ({ ...p, id: i, remaining: p.duration, start: null, end: null, preempted: false }));
  const docs = Array.from({ length: doctors }, (_, i) => ({ id: i, job: null, segStart: 0 }));
  const segments = [];
  let waiting = [], next = 0, t = 0, done = 0, preemptions = 0, steps = 0;
  const score = (j) => {
    if (policy === "fcfs") return -j.arrival;
    if (policy === "sjf") return -j.duration;
    let s = j.base;
    if (policy !== "prio") { const aging = Math.min(rate * (t - j.arrival), cap); s += aging; if (j.preempted) s = Math.max(s, PREEMPT_FLOOR + aging * 0.001); }
    if (j.emergency && policy !== "fcfs") s += EMERGENCY_BONUS;
    return s;
  };
  const pick = () => { let best = -1, bs = -Infinity; waiting.forEach((j, i) => { const s = score(j); if (s > bs || (s === bs && j.arrival < waiting[best].arrival)) { bs = s; best = i; } }); return waiting.splice(best, 1)[0]; };
  while (done < jobs.length && steps++ < 100000) {
    while (next < jobs.length && jobs[next].arrival <= t) waiting.push(jobs[next++]);
    for (const d of docs) if (d.job) { d.job.remaining -= dt; if (d.job.remaining <= 1e-9) { d.job.end = t; segments.push({ doc: d.id, job: d.job, from: d.segStart, to: t }); done++; d.job = null; } }
    if (policy === "preempt") {
      for (const e of waiting.filter((j) => j.emergency)) {
        void e;
        if (docs.some((d) => !d.job)) break;
        const victims = docs.filter((d) => d.job && !d.job.emergency && d.job.level !== "critical");
        if (!victims.length) break;
        victims.sort((a, b) => score(a.job) - score(b.job));
        const d = victims[0];
        segments.push({ doc: d.id, job: d.job, from: d.segStart, to: t, split: true });
        d.job.preempted = true; waiting.push(d.job); d.job = null; preemptions++;
      }
    }
    for (const d of docs) if (!d.job && waiting.length) { const j = pick(); if (j.start == null) j.start = t; d.job = j; d.segStart = t; }
    t += dt;
  }
  jobs.forEach((j) => (j.waited = Math.max(0, j.end - j.arrival - j.duration)));
  return { jobs, segments, preemptions, makespan: t };
}

function labMetrics(res) {
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const by = Object.fromEntries(LEVELS.map((l) => [l, res.jobs.filter((j) => j.level === l).map((j) => j.waited)]));
  const crit = res.jobs.filter((j) => j.level === "critical");
  return {
    avg: avg(res.jobs.map((j) => j.waited)), max: Math.max(...res.jobs.map((j) => j.waited)), byLevel: Object.fromEntries(LEVELS.map((l) => [l, avg(by[l])])),
    critFirst: avg(crit.map((j) => j.start - j.arrival)), critLate: crit.filter((j) => j.start - j.arrival > 5).length,
    lowMax: by.low.length ? Math.max(...by.low) : null, preemptions: res.preemptions,
  };
}

PAGES.lab = {
  title: "Scheduler Lab",
  render(el) {
    el.innerHTML = `<div class="page">${pageHead("Scheduler Lab", "The same patients under five scheduling policies. See who waits, who starves, and why MedOS uses priority with aging and pre-emption.",
      `<div class="seg" id="src"><button data-v="random" aria-pressed="true">Random day</button><button data-v="today" aria-pressed="false">Today's real patients</button></div><button class="btn" id="run">${icon("refresh")}New patients</button>`)}
      <section class="card card-pad"><div class="form-grid" id="ctl">
        ${[["n", "Patients", 10, 60, 30, 1], ["win", "Arrive over (min)", 30, 240, 120, 10], ["em", "Emergencies", 0, 5, 2, 1], ["docs", "Doctors", 1, 6, 3, 1], ["rate", "Aging (points/min)", 0, 20, 5, 0.5], ["cap", "Aging limit", 0, 900, 450, 10]]
          .map(([id, l, mn, mx, v, st]) => `<label class="field c2 ${["n", "win", "em"].includes(id) ? "rnd" : ""}"><span>${l}: <b id="${id}-o">${v}</b></span><input class="range" type="range" id="${id}" min="${mn}" max="${mx}" step="${st}" value="${v}"></label>`).join("")}
      </div><p class="t-small muted" id="summary" style="margin-top:8px"></p></section>
      <div class="stack" style="margin-top:16px">
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("chart")}Results</h2></div><div class="table-wrap"><table class="tbl" id="results"></table></div></section>
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("clock")}Average wait by priority (min)</h2></div><div class="card-body stack"><div class="wchart" id="wchart" style="max-width:820px"></div><div class="legend" id="wlegend"></div></div></section>
      </div>
      <section class="card" style="margin-top:16px"><div class="card-head"><h2 class="t-h3">${icon("list")}Gantt chart</h2><div class="seg seg-sm" id="pick"></div></div>
        <div class="card-body"><div id="gantt"></div><p class="t-small muted" id="gnote"></p></div></section></div>`;
    let source = "random", seed = 42, results = {}, shown = "aging";
    const ids = ["n", "win", "em", "docs", "rate", "cap"];
    const fmt = (v, d = 1) => (v == null || !isFinite(v) ? "—" : v.toFixed(d));
    function run() {
      ids.forEach((k) => ($(`#${k}-o`, el).textContent = $(`#${k}`, el).value));
      const opts = { doctors: +$("#docs", el).value, rate: +$("#rate", el).value, cap: +$("#cap", el).value };
      let patients;
      if (source === "today") {
        const ps = S.patients.filter((p) => p.status !== "cancelled" && isSelfPatient(p)).sort((a, b) => a.arrived - b.arrived);
        const t0 = ps.length ? ps[0].arrived : 0;
        patients = ps.map((p) => ({ token: p.token, arrival: (p.arrived - t0) / 60000, level: p.level, rank: p.rank, base: p.base, emergency: p.emergency, duration: p.consult_s > 30 ? p.consult_s / 60 : LAB_DUR[p.level] }));
      } else patients = labPatients(+$("#n", el).value, +$("#win", el).value, +$("#em", el).value, seed);
      if (!patients.length) { $("#summary", el).textContent = "No patients yet."; return; }
      results = {};
      LAB_ALGOS.forEach((a) => { const res = labSimulate(patients, { ...opts, policy: a.id }); results[a.id] = { res, m: labMetrics(res) }; });
      $("#summary", el).textContent = `${patients.length} patients (${LEVELS.map((l) => `${patients.filter((p) => p.level === l).length} ${LEVEL_LABEL[l].toLowerCase()}`).join(" · ")}) · ${opts.doctors} doctor${opts.doctors > 1 ? "s" : ""}`;
      const rows = [["Average wait, everyone", (m) => m.avg, "min", 1], ["Critical: time to a doctor", (m) => m.critFirst, "min", 1], ["Critical patients waiting over 5 min", (m) => m.critLate, "", 0],
        ["Longest wait, anyone", (m) => m.max, "min", 1], ["Longest wait, low priority", (m) => m.lowMax, "min", 1], ["Consultations paused for emergencies", (m) => m.preemptions, "", 0, true]];
      $("#results", el).innerHTML = `<thead><tr><th></th>${LAB_ALGOS.map((a) => `<th class="r"><span class="algo-name"><i style="background:${a.color}"></i>${a.name}</span></th>`).join("")}</tr></thead><tbody>${rows.map(([label, f, unit, dec, neutral]) => {
        const vals = LAB_ALGOS.map((a) => f(results[a.id].m)), fin = vals.filter((v) => v != null && isFinite(v));
        const best = Math.min(...fin), worst = Math.max(...fin);
        return `<tr><td>${label}</td>${vals.map((v) => `<td class="r num ${!neutral && fin.length > 1 && best !== worst ? (v === best ? "best" : v === worst ? "worst" : "") : ""}">${fmt(v, dec)}${unit && v != null ? " " + unit : ""}</td>`).join("")}</tr>`;
      }).join("")}</tbody>`;
      const max = Math.max(1, ...LAB_ALGOS.flatMap((a) => LEVELS.map((l) => results[a.id].m.byLevel[l] || 0)));
      $("#wchart", el).innerHTML = LEVELS.map((l) => `<div class="wc-col"><div class="wc-bars">${LAB_ALGOS.map((a) => { const v = results[a.id].m.byLevel[l]; return `<div style="height:${((v || 0) / max) * 100}%;background:${a.color}" title="${a.name}: ${fmt(v)} min"><span>${v == null ? "" : Math.round(v)}</span></div>`; }).join("")}</div><div class="wc-lbl">${prio(l)}</div></div>`).join("");
      $("#wlegend", el).innerHTML = LAB_ALGOS.map((a) => `<span><i style="background:${a.color}"></i>${a.name}</span>`).join("");
      gantt();
    }
    function gantt() {
      $("#pick", el).innerHTML = LAB_ALGOS.map((a) => `<button data-a="${a.id}" aria-pressed="${a.id === shown}">${a.name}</button>`).join("");
      const { res } = results[shown];
      const end = Math.max(...res.segments.map((s) => s.to), 1), docs = +$("#docs", el).value;
      let html = "";
      for (let d = 0; d < docs; d++) html += `<div class="gantt-row"><span class="t-small strong">Doctor ${d + 1}</span><div class="gantt-lane">${res.segments.filter((s) => s.doc === d).map((s) => {
        const left = (s.from / end) * 100, w = Math.max(0.3, ((s.to - s.from) / end) * 100);
        return `<div class="job ${s.split ? "split" : ""}" data-level="${s.job.level}" style="left:${left}%;width:${w}%" title="Token ${esc(s.job.token)} · ${LEVEL_LABEL[s.job.level]}${s.job.emergency ? " · emergency" : ""} · ${s.from.toFixed(0)}–${s.to.toFixed(0)} min${s.split ? " (interrupted)" : ""}">${w > 4 ? esc(s.job.token) : ""}</div>`;
      }).join("")}</div></div>`;
      const step = end > 180 ? 60 : end > 90 ? 30 : 15, ticks = [];
      for (let m = 0; m <= end; m += step) ticks.push(`<span style="left:${(m / end) * 100}%">${m}′</span>`);
      $("#gantt", el).innerHTML = html + `<div class="gantt-axis"><span></span><div>${ticks.join("")}</div></div>`;
      $("#gnote", el).textContent = `Each block is one consultation. Striped blocks were interrupted by an emergency and resumed later. Everyone is seen by minute ${Math.round(end)}.`;
    }
    $("#pick", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { shown = b.dataset.a; gantt(); } });
    $("#src", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; source = b.dataset.v; $$("#src button", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); $$(".rnd", el).forEach((x) => x.classList.toggle("hidden", source !== "random")); $("#run", el).classList.toggle("hidden", source !== "random"); run(); });
    ids.forEach((k) => $(`#${k}`, el).addEventListener("input", run));
    $("#run", el).addEventListener("click", () => { seed = Math.floor(Math.random() * 1e9); run(); });
    run();
  },
};

PAGES.about = {
  title: "How it works",
  render(el) {
    const os = [["First come, first served (FCFS)", "Pharmacy: prescriptions join one FIFO queue; only the head can be started", "Pharmacy page"],
      ["Shortest job first (SJF)", "Ambulance and token booking: the hospital with the shortest time to treatment wins; ambulances take emergencies first, then the shortest trip, with aging", "Book a token, Ambulance desk"],
      ["Dynamic priority scheduling", "readyQueue(): patients re-scored from live values and sorted every change", "Reception queue, priority bars"],
      ["Aging (starvation prevention)", "Every 15 s a daemon re-scores the queue and logs overtakes", "Hatched part of the priority bar; AGING lines in the log"],
      ["Pre-emption", "preemptFor(): the least urgent consultation yields to an emergency and resumes next", "Doctor screen notice; PREEMPT log lines; Lab striped blocks"],
      ["Interrupt handling", "The emergency hold-button (GPIO17 on the Pi) raises a Critical patient at once", "Admin → Simulate button press"],
      ["Process synchronisation", "One browser tab holds the daemon lease at a time, so two tabs never dispatch the same tick", "Open Reception and Doctor side by side"],
      ["Inter-process communication", "Every tab shares one state; changes reach other tabs through the storage event (Server-Sent Events on the Pi)", "TV display updates when a doctor finishes"],
      ["Producer / consumer", "Voice inputs are produced at the microphone and consumed by registration", "Voice intake page"]];
    el.innerHTML = `<div class="page">${pageHead("How it works", "MedOS is an operating-systems project: patients are processes, doctors are CPUs, and the scheduler decides who runs next.")}
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("cpu")}The priority score</h2></div><div class="card-body stack-sm">
          <pre class="mono t-small" style="white-space:pre-wrap;margin:0;background:var(--surface-2);padding:12px;border-radius:10px">effective priority = level base + (16 − rank) × 10 + modifiers
                   + min(aging rate × minutes waited, aging limit)
                   → at least 1450 if the patient was pre-empted
                   + 5000 for an emergency override

level base: Critical 1500 · High 600 · Medium 300 · Low 0
modifiers:  age ≥ 65 or ≤ 5: +40 · pregnant: +60 · pain ≥ 8/10: +40
defaults:   aging 5 points/minute, limit 450</pre>
          <p class="t-small muted-2">A Low case waiting about 70 minutes passes a newly arrived Medium case. Critical can never be overtaken: the best High score plus every modifier plus the full aging limit is still below the lowest Critical score.</p>
        </div></section>
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("route")}Choosing a hospital</h2></div><div class="card-body stack-sm t-small muted-2">
          <p><b>Token booking:</b> time to a prescription = max(travel, queue wait) + consultation. The queue keeps moving while you travel, so a farther hospital with a short queue can win.</p>
          <p><b>Ambulance:</b> time to treatment = drive from the pickup + the wait at that hospital (Critical patients are taken straight in, so the drive decides). Hospitals without an emergency department, free beds or the needed specialist are skipped.</p>
          <p><b>Travel times:</b> ${Maps.useGoogle ? "Google Directions and Distance Matrix with live traffic." : "real road routes from OSRM, multiplied by a time-of-day traffic factor (×1.9 at peak). Add a Google Maps key in js/config.js for Google's map and live traffic."}</p>
          <p><b>Doctors and queues:</b> City General's come live from the MedOS queue; the other hospitals' are a simulated live feed that changes every 3 minutes.</p>
        </div></section>
      </div>
      <section class="card" style="margin-top:16px"><div class="card-head"><h2 class="t-h3">${icon("chip")}Operating-system concepts, and where to see them</h2></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Concept</th><th>In MedOS Web</th><th>Watch it live</th></tr></thead><tbody>${os.map((r) => `<tr><td class="strong">${r[0]}</td><td>${r[1]}</td><td class="muted">${r[2]}</td></tr>`).join("")}</tbody></table></div></section>
      <div class="grid-2" style="margin-top:16px">
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("mic")}Voice registration</h2></div><div class="card-body t-small muted-2 stack-sm">
          <p>Speech is recognised by the browser (Chrome, Edge, Safari; English India by default, Tamil and Hindi selectable). The same microphone is recorded so each check-in keeps its audio clip on this device.</p>
          <p>A rules parser pulls out name, age, sex, phone and symptoms ("my name is Kavitha, thirty four, high fever" → Kavitha · 34 · High fever), then triage highlights the words that set the priority.</p>
          <p>On the Raspberry Pi version the same works fully offline with Vosk / Whisper and a USB microphone.</p></div></section>
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("bolt")}Emergency hardware (Pi version)</h2></div><div class="card-body t-small muted-2">
          <table class="tbl"><tbody><tr><td class="strong">Push button</td><td>GPIO17 (pin 11) → GND (pin 9), falling-edge interrupt</td></tr><tr><td class="strong">Red LED</td><td>GPIO27 (pin 13) → 330 Ω → LED → GND (pin 14)</td></tr>
          <tr><td class="strong">Active buzzer</td><td>GPIO22 (pin 15) → buzzer → GND (pin 20)</td></tr></tbody></table>
          <p style="margin-top:8px">Here, the hold-to-confirm emergency buttons and Admin → Simulate button press do the same job.</p></div></section>
      </div>
      <p class="t-xs muted" style="margin-top:20px">MedOS is a decision-support prototype for teaching and demonstration. It isn't a certified medical device. In an emergency in India, call 108.</p></div>`;
  },
};
