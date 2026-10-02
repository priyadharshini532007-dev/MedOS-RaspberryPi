// MedOS Web — Tamil → English translation of the symptoms, so every screen (and the English-trained ML
// model) can read a Tamil check-in.
//
// Order of preference:
//   1. The browser's own on-device translator (Chrome's Translator API, where available) — private.
//   2. MyMemory (api.mymemory.translated.net), a free translation service — needs internet.
//   3. Offline: the conditions the Tamil triage rules recognised, written in English.
// Only the symptom text is translated: the parser has already taken the name, age and phone out of it.
// The English is a helper shown next to the original Tamil, never a replacement — machine translation
// can be wrong, so staff always see both.
"use strict";

const Translate = (() => {
  const TAMIL = /[஀-௿]/;
  const CACHE_KEY = "medos.translate.cache";
  let cache = store(CACHE_KEY) || {};
  let onDevice = null;   // Chrome Translator instance, once created

  const isTamil = (text) => TAMIL.test(text || "");

  function remember(text, result) {
    cache[text] = result;
    const keys = Object.keys(cache);
    if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete cache[k]);
    store(CACHE_KEY, cache);
  }

  // Give up on any step that takes too long, and fall through to the next method.
  const within = (ms, p) => Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]);

  async function viaBrowser(text) {
    if (!("Translator" in self)) return null;
    try {
      if (!onDevice) {
        // Only when the Tamil model is already on this device: "downloadable" would wait for a download.
        const ok = await within(1500, self.Translator.availability({ sourceLanguage: "ta", targetLanguage: "en" }));
        if (ok !== "available") return null;
        onDevice = await within(3000, self.Translator.create({ sourceLanguage: "ta", targetLanguage: "en" }));
        if (!onDevice) return null;
      }
      return await within(4000, onDevice.translate(text));
    } catch { return null; }
  }

  async function viaMyMemory(text) {
    const url = "https://api.mymemory.translated.net/get?" + new URLSearchParams({ q: text.slice(0, 480), langpair: "ta|en" });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      const d = await r.json();
      const t = d && d.responseData && d.responseData.translatedText;
      if (!t || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(t) || isTamil(t)) return null;
      return t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    } catch { return null; } finally { clearTimeout(timer); }
  }

  // Offline fallback: the conditions the Tamil-aware triage rules found, in English.
  function viaRules(text) {
    const t = analyse(text);
    if (!t.conditions.length) return null;
    return t.conditions.map((c) => c.name.replace(/\s*\(.*?\)/, "").replace(/ \/ .*/, "")).join("; ");
  }

  // → { text, source: "on-device" | "MyMemory" | "offline summary" } or null if not Tamil / nothing found
  async function toEnglish(text) {
    text = (text || "").trim();
    if (!isTamil(text)) return null;
    if (cache[text]) return cache[text];
    let out = null, en;
    if ((en = await viaBrowser(text))) out = { text: en, source: "on-device" };
    else if ((en = await viaMyMemory(text))) out = { text: en, source: "MyMemory" };
    else if ((en = viaRules(text))) return { text: en, source: "offline summary" };   // not cached: retry online later
    if (out) remember(text, out);
    return out;
  }

  return { isTamil, toEnglish };
})();

// "In English: …" line shown under a Tamil text.
function englishLine(en, { pending = false } = {}) {
  if (pending) return `<div class="en-line muted">${icon("refresh")}Translating to English…</div>`;
  if (!en) return "";
  const src = { "on-device": "translated on this device", MyMemory: "machine translation", "offline summary": "offline — conditions recognised" }[en.source] || "";
  return `<div class="en-line" lang="en">${icon("send")}<span><b>In English:</b> ${esc(en.text)} <small class="muted">· ${src}</small></span></div>`;
}
