// MedOS Web — maps and road routing.
//
// Two providers behind one small interface:
//   • Google Maps JavaScript API (when MEDOS_CONFIG.googleMapsKey is set): Google's map, Directions with
//     live traffic, Distance Matrix.
//   • Leaflet (default, no key): CARTO Voyager street map + Esri satellite, real road routes from OSRM.
// If routing is unreachable, a curved estimate (straight line × 1.3 at city speed) keeps the page working.
"use strict";

const Maps = (() => {
  const cfg = window.MEDOS_CONFIG || {};
  const useGoogle = !!cfg.googleMapsKey;
  let googleReady = null;

  function loadGoogle() {
    if (googleReady) return googleReady;
    googleReady = new Promise((res, rej) => {
      window.__medosGmaps = () => res(window.google.maps);
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.googleMapsKey)}&callback=__medosGmaps&loading=async&libraries=geometry`;
      s.async = true; s.onerror = () => rej(new Error("Google Maps failed to load"));
      document.head.appendChild(s);
    });
    return googleReady;
  }
  const provider = () => (useGoogle ? "google" : "osm");

  // ---------------------------------------------------------------- routing
  const cache = new Map();
  const key = (a, b) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

  function curvedPath(a, b, n = 24) {
    // a gentle arc so estimated routes don't look like ruler lines
    const mx = (a.lat + b.lat) / 2, my = (a.lng + b.lng) / 2;
    const dx = b.lat - a.lat, dy = b.lng - a.lng;
    const c = { lat: mx - dy * 0.18, lng: my + dx * 0.18 };
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * a.lat + 2 * u * t * c.lat + t * t * b.lat, u * u * a.lng + 2 * u * t * c.lng + t * t * b.lng]);
    }
    return pts;
  }
  function estimate(a, b) {
    const km = haversineKm(a, b) * 1.3;
    return { coords: curvedPath(a, b), freeFlowMin: (km / 40) * 60, km, source: "estimate" };
  }
  function simplify(coords, max = 260) {
    if (coords.length <= max) return coords;
    const step = coords.length / max, out = [];
    for (let i = 0; i < coords.length; i += step) out.push(coords[Math.floor(i)]);
    out.push(coords[coords.length - 1]);
    return out;
  }

  // route(a, b) → {coords:[[lat,lng]], freeFlowMin, trafficMin?, km, source}
  async function route(a, b) {
    const k = key(a, b);
    if (cache.has(k)) return cache.get(k);
    const p = (async () => {
      if (useGoogle) {
        try {
          const g = await loadGoogle();
          const svc = new g.DirectionsService();
          const r = await svc.route({ origin: a, destination: b, travelMode: "DRIVING", drivingOptions: { departureTime: new Date(), trafficModel: "best_guess" } });
          const leg = r.routes[0].legs[0];
          return { coords: simplify(r.routes[0].overview_path.map((p) => [p.lat(), p.lng()])), freeFlowMin: leg.duration.value / 60,
            trafficMin: leg.duration_in_traffic ? leg.duration_in_traffic.value / 60 : null, km: leg.distance.value / 1000, source: "google" };
        } catch (e) { console.warn("Google directions failed, trying OSRM", e); }
      }
      try {
        const url = `${cfg.osrmUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 7000);
        const r = await fetch(url, { signal: ctl.signal }).then((x) => x.json());
        clearTimeout(to);
        if (r.code !== "Ok") throw new Error(r.code);
        const rt = r.routes[0];
        return { coords: simplify(rt.geometry.coordinates.map(([lng, lat]) => [lat, lng])), freeFlowMin: rt.duration / 60, km: rt.distance / 1000, source: "osrm" };
      } catch (e) { console.warn("OSRM route failed, using an estimate", e); return estimate(a, b); }
    })();
    cache.set(k, p);
    p.then((r) => { if (r.source === "estimate") cache.delete(k); });
    return p;
  }

  // matrix(origin, dests) → [{freeFlowMin, trafficMin?, km, source}] in one request
  async function matrix(origin, dests) {
    if (useGoogle) {
      try {
        const g = await loadGoogle();
        const svc = new g.DistanceMatrixService();
        const r = await svc.getDistanceMatrix({ origins: [origin], destinations: dests, travelMode: "DRIVING", drivingOptions: { departureTime: new Date(), trafficModel: "best_guess" } });
        return r.rows[0].elements.map((el, i) => el.status === "OK"
          ? { freeFlowMin: el.duration.value / 60, trafficMin: el.duration_in_traffic ? el.duration_in_traffic.value / 60 : null, km: el.distance.value / 1000, source: "google" }
          : estimate(origin, dests[i]));
      } catch (e) { console.warn("Distance matrix failed", e); }
    }
    try {
      const pts = [origin, ...dests].map((p) => `${p.lng},${p.lat}`).join(";");
      const url = `${cfg.osrmUrl}/table/v1/driving/${pts}?sources=0&annotations=duration,distance`;
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(url, { signal: ctl.signal }).then((x) => x.json());
      clearTimeout(to);
      if (r.code !== "Ok") throw new Error(r.code);
      return dests.map((d, i) => (r.durations[0][i + 1] == null ? estimate(origin, d)
        : { freeFlowMin: r.durations[0][i + 1] / 60, km: r.distances[0][i + 1] / 1000, source: "osrm" }));
    } catch (e) { console.warn("OSRM table failed, using estimates", e); return dests.map((d) => estimate(origin, d)); }
  }

  // Free-flow road time → expected time now. Google gives live traffic; otherwise apply the time-of-day factor.
  function travelMinutes(r, { siren = false } = {}) {
    const tf = trafficFactor();
    let min = r.trafficMin != null ? r.trafficMin : r.freeFlowMin * (r.source === "estimate" ? 1 : tf.f);
    if (r.source === "estimate") min = (r.km / (40 / tf.f)) * 60;
    if (siren) min *= 0.7;
    return Math.max(1, Math.round(min + 1));
  }
  const sourceLabel = (s) => ({ google: "Google live traffic", osrm: "road route (OSRM) + traffic", estimate: "straight-line estimate" }[s] || s);

  function googleMapsLink(from, to, mode = "driving") {
    return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode}`;
  }
  function googlePlaceLink(p) { return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`; }

  // ---------------------------------------------------------------- map views
  // create(el, {center, zoom}) → view with: setOrigin, addHospital, clearRoutes, drawRoute, fit, vehicle, onClick, setStyle, destroy
  function create(el, opts = {}) {
    return guard(useGoogle ? googleView(el, opts) : leafletView(el, opts));
  }
  // After destroy(), late route callbacks and timers become no-ops instead of touching a removed map.
  function guard(view) {
    let dead = false;
    const out = { get kind() { return view.kind; }, get map() { return view.map; }, get style() { return view.style; } };
    for (const k of Object.keys(view)) {
      const d = Object.getOwnPropertyDescriptor(view, k);
      if (typeof d.value !== "function") continue;
      out[k] = (...a) => {
        if (dead) return k === "vehicle" ? { move() {}, remove() {} } : undefined;
        if (k === "destroy") dead = true;
        try { return d.value.apply(view, a); } catch (e) { if (!dead) console.error(e); return k === "vehicle" ? { move() {}, remove() {} } : undefined; }
      };
    }
    return out;
  }

  function hospitalPinHtml(h, { badge, rank, best, dim } = {}) {
    return `<div class="hpin ${best ? "best" : ""} ${dim ? "dim" : ""}">
      <div class="hpin-head">${best ? icon("crown") : rank ? `<b>${rank}</b>` : icon("hospital")}</div>
      ${badge ? `<div class="hpin-badge">${esc(badge)}</div>` : ""}
    </div>`;
  }

  function leafletView(el, { center = cfg.region, zoom = 12 } = {}) {
    if (typeof L === "undefined") { el.innerHTML = `<div class="map-offline">${icon("pin")}<p>The map needs an internet connection.</p></div>`; return nullView(); }
    const map = L.map(el, { zoomControl: false, attributionControl: true, tap: true }).setView([center.lat, center.lng], zoom);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const street = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: 'Tiles &copy; Esri — Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
    const sat = L.layerGroup([
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery &copy; Esri" }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, opacity: 0.6 }),
    ]);
    street.addTo(map);
    let style = "street";
    const routes = L.layerGroup().addTo(map), pins = L.layerGroup().addTo(map), extra = L.layerGroup().addTo(map);
    let origin = null, comets = [];
    setTimeout(() => map.invalidateSize(), 60);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    const view = {
      kind: "leaflet", map,
      setStyle(s) { style = s; if (s === "satellite") { map.removeLayer(street); sat.addTo(map); } else { map.removeLayer(sat); street.addTo(map); } },
      get style() { return style; },
      setOrigin(p, label = "You") {
        if (origin) map.removeLayer(origin);
        origin = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: `<div class="me-dot"><span></span><em>${esc(label)}</em></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 900 }).addTo(map);
      },
      clearPins() { pins.clearLayers(); },
      addHospital(h, o = {}) {
        const m = L.marker([h.lat, h.lng], { icon: L.divIcon({ className: "", html: hospitalPinHtml(h, o), iconSize: [40, 48], iconAnchor: [20, 46] }), zIndexOffset: o.best ? 800 : o.dim ? 0 : 400, title: h.name }).addTo(pins);
        if (o.onClick) m.on("click", () => o.onClick(h));
        if (o.tooltip) m.bindTooltip(o.tooltip, { direction: "top", offset: [0, -44], className: "map-tip" });
        return m;
      },
      addPoint(p, html, size = [30, 30]) {
        return L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] }), zIndexOffset: 1000 }).addTo(extra);
      },
      clearRoutes() { routes.clearLayers(); comets.forEach((c) => c.stop()); comets = []; },
      clearExtra() { extra.clearLayers(); },
      // style: best | alt | leg1 | leg2 | faint
      drawRoute(coords, kind = "best", { onClick, tooltip } = {}) {
        const varName = { best: "--route", alt: "--route-alt", faint: "--route-alt", leg1: "--route-leg1", leg2: "--route-leg2" }[kind];
        const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || "#0e7490";
        const ls = [];
        if (kind === "best" || kind === "leg1" || kind === "leg2") {
          ls.push(L.polyline(coords, { color: "#ffffff", weight: 10, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false }));
          ls.push(L.polyline(coords, { color, weight: 6, opacity: 1, lineCap: "round", lineJoin: "round" }));
          ls.push(L.polyline(coords, { color: "#ffffff", weight: 2.5, opacity: 0.9, dashArray: "1 14", lineCap: "round", className: "route-flow", interactive: false }));
        } else {
          ls.push(L.polyline(coords, { color, weight: kind === "faint" ? 3 : 4.5, opacity: kind === "faint" ? 0.45 : 0.75, dashArray: "8 8", lineCap: "round" }));
        }
        ls.forEach((l) => l.addTo(routes));
        if (onClick) ls.forEach((l) => l.on("click", onClick));
        if (tooltip) ls[ls.length - 1].bindTooltip(tooltip, { sticky: true, className: "map-tip" });
        if (kind === "best") comets.push(comet(coords));
        return ls;
      },
      fit(points, pad = 40) {
        const b = L.latLngBounds(points.map((p) => [p.lat ?? p[0], p.lng ?? p[1]]));
        if (b.isValid()) map.fitBounds(b, { padding: [pad, pad], maxZoom: 15 });
      },
      vehicle(p, html) {
        const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html, iconSize: [40, 40], iconAnchor: [20, 20] }), zIndexOffset: 1200 }).addTo(extra);
        return { move(q) { m.setLatLng([q.lat, q.lng]); }, remove() { extra.removeLayer(m); } };
      },
      onClick(fn) { map.on("click", (e) => fn({ lat: e.latlng.lat, lng: e.latlng.lng })); },
      panTo(p) { map.panTo([p.lat, p.lng]); },
      destroy() { comets.forEach((c) => c.stop()); ro.disconnect(); map.remove(); },
    };
    // a glowing dot that runs along the recommended route, showing the direction of travel
    function comet(coords) {
      const m = L.circleMarker(coords[0], { radius: 6, color: "#fff", weight: 2, fillColor: "#fff", fillOpacity: 1, className: "comet", interactive: false }).addTo(routes);
      let raf, t0 = performance.now();
      const dur = Math.max(2500, Math.min(7000, coords.length * 40));
      const tick = (now) => {
        const f = ((now - t0) % dur) / dur;
        const p = pointAlong(coords, f);
        m.setLatLng([p.lat, p.lng]);
        raf = requestAnimationFrame(tick);
      };
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) raf = requestAnimationFrame(tick);
      return { stop() { cancelAnimationFrame(raf); } };
    }
    return view;
  }

  function googleView(el, { center = cfg.region, zoom = 12 } = {}) {
    el.innerHTML = `<div class="map-loading">${icon("pin")} Loading Google Maps…</div>`;
    const q = [];   // calls made before the API is ready
    let g, map, origin = null, pins = [], routes = [], extra = [], timers = [];
    const ready = loadGoogle().then((gm) => {
      g = gm;
      el.innerHTML = "";
      map = new g.Map(el, { center, zoom, disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy", clickableIcons: false,
        styles: [{ featureType: "poi.business", stylers: [{ visibility: "off" }] }] });
      new g.TrafficLayer().setMap(map);
      q.splice(0).forEach((f) => f());
    }).catch((e) => { el.innerHTML = `<div class="map-offline">${icon("pin")}<p>${esc(e.message)}</p></div>`; });
    const later = (f) => (map ? f() : q.push(f));
    const svgPin = (o) => {
      const fill = o.best ? "#0e7490" : o.dim ? "#94a3b8" : "#0f172a";
      const label = o.best ? "★" : o.rank || "H";
      return { url: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="M20 47s15-14 15-27A15 15 0 0 0 5 20c0 13 15 27 15 27z" fill="${fill}" stroke="#fff" stroke-width="2.5"/><text x="20" y="25" font-family="Arial" font-weight="700" font-size="14" fill="#fff" text-anchor="middle">${label}</text></svg>`),
        scaledSize: new g.Size(40, 48), anchor: new g.Point(20, 46), labelOrigin: new g.Point(20, -8) };
    };
    const view = {
      kind: "google", get map() { return map; },
      setStyle(s) { later(() => map.setMapTypeId(s === "satellite" ? "hybrid" : "roadmap")); view._style = s; },
      get style() { return view._style || "street"; },
      setOrigin(p, label = "You") {
        later(() => {
          if (origin) origin.setMap(null);
          origin = new g.Marker({ position: p, map, zIndex: 900, title: label,
            icon: { path: g.SymbolPath.CIRCLE, scale: 9, fillColor: "#2563eb", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 } });
        });
      },
      clearPins() { later(() => { pins.forEach((m) => m.setMap(null)); pins = []; }); },
      addHospital(h, o = {}) {
        later(() => {
          const m = new g.Marker({ position: { lat: h.lat, lng: h.lng }, map, title: h.name, icon: svgPin(o), zIndex: o.best ? 800 : 400,
            label: o.badge ? { text: o.badge, fontWeight: "700", fontSize: "12px", color: o.best ? "#0e7490" : "#0f172a", className: "gm-badge" } : null });
          if (o.onClick) m.addListener("click", () => o.onClick(h));
          pins.push(m);
        });
      },
      addPoint(p, html) { later(() => extra.push(new g.Marker({ position: p, map, zIndex: 1000, icon: { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: "#dc2626", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 } }))); },
      clearRoutes() { later(() => { routes.forEach((l) => l.setMap(null)); routes = []; timers.forEach(clearInterval); timers = []; }); },
      clearExtra() { later(() => { extra.forEach((m) => m.setMap(null)); extra = []; }); },
      drawRoute(coords, kind = "best", { onClick } = {}) {
        later(() => {
          const path = coords.map(([lat, lng]) => ({ lat, lng }));
          const color = { best: "#0e7490", alt: "#64748b", faint: "#94a3b8", leg1: "#d97706", leg2: "#dc2626" }[kind];
          if (kind === "best" || kind === "leg1" || kind === "leg2") {
            routes.push(new g.Polyline({ path, map, strokeColor: "#ffffff", strokeWeight: 10, strokeOpacity: 0.95, zIndex: 5 }));
            const line = new g.Polyline({ path, map, strokeColor: color, strokeWeight: 6, zIndex: 6,
              icons: [{ icon: { path: g.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.6, strokeColor: "#fff", fillColor: "#fff", fillOpacity: 1 }, offset: "0%", repeat: "70px" }] });
            routes.push(line);
            let off = 0;
            timers.push(setInterval(() => { off = (off + 1) % 70; const ic = line.get("icons"); ic[0].offset = off + "px"; line.set("icons", ic); }, 40));
            if (onClick) line.addListener("click", onClick);
          } else {
            const line = new g.Polyline({ path, map, strokeOpacity: 0, zIndex: 3,
              icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: kind === "faint" ? 0.45 : 0.8, strokeColor: color, scale: 3 }, offset: "0", repeat: "14px" }] });
            routes.push(line);
            if (onClick) line.addListener("click", onClick);
          }
        });
      },
      fit(points, pad = 40) {
        later(() => { const b = new g.LatLngBounds(); points.forEach((p) => b.extend({ lat: p.lat ?? p[0], lng: p.lng ?? p[1] })); map.fitBounds(b, pad); });
      },
      vehicle(p) {
        let m = null;
        later(() => { m = new g.Marker({ position: p, map, zIndex: 1200, icon: { url: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#dc2626" stroke="#fff" stroke-width="3"/><text x="20" y="26" font-size="18" text-anchor="middle" fill="#fff">✚</text></svg>`), scaledSize: new g.Size(40, 40), anchor: new g.Point(20, 20) } }); });
        return { move(q) { if (m) m.setPosition(q); }, remove() { if (m) m.setMap(null); } };
      },
      onClick(fn) { later(() => map.addListener("click", (e) => fn({ lat: e.latLng.lat(), lng: e.latLng.lng() }))); },
      panTo(p) { later(() => map.panTo(p)); },
      destroy() { timers.forEach(clearInterval); },
    };
    void ready;
    return view;
  }

  function nullView() {
    const noop = () => {};
    return { kind: "none", setStyle: noop, setOrigin: noop, clearPins: noop, addHospital: noop, addPoint: noop, clearRoutes: noop, clearExtra: noop,
      drawRoute: noop, fit: noop, vehicle: () => ({ move: noop, remove: noop }), onClick: noop, panTo: noop, destroy: noop };
  }

  // Map chrome: style switch (street / satellite), locate button, provider badge.
  function chrome(host, view, { onLocate } = {}) {
    const bar = document.createElement("div");
    bar.className = "map-tools";
    bar.innerHTML = `<div class="seg seg-sm" role="group" aria-label="Map style">
        <button type="button" data-s="street" aria-pressed="true">Map</button><button type="button" data-s="satellite" aria-pressed="false">Satellite</button></div>
      ${onLocate ? `<button type="button" class="map-btn" data-locate aria-label="Use my location">${icon("locate")}</button>` : ""}`;
    host.appendChild(bar);
    const badge = document.createElement("div");
    badge.className = "map-provider";
    badge.textContent = useGoogle ? "Google Maps · live traffic" : "OpenStreetMap · OSRM routing";
    host.appendChild(badge);
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.s) { view.setStyle(b.dataset.s); $$("[data-s]", bar).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
      if (b.hasAttribute("data-locate")) onLocate();
    });
  }

  // GPS position if the visitor is in the region, else null.
  function locate() {
    return new Promise((res) => {
      if (!navigator.geolocation) return res({ error: "This browser can't share its location." });
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          const d = haversineKm(p, cfg.region);
          if (d > cfg.region.radiusKm) return res({ error: `You're ${Math.round(d)} km from ${cfg.region.name}, where the demo hospitals are. Pick a pickup area or tap the map instead.`, far: p });
          res({ point: p });
        },
        (e) => res({ error: e.code === 1 ? "Location permission was denied. Pick an area or tap the map." : "Couldn't get your location. Pick an area or tap the map." }),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }

  return { provider, route, matrix, travelMinutes, sourceLabel, googleMapsLink, googlePlaceLink, create, chrome, locate, useGoogle };
})();
