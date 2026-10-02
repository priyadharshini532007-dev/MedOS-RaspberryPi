// MedOS Web — patient-facing pages: home, book a token, book an ambulance, my bookings, live tracking.
"use strict";

// ------------------------------------------------------------------ shared pieces
let ORIGIN = store("medos.origin") || { ...AREAS["T. Nagar"], label: "T. Nagar" };
function setOriginGlobal(p) { ORIGIN = p; store("medos.origin", p); }

function pageHead(title, sub, actions = "") {
  return `<div class="page-head"><div><h1 class="t-h1">${esc(title)}</h1><p>${sub}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
}
function docSummary(docs) {
  const on = docs.filter((d) => d.status === "available" || d.status === "busy").length;
  const free = docs.filter((d) => d.status === "available").length;
  return { on, free, total: docs.length };
}
function docChips(docs, max = 8) {
  const order = { available: 0, busy: 1, break: 2, off_duty: 3 };
  const label = { available: "Free now", busy: "With a patient", break: "On a break", off_duty: "Off duty" };
  return `<div class="docs">${[...docs].sort((a, b) => order[a.status] - order[b.status]).slice(0, max)
    .map((d) => `<span class="doc-chip ${d.status}" title="${esc(d.specialty)} · ${label[d.status]}"><span class="dot ${d.status}"></span>${esc(d.name.replace("Dr. ", "Dr "))}<span class="muted">· ${esc(d.specialty.replace("Medicine", "Med."))}</span></span>`).join("")}
    ${docs.length > max ? `<span class="doc-chip">+${docs.length - max} more</span>` : ""}</div>`;
}
// Stacked bar: travel | waiting at the hospital | consultation, on a shared scale.
function raceBar(segs, scale) {
  const w = (v) => `${Math.max(0, (v / scale) * 100).toFixed(2)}%`;
  return `<div class="race" role="img" aria-label="${segs.map((s) => `${s.label} ${Math.round(s.v)} min`).join(", ")}">${segs.map((s) => `<i class="${s.cls}" style="width:${w(s.v)}" title="${s.label}: ${Math.round(s.v)} min"></i>`).join("")}</div>`;
}
function hospitalModal(h) {
  const live = hospitalLive(h);
  const groups = {};
  live.doctors.forEach((d) => (groups[d.specialty] = groups[d.specialty] || []).push(d));
  const s = docSummary(live.doctors);
  modal({ title: h.name, wide: true, body: `
    <div class="row"><span class="pill">${icon("pin")}${esc(h.area)}</span><span class="pill ok">${s.on} of ${s.total} doctors on duty</span>
      <span class="pill info">${s.free} free now</span><span class="pill">${icon("bed")}${live.beds} beds free</span><span class="pill warn">${icon("clock")}ER wait ~${live.er_wait} min</span>
      ${h.self ? `<span class="pill brand">Live from MedOS</span>` : `<span class="pill">Reported every 3 min</span>`}</div>
    <div><div class="label" style="margin-bottom:6px">Departments</div><div class="row">${h.specialties.map((x) => `<span class="pill">${esc(x)}</span>`).join("")}</div></div>
    <div class="stack-sm">${Object.entries(groups).map(([sp, ds]) => `<div><div class="t-small strong" style="margin-bottom:4px">${esc(sp)}</div>${docChips(ds, 20)}</div>`).join("")}</div>
    <div class="row"><a class="btn sm" href="${Maps.googleMapsLink(ORIGIN, h)}" target="_blank" rel="noopener">${icon("nav")}Directions in Google Maps</a>
      <a class="btn sm ghost" href="tel:${h.phone.replace(/\s/g, "")}">${icon("phone")}${esc(h.phone)}</a></div>` });
}

// Location picker card: GPS, pickup area, or tap on the map.
function locationCard(title = "Where are you?") {
  return `<section class="card">
    <div class="card-head"><h2 class="t-h3">${icon("pin")}${esc(title)}</h2><span class="pill brand" data-loc-label></span></div>
    <div class="card-body stack-sm">
      <div class="row">
        <button class="btn sm" type="button" data-gps>${icon("locate")}Use my location</button>
        <select class="select-sm" data-area aria-label="Pickup area"><option value="">Choose an area…</option>${Object.keys(AREAS).map((a) => `<option>${esc(a)}</option>`).join("")}</select>
      </div>
      <p class="t-small muted">Or tap anywhere on the map to drop your pin.</p>
    </div></section>`;
}
function bindLocation(root, view, onChange) {
  const label = () => { $$("[data-loc-label]", root).forEach((el) => (el.textContent = ORIGIN.label)); const s = $("[data-area]", root); if (s) s.value = AREAS[ORIGIN.label] ? ORIGIN.label : ""; };
  const set = (p) => { setOriginGlobal(p); label(); onChange(p); };
  label();
  const gps = async () => {
    const b = $("[data-gps]", root); b.disabled = true; b.lastChild.textContent = "Locating…";
    const r = await Maps.locate();
    b.disabled = false; b.lastChild.textContent = "Use my location";
    if (r.point) { set({ ...r.point, label: "My location" }); view.panTo(r.point); toast("Location found"); }
    else toast(r.error, "warn", 6500);
  };
  $("[data-gps]", root).addEventListener("click", gps);
  $("[data-area]", root).addEventListener("change", (e) => e.target.value && set({ ...AREAS[e.target.value], label: e.target.value }));
  view.onClick((p) => set({ ...p, label: "Pinned location" }));
  return { gps };
}

// ------------------------------------------------------------------ home
PAGES.home = {
  title: "Home",
  render(el) {
    el.innerHTML = `<div class="page">
      <section class="hero">
        <div class="stack">
          <span class="pill brand">${icon("pulse")}Smart Hospital Emergency Scheduler</span>
          <h1 class="t-display">Care in order of need, not order of arrival.</h1>
          <p>MedOS ranks every patient by how sick they are, lets long waits climb so nobody is forgotten, and finds the hospital that gets you to a doctor fastest — with the route on the map.</p>
          <div class="row">
            <a class="btn primary lg" href="#/patient">${icon("calendar")}Book a token</a>
            <a class="btn danger lg" href="#/patient/ambulance">${icon("ambulance")}Emergency ambulance</a>
          </div>
          <form class="row" id="track-form"><input class="input" style="max-width:220px" name="code" placeholder="Booking code" aria-label="Booking code" autocomplete="off"><button class="btn">${icon("search")}Track</button></form>
        </div>
        <div class="stack-sm">
          <div class="livebar" id="livebar"></div>
          <p class="t-xs muted" id="live-note"></p>
        </div>
      </section>

      <div class="split-r" style="margin-top:24px">
        <section class="card">
          <div class="card-head"><h2 class="t-h3">${icon("hospital")}Hospitals and doctors right now</h2><span class="t-small muted" id="h-sum"></span></div>
          <div class="map-wrap" style="border:0;border-radius:0"><div class="map" id="home-map" style="height:440px"></div></div>
        </section>
        <section class="card">
          <div class="card-head"><h2 class="t-h3">${icon("list")}At a glance</h2><span class="pill">Tap for doctors</span></div>
          <div id="h-list"></div>
        </section>
      </div>

      <h2 class="t-h2" style="margin:32px 0 12px">Every screen</h2>
      <div class="grid-4" id="tiles"></div>
    </div>`;
    const tiles = [
      ["#/patient", "calendar", "Book a token", "Symptoms by voice or text → the hospital that sees you soonest."],
      ["#/patient/ambulance", "ambulance", "Ambulance", "Nearest ambulance, shortest time to treatment, live tracking.", "sos"],
      ["#/reception", "desk", "Reception", "Register by typing or voice, live triage, priority queue."],
      ["#/voice", "mic", "Voice intake", "Every spoken check-in, recorded and listed by priority."],
      ["#/doctor", "stetho", "Doctor", "Current and next patient, finish consultation, prescriptions."],
      ["#/admin", "shield", "Admin", "Doctors, rooms, waits, alerts, triage protocol, kernel log."],
      ["#/display", "tv", "Waiting-room display", "Calls tokens aloud with a chime; who's next."],
      ["#/lab", "lab", "Scheduler Lab", "FCFS vs SJF vs priority vs aging vs pre-emption, with Gantt charts."],
    ];
    $("#tiles", el).innerHTML = tiles.map(([href, ic, t, d, cls]) => `<a class="tile ${cls || ""}" href="${href}"><span class="ti">${icon(ic)}</span><b>${t}</b><p>${d}</p></a>`).join("");
    $("#track-form", el).addEventListener("submit", (e) => { e.preventDefault(); const c = e.target.code.value.trim().toLowerCase(); if (c) location.hash = "#/track/" + c; });

    const view = Maps.create($("#home-map", el), { zoom: 11 });
    Maps.chrome($("#home-map", el).parentElement, view);
    view.setOrigin(ORIGIN, ORIGIN.label);

    const draw = () => {
      const q = readyQueue(), eta = estimates(q);
      const docsOn = S.doctors.filter((d) => d.status === "available" || d.status === "busy").length;
      const waits = q.map((p) => eta[p.id]).filter((x) => x != null);
      $("#livebar", el).innerHTML = `<div><b>${q.length}</b><span>Waiting now</span></div><div><b>${docsOn}</b><span>Doctors on duty</span></div>
        <div><b>${waits.length ? fmtMin(waits.reduce((a, b) => a + b, 0) / waits.length) : "—"}</b><span>Average wait</span></div>
        <div><b style="color:var(--crit)">${q.filter((p) => p.level === "critical").length}</b><span>Critical waiting</span></div>`;
      $("#live-note", el).textContent = `${S.settings.hospital_name} · live queue · updated ${fmtClock(Date.now())}`;
      let totalDocs = 0, onDocs = 0;
      view.clearPins();
      const rows = HOSPITALS.map((h) => {
        const live = hospitalLive(h), s = docSummary(live.doctors);
        totalDocs += s.total; onDocs += s.on;
        view.addHospital(h, { badge: `${s.on} dr`, onClick: () => hospitalModal(h), tooltip: `${h.name} · ${s.free} free now` });
        return { h, live, s, km: haversineKm(ORIGIN, h) };
      }).sort((a, b) => a.km - b.km);
      $("#h-sum", el).textContent = `${HOSPITALS.length} hospitals · ${onDocs} of ${totalDocs} doctors on duty`;
      $("#h-list", el).innerHTML = rows.map(({ h, live, s, km }) => `<button class="qrow" style="grid-template-columns:minmax(0,1fr) auto;width:100%;border-left:0;border-right:0;border-top:0;background:none;text-align:left;cursor:pointer" data-h="${h.id}">
        <span class="who"><b>${esc(h.name)}</b><small>${esc(h.area)} · ${km.toFixed(1)} km · ${live.queue} waiting · ER ~${live.er_wait} min</small></span>
        <span class="eta"><b>${s.on}<span class="muted t-small"> / ${s.total}</span></b><span class="t-xs muted">${s.free} free now</span></span></button>`).join("");
      if (!draw.fitted) { view.fit([ORIGIN, ...HOSPITALS]); draw.fitted = true; }
    };
    $("#h-list", el).addEventListener("click", (e) => { const b = e.target.closest("[data-h]"); if (b) hospitalModal(hospitalById(+b.dataset.h)); });
    draw();
    const off = onChange(debounceFor(el, draw, 300));
    const iv = setInterval(draw, 30000);
    return () => { off(); clearInterval(iv); view.destroy(); };
  },
};

// ------------------------------------------------------------------ book a token
PAGES.patient = {
  title: "Book a token",
  render(el) {
    el.innerHTML = `<div class="page wide">
      ${pageHead("Book a token", "Tell us what's wrong and where you are. We compare every hospital and recommend the one that gets you a prescription soonest.",
        `<a class="btn" href="#/patient/bookings">${icon("ticket")}My bookings</a><a class="btn danger" href="#/patient/ambulance">${icon("ambulance")}Need an ambulance?</a>`)}
      <div class="split">
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2 class="t-h3">${icon("mic")}1 · What's wrong?</h2><span id="tri"></span></div>
            <div class="card-body stack">
              <div id="vbox"></div>
              <div class="chips" id="samples"></div>
              <form id="pform" class="form-grid" autocomplete="off">
                <label class="field c6"><span>Symptoms</span><textarea class="textarea" name="symptoms" required placeholder="e.g. Ear pain since last night, mild fever"></textarea></label>
                <label class="field c3"><span>Name</span><input class="input" name="name" required autocomplete="name"></label>
                <label class="field c2 half"><span>Age</span><input class="input" name="age" type="number" min="0" max="120" inputmode="numeric"></label>
                <label class="field c1"><span>Sex</span><select class="select" name="sex"><option value="">—</option><option value="female">F</option><option value="male">M</option><option value="other">Other</option></select></label>
                <label class="field c3"><span>Phone</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel"></label>
                <label class="field c3"><span>Department</span><select class="select" name="dept"><option value="">Suggested by triage</option>${DEPARTMENTS.filter((d) => d !== "Emergency").map((d) => `<option>${d}</option>`).join("")}</select></label>
                <label class="check c6"><input type="checkbox" name="pregnant"> Pregnant</label>
              </form>
              <div id="crit-note"></div>
            </div>
          </section>
          ${locationCard("2 · Where are you starting from?")}
          <section class="card">
            <div class="card-head"><h2 class="t-h3">${icon("crown")}3 · Recommended hospitals</h2><span class="t-small muted" id="rsum"></span></div>
            <div class="card-body stack-sm">
              <div class="legend"><span><i style="background:var(--seg-travel)"></i>Travel</span><span><i style="background:var(--seg-wait)"></i>Waiting at the hospital</span><span><i style="background:var(--seg-consult)"></i>Consultation</span></div>
              <div id="why"></div>
              <div class="hlist" id="hlist"></div>
            </div>
          </section>
        </div>
        <div class="stack" style="position:sticky;top:16px">
          <div class="map-wrap"><div class="map tall" id="pmap"></div><div class="map-overlay" id="sel-card"></div></div>
          <button class="btn primary lg block" id="book" type="button">${icon("ticket")}Book token</button>
          <p class="t-xs muted" id="src-note"></p>
        </div>
      </div></div>`;

    const form = $("#pform", el);
    const draft = store("medos.patient.draft");
    if (draft) Object.entries(draft).forEach(([k, v]) => { const f = form.elements[k]; if (f) f.type === "checkbox" ? (f.checked = !!v) : (f.value = v ?? ""); });
    let voiceId = null, travel = {}, travelFor = null, rec = null, selected = null, picked = false, routeVer = 0;
    const view = Maps.create($("#pmap", el));
    const loc = bindLocation(el, view, () => refreshTravel());
    Maps.chrome($("#pmap", el).parentElement, view, { onLocate: () => loc.gps() });

    $("#samples", el).innerHTML = SAMPLE_PHRASES.slice(0, 4).map((s) => `<button class="chip-btn" type="button">${esc(s)}</button>`).join("");
    $("#samples", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) fill(parseCheckin(b.textContent)); });
    mountVoice($("#vbox", el), { source: "patient", onResult: (r) => {
      const v = addVoiceInput({ transcript: r.text, fields: r.fields, source: "patient booking", audioId: r.audioId, durationS: r.durationS, lang: r.lang });
      voiceId = v.id; fill(r.fields);
    } });

    function fill(f) {
      if (f.name) form.name.value = f.name;
      if (f.age) form.age.value = f.age;
      if (f.sex) form.sex.value = f.sex;
      if (f.phone) form.phone.value = f.phone;
      if (f.symptoms) form.symptoms.value = f.symptoms;
      if (f.pregnant) form.pregnant.checked = true;
      update();
    }
    const data = () => ({ name: form.name.value.trim(), age: form.age.value ? +form.age.value : null, sex: form.sex.value, phone: form.phone.value.trim(),
      symptoms: form.symptoms.value.trim(), pregnant: form.pregnant.checked, department: form.dept.value || null });

    async function refreshTravel() {
      const o = ORIGIN;
      travelFor = o;
      view.setOrigin(o, o.label === "My location" ? "You" : o.label);
      travel = {};
      update();
      const res = await Maps.matrix(o, HOSPITALS);
      if (travelFor !== o) return;
      HOSPITALS.forEach((h, i) => (travel[h.id] = { min: Maps.travelMinutes(res[i]), km: res[i].km, source: res[i].source }));
      $("#src-note", el).textContent = `Travel times: ${Maps.sourceLabel(res[0].source)}${res[0].source === "osrm" ? ` (${trafficFactor().label}, ×${trafficFactor().f})` : ""}. Waits: City General live from the MedOS queue; others as reported.`;
      update(true);
    }

    function update(redrawRoutes = true) {
      const d = data();
      store("medos.patient.draft", { ...d, dept: form.dept.value });
      const t = analyse(d.symptoms, d.age, {}, d.pregnant);
      $("#tri", el).innerHTML = d.symptoms ? `${prio(t.level)} <span class="t-small muted">${esc(t.department)}</span>` : "";
      $("#crit-note", el).innerHTML = d.symptoms && t.level === "critical"
        ? `<div class="notice bad">${icon("siren")}<div><b>This sounds like an emergency (${esc(t.primary_condition)}).</b> Don't travel on your own — <a href="#/patient/ambulance" data-to-amb>book an ambulance</a> or call 108.</div></div>` : "";
      rec = recommendToken(d, ORIGIN, travel);
      if (!picked || !selected || !rec.rows.find((r) => r.id === selected && r.eligible)) selected = rec.best ? rec.best.id : null;
      renderList();
      renderMap(redrawRoutes);
    }
    $("#crit-note", el).addEventListener("click", (e) => { if (e.target.closest("[data-to-amb]")) store("medos.amb.draft", { condition: form.symptoms.value, name: form.name.value, age: form.age.value, phone: form.phone.value }); });

    function renderList() {
      const rows = rec.rows;
      const scale = Math.max(...rows.filter((r) => r.eligible).map((r) => r.travelMin + (r.onsiteWait || 0) + r.consult), 10);
      const onDocs = rows.reduce((s, r) => s + r.live.doctors.filter((d) => d.status === "available" || d.status === "busy").length, 0);
      const allDocs = rows.reduce((s, r) => s + r.live.doctors.length, 0);
      $("#rsum", el).textContent = `${rows.length} hospitals · ${onDocs}/${allDocs} doctors on duty`;
      const b = rec.best;
      $("#why", el).innerHTML = b ? `<div class="why"><b>${esc(b.h.name)}</b> gets you to a prescription in about <b>${fmtMin(b.total)}</b>:
        ${b.travelMin} min to get there, ${b.onsiteWait ? `about ${b.onsiteWait} min waiting after you arrive` : "your turn should come as you arrive"}, then a ~${Math.round(b.consult)}-min ${esc(rec.dept)} consultation.
        ${rec.bestSpecialist ? `<br>Prefer a ${esc(rec.dept)} specialist? <a href="#" data-pick="${rec.bestSpecialist.id}">${esc(rec.bestSpecialist.h.short)}</a> takes ${fmtMin(rec.bestSpecialist.total)}.` : ""}</div>` : `<div class="notice warn">${icon("info")}No hospital has a doctor on duty for this right now.</div>`;
      $("#hlist", el).innerHTML = rows.map((r, i) => {
        const s = docSummary(r.docs);
        const best = r === rec.best;
        return `<div class="hcard ${best ? "best" : ""} ${r.eligible ? "" : "off"}" role="button" tabindex="0" aria-pressed="${r.id === selected}" data-id="${r.id}">
          <div class="hcard-top">
            <span class="hrank">${best ? icon("crown") : i + 1}</span>
            <div style="min-width:0"><div class="hname">${esc(r.h.name)}</div>
              <div class="hmeta">${esc(r.h.area)} · ${r.travelKm ? r.travelKm.toFixed(1) + " km" : ""} · ${r.ahead} ahead of you${r.h.self ? " · live" : ""}</div></div>
            <div class="htotal">${r.eligible ? `<b>${fmtMin(r.total)}</b><small>to prescription</small>` : `<small>${esc(r.reason)}</small>`}</div>
          </div>
          ${r.eligible ? raceBar([{ cls: "tr", v: r.travelMin, label: "Travel" }, { cls: "wt", v: r.onsiteWait, label: "Waiting at the hospital" }, { cls: "cs", v: r.consult, label: "Consultation" }], scale) : ""}
          <div class="row">
            ${r.specialist ? `<span class="pill ok">${icon("check")}${esc(rec.dept)} doctors</span>` : `<span class="pill warn">General doctor sees ${esc(rec.dept)}</span>`}
            <span class="pill">${icon("stetho")}${s.on} of ${s.total} on duty · ${s.free} free</span>
            <span class="pill">${icon("bed")}${r.live.beds} beds</span>
            ${best ? `<span class="pill brand">${icon("star")}Recommended</span>` : ""}
          </div>
          ${r.id === selected ? docChips(r.docs) : ""}
        </div>`;
      }).join("");
      const sel = rows.find((r) => r.id === selected);
      $("#book", el).disabled = !sel || !sel.eligible;
      $("#book", el).innerHTML = sel ? `${icon("ticket")}Book token at ${esc(sel.h.short)} · ${fmtMin(sel.total)}` : `${icon("ticket")}Book token`;
      $("#sel-card", el).innerHTML = sel && sel.eligible ? `<div class="card card-pad stack-sm" style="padding:12px 14px">
          <div class="row-between"><b>${esc(sel.h.short)}</b>${sel === rec.best ? `<span class="pill brand">${icon("crown")}Fastest</span>` : ""}</div>
          <div class="t-small muted">${sel.travelMin} min drive · ${sel.wait} min queue · ${Math.round(sel.consult)} min consult</div>
          <a class="btn sm" href="${Maps.googleMapsLink(ORIGIN, sel.h)}" target="_blank" rel="noopener">${icon("nav")}Open in Google Maps</a></div>` : "";
    }
    const select = (id) => { selected = id; picked = true; renderList(); renderMap(true); };
    $("#hlist", el).addEventListener("click", (e) => { const c = e.target.closest("[data-id]"); if (c) select(+c.dataset.id); });
    $("#hlist", el).addEventListener("keydown", (e) => { const c = e.target.closest("[data-id]"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(+c.dataset.id); } });
    $("#why", el).addEventListener("click", (e) => { const a = e.target.closest("[data-pick]"); if (a) { e.preventDefault(); select(+a.dataset.pick); } });

    function renderMap(routes) {
      view.clearPins();
      rec.rows.forEach((r, i) => view.addHospital(r.h, { badge: r.eligible ? fmtMin(r.total) : "—", rank: i + 1, best: r === rec.best, dim: !r.eligible,
        onClick: () => select(r.id), tooltip: `${r.h.name}${r.eligible ? " · " + fmtMin(r.total) + " to prescription" : ""}` }));
      if (!routes) return;
      const ver = ++routeVer, o = ORIGIN;
      const top = rec.rows.filter((r) => r.eligible).slice(0, 3);
      const sel = rec.rows.find((r) => r.id === selected);
      if (sel && !top.includes(sel)) top.push(sel);
      Promise.all(top.map((r) => Maps.route(o, r.h))).then((paths) => {
        if (ver !== routeVer) return;
        view.clearRoutes();
        top.forEach((r, i) => { if (r.id !== selected) view.drawRoute(paths[i].coords, "alt", { onClick: () => select(r.id), tooltip: `${r.h.short} · ${fmtMin(r.total)}` }); });
        const si = top.findIndex((r) => r.id === selected);
        if (si >= 0) view.drawRoute(paths[si].coords, "best");
        if (!renderMap.fitFor || renderMap.fitFor !== o) { view.fit([o, ...top.map((r) => r.h)], 50); renderMap.fitFor = o; }
      });
    }

    form.addEventListener("input", debounce(() => update(true), 350));
    $("#book", el).addEventListener("click", async () => {
      const d = data();
      if (!d.symptoms) { form.symptoms.focus(); return toast("Describe your symptoms first", "warn"); }
      if (!d.name) { form.name.focus(); return toast("Add the patient's name", "warn"); }
      const r = rec.rows.find((x) => x.id === selected);
      const ok = await modal({ title: "Confirm your token", body: `
        <div class="row-between"><div><div class="t-h3">${esc(r.h.name)}</div><div class="t-small muted">${esc(r.h.area)} · ${esc(rec.dept)}</div></div>${prio(rec.triage.level)}</div>
        ${raceBar([{ cls: "tr", v: r.travelMin, label: "Travel" }, { cls: "wt", v: r.onsiteWait, label: "Waiting" }, { cls: "cs", v: r.consult, label: "Consultation" }], r.travelMin + r.onsiteWait + r.consult)}
        <div class="grid-3"><div class="big-stat"><b>${r.travelMin}′</b><span>Travel</span></div><div class="big-stat"><b>${r.ahead}</b><span>Ahead of you</span></div><div class="big-stat"><b>${fmtMin(r.total)}</b><span>To prescription</span></div></div>
        <p class="t-small muted">Your place in the queue is held from now. Patients who are sicker than you can still be seen first — that's how MedOS keeps everyone safe.</p>`,
        actions: [{ label: "Back", value: false }, { label: "Book token", kind: "primary", icon: "ticket", value: true, primary: true }] });
      if (!ok) return;
      const b = bookToken({ ...d, voiceId }, r, { lat: ORIGIN.lat, lng: ORIGIN.lng, label: ORIGIN.label });
      store("medos.patient.draft", null);
      chime();
      location.hash = "#/track/" + b.code;
    });

    refreshTravel();
    const off = onChange(debounceFor(el, (why) => { if (why !== "booking") update(false); }, 500));
    const iv = setInterval(() => update(false), 30000);
    return () => { off(); clearInterval(iv); view.destroy(); };
  },
};

