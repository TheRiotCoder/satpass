/* SatPass service worker (adapted from rf-toolbox) – offline app shell.
   VERSION is the single version string for the app (the About page reads it from the cache name). Bump it on every release. */
const VERSION = "satpass-v1.3.0";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/style.css",
  "js/vendor/satellite.min.js", "js/grid.js", "js/doppler.js", "js/format.js", "js/tle.js", "js/passes.js", "js/ics.js", "js/radio.js", "js/catalog.js", "js/sources.js",
  "js/biometric.js", "js/store.js", "js/draw.js", "js/app.js",
  "data/tle-snapshot.js", "data/world.js", "data/sar.js",
  "data/snap/sar.js", "data/snap/eo.js", "data/snap/nav.js", "data/snap/science.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))));
  if (!self.registration.active) self.skipWaiting(); // first install takes over immediately; updates wait for the user
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("satpass-") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("message", (event) => { if (event.data === "skipWaiting") self.skipWaiting(); });

// Only the active worker refreshes the cache, so a waiting (newer) worker's cache isn't mixed with old files and vice versa.
function isActiveWorker() { return self.registration.active === self.serviceWorker || !self.serviceWorker; }
function cachedShell() { return caches.match("index.html").then((r) => r || caches.match("./")); }

// Data-source requests (CelesTrak, Space-Track, SatNOGS, N2YO, the user's proxy) and anything carrying a credential are NEVER touched by the worker:
// no respondWith, no cache read or write. (N2YO keys can appear in a URL query, others travel in headers.)
const CRED_HEADERS = ["authorization", "x-spacetrack-identity", "x-spacetrack-password", "x-satnogs-token", "x-n2yo-key", "x-satpass-proxy-token"];
const API_HOSTS = /(^|\.)(celestrak\.org|space-track\.org|satnogs\.org|n2yo\.com|workers\.dev)$/i;
function bypass(req, url) {
  if (url.origin !== self.location.origin) return true;                                    // every cross-origin request, including the proxy
  if (API_HOSTS.test(url.hostname)) return true;
  if (/[?&](api_?key|token|password|identity|key)=/i.test(url.search)) return true;
  if (/^\/(spacetrack|satnogs|n2yo|health)(\/|$)/.test(url.pathname)) return true;      // proxy-style paths
  return CRED_HEADERS.some((h) => req.headers.has(h));
}
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || bypass(req, new URL(req.url))) return;

  // Cache-consistent per VERSION: every app file comes from the cache that this worker's install step filled (all with cache:"reload"), so the page
  // can never mix files of two releases. New releases arrive only through a new VERSION (the worker is re-checked on every start, when the app returns
  // to the foreground and hourly; the user then taps "Update"). Nothing is ever overwritten from the network after install; a file that is missing from the
  // cache (not listed in SHELL) is fetched once and added.
  const wantsShell = req.mode === "navigate";
  event.respondWith(
    (wantsShell ? cachedShell() : caches.match(req, { ignoreSearch: true })).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && !wantsShell && isActiveWorker()) { const copy = res.clone(); event.waitUntil(caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})); }
        return res;
      }, () => Response.error());
    })
  );
});

// Tapping a reminder notification focuses (or opens) the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate && c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
