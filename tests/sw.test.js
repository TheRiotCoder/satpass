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
ok("VERSION constant is satpass-v1.2.0", /const VERSION = "satpass-v1\.2\.0"/.test(src));
done();
