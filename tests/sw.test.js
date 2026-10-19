// sw.js fetch handler: credentialed / API requests are never intercepted (no respondWith, no cache read or write).
const { ok, done } = require("./harness"), fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const listeners = {}, cacheOps = [];
const self = { location: { origin: "https://theriotcoder.github.io" }, addEventListener: (t, f) => { listeners[t] = f; }, registration: { active: null }, clients: { claim() {} }, skipWaiting() {} };
const ctx = { self, caches: { open: async () => { cacheOps.push("open"); return { put: async () => cacheOps.push("put"), addAll: async () => {} }; }, match: async () => { cacheOps.push("match"); return undefined; }, keys: async () => [], delete: async () => true }, Request, Response, URL, Promise, fetch: async () => { cacheOps.push("fetch"); return new Response("x"); }, setTimeout, clearTimeout, console };
vm.createContext(ctx); vm.runInContext(src, ctx);
function fire(url, headers = {}, method = "GET", mode = "cors") {
  let responded = false; const before = cacheOps.length;
  const req = { url, method, mode, headers: new Headers(headers) };
  listeners.fetch({ request: req, respondWith: () => { responded = true; }, waitUntil: () => {} });
  return { responded, ops: cacheOps.slice(before) };
}
const B = "https://theriotcoder.github.io/satpass/";
const bypassed = [
  ["N2YO URL with apiKey", "https://api.n2yo.com/rest/v1/satellite/tle/25544&apiKey=SECRET"],
  ["same-origin URL with ?apiKey=", B + "x?apiKey=SECRET"],
  ["same-origin URL with ?token=", B + "x?token=SECRET"],
  ["Space-Track host", "https://www.space-track.org/basicspacedata/query/class/gp"],
  ["SatNOGS host", "https://db.satnogs.org/api/tle/"],
  ["CelesTrak host", "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json"],
  ["user's workers.dev proxy", "https://mine.workers.dev/spacetrack/gp?ids=25544"],
  ["any other cross-origin host", "https://proxy.example.com/health"],
  ["proxy-style path on the app origin", B.replace("/satpass/", "") + "/n2yo/tle?id=1"]
];
for (const [name, u] of bypassed) { const r = fire(u); ok("SW bypasses (no respondWith, no cache access): " + name, !r.responded && r.ops.length === 0, r); }
for (const h of ["Authorization", "X-N2YO-Key", "X-SpaceTrack-Password", "X-SpaceTrack-Identity", "X-SatNOGS-Token", "X-SatPass-Proxy-Token"]) { const r = fire(B + "data.json", { [h]: "secret" }); ok("SW bypasses same-origin request carrying header " + h, !r.responded && r.ops.length === 0); }
ok("SW bypasses non-GET", !fire(B + "css/style.css", {}, "POST").responded);
const normal = fire(B + "css/style.css");
ok("SW still serves ordinary same-origin assets (cache-first)", normal.responded === true);
const nav = fire(B, {}, "GET", "navigate");
ok("SW still handles navigations (offline shell)", nav.responded === true);
ok("VERSION constant is satpass-v1.3.13", /const VERSION = "satpass-v1\.3\.13"/.test(src));

