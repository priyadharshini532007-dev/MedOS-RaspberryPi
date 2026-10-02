// Voice capture: the Pi's USB microphone (offline Vosk), this device's microphone recorded and
// transcribed on the Pi, or the browser's own speech recognition. All three end in the same
// {text, fields, parser} result.
import { api } from "./core.js";

export async function voiceCapabilities() {
  let st = {};
  try { st = await api("voice/status"); } catch { /* offline */ }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const secure = window.isSecureContext;
  const media = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  return {
    pi: !!st.pi_mic,
    record: !!st.server_stt && secure && media,
    speech: !!SR && secure,
    secure,
  };
}

export const MODE_LABEL = { pi: "Pi microphone", record: "This mic, offline", speech: "This mic, browser" };

// Pi microphone first, then this device transcribed offline on the server, then the browser's own
// recogniser (often more accurate, but Chrome sends the audio to Google and needs internet).
export function preferredModes(caps) {
  const out = [];
  if (caps.pi) out.push("pi");
  if (caps.record) out.push("record");
  if (caps.speech) out.push("speech");
  return out;
}

// Every mode records until the user presses Stop; pauses in speech never end a recording.
// maxSeconds is only a safety cap. Returns { promise, stop(), pause(), resume(), canPause }.
export function listen({ mode, lang = "en-IN", onPartial = () => {}, maxSeconds = 600 }) {
  if (mode === "pi") return listenPi({ onPartial, maxSeconds });
  if (mode === "record") return listenRecord({ onPartial, maxSeconds });
  return listenSpeech({ lang, onPartial, maxSeconds });
}

// ---------------------------------------------------------------- Pi microphone
function listenPi({ onPartial, maxSeconds }) {
  const session = Math.random().toString(36).slice(2);
  const onEv = (e) => {
    const { kind, data } = e.detail;
    if (kind === "voice" && data.session === session) onPartial(data.text);
  };
  document.addEventListener("medos:event", onEv);
  const promise = api("voice/listen", { method: "POST", body: { session, seconds: maxSeconds, manual: true } })
    .finally(() => document.removeEventListener("medos:event", onEv));
  const noop = () => {};
  return { promise, canPause: false, pause: noop, resume: noop,
    stop() { api("voice/stop", { method: "POST" }).catch(noop); } };
}

// ---------------------------------------------------------------- transcript assembly
// Desktop Chrome gives each phrase once. Android Chrome instead gives a growing copy of everything said
// so far as each new result ("my name is", "my name is Kavita", "my name is Kavita I am 34"…), so
// appending them made the text repeat itself. The transcript is rebuilt from the whole result list each
// time; on Android a result that restates the previous one (grown, or with a word corrected) replaces it.
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const normText = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const wordsOf = (s) => normText(s).split(" ").filter(Boolean);
function restates(a, b) {
  const wa = wordsOf(a), wb = wordsOf(b);
  if (!wa.length || !wb.length) return false;
  const n = Math.min(wa.length, wb.length);
  let same = 0;
  for (let i = 0; i < n; i++) if (wa[i] === wb[i]) same++;
  return wa[0] === wb[0] && same >= Math.max(1, Math.ceil(n * 0.6));
}
export function mergeResults(results, cumulative = IS_ANDROID) {
  const parts = [];
  for (let i = 0; i < results.length; i++) {
    const t = ((results[i][0] && results[i][0].transcript) || "").trim();
    if (!t) continue;
    const last = parts[parts.length - 1];
    if (cumulative && last !== undefined && restates(last, t)) {
      if (wordsOf(t).length >= wordsOf(last).length) parts[parts.length - 1] = t;
      continue;
    }
    parts.push(t);
  }
  return parts.join(" ");
}
// Join an earlier session's text (before a pause or the browser's own restart) with the next one.
function joinText(before, next) {
  if (!before) return next;
  if (!next) return before;
  if (IS_ANDROID && restates(before, next)) return wordsOf(next).length >= wordsOf(before).length ? next : before;
  if (normText(before).endsWith(normText(next))) return before;
  return before + " " + next;
}

