// MedOS Web — the landing page (#/) and the hospital dashboard (#/dashboard).
"use strict";

// ------------------------------------------------------------------ shared numbers
function liveSummary() {
  const q = readyQueue(), eta = estimates(q);
  const waits = q.map((p) => eta[p.id]).filter((x) => x != null);
  const docs = S.doctors;
  const all = waitingAll();
  let onDuty = 0, total = 0;
  HOSPITALS.forEach((h) => { const d = hospitalLive(h).doctors; total += d.length; onDuty += d.filter((x) => x.status === "available" || x.status === "busy").length; });
  const today = S.patients.filter((p) => isSelfPatient(p) && p.status === "completed");
  return {
    q, eta, all,
    waiting: q.length,
    byLevel: Object.fromEntries(LEVELS.map((l) => [l, q.filter((p) => p.level === l).length])),
    avgWait: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null,
    longest: q.length ? Math.max(...q.map((p) => (Date.now() - p.arrived) / 60000)) : null,
    free: docs.filter((d) => d.status === "available").length,
    busy: docs.filter((d) => d.status === "busy").length,
    onBreak: docs.filter((d) => d.status === "break").length,
    docsTotal: docs.length,
    netOnDuty: onDuty, netDoctors: total,
    seenToday: today.length,
    avgSeenWait: today.length ? today.reduce((s, p) => s + (p.wait_s || 0), 0) / today.length / 60 : null,
  };
}
// Stacked bar: how many waiting at each priority level.
function levelBar(byLevel) {
  const total = LEVELS.reduce((s, l) => s + byLevel[l], 0) || 1;
  return `<div class="lvl-bar" role="img" aria-label="${LEVELS.map((l) => `${byLevel[l]} ${LEVEL_LABEL[l]}`).join(", ")}">
    ${LEVELS.map((l) => (byLevel[l] ? `<i style="width:${(byLevel[l] / total) * 100}%;background:${LEVEL_COLOR[l]}" title="${byLevel[l]} ${LEVEL_LABEL[l]}"></i>` : "")).join("")}</div>
    <div class="lvl-legend">${LEVELS.map((l) => `<span><i style="background:${LEVEL_COLOR[l]}"></i>${byLevel[l]} ${LEVEL_LABEL[l].toLowerCase()}</span>`).join("")}</div>`;
}

