// MedOS Web — router, app chrome (sidebar / mobile drawer / bottom tabs), emergency alarm bar.
"use strict";

(() => {
  const content = $("#content"), app = $("#app");
  let cleanup = null, lastAlerts = 0;

  load();
  startDaemon();
  hydrateIcons();
  $("#hosp-name").textContent = S.settings.hospital_name;

  // ---------------------------------------------------------------- theme
  const setThemeIcon = () => {
    const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    ["#theme-btn", "#theme-btn-m"].forEach((s) => { const b = $(s); const svg = $("svg", b); if (svg) svg.outerHTML = icon(dark ? "sun" : "moon"); });
    return dark;
  };
  const toggleTheme = () => {
    const dark = setThemeIcon();
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("medos.theme", document.documentElement.dataset.theme); } catch { /* private mode */ }
    setThemeIcon();
    route();   // maps read route colours from CSS variables
  };
  $("#theme-btn").addEventListener("click", toggleTheme);
  $("#theme-btn-m").addEventListener("click", toggleTheme);
  setThemeIcon();

  // ---------------------------------------------------------------- drawer (phones and tablets)
  const drawer = (open) => { app.classList.toggle("drawer-open", open); $("#menu-btn").setAttribute("aria-expanded", String(open)); };
  $("#menu-btn").addEventListener("click", () => drawer(true));
  $("#more-btn").addEventListener("click", () => drawer(true));
  $("#scrim").addEventListener("click", () => drawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") drawer(false); });

  // ---------------------------------------------------------------- router
  function parse() {
    const parts = (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean);
    if (!parts.length) return { name: "home", params: [] };
    if (parts[0] === "patient") return { name: parts[1] === "ambulance" ? "patient-ambulance" : parts[1] === "bookings" ? "patient-bookings" : "patient", params: [] };
    if (parts[0] === "p") return { name: "track", params: parts.slice(1) };   // the Pi version's /p/<code> links
    return { name: PAGES[parts[0]] ? parts[0] : "home", params: parts.slice(1) };
  }
  function route() {
    const { name, params } = parse();
    const page = PAGES[name];
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    drawer(false);
    app.classList.toggle("full", !!page.full);
    $$("[data-route]").forEach((a) => (a.dataset.route === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    $("#top-title").textContent = page.title;
    document.title = `${page.title} · MedOS`;
    content.innerHTML = "";
    const host = document.createElement("div");   // a fresh element per visit, so late callbacks see it disconnected
    content.appendChild(host);
    try { cleanup = page.render(host, params) || null; }
    catch (e) { console.error(e); content.innerHTML = `<div class="page"><div class="notice bad">${icon("octagon")}<div>This page failed to load: ${esc(e.message)}</div></div></div>`; }
    hydrateIcons(content);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  // ---------------------------------------------------------------- emergency alarm bar on staff screens
  function alarm() {
    const open = openAlerts();
    const { name } = parse();
    const show = open.length && (PAGES[name].staff || name === "display");
    $("#alarm-bar").classList.toggle("on", !!show);
    $("#alarm-text").textContent = open.length ? open[open.length - 1].message + (open.length > 1 ? ` (+${open.length - 1} more)` : "") : "";
    if (open.length > lastAlerts && show) alarmBeep();
    lastAlerts = open.length;
  }
  $("#alarm-ack").addEventListener("click", () => acknowledge(null, "staff"));
  onChange(() => { alarm(); $("#hosp-name").textContent = S.settings.hospital_name; });

  route();
  alarm();
})();
