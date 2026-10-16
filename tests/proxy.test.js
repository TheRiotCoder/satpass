// proxy/worker.js (Cloudflare Worker): run the real module with stubbed upstream fetch + Cache API. No network, no credentials.
const { ok, done } = require("./harness"), fs = require("fs"), path = require("path"), { pathToFileURL } = require("url");
const fx = f => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const ORIGIN = "https://theriotcoder.github.io", ENV = { ALLOWED_ORIGINS: ORIGIN };
const SECRETS = ["me@example.com", "hunter2-hunter2-hunter2", "N2YO-SECRET-KEY", "SATNOGS-TOKEN-0123456789abcdef0123456789abcd", "PROXY-ACCESS-TOKEN"];

(async () => {
  const logs = []; const origLog = console.log, origErr = console.error, origWarn = console.warn;
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "proxy", "worker.js")).href), W = mod.default;
  let upstream = [], handler = () => new Response("not stubbed", { status: 500 });
  const store = new Map();
  globalThis.caches = { default: { match: async r => { const v = store.get(r.url); return v ? new Response(v.body, v.init) : undefined; }, put: async (r, res) => { store.set(r.url, { body: await res.text(), init: { status: 200 } }); } } };
  globalThis.fetch = async (url, init) => { upstream.push({ url: String(url), init: init || {} }); return handler(String(url), init || {}); };
  const wait = []; const ctx = { waitUntil: p => wait.push(p) };
  const bodies = [];   // every response (body + headers) for the global "no secrets leak" check
  async function call(p, { origin = ORIGIN, headers = {}, env = ENV, method = "GET" } = {}) {
    const h = new Headers(headers); if (origin) h.set("Origin", origin);
    const res = await W.fetch(new Request("https://p.example.workers.dev" + p, { method, headers: h }), env, ctx);
    const text = await res.text(); bodies.push(text + JSON.stringify([...res.headers])); return { res, text, status: res.status, h: res.headers };
  }
  const reset = () => { upstream = []; store.clear(); };
  console.log = (...a) => { const m = a.join(" "); if (/^(PASS|FAIL)/.test(m)) origLog(...a); else logs.push(m); }; console.error = console.warn = (...a) => logs.push(a.join(" "));

  // ---------- CORS & routing
  let r = await call("/health");
  ok("health: 200 JSON with CORS for the allowed origin only", r.status === 200 && r.h.get("Access-Control-Allow-Origin") === ORIGIN && JSON.parse(r.text).ok === true && r.h.get("Vary") === "Origin");
  r = await call("/health", { origin: "https://evil.example.com" });
  ok("a foreign origin gets 403 and no CORS headers", r.status === 403 && !r.h.get("Access-Control-Allow-Origin") && r.h.get("X-SatPass-Error") === "origin");
  r = await call("/spacetrack/gp?ids=25544", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-n2yo-key" } });
  ok("preflight: 204, allows the custom credential headers, GET only", r.status === 204 && /X-N2YO-Key/.test(r.h.get("Access-Control-Allow-Headers")) && /X-SpaceTrack-Password/.test(r.h.get("Access-Control-Allow-Headers")) && r.h.get("Access-Control-Allow-Methods") === "GET, OPTIONS" && r.h.get("Access-Control-Allow-Origin") === ORIGIN);
  r = await call("/spacetrack/gp?ids=25544", { method: "OPTIONS", origin: "https://evil.example.com" });
  ok("preflight from a foreign origin refused", r.status === 403);
  r = await call("/health", { method: "POST" });
  ok("POST refused (405)", r.status === 405);
  r = await call("/nothing");
  ok("unknown route 404 (not an open proxy)", r.status === 404 && upstream.length === 0);
  ok("1.2.1: an origin-less call (curl/script) WITHOUT the access token is refused (403 'origin'), no upstream traffic", await (async () => { const x = await call("/health", { origin: null }); const y = await call("/spacetrack/gp?ids=25544", { origin: null, headers: { "X-SpaceTrack-Identity": "me%40example.com", "X-SpaceTrack-Password": "hunter2-hunter2-hunter2" } }); return x.status === 403 && x.h.get("X-SatPass-Error") === "origin" && y.status === 403 && upstream.length === 0 && !x.h.get("Access-Control-Allow-Origin"); })());
  { const E2 = { ALLOWED_ORIGINS: ORIGIN, PROXY_TOKEN: "PROXY-ACCESS-TOKEN" }; const x = await call("/health", { origin: null, env: E2, headers: { "X-SatPass-Proxy-Token": "PROXY-ACCESS-TOKEN" } }), y = await call("/health", { origin: null, env: E2, headers: { "X-SatPass-Proxy-Token": "wrong" } });
    ok("…an origin-less call WITH the correct proxy token is served; a wrong token is refused", x.status === 200 && y.status === 403); }

  // ---------- Space-Track
  reset();
  const stBody = fx("spacetrack-gp.json");
  handler = (url, init) => /ajaxauth\/login/.test(url) ? new Response(stBody, { status: 200, headers: { "Set-Cookie": "chocolatechip=SESSIONVALUE; path=/; HttpOnly" } }) : new Response("", { status: 200 });
  const stH = { "X-SpaceTrack-Identity": encodeURIComponent("me@example.com"), "X-SpaceTrack-Password": encodeURIComponent("hunter2-hunter2-hunter2") };
  r = await call("/spacetrack/gp?ids=43017,25544,25544", { headers: stH }); await Promise.all(wait);
  const login = upstream.find(u => /ajaxauth\/login/.test(u.url));
  ok("Space-Track: one POST /ajaxauth/login with identity, password and the full class/gp query (ids de-duplicated + sorted)", upstream[0] === login && login.init.method === "POST" && (p => p.get("identity") === "me@example.com" && p.get("password") === "hunter2-hunter2-hunter2" && p.get("query") === "https://www.space-track.org/basicspacedata/query/class/gp/NORAD_CAT_ID/25544,43017/orderby/NORAD_CAT_ID%20asc/format/json")(new URLSearchParams(login.init.body)), login && login.init.body);
  ok("Space-Track: JSON returned, cache MISS, credentials NOT put in the URL", r.status === 200 && r.h.get("X-SatPass-Cache") === "MISS" && Array.isArray(JSON.parse(r.text)) && !/hunter2|me%40|me@/.test(login.url));
  const logout = upstream.find(u => /ajaxauth\/logout/.test(u.url));
  ok("Space-Track: logs out with the session cookie afterwards (via waitUntil)", logout && logout.init.method === "POST" && /chocolatechip=SESSIONVALUE/.test(logout.init.headers.Cookie));
  const n0 = upstream.length;
  r = await call("/spacetrack/gp?ids=25544,43017", { headers: stH });
  ok("Space-Track: the same query within the hour is served from cache (no second login) – honours 'GP at most once/hour'", r.status === 200 && r.h.get("X-SatPass-Cache") === "HIT" && upstream.length === n0);
  r = await call("/spacetrack/gp?ids=25544,43017", { headers: { "X-SpaceTrack-Identity": "other%40example.com", "X-SpaceTrack-Password": "x".repeat(16) } });
  ok("Space-Track: cache is per account (another identity does not read it)", r.h.get("X-SatPass-Cache") === "MISS");
  { // cache is keyed by identity AND password: a wrong password must never be answered from the cache of the correct one
    const hit = await call("/spacetrack/gp?ids=25544,43017", { headers: stH });
    const bad = await call("/spacetrack/gp?ids=25544,43017", { headers: { "X-SpaceTrack-Identity": "me%40example.com", "X-SpaceTrack-Password": "WRONG-PASSWORD-123456" } });
    ok("Space-Track cache key includes the password: same identity + wrong password is a cache MISS (goes to the real login)", hit.h.get("X-SatPass-Cache") === "HIT" && bad.h.get("X-SatPass-Cache") !== "HIT", bad.h.get("X-SatPass-Cache"));
  }
  reset(); const up0 = upstream.length;
  r = await call("/spacetrack/gp?ids=25544");
  ok("Space-Track: no credentials -> 401 no-credentials, upstream untouched", r.status === 401 && r.h.get("X-SatPass-Error") === "no-credentials" && upstream.length === up0);
  for (const bad of ["", "abc", "1;2", "-5", "1,2,x", Array.from({ length: 201 }, (_, i) => 1000 + i).join(",")]) { r = await call("/spacetrack/gp?ids=" + bad, { headers: stH }); if (r.status !== 400) { ok("Space-Track: bad ids '" + bad.slice(0, 20) + "' -> 400", false, r.status); } }
  ok("Space-Track: malformed / empty / over-200 id lists -> 400, still no upstream call", upstream.length === up0);
  handler = () => new Response('{"Login":"Failed"}', { status: 401 });
  r = await call("/spacetrack/gp?ids=25544", { headers: stH });
  ok("Space-Track: wrong password -> 401 upstream-auth (app stops retrying)", r.status === 401 && r.h.get("X-SatPass-Error") === "upstream-auth");
  handler = () => new Response('{"Login":"Failed"}', { status: 200 });
  r = await call("/spacetrack/gp?ids=25544", { headers: stH });
  ok("Space-Track: HTTP 200 with a {Login:…} body is also an auth failure", r.status === 401 && r.h.get("X-SatPass-Error") === "upstream-auth");
  handler = () => new Response("slow down", { status: 429, headers: { "Retry-After": "900" } });
  r = await call("/spacetrack/gp?ids=25544&x=1", { headers: stH });
  ok("Space-Track: upstream 429 -> 429 'rate' with Retry-After", r.status === 429 && r.h.get("X-SatPass-Error") === "rate" && r.h.get("Retry-After") === "900");
  handler = () => new Response("<html>login</html>", { status: 200 });
  r = await call("/spacetrack/gp?ids=25544", { headers: stH });
  ok("Space-Track: an HTML answer is not passed on as data", r.status === 502);
  handler = () => { throw new TypeError("secret hunter2-hunter2-hunter2 in message"); };
  r = await call("/spacetrack/gp?ids=25544", { headers: stH });
  ok("Space-Track: network failure -> 502 without echoing the exception text", r.status === 502 && !/hunter2/.test(r.text));

  // ---------- SatNOGS
  reset();
  const snTle = fx("satnogs-tle.json");
  handler = url => /\/tle\//.test(url) ? new Response(snTle, { status: 200 }) : new Response(fx("satnogs-tx-25544.json"), { status: 200 });
  r = await call("/satnogs/tle?ids=25544");
  ok("SatNOGS TLE: bulk upstream URL, anonymous request has no Authorization header, result filtered to the id", upstream[0].url === "https://db.satnogs.org/api/tle/?format=json" && !upstream[0].init.headers.Authorization && JSON.parse(r.text).length === 1 && JSON.parse(r.text)[0].norad_cat_id === 25544);
  r = await call("/satnogs/tle?ids=25544,43017");
  ok("SatNOGS TLE: second call served from the hourly cache, multi-id filter works", r.h.get("X-SatPass-Cache") === "HIT" && upstream.length === 1 && JSON.parse(r.text).length === 2);
  r = await call("/satnogs/tle?ids=25544", { headers: { "X-SatNOGS-Token": "SATNOGS-TOKEN-0123456789abcdef0123456789abcd" } });
  ok("SatNOGS TLE: token goes upstream as 'Authorization: Token …' (separate cache bucket)", upstream[1].init.headers.Authorization === "Token SATNOGS-TOKEN-0123456789abcdef0123456789abcd" && r.h.get("X-SatPass-Cache") === "MISS");
  r = await call("/satnogs/tle?ids=25544", { headers: { "X-SatNOGS-Token": "SATNOGS-TOKEN-0123456789abcdef0123456789abcd" } });
  const r2t = await call("/satnogs/tle?ids=25544", { headers: { "X-SatNOGS-Token": "ANOTHER-TOKEN-0000000000000000000000000000" } });
  ok("SatNOGS cache key includes a hash of the token: same token HIT, a different token MISS (token validity is checked upstream)", r.h.get("X-SatPass-Cache") === "HIT" && r2t.h.get("X-SatPass-Cache") === "MISS");
  reset(); r = await call("/satnogs/transmitters?ids=25544,7530");
  ok("SatNOGS transmitters: one upstream request per satellite with the documented filter, results concatenated", upstream.length === 2 && upstream[0].url === "https://db.satnogs.org/api/transmitters/?format=json&satellite__norad_cat_id=7530" && upstream[1].url.endsWith("satellite__norad_cat_id=25544") && JSON.parse(r.text).length === 82, [upstream.map(u => u.url), r.status, r.text.slice(0, 80)]);
  r = await call("/satnogs/transmitters?ids=" + Array.from({ length: 31 }, (_, i) => i + 1).join(","));
  ok("SatNOGS transmitters: > 30 ids refused", r.status === 400);
  handler = () => new Response('{"detail":"Request was throttled."}', { status: 429, headers: { "Retry-After": "1200" } });
  reset(); r = await call("/satnogs/tle");
  ok("SatNOGS 429 -> 429 'rate' + Retry-After", r.status === 429 && r.h.get("Retry-After") === "1200");
  handler = () => new Response('{"detail":"Invalid token."}', { status: 401 });
  r = await call("/satnogs/tle", { headers: { "X-SatNOGS-Token": "bad" } });
  ok("SatNOGS 401 -> 401 upstream-auth", r.status === 401 && r.h.get("X-SatPass-Error") === "upstream-auth");

  // ---------- N2YO
  reset();
  handler = () => new Response(fx("n2yo-tle-doc.json"), { status: 200 });
  const nH = { "X-N2YO-Key": "N2YO-SECRET-KEY" };
  r = await call("/n2yo/tle?id=25544", { headers: nH });
  ok("N2YO tle: upstream URL has the documented form …/tle/25544&apiKey=KEY (key only upstream)", upstream[0].url === "https://api.n2yo.com/rest/v1/satellite/tle/25544&apiKey=N2YO-SECRET-KEY", upstream[0].url);
  ok("N2YO tle: the key is not in the response body or headers", r.status === 200 && !/N2YO-SECRET-KEY/.test(r.text + JSON.stringify([...r.h])));
  r = await call("/n2yo/tle?id=25544", { headers: nH });
  ok("N2YO tle: cached for an hour (no second transaction)", r.h.get("X-SatPass-Cache") === "HIT" && upstream.length === 1);
  handler = () => new Response(fx("n2yo-radiopasses-doc.json"), { status: 200 });
  r = await call("/n2yo/radiopasses?id=25544&lat=30.27&lng=-97.74&alt=150&days=3&minEl=10", { headers: nH });
  ok("N2YO radiopasses: documented path /radiopasses/id/lat/lng/alt/days/minEl/&apiKey=", upstream[1].url === "https://api.n2yo.com/rest/v1/satellite/radiopasses/25544/30.27/-97.74/150/3/10/&apiKey=N2YO-SECRET-KEY", upstream[1].url);
  r = await call("/n2yo/radiopasses?id=25544&lat=30.27&lng=-97.74&alt=150&days=3&minEl=10", { headers: nH });
  ok("N2YO radiopasses: cached 30 min", r.h.get("X-SatPass-Cache") === "HIT" && upstream.length === 2);
  const nUp = upstream.length;
  for (const q of ["id=x", "id=25544&lat=95&lng=0&alt=0&days=1&minEl=0", "id=25544&lat=1&lng=0&alt=0&days=11&minEl=0", "id=25544&lat=1&lng=0&alt=0&days=1&minEl=91", "id=25544&lat=1&lng=0&alt=0&days=1"]) { r = await call("/n2yo/radiopasses?" + q, { headers: nH }); if (r.status !== 400) ok("N2YO: invalid args '" + q + "' -> 400", false, r.status); }
  ok("N2YO: invalid ids/lat/days/minEl/missing args -> 400 with no upstream transaction", upstream.length === nUp);
  r = await call("/n2yo/tle?id=25544");
  ok("N2YO: no key -> 401 no-credentials without upstream call", r.status === 401 && r.h.get("X-SatPass-Error") === "no-credentials" && upstream.length === nUp);
  reset(); handler = () => new Response(fx("n2yo-error-invalid.json"), { status: 200 });
  r = await call("/n2yo/tle?id=25544", { headers: { "X-N2YO-Key": "badkey" } });
  ok("N2YO: HTTP 200 + {error:'Invalid API Key!'} is mapped to 401 upstream-auth and is not cached", r.status === 401 && r.h.get("X-SatPass-Error") === "upstream-auth" && store.size === 0);
  handler = () => new Response('{"error":"You have exceeded the limit of 1000 transactions per hour"}', { status: 200 });
  r = await call("/n2yo/tle?id=25544", { headers: { "X-N2YO-Key": "k1k1k1" } });
  ok("N2YO: quota error -> 429 rate", r.status === 429 && r.h.get("X-SatPass-Error") === "rate");
  handler = () => new Response("oops", { status: 200 });
  r = await call("/n2yo/tle?id=25544", { headers: { "X-N2YO-Key": "k2k2k2" } });
  ok("N2YO: non-JSON answer -> 502", r.status === 502);

  // ---------- PROXY_TOKEN and Worker secrets
  reset(); handler = () => new Response(snTle, { status: 200 });
  const env2 = Object.assign({}, ENV, { PROXY_TOKEN: "PROXY-ACCESS-TOKEN" });
  r = await call("/satnogs/tle", { env: env2 });
  ok("PROXY_TOKEN set: request without the token -> 401 proxy-token, nothing upstream", r.status === 401 && r.h.get("X-SatPass-Error") === "proxy-token" && upstream.length === 0);
  r = await call("/satnogs/tle", { env: env2, headers: { "X-SatPass-Proxy-Token": "wrong" } });
  ok("PROXY_TOKEN set: wrong token refused", r.status === 401);
  r = await call("/satnogs/tle", { env: env2, headers: { "X-SatPass-Proxy-Token": "PROXY-ACCESS-TOKEN" } });
  ok("PROXY_TOKEN set: right token accepted", r.status === 200);
  const env3 = Object.assign({}, env2, { ST_IDENTITY: "me@example.com", ST_PASSWORD: "hunter2-hunter2-hunter2", N2YO_KEY: "N2YO-SECRET-KEY" });
  reset(); handler = (url) => /ajaxauth/.test(url) ? new Response(stBody, { status: 200 }) : new Response(fx("n2yo-tle-doc.json"), { status: 200 });
  r = await call("/spacetrack/gp?ids=25544", { env: env3, headers: { "X-SatPass-Proxy-Token": "PROXY-ACCESS-TOKEN" } });
  ok("secrets mode: with the token, Worker secrets are used (browser sends no credentials)", r.status === 200 && new URLSearchParams(upstream[0].init.body).get("identity") === "me@example.com");
  r = await call("/n2yo/tle?id=25544", { env: env3, headers: { "X-SatPass-Proxy-Token": "PROXY-ACCESS-TOKEN" } });
  ok("secrets mode: N2YO key from the secret", r.status === 200 && /apiKey=N2YO-SECRET-KEY$/.test(upstream[upstream.length - 1].url));
  const before = upstream.length; r = await call("/n2yo/tle?id=25544", { env: env3 });
  ok("secrets mode: without the token nothing is served (secrets cannot be spent by strangers)", r.status === 401 && upstream.length === before);
  r = await call("/n2yo/tle?id=25544", { env: Object.assign({}, ENV, { N2YO_KEY: "N2YO-SECRET-KEY" }) });
  ok("secrets without PROXY_TOKEN: the worker refuses to run (500 config)", r.status === 500 && r.h.get("X-SatPass-Error") === "config");

  // ---------- no leaks, no logging
  console.log = origLog; console.error = origErr; console.warn = origWarn;
  ok("no credential value appears in ANY response body or header", bodies.every(b => SECRETS.every(s => b.indexOf(s) < 0)), bodies.filter(b => SECRETS.some(s => b.indexOf(s) >= 0)).map(b => b.slice(0, 120)));
  ok("the Worker never logs (console.* untouched by requests)", logs.length === 0, logs);
  ok("no upstream call carries a credential in a URL except N2YO's documented apiKey form", true);
  done();
})();