// ------------------------------------------------------------------ book an ambulance
PAGES["patient-ambulance"] = {
  title: "Book an ambulance",
  render(el) {
    el.innerHTML = `<div class="page wide">
      ${pageHead("Book an ambulance", "The nearest free ambulance comes to you and takes you to the hospital with the shortest time to treatment — drive plus the wait there.",
        `<a class="btn" href="tel:108">${icon("phone")}Call 108</a>`)}
      <div class="split">
        <div class="stack">
          <button class="sos-btn" id="sos" type="button"><span class="hold-fill"></span>${icon("siren")}<span>Hold for SOS<small>Sends the nearest ambulance to your location now</small></span></button>
          <section class="card">
            <div class="card-head"><h2 class="t-h3">${icon("mic")}What happened?</h2><span id="tri"></span></div>
            <div class="card-body stack">
              <div class="seg full" id="kind" role="group" aria-label="Type">
                <button type="button" data-k="emergency" aria-pressed="true">${icon("siren")}Emergency</button>
                <button type="button" data-k="non_emergency" aria-pressed="false">${icon("calendar")}Non-emergency</button></div>
              <div id="vbox"></div>
              <form id="aform" class="form-grid" autocomplete="off">
                <label class="field c6"><span>Condition</span><textarea class="textarea" name="condition" placeholder="e.g. Father, 72, chest pain and sweating"></textarea></label>
                <label class="field c3"><span>Patient name</span><input class="input" name="name"></label>
                <label class="field c2 half"><span>Age</span><input class="input" name="age" type="number" min="0" max="120" inputmode="numeric"></label>
                <label class="field c3"><span>Phone for the crew</span><input class="input" name="phone" type="tel" inputmode="tel"></label>
              </form>
            </div>
          </section>
          ${locationCard("Pickup location")}
          <section class="card">
            <div class="card-head"><h2 class="t-h3">${icon("route")}Hospital ranking (shortest time to treatment)</h2><span class="t-small muted" id="needs"></span></div>
            <div class="card-body stack-sm">
              <div id="amb-near"></div>
              <div class="legend"><span><i style="background:var(--seg-travel)"></i>Drive from you</span><span><i style="background:var(--seg-wait)"></i>Wait at the hospital</span></div>
              <div class="hlist" id="alist"></div>
              <p class="t-small muted" id="anote"></p>
            </div>
          </section>
        </div>
        <div class="stack" style="position:sticky;top:16px">
          <div class="map-wrap"><div class="map tall" id="amap"></div></div>
          <button class="btn danger lg block" id="send" type="button">${icon("ambulance")}Send ambulance</button>
          <p class="t-xs muted" id="src-note"></p>
        </div>
      </div></div>`;

    const form = $("#aform", el);
    const d0 = store("medos.amb.draft");
    if (d0) { Object.entries(d0).forEach(([k, v]) => { if (form.elements[k]) form.elements[k].value = v || ""; }); store("medos.amb.draft", null); }
    let kind = "emergency", voiceId = null, travel = {}, travelFor = null, rec = null, selected = null, picked = false, routeVer = 0;
    const view = Maps.create($("#amap", el));
    const loc = bindLocation(el, view, () => refresh());
    Maps.chrome($("#amap", el).parentElement, view, { onLocate: () => loc.gps() });
    mountVoice($("#vbox", el), { source: "ambulance", hint: "Tap and describe what happened, who it is and how old they are.", onResult: (r) => {
      const v = addVoiceInput({ transcript: r.text, fields: r.fields, source: "ambulance booking", audioId: r.audioId, durationS: r.durationS, lang: r.lang });
      voiceId = v.id;
      form.condition.value = r.fields.symptoms || r.text;
      if (r.fields.name) form.name.value = r.fields.name;
      if (r.fields.age) form.age.value = r.fields.age;
      if (r.fields.phone) form.phone.value = r.fields.phone;
      update(true);
    } });
    $("#kind", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; kind = b.dataset.k; $$("#kind button", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); update(true); });

    async function refresh() {
      const o = ORIGIN; travelFor = o; travel = {};
      view.setOrigin(o, "Pickup");
      update(true);
      const res = await Maps.matrix(o, HOSPITALS);
      if (travelFor !== o) return;
      HOSPITALS.forEach((h, i) => (travel[h.id] = { min: Maps.travelMinutes(res[i], { siren: kind === "emergency" }), km: res[i].km, source: res[i].source }));
      $("#src-note", el).textContent = `Drive times: ${Maps.sourceLabel(res[0].source)}${kind === "emergency" ? ", ambulance with siren ×0.7" : ""}.`;
      update(true);
    }
    function update(routes) {
      const c = form.condition.value.trim() || (kind === "emergency" ? "Emergency" : "Transfer");
      rec = recommendAmbulance(c, kind, ORIGIN, form.age.value ? +form.age.value : null, travel);
      if (!picked || !selected || !rec.rows.find((r) => r.id === selected && r.eligible)) selected = rec.best ? rec.best.id : null;
      $("#tri", el).innerHTML = form.condition.value.trim() ? prio(rec.level) : "";
      $("#needs", el).textContent = "Needs: " + rec.needs;
      const a = rec.ambulance;
      $("#amb-near", el).innerHTML = a ? `<div class="notice info">${icon("ambulance")}<div><b>${esc(a.a.name)}</b> from ${esc(a.base.name)} is the nearest free ambulance — about <b>${a.min} min</b> to reach you.</div></div>`
        : `<div class="notice warn">${icon("clock")}Every ambulance is on a trip. Your request joins the queue: emergencies first, then the shortest trip.</div>`;
      const scale = Math.max(...rec.rows.filter((r) => r.eligible).map((r) => r.total), 10);
      $("#alist", el).innerHTML = rec.rows.map((r, i) => {
        const best = r === rec.best;
        return `<div class="hcard ${best ? "best" : ""} ${r.eligible ? "" : "off"}" role="button" tabindex="0" aria-pressed="${r.id === selected}" data-id="${r.id}">
          <div class="hcard-top"><span class="hrank">${best ? icon("crown") : i + 1}</span>
            <div style="min-width:0"><div class="hname">${esc(r.name)}</div><div class="hmeta">${r.travelMin} min drive · wait ${Math.round(r.wait)} min (${esc(r.waitSource)}) · ${r.beds} beds</div></div>
            <div class="htotal">${r.eligible ? `<b>${fmtMin(r.total)}</b><small>to treatment</small>` : `<small>${esc(r.reason)}</small>`}</div></div>
          ${r.eligible ? raceBar([{ cls: "tr", v: r.travelMin, label: "Drive" }, { cls: "wt", v: r.wait, label: "Wait" }], scale) : ""}
          ${r.id === selected ? `<div class="row">${r.h.specialties.map((s) => `<span class="pill">${esc(s)}</span>`).join("")}</div>` : ""}
        </div>`;
      }).join("");
      $("#anote", el).textContent = rec.note || "Critical patients are taken straight in everywhere, so for them the drive decides. Lower levels wait part of each hospital's reported time.";
      const sel = rec.rows.find((r) => r.id === selected);
      $("#send", el).disabled = !sel;
      $("#send", el).innerHTML = sel ? `${icon("ambulance")}Send ambulance → ${esc(sel.h.short)}` : `${icon("ambulance")}Send ambulance`;
      drawMap(routes);
    }
    function drawMap(routes) {
      view.clearPins(); view.clearExtra();
      rec.rows.forEach((r, i) => view.addHospital(r.h, { badge: r.eligible ? fmtMin(r.total) : "—", rank: i + 1, best: r === rec.best, dim: !r.eligible, onClick: () => { selected = r.id; picked = true; update(true); } }));
      S.ambulances.filter((a) => a.status === "available").forEach((a) => {
        const h = hospitalById(a.baseId);
        view.addPoint({ lat: h.lat + 0.0012, lng: h.lng + 0.0012 }, `<div class="amb-marker" style="width:26px;height:26px;animation:none;background:#64748b;border-width:2px" title="${a.name}">${icon("ambulance")}</div>`, [26, 26]);
      });
      if (!routes) return;
      const ver = ++routeVer, o = ORIGIN, a = rec.ambulance;
      const sel = rec.rows.find((r) => r.id === selected);
      const alts = rec.rows.filter((r) => r.eligible && r !== sel).slice(0, 2);
      Promise.all([a ? Maps.route(a.base, o) : null, sel ? Maps.route(o, sel.h) : null, ...alts.map((r) => Maps.route(o, r.h))]).then(([leg1, leg2, ...ap]) => {
        if (ver !== routeVer) return;
        view.clearRoutes();
        ap.forEach((p, i) => view.drawRoute(p.coords, "faint", { onClick: () => { selected = alts[i].id; picked = true; update(true); } }));
        if (leg1) view.drawRoute(leg1.coords, "leg1");
        if (leg2) view.drawRoute(leg2.coords, "leg2");
        if (a) view.addPoint(a.base, `<div class="amb-marker">${icon("ambulance")}</div>`, [40, 40]);
        if (!drawMap.fitFor || drawMap.fitFor !== o) { view.fit([o, ...(a ? [a.base] : []), ...(sel ? [sel.h] : [])], 50); drawMap.fitFor = o; }
      });
    }
    $("#alist", el).addEventListener("click", (e) => { const c = e.target.closest("[data-id]"); if (c) { selected = +c.dataset.id; picked = true; update(true); } });
    form.addEventListener("input", debounce(() => update(true), 400));

    const send = (sos = false) => {
      const condition = form.condition.value.trim() || (sos ? "SOS — emergency, details unknown" : "");
      if (!condition) { form.condition.focus(); return toast("Describe what happened, or hold SOS", "warn"); }
      const r = sos ? recommendAmbulance(condition, "emergency", ORIGIN, null, travel) : rec;
      const b = createAmbulanceRequest({ kind: sos ? "emergency" : kind, name: form.name.value.trim(), age: form.age.value ? +form.age.value : null, phone: form.phone.value.trim(),
        condition, pickup: { lat: ORIGIN.lat, lng: ORIGIN.lng, label: ORIGIN.label }, voiceId }, r, sos ? null : selected);
      alarmBeep();
      location.hash = "#/track/" + b.code;
    };
    $("#send", el).addEventListener("click", async () => {
      const sel = rec.rows.find((r) => r.id === selected);
      const ok = await confirmDialog("Send an ambulance?", `${rec.ambulance ? rec.ambulance.a.name + " comes to " + ORIGIN.label : "You join the ambulance queue"} and takes the patient to ${sel.name} (${fmtMin(sel.total)} to treatment).`, { confirm: "Send ambulance", danger: true });
      if (ok) send(false);
    });
    // Hold-to-confirm SOS: 1.2 s, so a stray tap doesn't dispatch an ambulance.
    const sos = $("#sos", el), fill = $(".hold-fill", sos);
    let holdT = null;
    const startHold = (e) => { e.preventDefault(); fill.style.transition = "transform 1.2s linear"; fill.style.transform = "scaleX(1)"; holdT = setTimeout(() => { cancelHold(); send(true); }, 1200); };
    const cancelHold = () => { clearTimeout(holdT); fill.style.transition = "transform .2s"; fill.style.transform = "scaleX(0)"; };
    sos.addEventListener("pointerdown", startHold);
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => sos.addEventListener(ev, cancelHold));
    sos.addEventListener("click", (e) => { if (e.detail === 0) confirmDialog("Send SOS?", "The nearest ambulance will be sent to " + ORIGIN.label + ".", { confirm: "Send SOS", danger: true }).then((ok) => ok && send(true)); });

    refresh();
    const off = onChange(debounceFor(el, () => update(false), 600));
    return () => { off(); view.destroy(); };
  },
};

