// MedOS Web — staff pages: reception, voice intake, doctor, pharmacy, ambulance desk, waiting-room display, admin.
"use strict";

// ------------------------------------------------------------------ shared: queue rows and the token slip
function priorityBar(p) {
  const max = 2000;
  const base = Math.min(p.score.base, max), ag = Math.min(p.score.aging, max - base), pre = Math.min(p.score.preempt, max - base - ag);
  const col = LEVEL_COLOR[p.level];
  return `<div class="pbar" style="color:${col}" title="Base ${Math.round(p.score.base)} + aging ${Math.round(p.score.aging)}${p.score.preempt ? " + pre-empted " + Math.round(p.score.preempt) : ""}${p.score.emergency ? " + emergency 5000" : ""}">
    <i style="width:${(base / max) * 100}%;background:${col}"></i><i class="aging" style="width:${(ag / max) * 100}%"></i>${pre ? `<i style="width:${(pre / max) * 100}%;background:var(--crit);opacity:.5"></i>` : ""}</div>`;
}
function queueRows(q, eta, { actions = false } = {}) {
  if (!q.length) return `<div class="empty">${icon("check")}<p>Nobody is waiting.</p></div>`;
  return q.map((p) => `<div class="qrow" data-pid="${p.id}">
    <span class="pos">${p.position}</span>${tokenChip(p.token, p.level)}
    <span class="who"><b>${esc(p.name || "Unnamed")} ${p.emergency ? `<span class="pill bad">${icon("siren")}Emergency</span>` : ""}${p.preempted ? `<span class="pill warn">Resumes next</span>` : ""}${p.voiceId ? `<span class="pill info" title="Registered by voice">${icon("mic")}</span>` : ""}</b>
      <small>${esc(ageSex(p))}${ageSex(p) ? " · " : ""}${esc(p.primary)} · ${esc(p.source)}</small></span>
    <span class="lvl">${prio(p.level)}${priorityBar(p)}</span>
    <span class="eta"><b>${eta[p.id] == null ? "—" : fmtMin(eta[p.id])}</b><span class="muted">waited ${fmtMin((Date.now() - p.arrived) / 60000)}</span>
      ${actions ? `<button class="btn sm ghost" data-cancel="${p.id}" style="margin-top:4px">Left</button>` : ""}</span>
  </div>`).join("");
}
function tokenSlip(p) {
  const url = location.href.split("#")[0] + "#/track/" + p.code;
  const q = readyQueue(), me = q.find((x) => x.id === p.id), eta = estimates(q);
  modal({ title: "Token slip", body: `<div class="ticket">
      <div class="ticket-top"><div><small>Token</small><div class="tnum">${esc(p.token)}</div></div><div style="background:#fff;border-radius:999px;padding:2px">${prio(p.level, { lg: true })}</div></div>
      <div class="ticket-body"><div class="row-between"><div><b>${esc(p.name || "Patient")}</b><div class="t-small muted">${esc(ageSex(p))} · ${esc(p.primary)}</div></div></div>
        <div class="grid-3"><div class="big-stat"><b>${me ? me.position : "—"}</b><span>Position</span></div><div class="big-stat"><b>${me ? fmtMin(eta[p.id]) : p.status === "in_consultation" ? "Now" : "—"}</b><span>Estimated wait</span></div><div class="big-stat"><b>${esc(p.department)}</b><span>Department</span></div></div></div>
      <div class="ticket-cut"></div>
      <div class="ticket-body"><div class="row" style="gap:16px;flex-wrap:nowrap">${qrSvg(url, 112)}<div class="t-small muted">Scan to follow this token on your phone.<br>Code <b class="mono">${esc(p.code)}</b></div></div></div></div>`,
    actions: [{ label: "Print", icon: "ticket", value: "print" }, { label: "Done", kind: "primary", value: true, primary: true }] })
    .then((v) => v === "print" && setTimeout(() => print(), 100));
}

// Hold-to-confirm emergency button (the on-screen twin of the GPIO17 push button).
function bindHoldEmergency(btn, source) {
  const fill = $(".hold-fill", btn);
  let t = null;
  const go = () => { const p = raiseEmergency(source); alarmBeep(); toast(`Emergency: Token ${p.token} raised`, "error"); };
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); fill.style.transition = "transform 1s linear"; fill.style.transform = "scaleX(1)"; t = setTimeout(() => { reset(); go(); }, 1000); });
  const reset = () => { clearTimeout(t); fill.style.transition = "transform .2s"; fill.style.transform = "scaleX(0)"; };
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, reset));
  btn.addEventListener("click", (e) => { if (e.detail === 0) confirmDialog("Raise an emergency?", "A Critical emergency patient goes to the front; a consultation may be paused.", { confirm: "Raise emergency", danger: true }).then((ok) => ok && go()); });
}

