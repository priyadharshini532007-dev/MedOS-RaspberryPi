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
      let rec = null, finalText = "", interim = "", userStopped = false, paused = false, settled = false, hard = null;
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
      const text = () => (finalText + " " + interim).replace(/\s+/g, " ").trim();
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
          interim = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalText += " " + r[0].transcript; else interim += r[0].transcript;
          }
          onPartial(text(), !interim);
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
          if (interim) { finalText += " " + interim; interim = ""; }   // keep words heard just before the break
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

  return { caps, listen, getClip, clearClips };
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
    ${compact ? "" : `<div class="voice-opts">
      <label class="check"><input type="checkbox" class="v-rec" ${Voice.caps.canRecordWithSpeech ? "checked" : "disabled"}> Save audio clip</label>
      <select class="v-lang select-sm" aria-label="Recognition language">
        <option value="en-IN">English (India)</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option>
        <option value="ta-IN">தமிழ் (Tamil)</option><option value="hi-IN">हिन्दी (Hindi)</option></select>
    </div>`}`;
  const btn = $(".mic-btn", el), live = $(".voice-live", el), canvas = $(".wave", el), ctl = $(".voice-ctl", el);
  const pauseBtn = $(".v-pause", el), stopBtn = $(".v-stop", el), timeEl = $(".rec-time", el), label = $(".rec-label", el);
  const g = canvas.getContext("2d");
  let session = null, history = [], paused = false, heard = "", clock = null;
  if ($(".v-lang", el)) $(".v-lang", el).value = lang;
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
    const lng = $(".v-lang", el) ? $(".v-lang", el).value : lang;
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