// ---------------------------------------------------------------- browser speech recognition
// The browser ends a recognition session by itself after a long silence or about a minute of speech;
// we start a new one straight away and keep the text heard so far, until the user presses Stop.
function listenSpeech({ lang, onPartial, maxSeconds }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // committed: text from finished sessions; current: everything heard in the session now running
  let rec = null, committed = "", current = "", userStopped = false, paused = false, settled = false, hardStop = null;
  let resolveP, rejectP;
  const promise = new Promise((res, rej) => { resolveP = res; rejectP = rej; });
  const text = () => joinText(committed, current).replace(/\s+/g, " ").trim();
  const finish = async () => {
    if (settled) return;
    settled = true; clearTimeout(hardStop);
    const t = text();
    if (!t) return rejectP(new Error("We didn't catch anything. Try again and speak a little closer."));
    try { resolveP(await api("voice/parse", { method: "POST", body: { text: t } })); } catch (e) { rejectP(e); }
  };
  const fail = (err) => { if (settled) return; settled = true; clearTimeout(hardStop); try { rec.abort(); } catch { /* already stopped */ } rejectP(err); };
  const startRec = () => {
    rec = new SR();
    rec.lang = lang; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      current = mergeResults(ev.results);
      onPartial(text());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;   // silence is fine; onend restarts
      const msg = { "not-allowed": "Microphone access was blocked. Allow it in the browser's site settings.",
        "network": "This browser's speech service needs internet. Switch to the Pi microphone instead.",
        "audio-capture": "No microphone was found on this device." }[e.error];
      fail(new Error(msg || "Speech recognition stopped (" + e.error + ")"));
    };
    rec.onend = () => {
      committed = joinText(committed, current); current = "";   // keep everything this session heard
      if (settled) return;
      if (userStopped) return finish();
      if (paused) return;
      try { startRec(); } catch { finish(); }
    };
    rec.start();
  };
  startRec();
  hardStop = setTimeout(() => { userStopped = true; if (paused) finish(); else try { rec.stop(); } catch { finish(); } }, maxSeconds * 1000);
  return {
    promise, canPause: true,
    stop() { userStopped = true; if (paused) finish(); else try { rec.stop(); } catch { finish(); } },
    pause() { if (paused || settled) return; paused = true; try { rec.stop(); } catch { /* ended */ } },
    resume() { if (!paused || settled) return; paused = false; try { startRec(); } catch (e) { fail(e); } },
  };
}

// ---------------------------------------------------------------- record here, transcribe on the Pi
function listenRecord({ onPartial, maxSeconds }) {
  let stopFn = () => {}, paused = false;
  const promise = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    // Adaptive level meter: learn the room's background level first, then show speech against it.
    let heard = 0, start = performance.now(), done, noise = null, calib = [];
    const finished = new Promise((r) => (done = r));
    node.onaudioprocess = (e) => {
      const now = performance.now();
      if (now - start > maxSeconds * 1000) return done();
      if (paused) { onPartial("Paused. Press Resume to carry on, or Stop when you're done."); return; }
      const data = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(data));
      let sum = 0; for (let i = 0; i < data.length; i += 4) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / (data.length / 4));
      if (noise === null) { calib.push(rms); if (now - start > 400) noise = Math.min(...calib); }
      const threshold = Math.max(0.004, (noise || 0.004) * 2.5);
      if (noise !== null && rms > threshold) heard = now;
      const bar = "▮".repeat(Math.min(24, Math.round((rms / threshold) * 4)));
      onPartial(`${heard ? "Recording. Press Stop when you're done" : "Listening, start speaking"}  ${bar}`);
    };
    src.connect(node); node.connect(ctx.destination);
    stopFn = done;
    await finished;
    node.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop());
    const rate = ctx.sampleRate; await ctx.close();
    if (!heard) throw new Error("We didn't hear anything. Try again and speak a little closer.");
    onPartial("Transcribing on the Pi…");
    const pcm = downsample(concat(chunks), rate, 16000);
    // Boost quiet recordings so the speech model can hear them.
    let peak = 0; for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    if (peak > 0.001 && peak < 0.8) { const g = Math.min(20, 0.8 / peak); for (let i = 0; i < pcm.length; i++) pcm[i] *= g; }
    const wav = encodeWav(pcm, 16000);
    return api("voice/transcribe", { method: "POST", body: wav, headers: { "Content-Type": "audio/wav" } });
  })();
  return { promise, canPause: true, stop() { paused = false; stopFn(); }, pause() { paused = true; }, resume() { paused = false; } };
}

function concat(chunks) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(len); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
function downsample(buf, from, to) {
  if (from === to) return buf;
  const ratio = from / to, len = Math.floor(buf.length / ratio), out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.floor(i * ratio), e = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = s; j < e; j++) sum += buf[j];
    out[i] = sum / Math.max(1, e - s);
  }
  return out;
}
function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}
