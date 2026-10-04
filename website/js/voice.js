// MedOS Web — voice capture.
//
// Speech recognition: the browser's Web Speech API (Chrome, Edge, Safari; en-IN by default).
// Recording: the same microphone is recorded with MediaRecorder so every spoken check-in keeps its
// audio clip (saved in IndexedDB on this device), and an AnalyserNode drives the live waveform.
// Android Chrome cannot share the microphone between the two, so there it transcribes without a clip.
//
// A recording only ends when the user presses Stop. Pauses in speech never end it, and Pause / Resume
// holds both the transcript and the audio clip.
"use strict";

const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const caps = {
    speech: !!SR,
    record: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder),
    secure: window.isSecureContext,
  };
  caps.canRecordWithSpeech = caps.record && !isAndroid;

  // ---------------------------------------------------------------- IndexedDB for audio clips
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("No IndexedDB"));
      const r = indexedDB.open("medos-voice", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("clips");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function saveClip(id, blob) {
    const d = await db();
    return new Promise((res, rej) => { const tx = d.transaction("clips", "readwrite"); tx.objectStore("clips").put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  async function getClip(id) {
    const d = await db();
    return new Promise((res, rej) => { const r = d.transaction("clips").objectStore("clips").get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  }
  async function clearClips() { try { const d = await db(); d.transaction("clips", "readwrite").objectStore("clips").clear(); } catch { /* none */ } }

  // ---------------------------------------------------------------- transcript assembly
  // Desktop Chrome gives each phrase once ("my name is Kavita", "I am 34"). Android Chrome instead gives
  // a growing copy of everything said so far as each new result ("my name is", "my name is Kavita", "my
  // name is Kavita I am 34"…). Appending them all made the text snowball, so the transcript is rebuilt
  // from the whole result list every time, and a result that repeats or extends the previous one
  // replaces it instead of being added.
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();   // \p{M}: Tamil vowel signs
  const words = (s) => norm(s).split(" ").filter(Boolean);
  // True when b is a.restated: the same opening words (allowing a word or two to be corrected, e.g.
  // "Kavita" → "Kavitha"), as Android sends when it re-sends a phrase.
  function restates(a, b) {
    const wa = words(a), wb = words(b);
    if (!wa.length || !wb.length) return false;
    const n = Math.min(wa.length, wb.length);
    // the last word of the shorter text may still be growing ("hi" → "high"), so a prefix counts as the same word
    const sameWord = (i) => wa[i] === wb[i] || (i === n - 1 && Math.min(wa[i].length, wb[i].length) >= 2 && (wa[i].startsWith(wb[i]) || wb[i].startsWith(wa[i])));
    let same = 0;
    for (let i = 0; i < n; i++) if (sameWord(i)) same++;
    return sameWord(0) && same >= Math.max(1, Math.ceil(n * 0.6));
  }
  function mergeResults(results, cumulative = isAndroid) {
    const parts = [];
    for (let i = 0; i < results.length; i++) {
      const t = (results[i][0] && results[i][0].transcript || "").trim();
      if (!t) continue;
      const last = parts[parts.length - 1];
      if (cumulative && last !== undefined && restates(last, t)) {
        if (words(t).length >= words(last).length) parts[parts.length - 1] = t;   // the same phrase, grown or corrected
        continue;                                                                   // a shorter repeat of it
      }
      parts.push(t);
    }
    return parts.join(" ");
  }
  // Join the text of an earlier session (before a pause or the browser's own restart) with the next one,
  // without doubling words if the new session starts by repeating the end of the old one.
  function joinText(before, next) {
    if (!before) return next;
    if (!next) return before;
    if (isAndroid && restates(before, next)) return words(next).length >= words(before).length ? next : before;
    if (norm(before).endsWith(norm(next))) return before;
    return before + " " + next;
  }

  // ---------------------------------------------------------------- one recording session
  // The browser ends a recognition session by itself after a long silence or about a minute of speech;
  // a new one starts straight away and the text heard so far is kept. maxSeconds is only a safety cap.
  // listen({lang, onPartial, onLevel, record}) →
  //   { promise: Promise<{text, audioId, durationS}>, stop(), pause(), resume(), elapsed() }
  function listen({ lang = "en-IN", onPartial = () => {}, onLevel = () => {}, record = true, maxSeconds = 600 } = {}) {
    let ctl = { stop() {}, pause() {}, resume() {}, elapsed: () => 0 };
    const promise = new Promise(async (resolve, reject) => {
      if (!caps.speech) return reject(new Error("This browser has no speech recognition. Use Chrome, Edge or Safari, or type instead."));
      let stream = null, recorder = null, chunks = [], meter = null, ctx = null;
      // committed: text from finished sessions; current: everything heard in the session now running
      let rec = null, committed = "", current = "", userStopped = false, paused = false, settled = false, hard = null;
      let spoken = 0, since = performance.now();   // recorded time, not counting pauses
      const wantRecord = record && caps.canRecordWithSpeech;
      if (caps.record && !isAndroid) {   // Android can't share the mic with recognition
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch (e) {
          if (e && e.name === "NotAllowedError") return reject(new Error("Microphone access was blocked. Allow it in the browser's site settings."));
          stream = null;
        }
      }
      if (stream) {
        try {
          const C = window.AudioContext || window.webkitAudioContext;
          ctx = new C();
          const an = ctx.createAnalyser();
          an.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(an);
          const buf = new Uint8Array(an.fftSize);
          meter = setInterval(() => {
            if (paused) return onLevel(0, null);
            an.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
            onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4), buf);
          }, 50);
        } catch { /* no meter */ }
        if (wantRecord) {
          try {
            recorder = new MediaRecorder(stream);
            recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
            recorder.start(250);
          } catch { recorder = null; }
        }
      }
      const text = () => joinText(committed, current).replace(/\s+/g, " ").trim();
      const stopRecorder = () => new Promise((res) => {
        if (!recorder || recorder.state === "inactive") return res(null);
        recorder.onstop = () => res(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        recorder.stop();
      });
      const finish = async (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(hard); clearInterval(meter); onLevel(0, null);
        if (!paused) spoken += performance.now() - since;
        if (err) { try { rec.abort(); } catch { /* ended */ } }
        const blob = await stopRecorder();
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (ctx) ctx.close().catch(() => {});
        if (err) return reject(err);
        const t = text();
        if (!t) return reject(new Error("We didn't catch anything. Try again and speak a little closer to the microphone."));
        let audioId = null;
        if (blob && blob.size > 2000) { audioId = "clip-" + Date.now(); try { await saveClip(audioId, blob); } catch { audioId = null; } }
        resolve({ text: t, audioId, durationS: spoken / 1000 });
      };
      const startRec = () => {
        rec = new SR();
        rec.lang = lang; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
        rec.onresult = (ev) => {
          current = mergeResults(ev.results);
          const last = ev.results[ev.results.length - 1];
          onPartial(text(), !!(last && last.isFinal));
        };
        rec.onerror = (e) => {
          if (e.error === "no-speech" || e.error === "aborted") return;   // silence is fine; onend restarts
          const msg = { "not-allowed": "Microphone access was blocked. Allow it in the browser's site settings.",
            "service-not-allowed": "Speech recognition is turned off in this browser.",
            "network": "The browser's speech service needs internet. Check the connection or type instead.",
            "audio-capture": "No microphone was found on this device." }[e.error];
          finish(new Error(msg || "Speech recognition stopped (" + e.error + ")"));
        };
        rec.onend = () => {
          committed = joinText(committed, current); current = "";   // keep everything this session heard
          if (settled) return;
          if (userStopped) return finish();
          if (paused) return;
          try { startRec(); } catch { finish(); }   // the browser stopped on its own: keep listening
        };
        rec.start();
      };
      const stop = () => { userStopped = true; if (paused) finish(); else try { rec.stop(); } catch { finish(); } };
      ctl = {
        stop,
        pause() {
          if (paused || settled) return;
          paused = true; spoken += performance.now() - since;
          if (recorder && recorder.state === "recording") recorder.pause();
          try { rec.stop(); } catch { /* ended */ }
        },
        resume() {
          if (!paused || settled) return;
          paused = false; since = performance.now();
          if (recorder && recorder.state === "paused") recorder.resume();
          try { startRec(); } catch (e) { finish(e); }
        },
        elapsed: () => (spoken + (paused || settled ? 0 : performance.now() - since)) / 1000,
      };
      hard = setTimeout(stop, maxSeconds * 1000);
      try { startRec(); } catch (e) { finish(e); }
    });
    return { promise, stop: () => ctl.stop(), pause: () => ctl.pause(), resume: () => ctl.resume(), elapsed: () => ctl.elapsed() };
  }

  return { caps, listen, getClip, clearClips, _mergeResults: mergeResults, _joinText: joinText };
})();

// A reusable "speak to fill" widget: mic button (start / stop), pause-resume, timer, live waveform and
// transcript. The recording only ends when the user presses Stop.
// mountVoice(el, {onResult({text, fields, audioId, durationS}), source, compact})
function mountVoice(el, { onResult, source = "reception", compact = false, lang = "en-IN", hint } = {}) {
  const idle = hint || (Voice.caps.speech ? "Tap the microphone and say your name, age and what's wrong. Take your time, then tap Stop." : "Voice needs Chrome, Edge or Safari — type below instead.");
  el.classList.add("voice-box");
  el.innerHTML = `
    <div class="voice-row">
      <button type="button" class="mic-btn" aria-label="Start recording">${icon("mic")}<span class="mic-ring"></span></button>
      <div class="voice-main">
        <canvas class="wave" height="44" aria-hidden="true"></canvas>
        <p class="voice-live" aria-live="polite">${esc(idle)}</p>
      </div>
    </div>
    <div class="voice-ctl hidden">
      <span class="rec-state"><span class="rec-dot"></span><span class="rec-label">Recording</span><b class="rec-time num">0:00</b></span>
      <button type="button" class="btn sm v-pause">${icon("pause")}Pause</button>
      <button type="button" class="btn sm primary v-stop">${icon("stop")}Stop and use</button>
    </div>
    <div class="voice-opts">
      <div class="seg seg-sm v-lang" role="group" aria-label="Language you will speak">
        <button type="button" data-lang="en-IN">English</button><button type="button" data-lang="ta-IN" lang="ta">தமிழ்</button></div>
      ${compact ? "" : `<label class="check"><input type="checkbox" class="v-rec" ${Voice.caps.canRecordWithSpeech ? "checked" : "disabled"}> Save audio clip</label>`}
    </div>`;
  const btn = $(".mic-btn", el), live = $(".voice-live", el), canvas = $(".wave", el), ctl = $(".voice-ctl", el);
  const pauseBtn = $(".v-pause", el), stopBtn = $(".v-stop", el), timeEl = $(".rec-time", el), label = $(".rec-label", el);
  const g = canvas.getContext("2d");
  let session = null, history = [], paused = false, heard = "", clock = null;
  // Spoken language: English, or Tamil (Tamil script, with English words mixed in). Remembered on this device.
  let speechLang = store("medos.voice.lang") || lang;
  const showLang = () => $$(".v-lang button", el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === speechLang)));
  showLang();
  $(".v-lang", el).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || session) return;
    speechLang = b.dataset.lang; store("medos.voice.lang", speechLang); showLang();
    if (!session) live.textContent = speechLang === "ta-IN"
      ? "தமிழில் பேசுங்கள் — உங்கள் பெயர், வயது, என்ன பிரச்சனை. (Speak in Tamil; English words are fine too.)"
      : idle;
  });
  if (!Voice.caps.speech) btn.disabled = true;

  const draw = (level) => {
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio), h = (canvas.height = 44 * devicePixelRatio);
    history.push(level); if (history.length > 64) history.shift();
    g.clearRect(0, 0, w, h);
    const bw = w / 64, col = getComputedStyle(el).getPropertyValue("--wave") || "#0e7490";
    g.fillStyle = col.trim() || "#0e7490";
    history.forEach((v, i) => { const bh = Math.max(2 * devicePixelRatio, v * h * 0.95); g.fillRect(i * bw + bw * 0.2, (h - bh) / 2, bw * 0.6, bh); });
  };
  const tick = () => {
    if (!session) return;
    const s = Math.floor(session.elapsed());
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const showLive = () => {
    live.innerHTML = paused
      ? `${heard ? "“" + esc(heard) + "” " : ""}<span class="muted">— paused. Resume to carry on, or Stop when you're done.</span>`
      : heard ? esc(heard) + '<span class="caret"></span>' : "Recording… speak whenever you're ready.";
    live.scrollTop = live.scrollHeight;   // long transcripts scroll inside the box, newest words in view
  };
  const setPaused = (p) => {
    paused = p;
    el.classList.toggle("paused", p);
    label.textContent = p ? "Paused" : "Recording";
    pauseBtn.innerHTML = p ? `${icon("mic")}Resume` : `${icon("pause")}Pause`;
    showLive();
  };
  const start = async () => {
    audioCtx();
    history = []; heard = "";
    el.classList.add("listening");
    ctl.classList.remove("hidden");
    btn.setAttribute("aria-label", "Stop and use what was heard");
    timeEl.textContent = "0:00";
    setPaused(false);
    const record = $(".v-rec", el) ? $(".v-rec", el).checked : Voice.caps.canRecordWithSpeech;
    const lng = speechLang;
    session = Voice.listen({ lang: lng, record, onPartial: (t) => { heard = t; showLive(); }, onLevel: (v) => draw(v) });
    clock = setInterval(tick, 250);
    try {
      const r = await session.promise;
      const fields = parseCheckin(r.text);
      live.textContent = "“" + r.text + "”";
      onResult && onResult({ ...r, fields, source, lang: lng });
    } catch (e) {
      live.textContent = e.message;
      toast(e.message, "error");
    } finally {
      clearInterval(clock);
      session = null;
      el.classList.remove("listening", "paused");
      ctl.classList.add("hidden");
      stopBtn.disabled = false;
      btn.setAttribute("aria-label", "Start recording");
    }
  };
  const stop = () => {
    if (!session) return;
    stopBtn.disabled = true;
    label.textContent = "Finishing";
    session.stop();
  };
  btn.addEventListener("click", () => (session ? stop() : start()));
  stopBtn.addEventListener("click", stop);
  pauseBtn.addEventListener("click", () => {
    if (!session) return;
    if (paused) session.resume(); else session.pause();
    setPaused(!paused);
  });
  return { stop };
}