// ------------------------------------------------------------------ reception
PAGES.reception = {
  title: "Reception", staff: true,
  render(el) {
    el.innerHTML = `<div class="page wide">
      ${pageHead("Reception", "Register by typing or speaking. Triage runs as you type; the queue is always in priority order.",
        `<a class="btn" href="#/voice">${icon("mic")}Voice intake</a><a class="btn" href="#/display" target="_blank">${icon("tv")}Open display</a>`)}
      <div class="split">
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2 class="t-h3">${icon("plus")}Register a patient</h2><span id="tri"></span></div>
            <div class="card-body stack">
              <div id="vbox"></div>
              <form id="rform" class="form-grid" autocomplete="off">
                <label class="field c6"><span>Symptoms</span><textarea class="textarea" name="symptoms" required placeholder="What brings them in?"></textarea></label>
                <label class="field c3"><span>Name</span><input class="input" name="name"></label>
                <label class="field c2 half"><span>Age</span><input class="input" name="age" type="number" min="0" max="120" inputmode="numeric"></label>
                <label class="field c1"><span>Sex</span><select class="select" name="sex"><option value="">—</option><option value="female">F</option><option value="male">M</option><option value="other">Other</option></select></label>
                <label class="field c3"><span>Phone</span><input class="input" name="phone" type="tel" inputmode="tel"></label>
                <label class="check c3" style="align-self:end;min-height:44px"><input type="checkbox" name="pregnant"> Pregnant</label>
                <details class="more c6"><summary>${icon("pulse")}Vital signs (optional)</summary>
                  <div class="form-grid" style="margin-top:8px">
                    <label class="field c2 half"><span>Temp °F</span><input class="input" name="temp" inputmode="decimal"></label>
                    <label class="field c2 half"><span>Pulse</span><input class="input" name="pulse" inputmode="numeric"></label>
                    <label class="field c2 half"><span>SpO₂ %</span><input class="input" name="spo2" inputmode="numeric"></label>
                    <label class="field c3"><span>BP systolic</span><input class="input" name="bp_sys" inputmode="numeric"></label>
                    <label class="field c3"><span>Pain 0–10</span><input class="input" name="pain" inputmode="numeric"></label>
                  </div></details>
              </form>
              <div id="preview"></div>
              <div class="row"><button class="btn primary lg" id="reg" type="button">${icon("ticket")}Register and print token</button><button class="btn ghost" id="clr" type="button">Clear</button></div>
            </div>
          </section>
          <button class="sos-btn" id="emerg" type="button"><span class="hold-fill"></span>${icon("siren")}<span>Hold for emergency<small>Same as the hardware button: Critical, front of the queue</small></span></button>
        </div>
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2 class="t-h3">${icon("list")}Waiting queue</h2><span class="t-small muted" id="qsum"></span></div>
            <div class="qlist" id="queue"></div>
          </section>
          <section class="card">
            <div class="card-head"><h2 class="t-h3">${icon("stetho")}With a doctor</h2></div>
            <div class="qlist" id="serving"></div>
          </section>
        </div>
      </div></div>`;
    const form = $("#rform", el);
    let voiceId = null;
    mountVoice($("#vbox", el), { source: "reception", onResult: (r) => {
      const v = addVoiceInput({ transcript: r.text, fields: r.fields, source: "reception", audioId: r.audioId, durationS: r.durationS, lang: r.lang });
      voiceId = v.id;
      ["name", "age", "sex", "phone", "symptoms"].forEach((k) => { if (r.fields[k]) form.elements[k].value = r.fields[k]; });
      if (r.fields.pregnant) form.pregnant.checked = true;
      preview();
    } });
    const data = () => ({ name: form.name.value, age: form.age.value, sex: form.sex.value, phone: form.phone.value, symptoms: form.symptoms.value, pregnant: form.pregnant.checked,
      vitals: { temp: form.temp.value, pulse: form.pulse.value, spo2: form.spo2.value, bp_sys: form.bp_sys.value, pain: form.pain.value }, voiceId });
    function preview() {
      const d = data();
      if (!d.symptoms.trim()) { $("#preview", el).innerHTML = ""; $("#tri", el).innerHTML = ""; return; }
      const vit = Object.fromEntries(Object.entries(d.vitals).filter(([, v]) => v !== ""));
      const t = analyse(d.symptoms, d.age, vit, d.pregnant);
      $("#tri", el).innerHTML = prio(t.level);
      const ahead = readyQueue().filter((p) => p.score.total >= t.base_score).length;
      $("#preview", el).innerHTML = `<div class="why" style="border-color:${LEVEL_COLOR[t.level]}"><div class="row-between"><b>${esc(t.primary_condition)}</b><span class="t-small muted">score ${Math.round(t.base_score)} · ${esc(t.department)}</span></div>
        <div class="quote" style="margin:6px 0">${highlightSymptoms(d.symptoms, t.spans)}</div>
        <ul style="margin:0;padding-left:18px" class="t-small">${t.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
        <div class="t-small muted" style="margin-top:4px">Would join at position ${ahead + 1} · ${LEVEL_TARGET[t.level]}</div></div>`;
    }
    form.addEventListener("input", debounce(preview, 200));
    $("#clr", el).addEventListener("click", () => { form.reset(); voiceId = null; preview(); });
    $("#reg", el).addEventListener("click", () => {
      if (!form.symptoms.value.trim()) { form.symptoms.focus(); return toast("Enter the symptoms first", "warn"); }
      const p = register(data(), voiceId ? "voice" : "reception");
      form.reset(); voiceId = null; preview();
      if (p.level === "critical") alarmBeep(); else softPing();
      tokenSlip(p);
    });
    bindHoldEmergency($("#emerg", el), "reception button");
    $("#queue", el).addEventListener("click", async (e) => {
      const c = e.target.closest("[data-cancel]");
      if (c) { if (await confirmDialog("Remove from queue?", "Mark this patient as having left.", { confirm: "Remove", danger: true })) cancelPatient(+c.dataset.cancel); return; }
      const row = e.target.closest("[data-pid]"); if (row) tokenSlip(getPatient(+row.dataset.pid));
    });
    const draw = () => {
      const q = readyQueue(), eta = estimates(q);
      $("#qsum", el).textContent = `${q.length} waiting · ${LEVELS.map((l) => `${q.filter((p) => p.level === l).length} ${LEVEL_LABEL[l].toLowerCase()}`).join(" · ")}`;
      $("#queue", el).innerHTML = queueRows(q, eta, { actions: true });
      const serving = S.patients.filter((p) => p.status === "in_consultation");
      $("#serving", el).innerHTML = serving.length ? serving.map((p) => {
        const d = S.doctors.find((x) => x.id === p.doctorId), room = d && S.rooms.find((r) => r.id === d.roomId);
        return `<div class="qrow" style="grid-template-columns:64px minmax(0,1fr) auto">${tokenChip(p.token, p.level)}<span class="who"><b>${esc(p.name || "—")}</b><small>${esc(d ? d.name : "")}${room ? " · " + esc(room.name) : ""}</small></span><span class="eta">${fmtMin((Date.now() - p.called) / 60000)}</span></div>`;
      }).join("") : `<div class="empty"><p>No consultations right now.</p></div>`;
    };
    draw();
    const off = onChange(debounceFor(el, draw, 150));
    const iv = setInterval(draw, 15000);
    return () => { off(); clearInterval(iv); };
  },
};

