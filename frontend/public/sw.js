// Service Worker für Offline-PWA.
// Cacht die App-Shell (HTML/JS/CSS), sodass die App offline geladen werden kann.
// API-Anfragen werden bewusst NICHT gecacht (immer frisch vom Backend).

const CACHE_NAME = "naehrstoff-v__APP_VERSION__";
// "/" und "/index.html" liefern denselben Inhalt -> nur einmal cachen (Dedup).
const APP_SHELL = [
  "/index.html",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  // Per-Resource-Caching statt addAll: addAll schlägt atomar fehl, wenn EINE Resource
  // 404 liefert, was den gesamten Offline-Cache verhindern würde. Hier fährt der
  // Install auch mit partieller Shell durch (Stale-while-revalidate füllt nach).
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try { await cache.add(url); } catch (e) { /* einzeln tolerieren */ }
        })
      );
      // Start-URL "/" explizit als index.html-Alias vorcachen.
      try { await cache.add("/"); } catch (e) { /* ignore */ }
      self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Nur GET cachen; API/OAuth/extern nie cachen.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/oauth")) return;
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate für statische Assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
