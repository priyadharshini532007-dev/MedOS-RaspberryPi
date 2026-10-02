// MedOS Web — shared helpers: DOM, icons, formatting, priority badges, dialogs, sound, speech.
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ------------------------------------------------------------------ icons (one outline family, 2px stroke)
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>',
  desk: '<rect x="5.5" y="4" width="13" height="17" rx="2"/><path d="M9 4.5h6V7H9z"/><path d="M9 12h6M9 16h4"/>',
  stetho: '<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v1.5a5.5 5.5 0 0 0 11 0V12"/><circle cx="21" cy="10" r="1.8"/>',
  shield: '<path d="M12 3 5 6v5c0 4.6 3 8.4 7 10 4-1.6 7-5.4 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
  tv: '<rect x="3" y="4.5" width="18" height="12.5" rx="2"/><path d="M8 21h8M12 17v4"/>',
  lab: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  siren: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M4 21h16M5 18h14"/><path d="M12 3v2M4.5 6.5l1.4 1.4M19.5 6.5l-1.4 1.4"/>',
  octagon: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M12 8v5M12 16.5v.5"/>',
  chevronsUp: '<path d="m7 12 5-5 5 5M7 18l5-5 5 5"/>',
  dash: '<path d="M6 12h12"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  door: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12" r="1"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><rect x="9.5" y="9.5" width="5" height="5"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  coffee: '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h2a2.5 2.5 0 0 1 0 5h-2M8 2.5V5M12 2.5V5"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  clipboard: '<rect x="5.5" y="4" width="13" height="17" rx="2"/><path d="M9 4.5h6V7H9z"/><path d="m9 14 2 2 4-4"/>',
  pill: '<path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z"/><path d="m8.5 8.5 7 7"/>',
  ambulance: '<path d="M2 17V8a1 1 0 0 1 1-1h11v10"/><path d="M14 10h4l3 3.5V17h-7"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/><path d="M8 9v4M6 11h4"/>',
  hospital: '<path d="M4 21V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v16"/><path d="M2 21h20M12 8v6M9 11h6M10 21v-3h4v3"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  nav: '<path d="M3 11 21 3l-8 18-2-8z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  ticket: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2.5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
  bed: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="2"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM17 17h4v4h-4M20 14h1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
};

function icon(name, cls = "") {
  return `<svg class="ico ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
}
function hydrateIcons(root = document) {
  $$("[data-icon]", root).forEach((el) => {
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    el.dataset.iconDone = "1";
  });
}

// ------------------------------------------------------------------ priorities
const LEVELS = ["critical", "high", "medium", "low"];
const LEVEL_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const LEVEL_TARGET = { critical: "Seen immediately", high: "Seen within 15 min", medium: "Seen within 1 hour", low: "Seen within 2 hours" };
const LEVEL_ICON = { critical: "octagon", high: "chevronsUp", medium: "dash", low: "chevronDown" };
const LEVEL_COLOR = { critical: "var(--crit)", high: "var(--high)", medium: "var(--med)", low: "var(--low)" };

function prio(level, { lg = false, text } = {}) {
  if (!LEVELS.includes(level)) return "";
  return `<span class="prio ${lg ? "lg" : ""}" data-level="${level}" title="${LEVEL_TARGET[level]}">${icon(LEVEL_ICON[level])}${esc(text || LEVEL_LABEL[level])}</span>`;
}
function tokenChip(token, level) {
  return `<span class="token-chip" data-level="${level || ""}">${esc(token)}</span>`;
}

// ------------------------------------------------------------------ formatting
function fmtMin(min, { short = true } = {}) {
  if (min == null || !isFinite(min)) return "—";
  const m = Math.max(0, Math.round(min));
  if (m < 1) return min <= 0.05 ? "now" : "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return short ? `${h} h ${r ? r + " m" : ""}`.trim() : `${h} hour${h > 1 ? "s" : ""} ${r ? r + " min" : ""}`.trim();
}
function fmtAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 50) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} m ago`;
}
function fmtClock(ts, sec = false) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(sec ? { second: "2-digit" } : {}) });
}
function fmtKm(m) { return m == null ? "—" : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`; }
function ageSex(p) {
  const sex = { male: "Male", female: "Female", other: "Other" }[p.sex];
  return [p.age ? `${p.age} yrs` : null, sex].filter(Boolean).join(" · ");
}
function initials(name) { return (name || "?").replace(/^Dr\.\s*/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
// Debounced redraw that does nothing once the page element has been navigated away from.
function debounceFor(el, fn, ms) { return debounce((...a) => { if (el.isConnected) fn(...a); }, ms); }
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch { return null; }
}

// ------------------------------------------------------------------ toasts and dialogs
function toast(message, kind = "ok", ms = 4000) {
  let host = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = `${icon(kind === "error" ? "octagon" : kind === "warn" ? "bell" : "check")}<span>${esc(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 250); }, ms);
}

function modal({ title, body = "", actions = [], wide = false, onOpen }) {
  const dlg = document.createElement("dialog");
  dlg.className = `modal ${wide ? "wide" : ""}`;
  dlg.innerHTML = `<form method="dialog" class="modal-inner">
      <header class="modal-head"><h2 class="t-h2">${esc(title)}</h2><button class="icon-btn" value="cancel" aria-label="Close">${icon("x")}</button></header>
      <div class="modal-body">${body}</div>
      ${actions.length ? `<footer class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.kind || ""}" value="${i}" ${a.primary ? "autofocus" : ""}>${a.icon ? icon(a.icon) : ""}${esc(a.label)}</button>`).join("")}</footer>` : ""}
    </form>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => {
      const v = dlg.returnValue;
      const a = actions[+v];
      const res = a && a.collect ? a.collect(dlg) : a ? a.value ?? true : null;
      dlg.remove();
      resolve(res);
    });
    if (onOpen) onOpen(dlg);
    dlg.showModal();
  });
}
function confirmDialog(title, message, { confirm = "Confirm", danger = false } = {}) {
  return modal({ title, body: `<p class="t-body muted-2">${esc(message)}</p>`,
    actions: [{ label: "Cancel", value: false }, { label: confirm, kind: danger ? "danger" : "primary", value: true, primary: true }] });
}

// ------------------------------------------------------------------ sound and speech
let _ctx = null;
function audioCtx() {
  if (!_ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; _ctx = new C(); }
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}
function tone(freq, at, dur, type = "sine", vol = 0.18) {
  const c = audioCtx(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + at);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  o.connect(g).connect(c.destination); o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.05);
}
function chime() { tone(659, 0, 0.5); tone(880, 0.22, 0.7); tone(1319, 0.44, 0.9, "sine", 0.12); }
function softPing() { tone(988, 0, 0.35, "sine", 0.12); }
function alarmBeep() { for (let i = 0; i < 4; i++) { tone(960, i * 0.5, 0.22, "square", 0.08); tone(720, i * 0.5 + 0.25, 0.22, "square", 0.08); } }
function speak(text, lang = "en-IN") {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = 0.92;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function spokenToken(t) { return String(t).split("").join(" "); }

// Page registry: each pages-*.js file adds { title, staff, full, render(el, params) → cleanup }.
const PAGES = {};

// ------------------------------------------------------------------ QR code (qrcode-generator from the CDN; a plain code box if offline)
function qrSvg(text, size = 132) {
  if (typeof qrcode !== "function") return `<div class="qr-fallback">${esc(text)}</div>`;
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), cell = size / (n + 8);
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${(c + 4) * cell},${(r + 4) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0f172a"/></svg>`;
}