// ------------------------------------------------------------------ voice intake: every spoken input, recorded and listed by priority
PAGES.voice = {
  title: "Voice intake", staff: true,
  render(el) {
    el.innerHTML = `<div class="page">
      ${pageHead("Voice intake", "Every spoken check-in is transcribed, analysed and kept with its audio. The list is always in priority order — the most urgent voice is on top.")}
      <div class="grid-4" id="kpis"></div>
      <div class="split" style="margin-top:20px">
        <section class="card">
          <div class="card-head"><h2 class="t-h3">${icon("mic")}Capture</h2><span class="pill">${Voice.caps.speech ? "Speech recognition ready" : "No speech recognition in this browser"}</span></div>
          <div class="card-body stack">
            <div id="vbox"></div>
            <div class="stack-sm"><span class="label">Or try a sample sentence</span><div class="chips" id="samples"></div></div>
            <form id="typed" class="row"><input class="input" style="flex:1;min-width:200px" name="t" placeholder="…or type what the patient said"><button class="btn">${icon("send")}Add</button></form>
            <div id="last"></div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2 class="t-h3">${icon("list")}Recorded inputs, by priority</h2>
            <div class="seg seg-sm" id="filter"><button data-f="all" aria-pressed="true">All</button><button data-f="captured" aria-pressed="false">Not yet queued</button><button data-f="registered" aria-pressed="false">In queue</button></div></div>
          <div id="vlist"></div>
        </section>
      </div></div>`;
    let filter = "all";
    const capture = (r) => {
      const v = addVoiceInput({ transcript: r.text, fields: r.fields, source: r.source || "voice intake", audioId: r.audioId, durationS: r.durationS, lang: r.lang });
      showLast(v);
    };
    mountVoice($("#vbox", el), { source: "voice intake", onResult: capture });
    $("#samples", el).innerHTML = SAMPLE_PHRASES.map((s) => `<button class="chip-btn" type="button">${esc(s)}</button>`).join("");
    $("#samples", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) capture({ text: b.textContent, fields: parseCheckin(b.textContent), source: "sample" }); });
    $("#typed", el).addEventListener("submit", (e) => { e.preventDefault(); const t = e.target.t.value.trim(); if (t) { capture({ text: t, fields: parseCheckin(t), source: "typed" }); e.target.reset(); } });
    $("#filter", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; filter = b.dataset.f; $$("#filter button", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); });
    function showLast(v) {
      $("#last", el).innerHTML = `<div class="why" style="border-color:${LEVEL_COLOR[v.level]}"><div class="row-between"><b>Just captured</b>${prio(v.level)}</div>
        <div class="quote" style="margin:6px 0">${highlightSymptoms(v.fields.symptoms || v.transcript, analyse(v.fields.symptoms || v.transcript, v.fields.age).spans)}</div>
        ${fieldChips(v.fields)}<div class="row" style="margin-top:8px"><button class="btn sm primary" data-reg="${v.id}">${icon("plus")}Add to queue</button></div></div>`;
    }
    function fieldChips(f) {
      return `<div class="field-chips">${[["Name", f.name], ["Age", f.age], ["Sex", f.sex], ["Phone", f.phone], ["Pregnant", f.pregnant ? "yes" : null]].filter(([, v]) => v)
        .map(([k, v]) => `<span class="field-chip"><b>${k}</b>${esc(v)}</span>`).join("") || `<span class="t-small muted">No name or age heard</span>`}</div>`;
    }
    const register1 = (id) => {
      const v = S.voice.find((x) => x.id === id);
      if (!v || v.patientId) return;
      const p = register({ ...v.fields, symptoms: v.fields.symptoms || v.transcript, voiceId: v.id }, "voice");
      toast(`Token ${p.token} added — ${LEVEL_LABEL[p.level]}`);
      $("#last", el).innerHTML = "";
    };
    el.addEventListener("click", (e) => {
      const r = e.target.closest("[data-reg]"); if (r) return register1(+r.dataset.reg);
      const pl = e.target.closest("[data-play]"); if (pl) return playClip(pl.dataset.play, pl);
    });
    const draw = () => {
      const all = voiceInPriorityOrder();
      const withAudio = all.filter((v) => v.audioId).length, queued = all.filter((v) => v.patientId).length;
      const durs = all.filter((v) => v.durationS).map((v) => v.durationS);
      $("#kpis", el).innerHTML = [["mic", "Inputs captured", all.length, "this session"], ["volume", "With audio clip", withAudio, "saved on this device"],
        ["list", "Added to queue", queued, `${all.filter((v) => v.status === "booked").length} booked online`],
        ["clock", "Average length", durs.length ? (durs.reduce((a, b) => a + b, 0) / durs.length).toFixed(1) + " s" : "—", "per spoken input"]]
        .map(([ic, l, v, s]) => `<div class="card kpi"><span class="k-label">${icon(ic)}${l}</span><span class="k-value">${v}</span><span class="k-sub">${s}</span></div>`).join("");
      const list = all.filter((v) => filter === "all" || (filter === "captured" ? !v.patientId : !!v.patientId));
      $("#vlist", el).innerHTML = list.length ? list.map((v, i) => {
        const p = v.patient;
        const qpos = p && p.status === "waiting" ? readyQueue().find((x) => x.id === p.id) : null;
        const status = p ? (p.status === "waiting" ? `<span class="pill brand">Token ${esc(p.token)} · position ${qpos ? qpos.position : "—"}</span>` : p.status === "in_consultation" ? `<span class="pill ok">Token ${esc(p.token)} · with doctor</span>` : `<span class="pill">Token ${esc(p.token)} · ${esc(p.status.replace("_", " "))}</span>`)
          : v.status === "booked" ? `<span class="pill info">Booked online</span>` : `<button class="btn sm" data-reg="${v.id}">${icon("plus")}Add to queue</button>`;
        return `<div class="vrow" data-level="${v.level}">
          <span class="rank">${i + 1}</span>
          <div class="stack-sm" style="min-width:0">
            <div class="row">${prio(v.level)}<b>${esc(v.primary)}</b><span class="t-small muted">score ${Math.round(v.score)}</span></div>
            <div class="quote">“${highlightSymptoms(v.transcript, analyse(v.transcript, v.fields.age).spans)}”</div>
            ${fieldChips(v.fields)}
            <div class="t-xs muted">${fmtClock(v.ts, true)} · ${esc(v.source)}${v.durationS ? ` · ${v.durationS.toFixed(1)} s` : ""}${v.lang ? ` · ${esc(v.lang)}` : ""}</div>
          </div>
          <div class="vside stack-sm" style="justify-items:end">${v.audioId ? `<button class="play-btn" data-play="${v.audioId}" aria-label="Play recording">${icon("play")}</button>` : ""}${status}</div>
        </div>`;
      }).join("") : `<div class="empty">${icon("mic")}<p>No spoken inputs yet. Tap the microphone or try a sample sentence.</p></div>`;
    };
    draw();
    const off = onChange(debounceFor(el, draw, 200));
    const iv = setInterval(draw, 15000);
    return () => { off(); clearInterval(iv); };
  },
};