// ---------------------------------------------------------------- guided check-in: three questions, one field each
// Name, then age, then the problem — each answer fills only its own field, so nothing gets mixed up. Works in
// English and Tamil: the question is shown (and spoken, when the device has a voice for that language); the app
// never listens while it is speaking, and each recording runs until the patient taps Done.
const GUIDED_STEPS = ["name", "age", "problem"];
const GUIDED_TEXT = {
  "en-IN": {
    title: "Voice check-in", sub: "3 short questions", start: "Start voice check-in", done: "Done", again: "Say again", edit: "Edit",
    type: "Type instead", yes: "Yes, next", finish: "Yes, finish", restart: "Start again", listening: "Listening… tap Done when you finish.",
    speaking: "Asking…", notHeard: "We didn't catch that — please say it again, or type it.",
    labels: { name: "Name", age: "Age", problem: "Problem" },
    q: { name: "What is your name?", age: "How old are you?", problem: "What is the problem?" },
    hint: { name: "Say just your name — for example “Kavitha”.", age: "Say your age — for example “34”. For a baby, say “6 months”.",
      problem: "Say what is wrong and since when — for example “fever and cough for two days”." },
    retry: { name: "Please say just your name.", age: "Please say the age as a number, like “34”.", problem: "Please tell us what is wrong." },
    infant: "under 1 year", years: "years", allSet: "All three answers recorded.",
  },
  "ta-IN": {
    title: "குரல் பதிவு", sub: "3 சிறிய கேள்விகள்", start: "குரல் பதிவைத் தொடங்கு", done: "முடிந்தது", again: "மீண்டும் சொல்லுங்கள்", edit: "திருத்து",
    type: "தட்டச்சு செய்ய", yes: "சரி, அடுத்து", finish: "சரி, முடி", restart: "மீண்டும் தொடங்கு", listening: "கேட்கிறது… சொல்லி முடித்ததும் “முடிந்தது” அழுத்துங்கள்.",
    speaking: "கேட்கிறோம்…", notHeard: "சரியாகக் கேட்கவில்லை — மீண்டும் சொல்லுங்கள், அல்லது தட்டச்சு செய்யுங்கள்.",
    labels: { name: "பெயர்", age: "வயது", problem: "பிரச்சனை" },
    q: { name: "உங்கள் பெயர் என்ன?", age: "உங்களுக்கு எத்தனை வயசு?", problem: "என்ன பிரச்சனை?" },
    hint: { name: "பெயரை மட்டும் சொல்லுங்கள் — எ.கா. “கவிதா”.", age: "வயதைச் சொல்லுங்கள் — எ.கா. “34” அல்லது “பதினெட்டு”. குழந்தைக்கு “ஆறு மாசம்”.",
      problem: "என்ன பிரச்சனை, எத்தனை நாளா என்று சொல்லுங்கள் — எ.கா. “ரெண்டு நாளா காய்ச்சல், இருமல்”." },
    retry: { name: "பெயரை மட்டும் சொல்லுங்கள்.", age: "வயதை எண்ணாகச் சொல்லுங்கள், எ.கா. “34”.", problem: "என்ன பிரச்சனை என்று சொல்லுங்கள்." },
    infant: "1 வயதுக்குக் குறைவு", years: "வயது", allSet: "மூன்று பதில்களும் பதிவாகின.",
  },
};

