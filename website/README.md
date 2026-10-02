# MedOS Web

The website version of MedOS. It works on desktop and phone, needs no build step and no server code, and runs entirely in the browser.

| Page | What it does |
|---|---|
| **Home** `#/` | Live queue numbers, every hospital on the map with doctors on duty, links to every screen |
| **Book a token** `#/patient` | Symptoms by voice or text → live triage → all 8 hospitals ranked by *time to a prescription* (travel, waiting there, consultation), doctors on duty listed, recommended hospital crowned, real road routes on the map |
| **Book an ambulance** `#/patient/ambulance` | Hold-for-SOS, nearest free ambulance, hospitals ranked by *time to treatment* (SJF), ambulance → you → hospital route |
| **Track** `#/track/<code>` | Token: position, wait, "leave in N min" advice, alert when close. Ambulance: live animated ambulance on the route, trip phases |
| **Reception** `#/reception` | Register by typing or voice, live triage with highlighted keywords, priority queue with aging bars, emergency hold-button, token slip with QR |
| **Voice intake** `#/voice` | Every spoken input recorded (transcript, extracted fields, audio clip) and listed in priority order |
| **Doctor**, **Pharmacy** (FCFS), **Ambulance desk**, **Waiting-room display**, **Admin** | As in the Pi version |
| **Scheduler Lab**, **How it works** | FCFS vs SJF vs priority vs aging vs pre-emption, and the OS concepts |

There is no sign-in: every page, patient and staff, opens directly.

## Run it

Any static web server works. From this folder:

```bash
python -m http.server 8000
```

Open http://localhost:8000. On a phone on the same Wi-Fi use `http://<laptop-ip>:8000`. The microphone and GPS need a secure page on phones: use HTTPS (any static host, such as GitHub Pages or Netlify) or `localhost`.

The Flask app serves it too: `python run.py`, then open http://localhost:8080/web/.

## Maps

- **Default (no key):** Esri street map and satellite imagery, with real road routes and drive times from OSRM. Drive times are adjusted for time of day (×1.9 at peak, ×1.5 daytime, ×1.2 at night).
- **Google Maps:** put a Google Maps JavaScript API key in `js/config.js` (`googleMapsKey`) with the Maps JavaScript, Directions and Distance Matrix APIs enabled. Every map then becomes Google Maps with live traffic.
- "Open in Google Maps" and "Navigate" buttons always open turn-by-turn directions in Google Maps.

The hospitals are fictional, placed in real Chennai neighbourhoods. A visitor more than 60 km from Chennai picks a pickup area or taps the map instead of using GPS.

## How the data works

All state lives in the browser's `localStorage`. Every open tab on the same device shares it live. For example, a doctor finishing in one tab updates the TV display in another. Audio clips are stored in IndexedDB on the device that recorded them. *Admin → Reload demo* resets everything.

City General's doctors and queue are the real MedOS scheduler running in the page. The other hospitals' doctors, queues and waits come from a simulated live feed that changes every 3 minutes.

## Files

```
index.html            app shell: sidebar on desktop, top bar + bottom tabs on phones
css/site.css          design tokens (light + dark), layout, components
js/config.js          Google Maps key, region, OSRM server
js/triage.js          rules triage + spoken check-in parser (ported from medos/triage.py, medos/voice.py)
js/store.js           scheduler, aging, pre-emption, ETA, pharmacy FCFS, ambulance SJF, hospital recommendation
js/voice.js           Web Speech recognition, audio recording, waveform, saved clips
js/maps.js            Leaflet / Google Maps views, OSRM / Google routing
js/pages-*.js         the pages
js/app.js             router, alarm bar
```

Voice recognition uses the browser's Web Speech API (Chrome, Edge, Safari). Firefox has none, so type there instead. MedOS is a teaching prototype, not a certified medical device.