// ------------------------------------------------------------------ doctor
PAGES.doctor = {
  title: "Doctor", staff: true,
  render(el) {
    let docId = store("medos.doctor") || 1;
    el.innerHTML = `<div class="page">
      ${pageHead("Doctor", "Your current patient, who's next, and finishing a consultation. The next most urgent patient arrives automatically.")}
      <div class="seg" id="docs" style="margin-bottom:16px"></div>
      <div class="split-r"><div class="stack" id="now"></div><div class="stack" id="side"></div></div></div>`;
    const draw = () => {
      const d = S.doctors.find((x) => x.id === docId) || S.doctors[0];
      docId = d.id;
      $("#docs", el).innerHTML = S.doctors.map((x) => `<button data-d="${x.id}" aria-pressed="${x.id === d.id}"><span class="dot ${x.status}"></span>${esc(x.name)}</button>`).join("");
      const p = d.currentId && getPatient(d.currentId);
      const room = S.rooms.find((r) => r.id === d.roomId);
      const pre = S.lastPreempt && S.lastPreempt.doctorId === d.id && Date.now() - S.lastPreempt.ts < 5 * 60000;
      if (!$("#fin-form", el) || !p || $("#fin-form", el).dataset.pid !== String(p.id)) {
        $("#now", el).innerHTML = `<section class="card now-card">
          <div class="row-between"><div><div class="t-small muted strong">${esc(d.specialty)} · ${esc(room ? room.name : "No room")}</div><div class="t-h2">${esc(d.name)}</div></div>
            <div class="seg seg-sm" id="st">${[["available", "Available"], ["break", "Break"], ["off_duty", "Off duty"]].map(([k, l]) => `<button data-s="${k}" aria-pressed="${d.status === k}">${l}</button>`).join("")}</div></div>
          ${pre ? `<div class="notice warn">${icon("siren")}<div><b>Emergency interrupt.</b> Token ${esc(S.lastPreempt.victim)} was paused and returns to the head of the queue; Token ${esc(S.lastPreempt.token)} is with you now.</div></div>` : ""}
          ${p ? `<div class="row" style="gap:16px">${tokenChip(p.token, p.level)}<div><div class="t-h2">${esc(p.name || "Unnamed")}</div><div class="muted">${esc(ageSex(p))}</div></div><div style="margin-left:auto">${prio(p.level, { lg: true })}</div></div>
            <div class="why" style="border-color:${LEVEL_COLOR[p.level]}"><div class="quote">${highlightSymptoms(p.symptoms, analyse(p.symptoms, p.age, p.vitals, p.pregnant).spans)}</div>
              <ul class="t-small" style="margin:6px 0 0;padding-left:18px">${p.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>
            ${Object.keys(p.vitals || {}).length ? `<div class="vitals">${Object.entries(p.vitals).map(([k, v]) => `<span class="vital">${icon({ temp: "thermo", pulse: "pulse", spo2: "drop", bp_sys: "gauge", pain: "bolt" }[k] || "info")}${esc({ temp: "Temp", pulse: "Pulse", spo2: "SpO₂", bp_sys: "BP", pain: "Pain" }[k])} <b>${esc(v)}</b></span>`).join("")}</div>` : ""}
            <div class="t-small muted">Waited ${fmtMin((p.wait_s || 0) / 60)} · with you <span id="timer">${fmtMin((Date.now() - p.called) / 60000)}</span> · ${esc(p.source)}${p.voiceId ? " · registered by voice" : ""}</div>
            <form id="fin-form" data-pid="${p.id}" class="form-grid">
              <label class="field c3"><span>Outcome</span><select class="select" name="outcome">${["Prescribed", "Treated", "Admitted", "Referred", "Follow-up", "Discharged"].map((o) => `<option>${o}</option>`).join("")}</select></label>
              <label class="field c3"><span>Notes</span><input class="input" name="notes"></label>
              <label class="field c6"><span>Prescription (goes to the pharmacy queue)</span><textarea class="textarea" name="medicines" style="min-height:64px" placeholder="e.g. Paracetamol 500 mg, 3 times a day for 3 days"></textarea></label>
            </form>
            <div class="row"><button class="btn primary lg" id="finish">${icon("check")}Finish consultation</button><button class="btn" id="recall">${icon("volume")}Call again</button><button class="btn ghost" id="noshow">Didn't come</button></div>`
          : `<div class="empty">${icon("coffee")}<p>${d.status === "available" ? "No patient yet — the next one arrives automatically." : "You're " + d.status.replace("_", " ") + "."}</p>${readyQueue().length && d.status !== "busy" ? `<button class="btn primary" id="callnext">${icon("chevronRight")}Call next patient</button>` : ""}</div>`}
        </section>`;
      } else if ($("#timer", el)) $("#timer", el).textContent = fmtMin((Date.now() - p.called) / 60000);
      const q = readyQueue(), eta = estimates(q);
      $("#side", el).innerHTML = `<section class="card"><div class="card-head"><h2 class="t-h3">${icon("list")}Next in the queue</h2><span class="t-small muted">${q.length} waiting</span></div>
        <div class="qlist">${queueRows(q.slice(0, 6), eta)}</div></section>`;
    };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      try {
        if (b.dataset.d) { docId = +b.dataset.d; store("medos.doctor", docId); $("#now", el).innerHTML = ""; draw(); }
        else if (b.dataset.s) setDoctorStatus(docId, b.dataset.s);
        else if (b.id === "finish") { const f = $("#fin-form", el); finishConsult(docId, { outcome: f.outcome.value, notes: f.notes.value, medicines: f.medicines.value }); toast("Consultation finished"); }
        else if (b.id === "recall") { recall(docId); toast("Called again on the display"); }
        else if (b.id === "noshow") noShow(docId);
        else if (b.id === "callnext") callNext(docId);
      } catch (err) { toast(err.message, "error"); }
    });
    draw();
    const off = onChange(debounceFor(el, draw, 150));
    const iv = setInterval(draw, 15000);
    return () => { off(); clearInterval(iv); };
  },
};

// ------------------------------------------------------------------ pharmacy (FCFS)
PAGES.pharmacy = {
  title: "Pharmacy", staff: true,
  render(el) {
    el.innerHTML = `<div class="page">${pageHead("Pharmacy", "Prescriptions are prepared first come, first served — only the order at the head of the queue can be started.",
      `<button class="btn" id="walkin">${icon("plus")}Walk-in order</button>`)}
      <div class="grid-3" id="cols"></div></div>`;
    $("#walkin", el).addEventListener("click", async () => {
      const items = await modal({ title: "Walk-in order", body: `<label class="field"><span>Items</span><textarea class="textarea" id="wi"></textarea></label>`,
        actions: [{ label: "Cancel", value: null }, { label: "Add to queue", kind: "primary", collect: (d) => $("#wi", d).value.trim() }] });
      if (items) { createOrder(items, null, "Walk-in"); save(); }
    });
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-step]"); if (!b) return; try { pharmacyStep(+b.dataset.id, b.dataset.step); } catch (err) { toast(err.message, "error"); } });
    const card = (o, action, label, head) => `<div class="qrow" style="grid-template-columns:64px minmax(0,1fr)">${tokenChip(o.token)}<div class="stack-sm"><span class="who"><b>${esc(o.name || "Walk-in")}</b><small>${esc(o.by)} · ${fmtAgo(o.created)}</small></span>
      <div class="t-small">${esc(o.items)}</div>${action ? `<button class="btn sm ${head ? "primary" : ""}" data-step="${action}" data-id="${o.id}" ${head === false ? "disabled title='First come, first served'" : ""}>${label}</button>` : ""}</div></div>`;
    const draw = () => {
      const w = pharmacyQueue(), prep = S.pharmacy.filter((o) => o.status === "preparing"), ready = S.pharmacy.filter((o) => o.status === "ready"), done = S.pharmacy.filter((o) => o.status === "collected").slice(-5).reverse();
      $("#cols", el).innerHTML = `
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("list")}Waiting (FIFO)</h2><span class="pill">${w.length}</span></div><div class="qlist">${w.map((o, i) => card(o, "preparing", "Start", i === 0)).join("") || `<div class="empty"><p>Queue empty</p></div>`}</div></section>
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("pill")}Preparing</h2><span class="pill">${prep.length}</span></div><div class="qlist">${prep.map((o) => card(o, "ready", "Mark ready")).join("") || `<div class="empty"><p>Nothing in progress</p></div>`}</div></section>
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("check")}Ready to collect</h2><span class="pill">${ready.length}</span></div><div class="qlist">${ready.map((o) => card(o, "collected", "Collected")).join("") || `<div class="empty"><p>None ready</p></div>`}
          ${done.length ? `<div class="card-body t-small muted">Collected: ${done.map((o) => esc(o.token)).join(", ")}</div>` : ""}</div></section>`;
    };
    draw();
    return onChange(debounceFor(el, draw, 150));
  },
};

// ------------------------------------------------------------------ ambulance desk: every request and ambulance on one live map
PAGES.ambulance = {
  title: "Ambulance desk", staff: true,
  render(el) {
    el.innerHTML = `<div class="page wide">${pageHead("Ambulance desk", "Requests are dispatched emergencies first, then the shortest trip (SJF), with aging so long trips are never starved.",
      `<a class="btn danger" href="#/patient/ambulance">${icon("plus")}New request</a>`)}
      <div class="split-r">
        <div class="stack">
          <div class="map-wrap"><div class="map tall" id="dmap"></div></div>
        </div>
        <div class="stack">
          <div class="grid-2" id="fleet-k"></div>
          <section class="card"><div class="card-head"><h2 class="t-h3">${icon("route")}On a trip</h2></div><div id="trips"></div></section>
          <section class="card"><div class="card-head"><h2 class="t-h3">${icon("list")}Waiting for an ambulance</h2></div><div id="waitq"></div></section>
          <section class="card"><div class="card-head"><h2 class="t-h3">${icon("ambulance")}Fleet</h2></div><div class="table-wrap"><table class="tbl" id="fleet"></table></div></section>
        </div>
      </div></div>`;
    const view = Maps.create($("#dmap", el), { zoom: 11 });
    Maps.chrome($("#dmap", el).parentElement, view);
    HOSPITALS.forEach((h) => view.addHospital(h, { badge: h.short, onClick: () => hospitalModal(h) }));
    view.fit(HOSPITALS, 30);
    const vehicles = {}, routed = {};
    let raf;
    async function routesFor(r) {
      if (routed[r.id] || r.status !== "dispatched") return;
      routed[r.id] = true;
      if (!r.routes.toPickup) {
        const base = hospitalById(r.baseId), h = hospitalById(r.hospitalId);
        const [a, c] = await Promise.all([Maps.route(base, r.pickup), Maps.route(r.pickup, h)]);
        const live = S.ambRequests.find((x) => x.id === r.id); live.routes = { toPickup: a.coords, toHospital: c.coords }; save("routes");
      }
      drawRoutes();
    }
    function drawRoutes() {
      view.clearRoutes();
      S.ambRequests.filter((r) => r.status === "dispatched" && r.routes.toPickup).forEach((r) => {
        const ph = ambulancePhase(r);
        if (ph.leg === 1) view.drawRoute(r.routes.toPickup, "leg1");
        view.drawRoute(r.routes.toHospital, ph.leg === 1 ? "faint" : "leg2");
      });
    }
    const draw = () => {
      const active = S.ambRequests.filter((r) => r.status === "dispatched");
      const q = ambulanceQueue();
      const free = S.ambulances.filter((a) => a.status === "available").length;
      $("#fleet-k", el).innerHTML = `<div class="card kpi"><span class="k-label">${icon("ambulance")}Available</span><span class="k-value">${free}</span><span class="k-sub">of ${S.ambulances.length} ambulances</span></div>
        <div class="card kpi"><span class="k-label">${icon("clock")}Waiting</span><span class="k-value">${q.length}</span><span class="k-sub">${active.length} on a trip</span></div>`;
      $("#trips", el).innerHTML = active.length ? active.map((r) => {
        const ph = ambulancePhase(r), a = S.ambulances.find((x) => x.id === r.ambulanceId);
        return `<div class="qrow" style="grid-template-columns:minmax(0,1fr) auto"><span class="who"><b>${esc(a ? a.name : "")} → ${esc(r.hospitalName)}</b><small>${esc(r.pickup.label)} · ${esc(r.condition)} · ${esc(ph.label)}</small>
          <div class="pbar"><i style="width:${Math.round(ph.progress * 100)}%;background:var(--crit)"></i></div></span><span class="row">${prio(r.level)}<button class="btn sm ghost" data-arrive="${r.id}">Arrived</button></span></div>`;
      }).join("") : `<div class="empty"><p>No ambulance on a trip.</p></div>`;
      $("#waitq", el).innerHTML = q.length ? q.map((r) => `<div class="qrow" style="grid-template-columns:28px minmax(0,1fr) auto"><span class="pos">${r.position}</span><span class="who"><b>${esc(r.pickup.label)} → ${esc(r.hospitalName)}</b><small>${r.kind === "emergency" ? "Emergency" : "Non-emergency"} · trip ${Math.round(jobMin(r))} min · waited ${fmtMin((Date.now() - r.created) / 60000)}</small></span>${prio(r.level)}</div>`).join("") : `<div class="empty"><p>Nobody waiting.</p></div>`;
      $("#fleet", el).innerHTML = `<thead><tr><th>Ambulance</th><th>Base</th><th>Status</th></tr></thead><tbody>${S.ambulances.map((a) => `<tr><td class="strong">${esc(a.name)}</td><td>${esc(hospitalById(a.baseId).short)}</td><td>${a.status === "available" ? `<span class="pill ok">Available</span>` : `<span class="pill bad">On trip #${a.requestId}</span>`}</td></tr>`).join("")}</tbody>`;
      active.forEach(routesFor);
      drawRoutes();
      Object.keys(vehicles).forEach((id) => { if (!active.find((r) => r.id === +id)) { vehicles[id].remove(); delete vehicles[id]; } });
      active.forEach((r) => { if (!vehicles[r.id]) vehicles[r.id] = view.vehicle(hospitalById(r.baseId), `<div class="amb-marker">${icon("ambulance")}</div>`); });
    };
    const anim = () => { S.ambRequests.filter((r) => r.status === "dispatched").forEach((r) => { const p = ambulancePosition(r); if (p && vehicles[r.id]) vehicles[r.id].move(p); }); raf = requestAnimationFrame(anim); };
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-arrive]"); if (b) { ambulanceArrived(S.ambRequests.find((r) => r.id === +b.dataset.arrive)); ambulanceDispatch(); save("ambulance"); } });
    draw(); anim();
    const off = onChange(debounceFor(el, draw, 300));
    const iv = setInterval(draw, 5000);
    return () => { off(); clearInterval(iv); cancelAnimationFrame(raf); view.destroy(); };
  },
};

