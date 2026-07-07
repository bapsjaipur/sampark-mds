// src/hooks/useMapsLoader.js
// Loads the Google Maps JavaScript API (with the Places library) once per
// page session and returns a boolean `ready` flag.
// Uses a module-level promise so the <script> is only injected once even if
// multiple components call this hook at the same time.

let loadPromise = null;

export function loadMapsApi() {
  if (loadPromise) return loadPromise;
  if (window.google?.maps?.places) {
    loadPromise = Promise.resolve();
    return loadPromise;
  }
  loadPromise = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
    if (!key || key === "YOUR_GOOGLE_MAPS_API_KEY_HERE") {
      reject(new Error("VITE_GOOGLE_MAPS_API_KEY is not set"));
      loadPromise = null;
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load Google Maps API"));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}