// ================================================================== landing page
PAGES.home = {
  title: "MedOS — care in order of need",
  full: true,
  render(el) {
    const m = ML.available ? ML.metrics : null;
    el.innerHTML = `<div class="lp">
      <header class="lp-nav">
        <a class="lp-brand" href="#/"><span class="brand-mark">${icon("pulse")}</span><span><b>MedOS</b><small>Smart hospital scheduler</small></span></a>
        <nav class="lp-links" aria-label="On this page">
          <button type="button" data-go="how">How it works</button><button type="button" data-go="features">Features</button>
          <button type="button" data-go="levels">Priority levels</button><button type="button" data-go="who">For hospitals</button>
        </nav>
        <div class="lp-actions">
          <a class="btn ghost sm hide-sm" href="#/dashboard">${icon("chart")}Dashboard</a>
          <a class="btn primary sm" href="#/patient">${icon("calendar")}Book a token</a>
        </div>
      </header>

      <section class="lp-hero">
        <div class="lp-hero-text">
          <span class="lp-eyebrow">${icon("pulse")}Emergency department scheduling</span>
          <h1>Care in order of <span class="lp-accent">need</span>,<br>not order of arrival.</h1>
          <p class="lp-lead">MedOS ranks every patient by how sick they are, keeps long waits moving so nobody is forgotten, and sends you to the hospital that can see you soonest — with the route on the map.</p>
          <div class="lp-cta-row">
            <a class="btn primary lg" href="#/patient">${icon("calendar")}Book a token</a>
            <a class="btn danger lg" href="#/patient/ambulance">${icon("ambulance")}Emergency ambulance</a>
          </div>
          <form class="lp-track" id="track-form">
            <label for="trk" class="sr-only">Booking code</label>
            <input class="input" id="trk" name="code" placeholder="Have a booking code? Track it" autocomplete="off">
            <button class="btn">${icon("search")}Track</button>
          </form>
          <ul class="lp-trust">
            <li>${icon("mic")}Speak in English or தமிழ்</li>
            <li>${icon("cpu")}Rules + machine learning</li>
            <li>${icon("route")}Fastest hospital on the map</li>
          </ul>
        </div>
        <aside class="lp-live card" aria-label="Live queue preview">
          <div class="lp-live-head">
            <div><span class="live-dot"></span><b>Live queue</b><small id="lp-hosp"></small></div>
            <a href="#/reception" class="t-small">Open reception ${icon("chevronRight")}</a>
          </div>
          <div class="lp-live-stats" id="lp-stats"></div>
          <div class="lp-live-list" id="lp-queue"></div>
          <p class="lp-live-foot">${icon("info")}Ordered by priority. Emergencies are always seen first; every minute waited adds priority.</p>
        </aside>
      </section>

      <section class="lp-numbers" id="lp-numbers"></section>

      <section class="lp-section" id="how">
        <div class="lp-head"><span class="lp-kicker">How it works</span><h2>From “I'm not well” to a doctor, in four steps</h2></div>
        <ol class="lp-steps">
          ${[["mic", "Tell us what's wrong", "Type it, or just speak — in English or Tamil. Name, age and symptoms are filled in for you."],
            ["shield", "Instant triage", "Rules from the hospital's protocol and a trained ML model set the priority: Critical, High, Medium or Low."],
            ["route", "The fastest hospital", "We compare every hospital's drive time, queue and doctors on duty, and recommend the one that sees you soonest."],
            ["stetho", "Seen in order of need", "You get a token and live position. Emergencies interrupt; long waits climb, so nobody is forgotten."]]
            .map(([ic, t, d], i) => `<li class="lp-step"><span class="lp-step-n">${i + 1}</span><span class="lp-step-ic">${icon(ic)}</span><h3>${t}</h3><p>${d}</p></li>`).join("")}
        </ol>
      </section>

      <section class="lp-section lp-alt" id="features">
        <div class="lp-head"><span class="lp-kicker">Features</span><h2>Everything a busy emergency department needs</h2></div>
        <div class="lp-features">
          ${[["mic", "Voice check-in", "Record until you press Stop, pause and resume. English and Tamil, with an English translation for staff.", "#/voice"],
            ["cpu", "Smart triage + ML", `Protocol rules plus a model trained on ${m ? m.train_rows.toLocaleString() : "thousands of"} cases. It can raise a priority, never lower one.`, "#/about"],
            ["route", "Fastest-hospital routing", "Real road routes, live queues and doctors on duty across 8 hospitals, ranked by time to prescription.", "#/patient"],
            ["siren", "Ambulance SOS", "Hold to send the nearest free ambulance, and watch it move to you and on to the hospital.", "#/patient/ambulance"],
            ["desk", "Live staff dashboards", "Reception, doctor, pharmacy and the waiting-room TV update the moment anything changes.", "#/dashboard"],
            ["lab", "Scheduler Lab", "See FCFS, SJF, priority, aging and pre-emption side by side on the same patients.", "#/lab"]]
            .map(([ic, t, d, href]) => `<a class="lp-feature" href="${href}"><span class="lp-feature-ic">${icon(ic)}</span><h3>${t}</h3><p>${d}</p><span class="lp-more">Open ${icon("chevronRight")}</span></a>`).join("")}
        </div>
      </section>

      <section class="lp-section" id="levels">
        <div class="lp-head"><span class="lp-kicker">Priority levels</span><h2>Four levels, one simple promise</h2>
          <p>The sickest patient is always next. Everyone else moves up the longer they wait.</p></div>
        <div class="lp-levels">
          ${[["critical", "Seen immediately", "Chest pain, can't breathe, stroke signs, severe bleeding, snake bite", "நெஞ்சு வலி · மூச்சு திணறல்"],
            ["high", "Within 15 minutes", "Severe abdominal pain, fractures, fever above 102°F", "எலும்பு முறிவு · அதிக காய்ச்சல்"],
            ["medium", "Within 1 hour", "Migraine, persistent vomiting, mild asthma, chest infection", "தொடர்ந்து வாந்தி · ஆஸ்துமா"],
            ["low", "Within 2 hours", "Back pain, ear pain, sore throat, cold, routine check-up", "காது வலி · சளி · இருமல்"]]
            .map(([l, when, eg, ta]) => `<div class="lp-level" data-level="${l}">${prio(l, { lg: true })}<b>${when}</b><p>${eg}</p><p class="lp-ta" lang="ta">${ta}</p></div>`).join("")}
        </div>
      </section>

      <section class="lp-section lp-alt" id="who">
        <div class="lp-head"><span class="lp-kicker">Who it's for</span><h2>Built for patients and the people caring for them</h2></div>
        <div class="lp-who">
          <div class="lp-who-card">
            <span class="lp-feature-ic">${icon("user")}</span><h3>For patients</h3>
            <ul>${["Book a token from your phone — no queue at the desk", "See which hospital will see you soonest, and the route", "Track your position live and get alerted near your turn", "Call an ambulance with one long press"].map((x) => `<li>${icon("check")}${x}</li>`).join("")}</ul>
            <div class="row"><a class="btn primary" href="#/patient">Book a token</a><a class="btn" href="#/patient/bookings">My bookings</a></div>
          </div>
          <div class="lp-who-card">
            <span class="lp-feature-ic">${icon("hospital")}</span><h3>For hospital staff</h3>
            <ul>${["One live queue per hospital, always in priority order", "Register by voice; Tamil arrives with an English translation", "Doctors call the next patient automatically", "Emergency button pre-empts the least urgent consultation"].map((x) => `<li>${icon("check")}${x}</li>`).join("")}</ul>
            <div class="row"><a class="btn primary" href="#/dashboard">Open dashboard</a><a class="btn" href="#/reception">Reception</a></div>
          </div>
        </div>
      </section>

      <section class="lp-band">
        <div><h2>Need care right now?</h2><p>Book a token in under a minute, or send an ambulance to where you are.</p></div>
        <div class="row"><a class="btn lg lp-band-btn" href="#/patient">${icon("calendar")}Book a token</a><a class="btn danger lg" href="#/patient/ambulance">${icon("ambulance")}Emergency ambulance</a></div>
      </section>

      <footer class="lp-foot">
        <div class="lp-foot-grid">
          <div><a class="lp-brand" href="#/"><span class="brand-mark">${icon("pulse")}</span><span><b>MedOS</b><small>Smart hospital scheduler</small></span></a>
            <p class="t-small muted">A teaching and demonstration project built on operating-system scheduling: dynamic priority, aging, pre-emption, FCFS and SJF.</p></div>
          <div><h4>Patients</h4><a href="#/patient">Book a token</a><a href="#/patient/ambulance">Ambulance</a><a href="#/patient/bookings">My bookings</a></div>
          <div><h4>Hospital staff</h4><a href="#/dashboard">Dashboard</a><a href="#/reception">Reception</a><a href="#/doctor">Doctor</a><a href="#/admin">Admin</a></div>
          <div><h4>Learn</h4><a href="#/about">How it works</a><a href="#/lab">Scheduler Lab</a><a href="#/display">Waiting-room display</a></div>
        </div>
        <p class="lp-legal">MedOS is a decision-support prototype, not a certified medical device. In a medical emergency in India, call <a href="tel:108">108</a>.</p>
      </footer>
    </div>`;

    $$("[data-go]", el).forEach((b) => b.addEventListener("click", () => $("#" + b.dataset.go, el).scrollIntoView({ behavior: "smooth", block: "start" })));
    $("#track-form", el).addEventListener("submit", (e) => { e.preventDefault(); const c = e.target.code.value.trim().toLowerCase(); if (c) location.hash = "#/track/" + c; });

    const draw = () => {
      const s = liveSummary();
      $("#lp-hosp", el).textContent = ` · ${S.settings.hospital_name} · ${fmtClock(Date.now())}`;
      $("#lp-stats", el).innerHTML = `<div><b>${s.waiting}</b><span>waiting</span></div><div><b>${s.free}<small>/${s.docsTotal}</small></b><span>doctors free</span></div>
        <div><b>${s.avgWait == null ? "—" : fmtMin(s.avgWait)}</b><span>average wait</span></div>`;
      $("#lp-queue", el).innerHTML = s.q.length ? s.q.slice(0, 5).map((p) => `<div class="lp-qrow">
          <span class="lp-qpos">${p.position}</span>${tokenChip(p.token, p.level)}
          <span class="lp-qwho"><b>${esc(p.primary)}</b><small>${p.emergency ? "Emergency · " : ""}waited ${fmtMin((Date.now() - p.arrived) / 60000)}</small></span>
          ${prio(p.level)}</div>`).join("") + (s.q.length > 5 ? `<div class="lp-qmore">+ ${s.q.length - 5} more waiting</div>` : "")
        : `<div class="empty">${icon("check")}<p>Nobody is waiting right now.</p></div>`;
      $("#lp-numbers", el).innerHTML = [
        [HOSPITALS.length, "hospitals connected"],
        [`${s.netOnDuty}`, `doctors on duty now (of ${s.netDoctors})`],
        [s.all.length, "patients waiting across hospitals"],
        [m ? (m.combined_accuracy * 100).toFixed(0) + "%" : "4", m ? "triage accuracy, rules + ML (synthetic test)" : "priority levels"],
      ].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join("");
    };
    draw();
    const off = onChange(debounceFor(el, draw, 400));
    const iv = setInterval(draw, 30000);
    return () => { off(); clearInterval(iv); };
  },
};