// ------------------------------------------------------------------ waiting-room display (TV)
PAGES.display = {
  title: "Waiting-room display", full: true,
  render(el) {
    el.innerHTML = `<div class="display">
      <div class="d-head"><div class="row" style="gap:14px"><span class="brand-mark" style="width:48px;height:48px">${icon("pulse")}</span><div><div style="font-size:24px;font-weight:700">${esc(S.settings.hospital_name)}</div><div style="color:#94a3b8">Emergency cases are always seen first</div></div></div>
        <div class="row"><button class="btn sm" id="snd" style="background:#111c33;color:#e2e8f0;border-color:#1e293b">${icon("volume")}Enable sound</button><a class="btn sm" href="#/" style="background:#111c33;color:#e2e8f0;border-color:#1e293b">Exit</a><span class="d-clock" id="clk"></span></div></div>
      <div class="d-grid">
        <div class="d-call" id="call"></div>
        <div class="stack"><div class="d-panel"><h3>With a doctor</h3><div class="d-serving" id="serv"></div></div>
          <div class="d-panel"><h3>Next</h3><div class="d-next" id="next"></div></div>
          <div class="d-panel"><h3>Medicines ready</h3><div class="d-next" id="ready"></div></div></div>
      </div>
      <div class="d-ticker"><span>Keep your token slip with you. Emergency cases are always seen first. Track your token on your phone by scanning the QR code on your slip. In an emergency call 108.</span></div></div>`;
    let sound = false, lastTs = S.lastCall ? S.lastCall.ts : 0;
    $("#snd", el).addEventListener("click", () => { sound = true; audioCtx(); $("#snd", el).innerHTML = `${icon("volume")}Sound on`; chime(); });
    const draw = () => {
      $("#clk", el).textContent = fmtClock(Date.now());
      const c = S.lastCall;
      const col = c ? LEVEL_COLOR[c.level] : "#334155";
      $("#call", el).innerHTML = c ? `<div style="color:#a5f3fc;font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:.1em">Now calling</div><div class="tnum">${esc(c.token)}</div>
        <div style="font-size:clamp(22px,3vw,36px);font-weight:700">${esc(c.room || "")}</div><div style="font-size:20px;color:#cffafe">${esc(c.doctor)}</div>` : `<div class="tnum" style="opacity:.3">—</div><div>Waiting for the first call</div>`;
      $("#call", el).style.boxShadow = `inset 8px 0 0 ${col}`;
      if (c && c.ts !== lastTs) {
        lastTs = c.ts;
        $("#call", el).classList.remove("pulse"); void $("#call", el).offsetWidth; $("#call", el).classList.add("pulse");
        if (sound) { chime(); setTimeout(() => speak(`Token ${spokenToken(c.token)}, please go to ${c.room || "the consultation room"}`), 1200); }
      }
      const serv = S.patients.filter((p) => p.status === "in_consultation");
      $("#serv", el).innerHTML = serv.map((p) => { const d = S.doctors.find((x) => x.id === p.doctorId), r = d && S.rooms.find((x) => x.id === d.roomId); return `<div><span>${esc(p.token)}</span><span style="color:#94a3b8">${esc(r ? r.name : "")}</span></div>`; }).join("") || `<div style="color:#64748b">—</div>`;
      $("#next", el).innerHTML = readyQueue().slice(0, 8).map((p) => `<span style="border-color:${LEVEL_COLOR[p.level]}">${esc(p.token)}</span>`).join("") || `<span style="border-color:#334155;color:#64748b">—</span>`;
      $("#ready", el).innerHTML = S.pharmacy.filter((o) => o.status === "ready").map((o) => `<span style="border-color:#22d3ee">${esc(o.token)}</span>`).join("") || `<span style="border-color:#334155;color:#64748b">—</span>`;
    };
    draw();
    const off = onChange(debounceFor(el, draw, 100));
    const iv = setInterval(draw, 10000);
    return () => { off(); clearInterval(iv); };
  },
};