// Speak a question; resolves when it has finished (or straight away if this device has no voice for the language).
function speakQuestion(text, lang) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve(false);
    const voices = speechSynthesis.getVoices();
    const prefix = lang.slice(0, 2);
    if (voices.length && !voices.some((v) => v.lang && v.lang.toLowerCase().startsWith(prefix))) return resolve(false);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = 0.95;
    const voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
    if (voice) u.voice = voice;
    let settled = false;
    const done = () => { if (!settled) { settled = true; setTimeout(() => resolve(true), 250); } };   // let the speaker go quiet
    u.onend = done; u.onerror = done;
    setTimeout(done, 7000);                                                                          // never hang
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
}

// mountGuidedVoice(el, {onDone({name, age, symptoms, symptomsEn, translationSource, lang, audioId, durationS, transcripts}),
//                       onStep(field, value), source})
function mountGuidedVoice(el, { onDone, onStep, source = "patient" } = {}) {
  let lang = store("medos.voice.lang") || "en-IN";
  let step = null, session = null, answers = {}, raw = {}, clip = {}, history = [], clock = null, speakToken = 0;
  const T = () => GUIDED_TEXT[lang] || GUIDED_TEXT["en-IN"];
  el.classList.add("guided");

  const shown = (field, v) => (v == null || v === "" ? "—" : field === "age" ? (v === 0 ? T().infant : `${v} ${T().years}`) : v);

  function frame() {
    const t = T();
    el.innerHTML = `
      <div class="g-head">
        <div><b>${icon("mic")}${esc(t.title)}</b><small>${esc(t.sub)}</small></div>
        <div class="seg seg-sm g-lang" role="group" aria-label="Language">
          <button type="button" data-lang="en-IN" aria-pressed="${lang === "en-IN"}">English</button>
          <button type="button" data-lang="ta-IN" lang="ta" aria-pressed="${lang === "ta-IN"}">தமிழ்</button></div>
      </div>
      <ol class="g-steps">${GUIDED_STEPS.map((f, i) => `<li data-step="${f}" class="${step === f ? "now" : answers[f] != null ? "done" : ""}">
          <span class="g-n">${answers[f] != null && step !== f ? icon("check") : i + 1}</span>
          <span class="g-l"><b>${esc(t.labels[f])}</b><small>${answers[f] != null ? esc(shown(f, answers[f])) : ""}</small></span></li>`).join("")}</ol>
      <div class="g-stage" aria-live="polite"></div>`;
    $$(".g-lang button", el).forEach((b) => b.addEventListener("click", () => {
      if (session) return;
      lang = b.dataset.lang; store("medos.voice.lang", lang);
      frame(); step ? ask(step) : intro();          // mid-way: ask the current question again, in the new language
    }));
    $$(".g-steps li", el).forEach((li) => li.addEventListener("click", () => {
      const f = li.dataset.step;
      if (session || step === null || (answers[f] == null && f !== step)) return;   // only finished steps can be redone
      stopAll(); ask(f);
    }));
  }
  const stage = () => $(".g-stage", el);
  // Keep the whole question card on screen — above the fixed bottom tab bar on phones, so Done can't be hidden under it.
  const inView = () => { try { el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } catch { /* old browser */ } };

  function intro() {
    const t = T();
    stage().innerHTML = `<button type="button" class="btn primary lg block g-start">${icon("mic")}${esc(t.start)}</button>
      <p class="t-small muted" style="margin-top:8px">${esc(t.q.name)} → ${esc(t.q.age)} → ${esc(t.q.problem)}</p>`;
    $(".g-start", el).addEventListener("click", () => { audioCtx(); ask("name"); });
    if (!Voice.caps.speech) $(".g-start", el).disabled = true;
  }

  function stopAll() {
    speakToken++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (session) { const s = session; session = null; s.stop(); }
    clearInterval(clock);
  }

  // Show a question, speak it, then listen.
  async function ask(field, { speak = true, retry = false } = {}) {
    step = field;
    frame();
    const t = T();
    stage().innerHTML = `
      <p class="g-q">${esc(t.q[field])}</p>
      <p class="g-hint">${esc(retry ? t.retry[field] : t.hint[field])}</p>
      <div class="voice-row g-rec">
        <button type="button" class="mic-btn" aria-label="${esc(t.done)}">${icon("mic")}<span class="mic-ring"></span></button>
        <div class="voice-main"><canvas class="wave" height="44" aria-hidden="true"></canvas><p class="voice-live">${esc(t.speaking)}</p></div>
      </div>
      <div class="g-ctl">
        <button type="button" class="btn primary g-done" disabled>${icon("check")}${esc(t.done)}</button>
        <button type="button" class="btn ghost g-type">${icon("keyboard")}${esc(t.type)}</button>
      </div>`;
    $(".g-type", el).addEventListener("click", () => { stopAll(); typeAnswer(field); });
    inView();
    const token = ++speakToken;
    if (speak) await speakQuestion(t.q[field], lang);
    if (token !== speakToken || step !== field) return;       // the patient moved on while it was speaking
    listenFor(field);
  }

  function listenFor(field) {
    const t = T();
    const live = $(".voice-live", el), canvas = $(".wave", el), doneBtn = $(".g-done", el), mic = $(".mic-btn", el);
    const g = canvas.getContext("2d");
    history = [];
    el.classList.add("listening");
    live.textContent = t.listening;
    doneBtn.disabled = false;
    const draw = (level) => {
      const w = (canvas.width = canvas.clientWidth * devicePixelRatio), h = (canvas.height = 44 * devicePixelRatio);
      history.push(level); if (history.length > 48) history.shift();
      g.clearRect(0, 0, w, h);
      g.fillStyle = (getComputedStyle(el).getPropertyValue("--wave") || "#0e7490").trim() || "#0e7490";
      const bw = w / 48;
      history.forEach((v, i) => { const bh = Math.max(2 * devicePixelRatio, v * h * 0.95); g.fillRect(i * bw + bw * 0.2, (h - bh) / 2, bw * 0.6, bh); });
    };
    const s = Voice.listen({ lang, record: field === "problem" && Voice.caps.canRecordWithSpeech,
      onPartial: (txt) => { live.innerHTML = esc(txt) + '<span class="caret"></span>'; live.scrollTop = live.scrollHeight; },
      onLevel: (v) => draw(v) });
    session = s;
    const finish = () => { if (session === s) { doneBtn.disabled = true; doneBtn.lastChild.textContent = "…"; s.stop(); } };
    doneBtn.addEventListener("click", finish);
    mic.addEventListener("click", finish);
    s.promise.then((r) => {
      if (session !== s) return;
      session = null;
      el.classList.remove("listening");
      if (field === "problem" && r.audioId) clip = { audioId: r.audioId, durationS: r.durationS };
      accept(field, r.text);
    }).catch((e) => {
      if (session !== s) return;
      session = null;
      el.classList.remove("listening");
      live.textContent = e.message || t.notHeard;
      showRetry(field);
    });
  }

  // One answer → one field, with the parser made for that question.
  function valueFor(field, text) {
    if (field === "name") return extractName(text);
    if (field === "age") return extractAge(text);
    const s = cleanSymptoms(text);
    return s || null;
  }

  function accept(field, text) {
    const value = valueFor(field, text);
    raw[field] = text;
    if (value == null) return ask(field, { speak: false, retry: true });
    showResult(field, value, text);
  }

  function showResult(field, value, heard) {
    const t = T();
    const last = field === "problem";
    stage().innerHTML = `
      <p class="g-q">${esc(t.q[field])}</p>
      <div class="g-result"><span class="g-rl">${esc(t.labels[field])}</span><b class="g-rv">${esc(shown(field, value))}</b>
        ${heard && heard.trim() !== String(value) ? `<small class="muted">“${esc(heard)}”</small>` : ""}</div>
      <div class="g-ctl">
        <button type="button" class="btn primary g-yes">${icon("check")}${esc(last ? t.finish : t.yes)}</button>
        <button type="button" class="btn g-again">${icon("refresh")}${esc(t.again)}</button>
        <button type="button" class="btn ghost g-edit">${icon("keyboard")}${esc(t.edit)}</button>
      </div>`;
    inView();
    $(".g-yes", el).addEventListener("click", () => {
      answers[field] = value;
      onStep && onStep(field, value);
      const next = GUIDED_STEPS[GUIDED_STEPS.indexOf(field) + 1];
      if (next && answers[next] == null) ask(next);
      else if (GUIDED_STEPS.every((f) => answers[f] != null)) complete();
      else ask(GUIDED_STEPS.find((f) => answers[f] == null));
    });
    $(".g-again", el).addEventListener("click", () => ask(field, { speak: false }));
    $(".g-edit", el).addEventListener("click", () => typeAnswer(field, value));
  }

  function showRetry(field) {
    const t = T();
    const ctl = $(".g-ctl", el);
    ctl.innerHTML = `<button type="button" class="btn primary g-again">${icon("refresh")}${esc(t.again)}</button>
      <button type="button" class="btn ghost g-type">${icon("keyboard")}${esc(t.type)}</button>`;
    $(".g-again", el).addEventListener("click", () => ask(field, { speak: false }));
    $(".g-type", el).addEventListener("click", () => typeAnswer(field));
  }

  function typeAnswer(field, current) {
    const t = T();
    step = field;
    frame();
    const isAge = field === "age";
    stage().innerHTML = `
      <p class="g-q">${esc(t.q[field])}</p>
      <form class="g-form">
        ${field === "problem" ? `<textarea class="textarea" name="v" rows="3"></textarea>` : `<input class="input" name="v" ${isAge ? 'inputmode="numeric"' : ""} autocomplete="off">`}
        <button class="btn primary">${icon("check")}${esc(t.yes)}</button>
      </form>`;
    const f = $(".g-form", el);
    f.v.value = current == null ? "" : String(current);
    inView();
    f.v.focus({ preventScroll: true });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = f.v.value.trim();
      if (!text) return;
      const value = valueFor(field, text);
      if (value == null) { toast(t.retry[field], "warn"); return; }
      raw[field] = text;
      showResult(field, value, text);
    });
  }

  async function complete() {
    step = null;
    frame();
    const t = T();
    const symptoms = answers.problem;
    const result = { name: answers.name, age: answers.age, symptoms, lang, source, transcripts: { ...raw }, ...clip };
    stage().innerHTML = `<p class="g-allset">${icon("check")}${esc(t.allSet)}</p>
      <div class="g-summary">${GUIDED_STEPS.map((f) => `<div><span>${esc(t.labels[f])}</span><b>${esc(shown(f, answers[f]))}</b></div>`).join("")}</div>
      <div class="g-en"></div>
      <button type="button" class="btn ghost sm g-restart">${icon("refresh")}${esc(t.restart)}</button>`;
    $(".g-restart", el).addEventListener("click", () => { answers = {}; raw = {}; clip = {}; ask("name"); });
    if (isTamilText(symptoms) && typeof Translate !== "undefined") {
      $(".g-en", el).innerHTML = englishLine(null, { pending: true });
      const en = await Translate.toEnglish(symptoms);
      if (en && en.text) { result.symptomsEn = en.text; result.translationSource = en.source; }
      const box = $(".g-en", el);
      if (box) box.innerHTML = en && en.text ? englishLine(en) : "";
    }
    onDone && onDone(result);
  }

  frame();
  intro();
  return { stop: stopAll, reset: () => { stopAll(); answers = {}; raw = {}; clip = {}; step = null; frame(); intro(); } };
}

// Play a saved clip.
async function playClip(audioId, btn) {
  try {
    const blob = await Voice.getClip(audioId);
    if (!blob) return toast("This clip was recorded on another device", "warn");
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    if (btn) { btn.classList.add("playing"); a.onended = () => btn.classList.remove("playing"); }
    a.play();
  } catch { toast("Couldn't play the clip", "error"); }
}
