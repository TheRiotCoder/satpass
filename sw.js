/* SatPass service worker (adapted from rf-toolbox) – offline app shell.
   VERSION is the single version string for the app (the About page reads it from the cache name). Bump it on every release. */
const VERSION = "satpass-v1.1.0";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/style.css",
  "js/vendor/satellite.min.js", "js/grid.js", "js/doppler.js", "js/format.js", "js/tle.js", "js/passes.js", "js/ics.js", "js/radio.js", "js/catalog.js",
  "js/store.js", "js/draw.js", "js/app.js",
  "data/tle-snapshot.js", "data/world.js", "data/sar.js",
  "data/snap/sar.js", "data/snap/eo.js", "data/snap/nav.js", "data/snap/science.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"
];
const NAV_TIMEOUT_MS = 3500; // on slow "lie-fi" connections fall back to the cached shell after this long

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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") { // network first with timeout, cached shell offline
    let settle;
    const refresh = new Promise((r) => { settle = r; });
    const network = fetch(req).then((res) => {
      if (res && res.ok && isActiveWorker()) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put("index.html", copy)).then(settle, settle);
      } else settle();
      return res;
    }, (err) => { settle(); throw err; });
    event.waitUntil(refresh);
    event.respondWith(new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
      const timer = setTimeout(() => cachedShell().then(finish), NAV_TIMEOUT_MS);
      network.then((res) => { clearTimeout(timer); finish(res); },
        () => { clearTimeout(timer); cachedShell().then((r) => { if (r) finish(r); else { done = true; resolve(Response.error()); } }); });
    }));
    return;
  }

  // static assets: cache first, refresh in the background (kept alive with waitUntil)
  const cachedP = caches.match(req, { ignoreSearch: true });
  const net = fetch(req).then((res) => {
    if (res && res.ok && isActiveWorker()) {
      const copy = res.clone();
      return caches.open(VERSION).then((c) => c.put(req, copy)).then(() => res);
    }
    return res;
  });
  event.waitUntil(net.then(() => {}, () => {}));
  event.respondWith(cachedP.then((cached) => cached || net.catch(() => cached || Response.error())));
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