// ------------------------------------------------------------------ admin
PAGES.admin = {
  title: "Admin", staff: "admin",
  render(el) {
    el.innerHTML = `<div class="page">${pageHead("Admin", "The whole hospital at a glance: doctors, rooms, waits, alerts, the triage protocol and the scheduler's kernel log.",
      `<button class="btn danger" id="sim">${icon("bolt")}Simulate button press</button>`)}
      <div class="grid-4" id="kpis"></div>
      <div class="grid-2" style="margin-top:16px">
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("chart")}Today by priority</h2></div><div class="card-body bars" id="bylevel"></div></section>
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("clock")}Average wait by priority</h2></div><div class="card-body bars" id="waits"></div></section>
      </div>
      <div class="grid-2" style="margin-top:16px">
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("stetho")}Doctors</h2></div><div class="table-wrap"><table class="tbl" id="doctbl"></table></div></section>
        <section class="card"><div class="card-head"><h2 class="t-h3">${icon("door")}Rooms</h2></div><div class="card-body grid-3" id="rooms"></div></section>
      </div>
      <section class="card" style="margin-top:16px"><div class="card-head"><h2 class="t-h3">${icon("sliders")}Settings</h2></div>
        <form class="card-body form-grid" id="set">
          <label class="field c2"><span>Aging rate (points / min)</span><input class="input" name="aging_rate" type="number" step="0.5" min="0"></label>
          <label class="field c2"><span>Aging limit (points)</span><input class="input" name="aging_cap" type="number" step="10" min="0"></label>
          <label class="field c2"><span>Pre-emption</span><select class="select" name="preemption"><option value="emergency">For emergencies</option><option value="off">Off</option></select></label>
          <label class="field c2"><span>Ambulance demo speed</span><select class="select" name="demo_speed"><option value="1">Real time ×1</option><option value="5">×5</option><option value="10">×10</option><option value="30">×30</option></select></label>
          <label class="field c2"><span>Alert patients when this many are ahead</span><input class="input" name="notify_ahead" type="number" min="0" max="10"></label>
          <label class="check c2" style="align-self:end;min-height:44px"><input type="checkbox" name="auto_dispatch"> Auto-dispatch to free doctors</label>
          <div class="c6 row"><button class="btn primary" type="submit">${icon("check")}Save settings</button>
            <button class="btn" type="button" id="csv">${icon("list")}Export CSV</button><button class="btn" type="button" id="demo">${icon("refresh")}Reload demo</button><button class="btn ghost" type="button" id="clear">${icon("trash")}Clear patients</button></div>
        </form></section>
      <section class="card" style="margin-top:16px"><div class="card-head"><h2 class="t-h3">${icon("clipboard")}Triage protocol</h2><span class="t-small muted">10 red flags + the 15-row priority table</span></div>
        <div class="table-wrap"><table class="tbl" id="proto"></table></div></section>
      <section class="card" style="margin-top:16px"><div class="card-head"><h2 class="t-h3">${icon("terminal")}Kernel log</h2><span class="t-small muted">ARRIVE · DISPATCH · AGING · INTERRUPT · PREEMPT · AMBULANCE · PHARMACY · VOICE</span></div><div class="log" id="log"></div></section>
    </div>`;
    const f = $("#set", el);
    const fillSettings = () => { ["aging_rate", "aging_cap", "preemption", "demo_speed", "notify_ahead"].forEach((k) => (f.elements[k].value = S.settings[k])); f.auto_dispatch.checked = !!S.settings.auto_dispatch; };
    fillSettings();
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      Object.assign(S.settings, { aging_rate: +f.aging_rate.value, aging_cap: +f.aging_cap.value, preemption: f.preemption.value, demo_speed: +f.demo_speed.value, notify_ahead: +f.notify_ahead.value, auto_dispatch: f.auto_dispatch.checked });
      log("SYSTEM", "Settings changed"); save(); toast("Settings saved");
    });
    $("#sim", el).addEventListener("click", () => { const p = raiseEmergency("hardware button (simulated)"); alarmBeep(); toast(`GPIO17 interrupt → Token ${p.token}`, "error"); });
    $("#demo", el).addEventListener("click", async () => { if (await confirmDialog("Reload the demo?", "Replaces every patient, booking and setting with the demo data.", { confirm: "Reload demo", danger: true })) { resetDemo(); Voice.clearClips(); fillSettings(); } });
    $("#clear", el).addEventListener("click", async () => { if (await confirmDialog("Clear all patients?", "Removes every patient, booking and order. Settings are kept.", { confirm: "Clear", danger: true })) { clearPatients(); Voice.clearClips(); } });
    $("#csv", el).addEventListener("click", () => {
      const cols = ["token", "name", "age", "sex", "level", "primary", "department", "source", "status", "arrived", "called", "completed", "wait_s", "consult_s", "outcome"];
      const rows = S.patients.map((p) => cols.map((c) => { let v = p[c]; if (["arrived", "called", "completed"].includes(c) && v) v = new Date(v).toISOString(); return `"${String(v ?? "").replace(/"/g, '""')}"`; }).join(","));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([cols.join(",") + "\n" + rows.join("\n")], { type: "text/csv" }));
      a.download = `medos-patients-${today()}.csv`; a.click();
    });
    $("#doctbl", el).addEventListener("change", (e) => { const s = e.target.closest("[data-doc]"); if (s) { try { setDoctorStatus(+s.dataset.doc, s.value); } catch (err) { toast(err.message, "error"); draw(); } } });
    $("#proto", el).innerHTML = `<thead><tr><th>Rank</th><th>Condition</th><th>Level</th><th>Department</th><th>Keywords</th></tr></thead><tbody>${DEFAULT_CONDITIONS.map((c) => `<tr><td class="num">${c.rank || "Red flag"}</td><td class="strong">${esc(c.name)}</td><td>${prio(c.level)}</td><td>${esc(c.department)}</td><td class="t-small muted">${esc(c.keywords.slice(0, 6).join(", "))}${c.keywords.length > 6 ? "…" : ""}</td></tr>`).join("")}</tbody>`;
    const draw = () => {
      const q = readyQueue(), eta = estimates(q), t = Date.now();
      const docsAvail = S.doctors.filter((d) => d.status === "available").length, onDuty = S.doctors.filter((d) => d.status !== "off_duty" && d.status !== "break").length;
      const busyRooms = new Set(S.doctors.filter((d) => d.status === "busy").map((d) => d.roomId));
      const done = S.patients.filter((p) => p.status === "completed");
      const avgWait = done.length ? done.reduce((s, p) => s + (p.wait_s || 0), 0) / done.length / 60 : null;
      $("#kpis", el).innerHTML = [["stetho", "Doctors available", `${docsAvail}`, `${onDuty} on duty of ${S.doctors.length}`], ["door", "Rooms free", `${S.rooms.length - busyRooms.size}`, `of ${S.rooms.length} rooms`],
        ["users", "Queue length", `${q.length}`, `${q.filter((p) => p.level === "critical").length} critical · ${q.filter((p) => p.level === "high").length} high`],
        ["clock", "Average wait today", avgWait == null ? "—" : fmtMin(avgWait), `${done.length} consultations finished`]]
        .map(([ic, l, v, s]) => `<div class="card kpi"><span class="k-label">${icon(ic)}${l}</span><span class="k-value">${v}</span><span class="k-sub">${s}</span></div>`).join("") +
        (openAlerts().length ? `<div class="notice bad" style="grid-column:1/-1">${icon("siren")}<div><b>${openAlerts().length} emergency alert${openAlerts().length > 1 ? "s" : ""}</b> — ${esc(openAlerts().map((a) => a.message).join("; "))}</div></div>` : "");
      const todayP = S.patients.filter((p) => p.status !== "cancelled");
      const maxL = Math.max(1, ...LEVELS.map((l) => todayP.filter((p) => p.level === l).length));
      $("#bylevel", el).innerHTML = LEVELS.map((l) => { const n = todayP.filter((p) => p.level === l).length; return `<div class="bar-row"><span>${prio(l)}</span><div class="bar-track"><i style="width:${(n / maxL) * 100}%;background:${LEVEL_COLOR[l]}"></i></div><b class="num">${n}</b></div>`; }).join("");
      const wl = Object.fromEntries(LEVELS.map((l) => { const ps = done.filter((p) => p.level === l); return [l, ps.length ? ps.reduce((s, p) => s + p.wait_s, 0) / ps.length / 60 : 0]; }));
      const maxW = Math.max(1, ...Object.values(wl));
      $("#waits", el).innerHTML = LEVELS.map((l) => `<div class="bar-row"><span>${prio(l)}</span><div class="bar-track"><i style="width:${(wl[l] / maxW) * 100}%;background:${LEVEL_COLOR[l]}"></i></div><b class="num">${Math.round(wl[l])}′</b></div>`).join("") + `<p class="t-xs muted">Targets: Critical immediately · High 15 min · Medium 1 h · Low 2 h</p>`;
      $("#doctbl", el).innerHTML = `<thead><tr><th>Doctor</th><th>Room</th><th>Patient</th><th>Status</th></tr></thead><tbody>${S.doctors.map((d) => { const p = d.currentId && getPatient(d.currentId); const r = S.rooms.find((x) => x.id === d.roomId); return `<tr><td><b>${esc(d.name)}</b><div class="t-xs muted">${esc(d.specialty)}</div></td><td>${esc(r ? r.name : "—")}</td><td>${p ? tokenChip(p.token, p.level) : "—"}</td>
        <td>${d.status === "busy" ? `<span class="pill warn">With patient</span>` : `<select class="select-sm" data-doc="${d.id}">${[["available", "Available"], ["break", "Break"], ["off_duty", "Off duty"]].map(([k, l]) => `<option value="${k}" ${d.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>`}</td></tr>`; }).join("")}</tbody>`;
      $("#rooms", el).innerHTML = S.rooms.map((r) => { const d = S.doctors.find((x) => x.roomId === r.id); const p = d && d.currentId && getPatient(d.currentId);
        return `<div class="card card-pad" style="padding:12px;border-left:4px solid ${p ? LEVEL_COLOR[p.level] : "var(--success)"}"><b>${esc(r.name)}</b><div class="t-small muted">${p ? "Token " + esc(p.token) : d ? esc(d.name.replace("Dr. ", "Dr ")) + " · free" : "Free"}</div></div>`; }).join("");
      $("#log", el).innerHTML = S.events.slice(-120).reverse().map((e) => `<div><time>${fmtClock(e.ts, true)}</time><b class="k-${e.kind}">${e.kind}</b>${esc(e.msg)}</div>`).join("");
      void eta; void t;
    };
    draw();
    const off = onChange(debounceFor(el, draw, 250));
    const iv = setInterval(draw, 15000);
    return () => { off(); clearInterval(iv); };
  },
};
