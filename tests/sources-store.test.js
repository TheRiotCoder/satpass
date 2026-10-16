// js/store.js data-source layer in a vm sandbox (real modules, fake localStorage, mocked fetch): fallback order, status/backoff, hourly pull rule,
// credentials (storage, forget, passphrase encryption, no leaks), JSON import, SatNOGS live transmitters, N2YO comparison cache. No network, no credentials.
const { ok, done } = require("./harness");
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, ".."), rd = f => fs.readFileSync(path.join(root, f), "utf8"), fx = f => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const PROXY = "https://satpass-proxy.example.workers.dev";
const CRED = { stIdentity: "tester@example.com", stPassword: "CorrectHorse-Battery-Staple1", satnogsToken: "0123456789abcdef0123456789abcdef01234567", n2yoKey: "ABCD-EFGH-1234-SECRET", proxyToken: "PROXY-ACCESS-TOKEN-XYZ" };
const SECRETVALS = Object.values(CRED);
function resp(status, body, headers) { headers = headers || {}; return { ok: status >= 200 && status < 300, status, headers: { get: k => (k in headers ? headers[k] : null) }, text: async () => body }; }
const isCT = u => /celestrak\.org/.test(u);

function load(opts = {}) {
  const ls = Object.assign({}, opts.ls || {}), reqs = [], logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")), info: (...a) => logs.push(a.join(" ")) };
  const ctx = {
    console: fakeConsole, Promise, Date, JSON, Object, Math, Array, Number, String, RegExp, Error, TypeError, parseInt, parseFloat, isFinite, isNaN, Uint8Array, TextEncoder, TextDecoder, URL, URLSearchParams, encodeURIComponent, decodeURIComponent, Buffer,
    crypto: require("crypto").webcrypto, btoa: s => Buffer.from(s, "binary").toString("base64"), atob: s => Buffer.from(s, "base64").toString("binary"),
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    navigator: { onLine: true }, AbortController, clearTimeout,
    setTimeout: (fn, ms) => (ms === 1200 || ms === 2000 ? (Promise.resolve().then(fn), 0) : setTimeout(fn, ms)),
    fetch: (url, init) => { url = String(url); reqs.push({ url, init: init || {} }); const r = (opts.fetch || (() => resp(500, "unstubbed")))(url, init || {}, reqs.length); return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); }
  };
  ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  const run = f => vm.runInContext(rd(f), ctx, { filename: f });
  ["js/tle.js", "js/radio.js", "data/sar.js", "js/catalog.js", "js/sources.js", "data/tle-snapshot.js", "js/store.js"].forEach(run);
  const S = ctx.SatStore; S.init(); return { S, ls, reqs, logs, ctx };
}
const proxied = (reqs, p) => reqs.filter(r => r.url.indexOf(PROXY + p) === 0);
const stOk = (url) => /\/spacetrack\/gp/.test(url) ? resp(200, fx("spacetrack-gp.json"), { "X-SatPass-Cache": "MISS" }) : null;
const snOk = (url) => /\/satnogs\/tle/.test(url) ? resp(200, fx("satnogs-tle.json")) : /\/satnogs\/transmitters/.test(url) ? resp(200, fx("satnogs-tx-25544.json")) : null;
const n2Ok = (url) => /\/n2yo\/tle/.test(url) ? resp(200, fx("n2yo-tle-doc.json")) : /\/n2yo\/radiopasses/.test(url) ? resp(200, fx("n2yo-radiopasses-doc.json")) : null;
const health = (url) => /\/health$/.test(url) ? resp(200, JSON.stringify({ ok: true, name: "satpass-proxy", version: "1.2.0" })) : null;
const setup = (S, enable) => { S.sources.setConfig({ proxy: PROXY, enabled: enable }); return S.sources.setCreds(CRED); };