// ---------- 1.2.1: cache-consistent per version (no overwrite from the network after install), update wiring
(async () => {
  const store = {}, netCalls = [], L = {};
  const mkRes = (body) => ({ ok: true, body, clone() { return mkRes(body); } });
  const cx = {
    self: { location: { origin: "https://theriotcoder.github.io" }, addEventListener: (t, f) => { L[t] = f; }, registration: { active: null }, clients: { claim() {} }, skipWaiting() {} },
    caches: { open: async (v) => ({ put: async (k, r) => { store[(k.url || k)] = r; }, addAll: async () => {} }), match: async (k) => store[(k.url || k)] || store["https://theriotcoder.github.io/satpass/" + k] || undefined, keys: async () => [], delete: async () => true },
    fetch: async (r) => { netCalls.push(r.url || r); return mkRes("NETWORK:" + (r.url || r)); }, Request: function (u) { this.url = u; }, Response: { error: () => ({ error: true }) }, URL, setTimeout, clearTimeout, Promise
  };
  vm.createContext(cx); vm.runInContext(src, cx);
  const B = "https://theriotcoder.github.io/satpass/";
  const go = (url, mode) => new Promise((resolve) => { let p = null; const req = { url, method: "GET", mode: mode || "cors", headers: new Headers() }; L.fetch({ request: req, respondWith: (x) => { p = Promise.resolve(x); }, waitUntil: () => {} }); resolve(p); }).then((p) => p);
  store[B + "js/app.js"] = mkRes("CACHED-APP-JS"); store["index.html"] = mkRes("CACHED-INDEX");
  const a = await go(B + "js/app.js"), b = await go(B + "js/app.js"), n = await go(B, "navigate");
  ok("static asset is served from the cache and never refreshed from the network on load", a.body === "CACHED-APP-JS" && b.body === "CACHED-APP-JS" && !netCalls.some((u) => /app\.js/.test(u)), netCalls);
  ok("navigation serves the cached shell without any network request or cache overwrite (no mixed old/new files)", n.body === "CACHED-INDEX" && netCalls.length === 0 && store["index.html"].body === "CACHED-INDEX");
  const miss = await go(B + "js/unlisted.js");
  ok("a file that is not in the cache is fetched once from the network and then added", miss.body.startsWith("NETWORK:") && netCalls.length === 1);
  ok("sw.js has no background re-fetch of cached files any more", !/refresh in the background|settle\(/.test(src) && /Cache-consistent per VERSION/.test(src));
  const app = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  ok("app: update bar is offered for an already-waiting worker (reg.waiting) and for a newly installed one", /reg\.waiting && navigator\.serviceWorker\.controller\) offerUpdate\(reg\.waiting\)/.test(app) && /nw\.state === "installed" && navigator\.serviceWorker\.controller\) offerUpdate\(nw\)/.test(app));
  ok("app: reg.update() runs when the app becomes visible again and about hourly", /visibilitychange[^}]*check\(\)/.test(app) && /setInterval\(check, 3600e3\)/.test(app) && /reg\.update\(\)/.test(app));
  ok("app: the update button posts skipWaiting to the waiting worker and sw.js honours it", /w\.postMessage\("skipWaiting"\)/.test(app) && /event\.data === "skipWaiting"\) self\.skipWaiting\(\)/.test(src));
  ok("app: malformed hash escapes cannot abort boot (safeDecode)", /function safeDecode/.test(app) && !/\.map\(decodeURIComponent\)/.test(app));
  // ---------- 1.3.5: a host that redirects /index.html -> / (Cloudflare Pages) must not leave a redirected response in the shell cache or serve one to a navigation
  {
    const store2 = {}, mk = (body, redirected) => { const r = new Response(body, { status: 200, headers: { "content-type": "text/html" } }); Object.defineProperty(r, "redirected", { value: !!redirected }); return r; };
    const L2 = {}, sw2 = { location: { origin: "https://satpass-3wj.pages.dev" }, addEventListener: (t, f) => { L2[t] = f; }, registration: { active: null }, clients: { claim() {} }, skipWaiting() {} };
    const RQ = function (u, o) { return new Request(new URL(u, "https://satpass-3wj.pages.dev/sw.js").href, o); }, c2 = { self: sw2, Response, Request: RQ, Headers, URL, Promise, Error, fetch: async (req) => mk("<html>" + (req.url || req) + "</html>", /index\.html$/.test(req.url || String(req))), caches: { open: async () => ({ put: async (k, r) => { store2[k] = r; } }), match: async (k) => store2[typeof k === "string" ? k : k.url], keys: async () => [] } };
    vm.createContext(c2); vm.runInContext(src, c2);
    let inst; L2.install({ waitUntil: (p) => { inst = p; } }); await inst;
    ok("1.3.5 install precaches the whole shell and none of the cached responses is a redirected one (index.html is redirected on Pages)", Object.keys(store2).length > 20 && Object.values(store2).every((r) => r.redirected === false) && /index\.html/.test(Object.keys(store2).join()));
    store2["index.html"] = mk("<html>old</html>", true);   // an entry cached by 1.3.4 is rebuilt before it is served
    let served; L2.fetch({ request: { url: "https://satpass-3wj.pages.dev/", method: "GET", mode: "navigate", headers: new Headers() }, respondWith: (p) => { served = p; }, waitUntil() {} }); served = await served;
    ok("1.3.5 a navigation is never answered with a redirected response (body preserved)", served.redirected === false && (await served.text()) === "<html>old</html>" && served.status === 200);
  }
  done();
})();