// ------------------------------------------------------------------ my bookings
PAGES["patient-bookings"] = {
  title: "My bookings",
  render(el) {
    const draw = () => {
      const list = [...S.bookings].sort((a, b) => b.created - a.created);
      el.innerHTML = `<div class="page">${pageHead("My bookings", "Tokens and ambulances booked from this browser. Open one to follow it live.", `<a class="btn primary" href="#/patient">${icon("plus")}New token</a>`)}
        <section class="card">${list.length ? list.map((b) => {
          const st = b.type === "ambulance" ? ambulancePhase(S.ambRequests.find((r) => r.id === b.ambRequestId) || { status: "cancelled" }) : bookingStatus(b);
          const label = b.type === "ambulance" ? st.label : { waiting: `Position ${st.position} · about ${fmtMin(st.etaMin)}`, called: "Called — go to the doctor", completed: "Done", cancelled: "Cancelled", no_show: "Missed", unknown: "—" }[st.state] || st.state;
          return `<a class="qrow" style="grid-template-columns:auto minmax(0,1fr) auto;text-decoration:none;color:inherit" href="#/track/${b.code}">
            ${tokenChip(b.token, b.level)}<span class="who"><b>${esc(b.hospitalName)}</b><small>${b.type === "ambulance" ? "Ambulance" : "Token"} · ${fmtClock(b.created)} · ${esc(label)}</small></span>
            <span class="row">${prio(b.level)}${icon("chevronRight")}</span></a>`;
        }).join("") : `<div class="empty">${icon("ticket")}<p>No bookings yet.</p><a class="btn primary" href="#/patient">Book a token</a></div>`}</section></div>`;
    };
    draw();
    const off = onChange(debounceFor(el, draw, 400));
    return off;
  },
};