// ================================================================== hospital dashboard
const EVENT_ICON = { ARRIVE: "plus", DISPATCH: "stetho", AGING: "clock", PREEMPT: "bolt", INTERRUPT: "siren", FINISH: "check", AMBULANCE: "ambulance",
  PHARMACY: "pill", VOICE: "mic", BOOKING: "ticket", ML: "cpu", SYSTEM: "info", CANCEL: "x", DOCTOR: "user", ALERT: "bell", NO_SHOW: "x" };

PAGES.dashboard = {
  title: "Dashboard",
  render(el) {
    el.innerHTML = `<div class="page dash">
      <div class="page-head">
        <div><h1 class="t-h1">Hospital overview</h1><p id="d-sub"></p></div>
        <div class="page-actions">
          <a class="btn" href="#/reception">${icon("plus")}Register patient</a>
          <a class="btn primary" href="#/patient">${icon("calendar")}Book a token</a>
        </div>
      </div>
      <div id="d-alert"></div>
      <div class="dash-kpis" id="d-kpis"></div>

      <div class="dash-row">
        <section class="card dash-card">
          <div class="card-head"><h2 class="t-h3">${icon("list")}Live queue</h2><span class="t-small muted" id="d-qsum"></span></div>
          <div id="d-queue"></div>
          <a class="dash-foot" href="#/reception">Open Reception ${icon("chevronRight")}</a>
        </section>
        <section class="card dash-card">
          <div class="card-head"><h2 class="t-h3">${icon("stetho")}Doctors</h2><span class="t-small muted" id="d-dsum"></span></div>
          <div id="d-docs"></div>
          <a class="dash-foot" href="#/doctor">Doctor screen ${icon("chevronRight")}</a>
        </section>
      </div>

      <div class="dash-row equal">
        <section class="card dash-card">
          <div class="card-head"><h2 class="t-h3">${icon("hospital")}Hospitals near you</h2><span class="t-small muted" id="d-hsum"></span></div>
          <div class="map-wrap dash-map"><div class="map" id="d-map"></div></div>
        </section>
        <section class="card dash-card">
          <div class="card-head"><h2 class="t-h3">${icon("users")}Doctors on duty by hospital</h2><span class="pill">Tap for details</span></div>
          <div id="d-hosps" class="dash-scroll"></div>
        </section>
      </div>

      <div class="dash-row">
        <section class="card dash-card">
          <div class="card-head"><h2 class="t-h3">${icon("terminal")}Recent activity</h2></div>
          <div id="d-events"></div>
          <a class="dash-foot" href="#/admin">Full log in Admin ${icon("chevronRight")}</a>
        </section>
        <section class="card dash-card">
          <div class="card-head"><h2 class="t-h3">${icon("pulse")}Services</h2></div>
          <div id="d-services"></div>
          <div class="dash-links">
            ${[["#/voice", "mic", "Voice intake"], ["#/pharmacy", "pill", "Pharmacy"], ["#/ambulance", "siren", "Ambulance desk"], ["#/display", "tv", "TV display"], ["#/admin", "shield", "Admin"], ["#/lab", "lab", "Scheduler Lab"]]
              .map(([h, ic, t]) => `<a href="${h}">${icon(ic)}<span>${t}</span></a>`).join("")}
          </div>
        </section>
      </div>
    </div>`;

    const view = Maps.create($("#d-map", el), { zoom: 11 });
    Maps.chrome($("#d-map", el).parentElement, view);
    view.setOrigin(ORIGIN, ORIGIN.label);
    let fitted = false;
    $("#d-hosps", el).addEventListener("click", (e) => { const b = e.target.closest("[data-h]"); if (b) hospitalModal(hospitalById(+b.dataset.h)); });
    $("#d-alert", el).addEventListener("click", (e) => { if (e.target.closest("[data-ack]")) acknowledge(null, "dashboard"); });

    const draw = () => {
      const s = liveSummary();
      const now = new Date();
      $("#d-sub", el).innerHTML = `<span class="live-dot"></span>${esc(S.settings.hospital_name)} · live · ${now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}, ${fmtClock(Date.now())}`;
      const alerts = openAlerts();
      $("#d-alert", el).innerHTML = alerts.length ? `<div class="dash-alert">${icon("siren")}<div><b>${alerts.length} emergency alert${alerts.length > 1 ? "s" : ""}</b><span>${esc(alerts[alerts.length - 1].message)}</span></div><button class="btn sm" data-ack>Acknowledge</button></div>` : "";

      const ph = { waiting: S.pharmacy.filter((o) => o.status === "waiting").length, ready: S.pharmacy.filter((o) => o.status === "ready").length };
      $("#d-kpis", el).innerHTML = `
        <div class="card kpi dash-kpi"><span class="k-label">${icon("users")}Waiting now</span><span class="k-value">${s.waiting}</span>${levelBar(s.byLevel)}</div>
        <div class="card kpi dash-kpi"><span class="k-label">${icon("stetho")}Doctors free</span><span class="k-value">${s.free}<small> of ${s.docsTotal}</small></span>
          <span class="k-sub">${s.busy} with a patient · ${s.onBreak} on a break</span></div>
        <div class="card kpi dash-kpi"><span class="k-label">${icon("clock")}Expected wait</span><span class="k-value">${s.avgWait == null ? "—" : fmtMin(s.avgWait)}</span>
          <span class="k-sub">${s.longest == null ? "Nobody waiting" : `Longest waiting: ${fmtMin(s.longest)}`}</span></div>
        <div class="card kpi dash-kpi"><span class="k-label">${icon("check")}Seen today</span><span class="k-value">${s.seenToday}</span>
          <span class="k-sub">${s.avgSeenWait == null ? "—" : `Average wait ${fmtMin(s.avgSeenWait)}`} · ${ph.ready} prescription${ph.ready === 1 ? "" : "s"} ready</span></div>`;

      $("#d-qsum", el).textContent = `${s.waiting} waiting · in priority order`;
      $("#d-queue", el).innerHTML = s.q.length ? `<div class="dash-list">${s.q.slice(0, 7).map((p) => `<a class="dash-item" href="#/reception">
          <span class="dash-pos">${p.position}</span>${tokenChip(p.token, p.level)}
          <span class="dash-main"><b>${esc(p.name || "Unnamed")}</b><small>${esc(p.symptomsEn || p.primary)}</small></span>
          <span class="dash-side">${prio(p.level)}<small>${s.eta[p.id] == null ? "—" : "in " + fmtMin(s.eta[p.id])}</small></span></a>`).join("")}</div>`
        : `<div class="empty">${icon("check")}<p>Nobody is waiting.</p></div>`;

      const label = { available: "Free", busy: "With patient", break: "On a break", off_duty: "Off duty" };
      $("#d-dsum", el).textContent = `${s.free} free · ${s.busy} busy`;
      $("#d-docs", el).innerHTML = `<div class="dash-list">${S.doctors.map((d) => {
        const p = d.currentId && getPatient(d.currentId), room = S.rooms.find((r) => r.id === d.roomId);
        return `<a class="dash-item" href="#/doctor"><span class="avatar">${initials(d.name)}</span>
          <span class="dash-main"><b>${esc(d.name)}</b><small>${esc(d.specialty)} · ${esc(room ? room.name : "No room")}</small></span>
          <span class="dash-side"><span class="status-pill ${d.status}"><span class="dot ${d.status}"></span>${label[d.status]}</span>${p ? `<small>Token ${esc(p.token)} · ${fmtMin((Date.now() - p.called) / 60000)}</small>` : ""}</span></a>`;
      }).join("")}</div>`;

      view.clearPins();
      const rows = HOSPITALS.map((h) => {
        const live = hospitalLive(h), d = live.doctors;
        const on = d.filter((x) => x.status === "available" || x.status === "busy").length, free = d.filter((x) => x.status === "available").length;
        view.addHospital(h, { badge: `${on} dr`, best: h.self, onClick: () => hospitalModal(h), tooltip: `${h.name} · ${free} free now` });
        return { h, live, on, free, total: d.length, km: haversineKm(ORIGIN, h) };
      }).sort((a, b) => a.km - b.km);
      if (!fitted) { view.fit([ORIGIN, ...HOSPITALS], 30); fitted = true; }
      $("#d-hsum", el).textContent = `${HOSPITALS.length} hospitals · ${s.netOnDuty} doctors on duty`;
      $("#d-hosps", el).innerHTML = `<div class="dash-list">${rows.map((r) => `<button class="dash-item" type="button" data-h="${r.h.id}">
          <span class="avatar hosp">${icon("hospital")}</span>
          <span class="dash-main"><b>${esc(r.h.name)}${r.h.self ? ` <span class="pill brand">This hospital</span>` : ""}</b><small>${esc(r.h.area)} · ${r.km.toFixed(1)} km · ${r.live.queue} waiting · ER ~${r.live.er_wait} min</small></span>
          <span class="dash-side"><b class="num">${r.on}<small>/${r.total}</small></b><small>${r.free} free now</small></span></button>`).join("")}</div>`;

      const ev = S.events.slice(-10).reverse();
      $("#d-events", el).innerHTML = ev.length ? `<ul class="dash-events">${ev.map((e) => `<li><span class="ev-ic k-${e.kind}">${icon(EVENT_ICON[e.kind] || "info")}</span>
          <span class="ev-msg">${esc(e.msg)}</span><time>${fmtAgo(e.ts)}</time></li>`).join("")}</ul>` : `<div class="empty"><p>No activity yet.</p></div>`;

      const amb = { free: S.ambulances.filter((a) => a.status === "available").length, trip: S.ambulances.filter((a) => a.status !== "available").length, queue: ambulanceQueue().length };
      const mlUps = S.patients.filter((p) => p.levelSource === "ml" || p.levelSource === "translation").length;
      $("#d-services", el).innerHTML = `<div class="dash-services">
        <div><span>${icon("ambulance")}Ambulances</span><b>${amb.free} free</b><small>${amb.trip} on a trip${amb.queue ? ` · ${amb.queue} waiting` : ""}</small></div>
        <div><span>${icon("pill")}Pharmacy</span><b>${ph.waiting} in queue</b><small>${ph.ready} ready to collect</small></div>
        <div><span>${icon("mic")}Voice inputs</span><b>${S.voice.length}</b><small>${S.voice.filter((v) => v.patientId).length} added to the queue</small></div>
        <div><span>${icon("cpu")}ML model</span><b>${ML.available ? "On" : "Off"}</b><small>${mlUps} priorit${mlUps === 1 ? "y" : "ies"} raised today</small></div>
      </div>`;
    };
    draw();
    const off = onChange(debounceFor(el, draw, 400));
    const iv = setInterval(draw, 30000);
    return () => { off(); clearInterval(iv); view.destroy(); };
  },
};