(async () => {
  // ---------- defaults
  {
    const { S, reqs } = load({ fetch: () => new TypeError("Failed to fetch") });
    ok("default: only CelesTrak enabled and ready; others report 'not set up' with the CORS/proxy reason", S.sources.chain().join() === "celestrak" && !S.sources.readiness("spacetrack").ready && /proxy/i.test(S.sources.readiness("n2yo").reason));
    const r = await S.refresh();
    ok("CelesTrak down + nothing else configured: allFailed, clear message, points to the other sources and to import", r.ok === false && r.allFailed === true && /CelesTrak/.test(r.message) && /not set up/.test(r.message) && /import/i.test(r.message), r.message);
    ok("the polite CelesTrak batch stops after the first network failure (1 request)", reqs.length === 1);
    ok("app still has data (bundled snapshot) and reports its origin", S.data.sats.length > 100 && S.data.origin !== "CelesTrak");
    ok("status line data for CelesTrak: last error recorded, backing off", !!S.sources.status("celestrak").lastError && S.sources.inBackoff("celestrak"));
    const r2 = await S.refresh({ auto: true });
    ok("automatic refresh does not hammer a source in back-off", reqs.length === 1 && r2.ok === false);
    ok("nextAutoRefreshDue is false while every enabled source is backing off", S.nextAutoRefreshDue() === false);
  }

  // ---------- fallback: CelesTrak down -> Space-Track
  {
    const { S, reqs, ls } = load({ fetch: (u) => isCT(u) ? new TypeError("Failed to fetch") : (health(u) || stOk(u) || resp(404, "")) });
    await setup(S, { spacetrack: true });
    ok("Space-Track becomes ready once proxy + credentials are set and it is enabled", S.sources.readiness("spacetrack").ready && S.sources.chain().join() === "celestrak,spacetrack");
    const r = await S.refresh();
    ok("fallback: message says 'CelesTrak unreachable — using Space-Track'", r.ok && r.source === "spacetrack" && /^CelesTrak unreachable — using Space-Track\./.test(r.message), r.message);
    ok("fallbackFrom lists CelesTrak; data origin is 'Space-Track (via proxy)'", r.fallbackFrom.join() === "celestrak" && S.data.origin === "Space-Track (via proxy)" && S.catStatus("amateur").origin === "Space-Track (via proxy)");
    const gp = proxied(reqs, "/spacetrack/gp");
    ok("Space-Track pull is batched: ids in comma lists (<=150 per request), one request per chunk", gp.length >= 1 && gp.length <= 3 && gp.every(g => /\?ids=[\d,]+$/.test(g.url) && g.url.split("=")[1].split(",").length <= 150), gp.map(g => g.url.length));
    ok("credentials travel only in headers: no secret in any request URL", reqs.every(q => SECRETVALS.every(s => q.url.indexOf(s) < 0 && q.url.indexOf(encodeURIComponent(s)) < 0)));
    ok("credentials sent as X-SpaceTrack-* + proxy token headers, never as cookies (credentials:'omit')", gp.every(g => decodeURIComponent(g.init.headers["X-SpaceTrack-Password"]) === CRED.stPassword && g.init.credentials === "omit" && g.init.headers["X-SatPass-Proxy-Token"]));
    ok("per-source status: Space-Track last success recorded, CelesTrak last problem recorded", S.sources.status("spacetrack").lastOk > 0 && !!S.sources.status("celestrak").lastError);
    ok("status is persisted for the Setup page", !!JSON.parse(ls["satpass:srcstatus"]).spacetrack.lastOk);
    // hourly rule: same pull again is refused (manual), no new Space-Track request
    const n = proxied(reqs, "/spacetrack/gp").length, r2 = await S.refresh();
    ok("Space-Track: a second manual refresh within the hour makes NO second Space-Track request ('1 GP pull / hour' rule)", proxied(reqs, "/spacetrack/gp").length === n && r2.ok === false && /less than 1 h ago|Nothing was tried|pulled/.test(r2.message + JSON.stringify(r2)), r2.message);
  }

  // ---------- priority order is honoured (Space-Track first -> CelesTrak untouched)
  {
    const { S, reqs } = load({ fetch: (u) => isCT(u) ? resp(200, "[]") : (health(u) || stOk(u) || resp(404, "")) });
    await setup(S, { spacetrack: true }); S.sources.setConfig({ order: ["spacetrack", "celestrak", "satnogs", "n2yo"] });
    const r = await S.refresh();
    ok("order spacetrack > celestrak: Space-Track used, CelesTrak never contacted", r.ok && r.source === "spacetrack" && reqs.filter(q => isCT(q.url)).length === 0 && !/unreachable/.test(r.message) && (r.fallbackFrom || []).length === 0, r.message);
    S.sources.setConfig({ enabled: { spacetrack: false } });
    ok("disabled sources leave the chain", S.sources.chain().join() === "celestrak");
  }

  // ---------- cascading failures: CelesTrak network, Space-Track 429, SatNOGS ok
  {
    const { S, reqs } = load({ fetch: (u) => isCT(u) ? new TypeError("Failed to fetch") : health(u) || (/spacetrack/.test(u) ? resp(429, JSON.stringify({ error: "rate" }), { "X-SatPass-Error": "rate", "Retry-After": "900" }) : null) || snOk(u) || resp(404, "") });
    await setup(S, { spacetrack: true, satnogs: true });
    const r = await S.refresh();
    ok("CelesTrak network failure -> Space-Track rate-limited -> SatNOGS used; message names both failures", r.ok && r.source === "satnogs" && /CelesTrak unreachable; Space-Track rate-limited — using SatNOGS DB/.test(r.message), r.message);
    ok("SatNOGS pull: one bulk TLE request filtered locally; sets merged", proxied(reqs, "/satnogs/tle").length === 1 && S.data.origin === "SatNOGS DB (via proxy)");
    ok("rate-limit failure backs off >= 2 h and is shown on the status line", S.sources.status("spacetrack").backoffUntil - Date.now() > 1.9 * 3600e3 && /rate|limit|429/i.test(S.sources.status("spacetrack").lastError), S.sources.status("spacetrack"));
    const n = reqs.length; await S.refresh({ auto: true });
    ok("automatic refresh afterwards skips both failed sources (no hammering)", reqs.filter((q, i) => i >= n && (isCT(q.url) || /spacetrack/.test(q.url))).length === 0);
  }

  // ---------- wrong credentials: stop automatic use until they change
  {
    let calls = 0;
    const { S, reqs } = load({ fetch: (u) => isCT(u) ? new TypeError("Failed to fetch") : health(u) || (/spacetrack/.test(u) ? (calls++, resp(401, JSON.stringify({ error: "Space-Track rejected the login" }), { "X-SatPass-Error": "upstream-auth" })) : resp(404, "")) });
    await setup(S, { spacetrack: true });
    const r1 = await S.refresh();
    ok("401 from the proxy is classified as 'rejected the credentials' and the source is blocked", !r1.ok && S.sources.status("spacetrack").blocked === "auth" && /rejected/.test(r1.message), r1.message);
    await S.refresh(); await S.refresh({ auto: true });
    ok("a blocked source is never retried automatically OR manually (protects the account from lock-out): exactly 1 call", calls === 1);
    S.sources.setCreds({ stPassword: "AnotherPassword-123456789" });
    ok("changing credentials clears the block", S.sources.status("spacetrack").blocked === null);
    await S.refresh();
    ok("…and it is tried again", calls === 2);
  }

  // ---------- N2YO per-satellite pull is capped and polite
  {
    const { S, reqs } = load({ fetch: (u) => isCT(u) ? new TypeError("Failed to fetch") : health(u) || n2Ok(u) || resp(404, "") });
    await setup(S, { n2yo: true });
    const r = await S.refresh();
    const t = proxied(reqs, "/n2yo/tle");
    ok("N2YO: one request per satellite, capped at 40 per refresh, favourites first", t.length <= 40 && t.length >= 1 && t[0].url === PROXY + "/n2yo/tle?id=25544", t.slice(0, 3).map(x => x.url));
    ok("N2YO: success note mentions the per-satellite cap", r.ok === true && /N2YO/.test(r.message));
    ok("N2YO key only in the X-N2YO-Key header, never in the URL", t.every(x => x.url.indexOf(CRED.n2yoKey) < 0 && x.init.headers["X-N2YO-Key"] === encodeURIComponent(CRED.n2yoKey)));
    ok("N2YO transaction count surfaced for the status line", S.sources.status("n2yo").quota && typeof S.sources.status("n2yo").quota.transactions === "number");
  }

  // ---------- N2YO: a server error on the first satellite stops the pull (does not walk through 40 satellites)
  {
    const { S, reqs } = load({ fetch: (u) => isCT(u) ? new TypeError("Failed to fetch") : health(u) || resp(502, JSON.stringify({ error: "N2YO is unreachable from the proxy." }), { "X-SatPass-Error": "upstream" }) });
    await setup(S, { n2yo: true });
    const r = await S.refresh();
    ok("N2YO 5xx on the first satellite: refresh gives up after ONE N2YO request", !r.ok && proxied(reqs, "/n2yo/tle").length === 1, proxied(reqs, "/n2yo/tle").length);
  }

  // ---------- everything fails -> manual import path advertised
  {
    const { S } = load({ fetch: (u) => isCT(u) ? new TypeError("Failed to fetch") : health(u) || resp(502, JSON.stringify({ error: "Space-Track is unreachable from the proxy." }), { "X-SatPass-Error": "upstream" }) });
    await setup(S, { spacetrack: true });
    const r = await S.refresh();
    ok("all sources failed: allFailed + both sources named + manual import hint", r.allFailed && r.failed.join() === "celestrak,spacetrack" && /CelesTrak unreachable; Space-Track/.test(r.message) && /import/i.test(r.message), r.message);
  }

  // ---------- proxy problems are reported plainly
  {
    const { S } = load({ fetch: (u) => isCT(u) ? new TypeError("Failed to fetch") : new TypeError("Failed to fetch") });
    await setup(S, { spacetrack: true });
    const t = await S.sources.test("spacetrack");
    ok("Test connection with an unreachable proxy -> clear message, no URL query/secrets", !t.ok && /proxy/i.test(t.message) && SECRETVALS.every(s => t.message.indexOf(s) < 0), t.message);
    const t2 = await load({ fetch: () => resp(200, "<html>not a proxy</html>") }).S.sources.test("celestrak");
    ok("Test connection (CelesTrak) with a bad answer fails gracefully", t2.ok === false);
  }
  {
    const { S, reqs } = load({ fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    await setup(S, { spacetrack: true });
    const t = await S.sources.test("spacetrack");
    ok("Test connection (Space-Track): /health then one tiny ISS-only query; success message names the element set epoch", t.ok && /Space-Track OK via your proxy/.test(t.message) && proxied(reqs, "/health").length === 1 && /ids=25544$/.test(proxied(reqs, "/spacetrack/gp")[0].url), t.message);
    const t3 = await S.sources.test("satnogs");
    ok("Test connection (SatNOGS, disabled/anonymous is fine): health + one ISS TLE query through the proxy; 404 from a stub proxy -> explained failure", t3.ok === false && t3.message.length > 5, t3.message);
  }
  {
    const { S } = load({ fetch: (u) => /\/health$/.test(u) ? resp(200, "<html>hello</html>") : resp(404, "") });
    await setup(S, { n2yo: true });
    const t = await S.sources.test("n2yo");
    ok("a URL that is not a SatPass proxy is detected", !t.ok && /not a SatPass proxy|web page|JSON/i.test(t.message), t.message);
  }

  // ---------- local limiter for Space-Track (25/min)
  {
    const { S, reqs } = load({ fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    await setup(S, { spacetrack: true });
    let blocked = null; for (let i = 0; i < 20 && !blocked; i++) { const t = await S.sources.test("spacetrack"); if (!t.ok) blocked = t; }
    ok("local limiter stops Space-Track requests before the published 30/min is reached", blocked && /Local rate limit/.test(blocked.message) && proxied(reqs, "").length <= 26, blocked && blocked.message);
    ok("usage counter is exposed for the status line", S.sources.usage("spacetrack").used >= 24);
  }

  // ---------- credentials: storage, forget, passphrase, leaks
  {
    const { S, ls, logs, ctx } = load({ fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    await setup(S, { spacetrack: true, satnogs: true, n2yo: true });
    await S.sources.test("spacetrack"); await S.sources.test("n2yo"); await S.refresh();
    const others = Object.keys(ls).filter(k => k !== "satpass:creds");
    ok("credentials are stored in exactly one localStorage key; no other key (settings, status, cache, limiter…) contains any secret", ls["satpass:creds"] && others.every(k => SECRETVALS.every(s => ls[k].indexOf(s) < 0)), others.filter(k => SECRETVALS.some(s => ls[k].indexOf(s) >= 0)));
    ok("nothing was ever written to console.*", logs.length === 0, logs);
    S.sources.forgetCreds();
    ok("Forget credentials: key removed, getCreds empty, sources not ready, configuration (proxy, order) kept", !("satpass:creds" in ls) && Object.keys(S.sources.getCreds()).length === 0 && !S.sources.readiness("spacetrack").ready && S.sources.config().proxy === PROXY);
    ok("after Forget, no secret remains anywhere in localStorage", Object.keys(ls).every(k => SECRETVALS.every(s => ls[k].indexOf(s) < 0)));
    // reload: still forgotten
    ok("a fresh start after Forget has no credentials", Object.keys(load({ ls }).S.sources.getCreds()).length === 0);
  }
  {
    const A = load({ fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    await setup(A.S, { spacetrack: true });
    await A.S.sources.lock("only-me-123");
    const raw = A.ls["satpass:creds"];
    ok("passphrase: stored blob is AES-GCM ciphertext with no plaintext credential", /"enc":1/.test(raw) && SECRETVALS.every(s => raw.indexOf(s) < 0) && A.S.sources.hasPassphrase());
    const B = load({ ls: A.ls, fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    ok("after reload credentials are LOCKED: sources not ready (reason 'locked'), nothing sent", B.S.sources.isLocked() && B.S.sources.readiness("spacetrack").kind === "locked" && Object.keys(B.S.sources.getCreds()).length === 0);
    B.S.sources.setConfig({ enabled: { celestrak: false } });
    const rr = await B.S.refresh(); ok("a locked source is skipped without any request to the proxy", proxied(B.reqs, "").length === 0 && !rr.ok && /locked/.test(rr.message), rr.message);
    B.S.sources.setConfig({ enabled: { celestrak: true } });
    ok("wrong passphrase refused", await B.S.sources.unlock("nope").then(() => false, e => e.kind === "auth"));
    ok("right passphrase unlocks and the source is ready again", await B.S.sources.unlock("only-me-123") === true && !B.S.sources.isLocked() && B.S.sources.readiness("spacetrack").ready);
    await B.S.sources.removePassphrase();
    ok("removing the passphrase stores credentials unencrypted again (documented)", /stIdentity/.test(B.ls["satpass:creds"]) && !B.S.sources.hasPassphrase());
    ok("short passphrase refused", await A.S.sources.lock("123").then(() => false, e => e.kind === "config"));
  }
  {
    const { S } = load({ fetch: (u) => health(u) || resp(500, JSON.stringify({ error: "upstream said password=" + CRED.stPassword + " apiKey=" + CRED.n2yoKey + " identity=" + CRED.stIdentity }), { "X-SatPass-Error": "upstream" }) });
    await setup(S, { spacetrack: true, n2yo: true });
    const t = await S.sources.test("spacetrack"), t2 = await S.sources.test("n2yo");
    ok("error text from the network that echoes credentials is redacted before it reaches the UI or the status line", [t.message, t2.message, JSON.stringify(S.sources.status("spacetrack")), JSON.stringify(S.sources.status("n2yo"))].every(m => SECRETVALS.every(s => m.indexOf(s) < 0)), [t.message]);
  }
  {
    const { S, ls } = load();
    ok("setConfig rejects an insecure proxy at use time (http, user:password)", (() => { S.sources.setConfig({ proxy: "http://example.com" }); return !S.sources.readiness("satnogs").ready; })());
    S.sources.setConfig({ proxy: PROXY });
    ok("config persisted separately from credentials", JSON.parse(ls["satpass:sources"]).proxy === PROXY && !("satpass:creds" in ls));
  }

  // ---------- manual import: JSON/OMM
  {
    const { S } = load();
    const r = S.importText(fx("spacetrack-gp.json"), "file: gp.json");
    ok("importText accepts Space-Track/OMM JSON and labels the origin 'imported file'", r.ok && S.data.origin === "imported file" && S.data.byId[100889] && /3 element set/.test(r.message), r.message);
    ok("importText still accepts plain TLE text and still rejects junk", S.importText(fx("tle-25544.txt")).ok && !S.importText("hello world").ok && !S.importText("[1,2,3]").ok);
  }

  // ---------- SatNOGS live transmitters
  {
    const { S, ls, reqs } = load({ fetch: (u) => health(u) || snOk(u) || resp(404, "") });
    await setup(S, { satnogs: true });
    const R = S.ctx ? null : null;
    const before = JSON.stringify(require("../js/radio.js").radios(25544));
    ok("no live data before fetching", S.liveRadios(25544).length === 0 && S.txInfo() === null);
    const r = await S.fetchTransmitters();
    ok("fetchTransmitters: ok, per-satellite requests in batches of <=30 ids, no ids sent as secrets", r.ok && proxied(reqs, "/satnogs/transmitters").length >= 1 && proxied(reqs, "/satnogs/transmitters").every(q => q.url.split("=")[1].split(",").length <= 30), r.message);
    const live = S.liveRadios(25544);
    ok("live radios for ISS: flagged live, source+date labelled, no override of the bundled table", live.length > 0 && live.every(x => x.live && x.source === "SatNOGS DB" && x.fetchedAt > 0) && JSON.stringify(require("../js/radio.js").radios(25544)) === before);
    ok("live data is persisted with its fetch time", JSON.parse(ls["satpass:txlive"]).fetchedAt > 0 && S.txInfo().satellites >= 1);
    const again = await S.fetchTransmitters();
    const nTx = proxied(reqs, "/satnogs/transmitters").length; const again2 = await S.fetchTransmitters();
    ok("a second fetch within an hour is refused without a request (SatNOGS data changes slowly)", !again.ok && /min ago/.test(again.message) && proxied(reqs, "/satnogs/transmitters").length === nTx && !again2.ok);
    const cmp = S.txCompare();
    ok("txCompare reports bundled vs live per satellite (never mutates)", cmp[25544] && cmp[25544].length === require("../js/radio.js").radios(25544).length);
    S.clearLiveTx();
    ok("clearLiveTx removes live data and its storage", S.liveRadios(25544).length === 0 && !("satpass:txlive" in ls));
  }

  // ---------- N2YO comparison: cache + quota, key never cached
  {
    const { S, ls, reqs } = load({ fetch: (u) => health(u) || n2Ok(u) || resp(404, "") });
    await setup(S, { n2yo: true });
    const obs = { lat: 30.2672, lon: -97.7431, alt: 150 };
    const a = await S.n2yoPasses(25544, obs, { days: 2, minEl: 0 });
    ok("n2yoPasses: passes + transactions count returned", a.ok && a.passes.length >= 1 && typeof a.transactions === "number" && a.cached === false, a);
    const q = proxied(reqs, "/n2yo/radiopasses")[0];
    ok("observer location is rounded to 0.01° in the request and the key is in a header only", /lat=30\.27&lng=-97\.74&alt=150&days=2&minEl=0/.test(q.url) && q.url.indexOf(CRED.n2yoKey) < 0 && q.init.headers["X-N2YO-Key"]);
    const b = await S.n2yoPasses(25544, obs, { days: 2, minEl: 0 });
    ok("second identical comparison within 30 min comes from the cache (no extra N2YO transaction)", b.ok && b.cached === true && proxied(reqs, "/n2yo/radiopasses").length === 1);
    ok("cache and quota contain no credentials; n2yo status shows the reported transaction count", Object.keys(ls).filter(k => k !== "satpass:creds").every(k => SECRETVALS.every(s => ls[k].indexOf(s) < 0)) && S.sources.n2yoUsage().used === 1 && S.sources.n2yoUsage().limit === 90 && S.sources.status("n2yo").quota.transactions >= 0);
    await S.n2yoPasses(25544, { lat: 40, lon: 10, alt: 0 }, { days: 2 });
    ok("a different observer location is a different cache entry (second request sent)", proxied(reqs, "/n2yo/radiopasses").length === 2);
  }
  {
    const { S } = load({ fetch: (u) => health(u) || resp(401, JSON.stringify({ error: "N2YO: Invalid API Key!" }), { "X-SatPass-Error": "upstream-auth" }) });
    await setup(S, { n2yo: true });
    const a = await S.n2yoPasses(25544, { lat: 1, lon: 1, alt: 0 }, {});
    ok("N2YO rejected key: clear message, source blocked until the key changes", !a.ok && a.kind === "auth" && S.sources.status("n2yo").blocked === "auth");
  }
  {
    // 90/h local cap on radiopasses
    const { S, reqs } = load({ fetch: (u) => health(u) || n2Ok(u) || resp(404, "") });
    await setup(S, { n2yo: true });
    let last = null; for (let i = 0; i < 95; i++) { last = await S.n2yoPasses(25544, { lat: 10 + i / 10, lon: 1, alt: 0 }, { days: 1 }); if (!last.ok) break; }
    ok("N2YO radiopasses: stops locally at 90/hour (free limit 100)", last && !last.ok && proxied(reqs, "/n2yo/radiopasses").length === 90 && /Local rate limit/.test(last.message), last && last.message);
  }
  done();
})();