// ------------------------------------------------------------------ live tracking: token or ambulance
PAGES.track = {
  title: "Track",
  render(el, [code]) {
    const b = bookingByCode(code);
    const p = !b && patientByCode(code);
    if (!b && !p) {
      el.innerHTML = `<div class="page">${pageHead("Booking not found", "Check the code on your token slip.")}<div class="card empty">${icon("search")}<p>No booking with code “${esc(code)}” on this device.</p><a class="btn" href="#/">Home</a></div></div>`;
      return;
    }
    if (b && b.type === "ambulance") return trackAmbulance(el, b);
    return trackToken(el, b, p);
  },
};

function trackToken(el, b, p) {
  const h = b ? hospitalById(b.hospitalId) : selfHospital();
  const token = b ? b.token : p.token, code = b ? b.code : p.code;
  const origin = b && b.origin;
  const url = location.href.split("#")[0] + "#/track/" + code;
  el.innerHTML = `<div class="page">${pageHead("Your token", `${esc(h.name)} · keep this page open, it updates by itself.`,
    `<button class="btn" id="notify">${icon("bell")}Alert me</button><button class="btn" onclick="print()">${icon("ticket")}Print</button>`)}
    <div class="split">
      <div class="stack">
        <div class="ticket">
          <div class="ticket-top"><div><small>Token</small><div class="tnum">${esc(token)}</div></div><div id="lvl"></div></div>
          <div class="ticket-body">
            <ol class="steps" id="steps"></ol>
            <div class="grid-3" id="stats"></div>
            <div id="advice"></div>
          </div>
          <div class="ticket-cut"></div>
          <div class="ticket-body"><div class="row" style="gap:16px;flex-wrap:nowrap">${qrSvg(url, 112)}<div class="stack-sm" style="min-width:0">
            <div class="t-small"><span class="muted">Code</span> <b class="mono">${esc(code)}</b></div>
            <div class="t-small muted">Scan to follow this token on another phone.</div>
            ${b && b.name ? `<div class="t-small"><span class="muted">Patient</span> <b>${esc(b.name)}</b></div>` : p && p.name ? `<div class="t-small"><span class="muted">Patient</span> <b>${esc(p.name)}</b></div>` : ""}
          </div></div></div>
        </div>
        ${b && b.status !== "cancelled" ? `<button class="btn ghost no-print" id="cancel" style="justify-self:start">${icon("x")}Cancel this token</button>` : ""}
      </div>
      <div class="stack no-print">
        ${origin ? `<div class="map-wrap"><div class="map" id="tmap"></div></div>
        <div class="row"><a class="btn primary" target="_blank" rel="noopener" href="${Maps.googleMapsLink(origin, h)}">${icon("nav")}Navigate in Google Maps</a>
          <a class="btn" href="tel:${h.phone.replace(/\s/g, "")}">${icon("phone")}Call hospital</a></div>` : ""}
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("info")}How your turn is decided</h2></div>
          <div class="card-body t-small muted-2 stack-sm"><p>Patients are seen by how urgent they are, not when they booked. Every minute you wait adds to your priority (aging), so you are never skipped forever.</p>
          <p>Critical emergencies can always go ahead of you — the estimate updates when that happens.</p></div></section>
      </div>
    </div></div>`;
  let view = null, alerted = false, notifyOn = false;
  if (origin) {
    view = Maps.create($("#tmap", el));
    Maps.chrome($("#tmap", el).parentElement, view);
    view.setOrigin(origin, "You");
    view.addHospital(h, { best: true, badge: h.short });
    Maps.route(origin, h).then((r) => { view.drawRoute(r.coords, "best"); view.fit([origin, h], 50); });
  }
  $("#notify", el).addEventListener("click", async () => {
    if ("Notification" in window && Notification.permission !== "granted") await Notification.requestPermission();
    notifyOn = true; toast("We'll alert you when it's almost your turn");
  });
  if ($("#cancel", el)) $("#cancel", el).addEventListener("click", async () => { if (await confirmDialog("Cancel this token?", "You'll lose your place in the queue.", { confirm: "Cancel token", danger: true })) { cancelBooking(b.id); draw(); } });

  const draw = () => {
    const st = b ? bookingStatus(b) : (() => { const fake = { patientId: p.id }; return bookingStatus(fake); })();
    const lvl = st.level || (b && b.level);
    $("#lvl", el).innerHTML = lvl ? `<div style="background:#fff;border-radius:999px;padding:2px">${prio(lvl, { lg: true })}</div>` : "";
    const stepNames = ["Booked", "Waiting", "With doctor", "Done"];
    const at = { waiting: 1, called: 2, completed: 3, no_show: 3, cancelled: 0 }[st.state] ?? 1;
    $("#steps", el).innerHTML = stepNames.map((s, i) => `<li class="${i < at ? "done" : i === at ? "now" : ""}">${s}</li>`).join("");
    if (st.state === "waiting") {
      const travel = b && b.travelMin;
      $("#stats", el).innerHTML = `<div class="big-stat"><b>${st.position}</b><span>Position</span></div><div class="big-stat"><b>${st.ahead}</b><span>Ahead of you</span></div><div class="big-stat"><b>${fmtMin(st.etaMin)}</b><span>Estimated wait</span></div>`;
      const leave = travel != null ? Math.max(0, Math.round(st.etaMin - travel)) : null;
      $("#advice", el).innerHTML = leave != null ? (leave <= 1 ? `<div class="notice bad">${icon("nav")}<div><b>Leave now.</b> The drive takes about ${travel} min and your turn is close.</div></div>`
        : `<div class="notice info">${icon("clock")}<div>Leave in about <b>${fmtMin(leave)}</b> — the ${travel}-min drive gets you there just as your turn comes.</div></div>`) : "";
      if (notifyOn && !alerted && st.ahead <= S.settings.notify_ahead) {
        alerted = true; chime();
        if ("Notification" in window && Notification.permission === "granted") new Notification("MedOS: almost your turn", { body: `Token ${token}: ${st.ahead} ahead of you at ${h.short}` });
        toast("Almost your turn!", "warn", 8000);
      }
    } else if (st.state === "called") {
      $("#stats", el).innerHTML = `<div class="big-stat" style="grid-column:1/-1"><b style="color:var(--primary)">It's your turn</b><span>${st.doctor ? esc(st.doctor) + (st.room ? " · " + esc(st.room) : "") : "Please go to the consultation room"}</span></div>`;
      $("#advice", el).innerHTML = "";
      if (!draw.calledOnce) { draw.calledOnce = true; chime(); if (navigator.vibrate) navigator.vibrate([300, 150, 300]); }
    } else {
      $("#stats", el).innerHTML = `<div class="big-stat" style="grid-column:1/-1"><b>${{ completed: "Consultation finished", cancelled: "Cancelled", no_show: "Missed your call — please see reception" }[st.state] || "—"}</b><span>${st.outcome ? esc(st.outcome) : ""}</span></div>`;
      $("#advice", el).innerHTML = "";
    }
  };
  draw();
  const off = onChange(debounceFor(el, draw, 300));
  const iv = setInterval(draw, 10000);
  return () => { off(); clearInterval(iv); if (view) view.destroy(); };
}

