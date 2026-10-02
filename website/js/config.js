// MedOS Web — site configuration.
//
// Maps: without a key the site uses an OpenStreetMap-based street map (CARTO Voyager tiles, Esri satellite)
// with real road routing from OSRM. Paste a Google Maps JavaScript API key below (Maps JavaScript,
// Directions and Distance Matrix APIs enabled) and every map switches to Google Maps with live traffic.
// "Open in Google Maps" navigation links work either way.
window.MEDOS_CONFIG = {
  googleMapsKey: "",
  // Region the demo hospitals are in. A visitor further away than radiusKm picks a pickup area instead
  // of using their GPS position, so the routes stay meaningful.
  region: { name: "Chennai", lat: 13.045, lng: 80.215, radiusKm: 60 },
  // Public OSRM server for road routing (no key). Swap for your own OSRM instance in production.
  osrmUrl: "https://router.project-osrm.org",
};