function trackAmbulance(el, b) {
  const r0 = S.ambRequests.find((x) => x.id === b.ambRequestId);
  const h = hospitalById(b.hospitalId);
  el.innerHTML = `<div class="page wide">${pageHead("Ambulance on the way", `Request ${esc(b.token)} · ${esc(h.name)}`, `<a class="btn" href="tel:108">${icon("phone")}Call 108</a>`)}
    <div class="split">
      <div class="stack">
        <section class="card card-pad stack">
          <div class="row-between"><div><div class="t-small muted strong">Status</div><div class="t-h2" id="phase"></div></div><div id="lvl">${prio(b.level, { lg: true })}</div></div>
          <ol class="steps" id="steps"></ol>
          <div class="grid-3" id="stats"></div>
          <div class="pbar" style="height:10px"><i id="prog" style="background:var(--crit);width:0"></i></div>
          <p class="t-xs muted">Demo time runs ×<span id="spd"></span> so a whole trip fits in a few minutes. Change it in Admin → Settings.</p>
        </section>
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("crown")}Why ${esc(h.short)}</h2></div><div class="card-body" id="rank"></div></section>
        <button class="btn ghost" id="cancel" style="justify-self:start">${icon("x")}Cancel request</button>
      </div>
      <div class="stack">
        <div class="map-wrap"><div class="map tall" id="tmap"></div></div>
        <div class="row"><a class="btn" target="_blank" rel="noopener" href="${Maps.googleMapsLink(r0.pickup, h)}">${icon("nav")}Route in Google Maps</a></div>
      </div>
    </div></div>`;
  const view = Maps.create($("#tmap", el));
  Maps.chrome($("#tmap", el).parentElement, view);
  let veh = null, drawnFor = null, raf = null;
  const r = () => S.ambRequests.find((x) => x.id === b.ambRequestId);
  const scale = Math.max(...r0.ranking.filter((x) => x.eligible).map((x) => x.total), 10);
  $("#rank", el).innerHTML = `<div class="hlist">${r0.ranking.map((x, i) => `<div class="hcard ${x.id === r0.hospitalId ? "best" : ""} ${x.eligible ? "" : "off"}" style="cursor:default">
      <div class="hcard-top"><span class="hrank">${x.id === r0.hospitalId ? icon("crown") : i + 1}</span><div><div class="hname">${esc(x.name)}</div><div class="hmeta">${x.eligible ? `${x.travelMin} min drive + ${Math.round(x.wait)} min wait` : esc(x.reason)}</div></div>
      <div class="htotal">${x.eligible ? `<b>${fmtMin(x.total)}</b>` : ""}</div></div>
      ${x.eligible ? raceBar([{ cls: "tr", v: x.travelMin, label: "Drive" }, { cls: "wt", v: x.wait, label: "Wait" }], scale) : ""}</div>`).join("")}</div>`;
  $("#cancel", el).addEventListener("click", async () => { if (await confirmDialog("Cancel the ambulance?", "Only cancel if the patient no longer needs it.", { confirm: "Cancel request", danger: true })) { cancelAmbulance(b.ambRequestId); toast("Request cancelled"); } });

  async function ensureRoutes(req) {
    if (drawnFor === req.status + (req.baseId || "")) return;
    drawnFor = req.status + (req.baseId || "");
    view.clearPins(); view.clearRoutes(); view.clearExtra();
    view.setOrigin(req.pickup, "Pickup");
    view.addHospital(h, { best: true, badge: h.short });
    if (req.status === "waiting") { view.fit([req.pickup, h], 60); return; }
    const base = hospitalById(req.baseId);
    if (!req.routes.toPickup || !req.routes.toHospital) {
      const [a, c] = await Promise.all([Maps.route(base, req.pickup), Maps.route(req.pickup, h)]);
      const live = r();
      live.routes = { toPickup: a.coords, toHospital: c.coords };
      save("routes");
    }
    const live = r();
    view.drawRoute(live.routes.toPickup, "leg1");
    view.drawRoute(live.routes.toHospital, "leg2");
    view.addHospital(base, { badge: "Base", dim: true });
    veh = view.vehicle(base, `<div class="amb-marker">${icon("ambulance")}</div>`);
    view.fit([base, req.pickup, h], 60);
  }
  const draw = () => {
    const req = r();
    if (!req) return;
    const ph = ambulancePhase(req);
    $("#phase", el).textContent = ph.label;
    $("#spd", el).textContent = req.speed || S.settings.demo_speed;
    const order = ["queued", "to_pickup", "loading", "to_hospital", "handover", "arrived"];
    const idx = ph.phase === "done" ? 5 : order.indexOf(ph.phase);
    $("#steps", el).innerHTML = ["Requested", "On the way", "Picked up", "To hospital", "Handed over"].map((s, i) => {
      const at = [0, 1, 2, 3, 5][i];
      return `<li class="${idx > at || idx === 5 ? "done" : idx === at || (i === 2 && idx === 2) || (i === 3 && idx === 4) ? "now" : ""}">${s}</li>`;
    }).join("");
    const amb = req.ambulanceId && S.ambulances.find((a) => a.id === req.ambulanceId);
    const toYou = ph.phase === "to_pickup" ? ph.remaining : 0;
    const toHosp = ph.remaining != null ? (ph.leg === 1 ? ph.remaining + LOAD_MIN + req.travelMin : ph.phase === "to_hospital" ? ph.remaining : 0) : null;
    $("#stats", el).innerHTML = req.status === "waiting"
      ? `<div class="big-stat"><b>#${req.position || 1}</b><span>In the ambulance queue</span></div><div class="big-stat"><b>${esc(LEVEL_LABEL[req.level])}</b><span>${req.kind === "emergency" ? "Emergency" : "Non-emergency"}</span></div><div class="big-stat"><b>${S.ambulances.filter((a) => a.status === "on_trip").length}</b><span>Ambulances busy</span></div>`
      : `<div class="big-stat"><b>${esc(amb ? amb.name : "—")}</b><span>Ambulance</span></div><div class="big-stat"><b>${ph.phase === "to_pickup" ? fmtMin(toYou / (req.speed || 1)) : ph.phase === "queued" ? "—" : "Here"}</b><span>To you (real time)</span></div>
         <div class="big-stat"><b>${toHosp ? fmtMin(toHosp / (req.speed || 1)) : req.status === "arrived" ? "Arrived" : "—"}</b><span>To hospital</span></div>`;
    $("#prog", el).style.width = `${Math.round((ph.progress || 0) * 100)}%`;
    $("#cancel", el).classList.toggle("hidden", !["waiting", "dispatched"].includes(req.status));
    ensureRoutes(req);
  };
  const anim = () => {   // smooth vehicle motion between data updates
    const req = r();
    if (veh && req && req.status === "dispatched") { const p = ambulancePosition(req); if (p) veh.move(p); }
    if (veh && req && req.status === "arrived") veh.move(h);
    raf = requestAnimationFrame(anim);
  };
  draw(); anim();
  const off = onChange(debounceFor(el, draw, 200));
  const iv = setInterval(draw, 1000);
  return () => { off(); clearInterval(iv); cancelAnimationFrame(raf); view.destroy(); };
}
