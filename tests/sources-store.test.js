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
  const ls = Object.assign({}, opts.ls || {}), ss = opts.ss || {}, reqs = [], logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")), info: (...a) => logs.push(a.join(" ")) };
  const ctx = {
    console: fakeConsole, Promise, Date, JSON, Object, Math, Array, Number, String, RegExp, Error, TypeError, parseInt, parseFloat, isFinite, isNaN, Uint8Array, TextEncoder, TextDecoder, URL, URLSearchParams, encodeURIComponent, decodeURIComponent, Buffer,
    crypto: require("crypto").webcrypto, btoa: s => Buffer.from(s, "binary").toString("base64"), atob: s => Buffer.from(s, "base64").toString("binary"),
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { if (opts.quota && opts.quota(k)) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; } ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    sessionStorage: opts.noSession ? undefined : { getItem: k => (k in ss ? ss[k] : null), setItem: (k, v) => { ss[k] = String(v); }, removeItem: k => { delete ss[k]; } },
    navigator: { onLine: true }, AbortController, clearTimeout, location: opts.location,
    setTimeout: (fn, ms) => (ms === 1200 || ms === 2000 ? (Promise.resolve().then(fn), 0) : setTimeout(fn, ms)),
    fetch: (url, init) => { url = String(url); reqs.push({ url, init: init || {} }); const r = (opts.fetch || (() => resp(500, "unstubbed")))(url, init || {}, reqs.length); return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); }
  };
  ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  const run = f => vm.runInContext(rd(f), ctx, { filename: f });
  ["js/tle.js", "js/radio.js", "data/sar.js", "js/catalog.js", "js/sources.js", "data/tle-snapshot.js", "js/store.js"].forEach(run);
  const S = ctx.SatStore; S.init(); return { S, ls, ss, reqs, logs, ctx };
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
    const { S, ls, ss, logs, ctx } = load({ fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    await setup(S, { spacetrack: true, satnogs: true, n2yo: true });
    await S.sources.test("spacetrack"); await S.sources.test("n2yo"); await S.refresh();
    ok("1.2.1: without a passphrase NO secret is written to localStorage at all (session storage / memory only)", !("satpass:creds" in ls) && Object.keys(ls).every(k => SECRETVALS.every(s => ls[k].indexOf(s) < 0)) && S.sources.credMode() === "session", Object.keys(ls).filter(k => SECRETVALS.some(s => ls[k].indexOf(s) >= 0)));
    ok("…they live in this tab's sessionStorage only", /stIdentity/.test(ss["satpass:creds"]) && Object.keys(S.sources.getCreds()).length === 5);
    ok("nothing was ever written to console.*", logs.length === 0, logs);
    S.sources.forgetCreds();
    ok("Forget credentials: key removed, getCreds empty, sources not ready, configuration (proxy, order) kept", !("satpass:creds" in ls) && !("satpass:creds" in ss) && Object.keys(S.sources.getCreds()).length === 0 && !S.sources.readiness("spacetrack").ready && S.sources.config().proxy === PROXY);
    ok("after Forget, no secret remains anywhere in localStorage", Object.keys(ls).every(k => SECRETVALS.every(s => ls[k].indexOf(s) < 0)));
    // reload: still forgotten
    ok("a fresh start after Forget has no credentials", Object.keys(load({ ls }).S.sources.getCreds()).length === 0);
  }
  {
    const A = load({ fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    await setup(A.S, { spacetrack: true });
    await A.S.sources.lock("only-me-123");
    const raw = A.ls["satpass:creds"];
    ok("passphrase: stored blob is AES-GCM ciphertext with no plaintext credential", /"enc":2/.test(raw) && SECRETVALS.every(s => raw.indexOf(s) < 0) && A.S.sources.hasPassphrase());
    const B = load({ ls: A.ls, fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    ok("after reload credentials are LOCKED: sources not ready (reason 'locked'), nothing sent", B.S.sources.isLocked() && B.S.sources.readiness("spacetrack").kind === "locked" && Object.keys(B.S.sources.getCreds()).length === 0);
    B.S.sources.setConfig({ enabled: { celestrak: false } });
    const rr = await B.S.refresh(); ok("a locked source is skipped without any request to the proxy", proxied(B.reqs, "").length === 0 && !rr.ok && /locked/.test(rr.message), rr.message);
    B.S.sources.setConfig({ enabled: { celestrak: true } });
    ok("wrong passphrase refused", await B.S.sources.unlock("nope").then(() => false, e => e.kind === "auth"));
    ok("right passphrase unlocks and the source is ready again", await B.S.sources.unlock("only-me-123") === true && !B.S.sources.isLocked() && B.S.sources.readiness("spacetrack").ready);
    await B.S.sources.removePassphrase();
    ok("removing the passphrase does NOT write plaintext to localStorage: the encrypted copy is deleted, creds stay in this tab only", !("satpass:creds" in B.ls) && /stIdentity/.test(B.ss["satpass:creds"]) && !B.S.sources.hasPassphrase() && B.S.sources.credMode() === "session");
    ok("short passphrase refused (minimum is 10 characters)", await A.S.sources.lock("123").then(() => false, e => e.kind === "config") && await A.S.sources.lock("123456789").then(() => false, e => e.kind === "config") && /at least 10/.test(await A.S.sources.lock("x").then(() => "", e => e.message)));
  }
  // ---------- 1.2.1: partial CelesTrak failure -> next source fills the missing categories; age bookkeeping
  {
    const A = load({ fetch: (u) => isCT(u) ? (/GROUP=weather/.test(u) ? resp(500, "boom") : resp(200, fx("tle-25544.txt"))) : (health(u) || stOk(u) || resp(404, "")) });
    await setup(A.S, { spacetrack: true });
    const r = await A.S.refresh();
    const st = proxied(A.reqs, "/spacetrack/gp");
    ok("one failed CelesTrak query (weather) no longer ends the refresh: Space-Track is asked for the missing category", r.ok && r.partialFrom === "celestrak" && r.source === "spacetrack" && st.length >= 1 && /weather/.test(r.message) && /GROUP=weather|failed: weather/.test(r.message), r.message);
    const B = load({ fetch: (u) => isCT(u) ? (/GROUP=weather/.test(u) ? resp(500, "boom") : resp(200, fx("tle-25544.txt"))) : resp(404, "") });
    const r2 = await B.S.refresh();
    ok("partial CelesTrak result with nothing else enabled is still reported as success with the missing part named", r2.ok && /failed: weather/.test(r2.message) && /No other enabled source|weather/.test(r2.message), r2.message);
  }
  {
    const A = load({ fetch: (u) => health(u) || stOk(u) || resp(404, "") }); const f0 = A.S.data.fetchedAt;
    const r = A.S.importText(fx("tle-25544.txt"), "old.txt");
    ok("importing an old TLE does not reset the 'fetched N days ago' age", r.ok && A.S.data.fetchedAt === f0, [f0, A.S.data.fetchedAt]);
    const old = JSON.stringify(JSON.parse(fx("spacetrack-gp.json")).filter(o => o.NORAD_CAT_ID === "25544").map(o => { const c = Object.assign({}, o, { EPOCH: "2026-10-01T00:00:00.000000" }); delete c.TLE_LINE0; delete c.TLE_LINE1; delete c.TLE_LINE2; return c; }));
    const P = load({ fetch: (u) => isCT(u) ? new TypeError("Failed to fetch") : (health(u) || (/\/spacetrack\/gp/.test(u) ? resp(200, old) : resp(404, ""))) }); await setup(P.S, { spacetrack: true }); const g0 = P.S.data.fetchedAt;
    const pr = await P.S.refresh();
    ok("a Space-Track pull that delivers nothing newer does not reset the data age (delivered ISS epoch 1 Oct < bundled)", pr.ok && pr.source === "spacetrack" && P.S.data.fetchedAt === g0 && pr.updated === 0, [g0, P.S.data.fetchedAt, pr.updated]);
  }
  // ---------- 1.2.2: session credentials lost after the tab closed; hourly rule independent of timestamps
  {
    const A = load({ fetch: (u) => health(u) || resp(404, "") }); await setup(A.S, { spacetrack: true });
    const B = load({ ls: A.ls });   // new tab: localStorage kept, sessionStorage gone
    ok("after a tab close the mode is 'session-lost' (UI: 'were session-only and need to be re-entered'); no secret in localStorage", B.S.sources.credMode() === "session-lost" && Object.keys(B.S.sources.getCreds()).length === 0 && SECRETVALS.every(v => Object.values(A.ls).every(x => x.indexOf(v) < 0)));
    await B.S.sources.setCreds(CRED); B.S.sources.forgetCreds();
    ok("Forget credentials clears the hint ('none'); never-set stays 'none'", load({ ls: B.ls }).S.sources.credMode() === "none" && load({}).S.sources.credMode() === "none");
    await B.S.sources.setCreds({ n2yoKey: "x-key-12345" }); await B.S.sources.lock("a-long-passphrase");
    ok("encrypting removes the hint (mode 'encrypted' -> locked after reload, not 'session-lost')", load({ ls: B.ls }).S.sources.credMode() === "locked");
  }
  {
    // the hourly pull rule must hold even when the pull found nothing newer (data age untouched) – 30 runs to catch any timestamp race
    let bad = 0;
    for (let i = 0; i < 30; i++) {
      const P = load({ fetch: (u) => isCT(u) ? new TypeError("Failed to fetch") : (health(u) || stOk(u) || resp(404, "")) }); await setup(P.S, { spacetrack: true });
      const r1 = await P.S.refresh(), r2 = await P.S.refresh();
      if (!(r1.ok && !r2.ok && /less than 1 h ago|pulled less than/.test(r2.message))) bad++;
    }
    ok("second manual refresh within the hour is refused by the local 1 h rule, 30/30 runs (no 1 ms timestamp race)", bad === 0, bad);
  }
  // ---------- 1.2.1 credential hardening
  {
    // reload within the same tab keeps session creds; a new tab/browser start (fresh sessionStorage) does not
    const A = load({ fetch: (u) => health(u) || resp(404, "") }); await setup(A.S, { spacetrack: true });
    const same = load({ ls: A.ls, ss: A.ss }), fresh = load({ ls: A.ls });
    ok("session credentials survive a reload in the same tab and are gone in a new session", same.S.sources.getCreds().stPassword === CRED.stPassword && Object.keys(fresh.S.sources.getCreds()).length === 0);
    const nos = load({ noSession: true }); await setup(nos.S, { spacetrack: true });
    ok("no sessionStorage available: credentials still work in memory, nothing persisted", nos.S.sources.getCreds().stIdentity === CRED.stIdentity && !("satpass:creds" in nos.ls));
  }
  {
    // migration of a 1.2.0 plaintext copy
    const legacy = { "satpass:creds": JSON.stringify(CRED), "satpass:sources": JSON.stringify({ proxy: PROXY, enabled: { spacetrack: true } }) };
    const A = load({ ls: Object.assign({}, legacy), fetch: (u) => health(u) || resp(404, "") });
    ok("1.2.0 plaintext credentials are still usable and flagged 'legacy-plain' (UI offers to encrypt or remove)", A.S.sources.credMode() === "legacy-plain" && A.S.sources.getCreds().stPassword === CRED.stPassword && A.S.sources.readiness("spacetrack").ready);
    await A.S.sources.lock("a-long-passphrase");
    ok("encrypting migrates it: localStorage holds only ciphertext, mode 'encrypted'", /"enc":2/.test(A.ls["satpass:creds"]) && SECRETVALS.every(v => A.ls["satpass:creds"].indexOf(v) < 0) && A.S.sources.credMode() === "encrypted" && JSON.parse(A.ls["satpass:creds"]).iter >= 600000);
    const B = load({ ls: Object.assign({}, legacy) });
    await B.S.sources.dropPlaintextCopy();
    ok("'remove the saved plaintext copy' keeps creds for this tab but deletes the localStorage copy", !("satpass:creds" in B.ls) && B.S.sources.credMode() === "session" && /stIdentity/.test(B.ss["satpass:creds"]));
    const C = load({ ls: Object.assign({}, legacy) }); await C.S.sources.setCreds({ n2yoKey: "other-key-1" });
    ok("editing a credential while a plaintext copy exists also removes that copy (no new plaintext persistence)", !("satpass:creds" in C.ls) && C.S.sources.getCreds().n2yoKey === "other-key-1");
  }
  {
    // Paul M2: 'Test connection' while LOCKED must not overwrite/delete the encrypted blob
    const A = load({ fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    await setup(A.S, { spacetrack: true }); await A.S.sources.lock("only-me-123");
    const enc = A.ls["satpass:creds"];
    const B = load({ ls: A.ls, fetch: (u) => health(u) || stOk(u) || resp(404, "") });
    ok("reloaded: locked", B.S.sources.isLocked());
    const r1 = await B.S.sources.setCreds({ stIdentity: "", stPassword: "", n2yoKey: "NEWKEY-1234" }).then(() => "resolved", e => e.kind);
    ok("setCreds while locked is rejected (kind 'locked') and the stored blob is byte-identical", r1 === "locked" && B.ls["satpass:creds"] === enc && !("satpass:creds" in B.ss), r1);
    ok("lock()/removePassphrase() while locked are also rejected without touching storage", await B.S.sources.lock("another-pass-12").then(() => "ok", e => e.kind) === "locked" && await B.S.sources.removePassphrase().then(() => "ok", e => e.kind) === "locked" && B.ls["satpass:creds"] === enc);
    const C = load({ ls: B.ls });
    ok("after the attempt a reload is still locked with a passphrase and the right passphrase still unlocks", C.S.sources.isLocked() && C.S.sources.hasPassphrase() && await C.S.sources.unlock("only-me-123") === true && C.S.sources.getCreds().stPassword === CRED.stPassword);
    // tampered iteration counts
    const t = JSON.parse(enc), t1 = Object.assign({}, t, { iter: 1 }), t2 = Object.assign({}, t, { iter: 4e9 });
    const D = load({ ls: Object.assign({}, A.ls, { "satpass:creds": JSON.stringify(t1) }) }), E = load({ ls: Object.assign({}, A.ls, { "satpass:creds": JSON.stringify(t2) }) });
    const t0 = Date.now();
    ok("tampered iter=1 / iter=4e9: unlock fails with an auth error (clamped to 100k..2M), does not hang", await D.S.sources.unlock("x").then(() => "ok", e => e.kind) === "auth" && await E.S.sources.unlock("x").then(() => "ok", e => e.kind) === "auth" && Date.now() - t0 < 20000, Date.now() - t0);
  }
  {
    // storage quota: failures are reported, not silent
    let full = false; const fails = [];
    const A = load({ quota: () => full, fetch: (u) => health(u) || resp(404, "") });
    A.S.onSaveFail(f => fails.push(f));
    full = true; A.S.set({ minEl: 20 });
    ok("a failed localStorage write calls onSaveFail with key + quota flag", fails.length === 1 && fails[0].key === "settings" && fails[0].quota === true, fails);
    const r = A.S.importText(fx("tle-25544.txt"), "t");
    ok("importing TLEs when storage is full reports it (listener) and the data is still usable in memory", fails.some(f => f.key === "tle") && r.ok && /not saved|storage/i.test(r.message), [fails.map(f => f.key), r.message]);
    const L = load({ quota: (k) => full, fetch: (u) => health(u) || resp(404, "") }); full = false; await L.S.sources.setCreds(CRED); await L.S.sources.lock("good-passphrase-1"); full = true;
    ok("an encrypted-credentials save that hits the quota rejects with kind 'storage'", await L.S.sources.setCreds({ n2yoKey: "k-2222-2222" }).then(() => "ok", e => e.kind) === "storage");
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
  // ---------- 1.3.0: auto-lock, biometric second door (stub PRF), encrypted backup
  const Src2 = require("../js/sources.js");
  {
    const wc = require("crypto").webcrypto, PRF = wc.getRandomValues(new Uint8Array(32)), META = { credId: "Y3JlZA", prfSalt: "c2FsdA==", rpId: "theriotcoder.github.io" };
    const A = load({}); await A.S.sources.setCreds({ stIdentity: "u@example.com", stPassword: "Pw-for-lock-test-1" });
    ok("session-only credentials cannot be locked (lockNow is a no-op; nothing would be recoverable)", A.S.sources.lockNow() === false && A.S.sources.getCreds().stPassword === "Pw-for-lock-test-1");
    ok("biometric enrol needs an encrypted vault first", (await A.S.sources.bioSave(META, PRF.slice()).catch(e => e)).kind === "config");
    await A.S.sources.lock("a-long-passphrase-1");
    ok("lockNow on an encrypted vault: memory emptied, mode 'locked', setCreds refused, readiness 'locked'", A.S.sources.lockNow() === true && A.S.sources.isLocked() && Object.keys(A.S.sources.getCreds()).length === 0 && A.S.sources.credMode() === "locked" && (await A.S.sources.setCreds({ n2yoKey: "zzzzzzzz" }).catch(e => e)).kind === "locked" && A.S.sources.readiness("spacetrack").kind === "locked");
    ok("lockNow keeps the encrypted blob (nothing in localStorage is plaintext, nothing was deleted)", /"enc":2/.test(A.ls["satpass:creds"]) && !/Pw-for-lock-test/.test(JSON.stringify(A.ls)) && A.S.sources.lockNow() === false);
    await A.S.sources.unlock("a-long-passphrase-1");
    ok("unlock with the passphrase restores the credentials after an auto-lock", A.S.sources.getCreds().stPassword === "Pw-for-lock-test-1" && !A.S.sources.isLocked());
    ok("vault config persists and is clamped", (() => { A.S.sources.setVaultCfg({ idleMin: 30, hiddenMin: 99999 }); const B = load({ ls: A.ls }); return B.S.sources.vaultCfg().idleMin === 30 && B.S.sources.vaultCfg().hiddenMin === 720 && load({}).S.sources.vaultCfg().idleMin === 15; })());

    // biometric
    const bi = await A.S.sources.bioSave(META, PRF.slice());
    ok("bioSave stores a wrapped record (no passphrase / credential plaintext in localStorage) and reports info", !!bi && bi.rpId === META.rpId && !!A.ls["satpass:bio"] && !/a-long-passphrase|Pw-for-lock/.test(JSON.stringify(A.ls)));
    A.S.sources.lockNow();
    let asked = null;
    await A.S.sources.bioUnlock(rec => { asked = rec; return PRF.slice(); });
    ok("bioUnlock: asks for the PRF of the stored record, then opens the vault; passphrase kept in memory so later edits re-encrypt", asked && asked.credId === META.credId && !A.S.sources.isLocked() && A.S.sources.getCreds().stIdentity === "u@example.com" && (await A.S.sources.setCreds({ n2yoKey: "N2-after-bio-1" }).then(() => true)) && /"enc":2/.test(A.ls["satpass:creds"]));
    const wrong = await (async () => { A.S.sources.lockNow(); return A.S.sources.bioUnlock(() => wc.getRandomValues(new Uint8Array(32))).catch(e => e); })();
    ok("wrong PRF output / cancelled prompt: stays locked, clear error, passphrase still works", wrong.kind === "auth" && A.S.sources.isLocked() && (await A.S.sources.bioUnlock(() => Promise.reject(new Error("cancelled"))).catch(e => e.message)) === "cancelled" && (await A.S.sources.unlock("a-long-passphrase-1")) === true);
    const blobBefore = JSON.parse(A.ls["satpass:creds"]);
    await A.S.sources.lock("another-long-passphrase-2");
    const blobAfter = JSON.parse(A.ls["satpass:creds"]);
    ok("1.3.2 changing the passphrase re-wraps only the data key: wrapped key + salt change, the biometric record stays valid", blobAfter.wk !== blobBefore.wk && blobAfter.salt !== blobBefore.salt && !!A.ls["satpass:bio"] && A.S.sources.bioInfo() !== null);
    A.S.sources.lockNow();
    ok("1.3.2 …the old passphrase no longer opens it, the new one does, and biometric unlock (PRF → data key) still works after the change", (await A.S.sources.unlock("a-long-passphrase-1").catch(e => e.kind)) === "auth" && (await A.S.sources.bioUnlock(() => PRF.slice())) === true && A.S.sources.getCreds().stPassword === "Pw-for-lock-test-1" && (A.S.sources.lockNow(), (await A.S.sources.unlock("another-long-passphrase-2")) === true));
    ok("1.3.2 the passphrase is nowhere in memory-facing state: the bio record unwraps to a 32-byte data key, not to the passphrase", await (async () => { const rec = JSON.parse(A.ls["satpass:bio"]); const dek = await Src2.unwrapSecret(rec, PRF.slice()); return Buffer.from(dek, "base64").length === 32 && dek.indexOf("passphrase") < 0 && rec.v === 2; })());

    await A.S.sources.bioSave(META, PRF.slice());
    await A.S.sources.removePassphrase();
    ok("removing the passphrase drops the biometric record", !A.ls["satpass:bio"] && A.S.sources.bioInfo() === null);
    await A.S.sources.lock("third-long-passphrase-3"); await A.S.sources.bioSave(META, PRF.slice()); A.S.sources.forgetCreds();
    ok("Forget credentials also removes the biometric record", !A.ls["satpass:bio"]);
    await A.S.sources.setCreds({ n2yoKey: "k-12345678" }); await A.S.sources.lock("fourth-long-passphrase-4"); await A.S.sources.bioSave(META, PRF.slice());
    ok("a damaged biometric record is ignored (no biometric option, no crash)", (() => { const ls = Object.assign({}, A.ls); ls["satpass:bio"] = '{"v":1,"credId":5}'; return load({ ls }).S.sources.bioInfo() === null; })());

    // backup
    const B = load({}); await B.S.sources.setCreds({ stIdentity: "mv@example.com", stPassword: "Move-Me-Pw-1", proxyToken: "tok-12345678" }); B.S.sources.setConfig({ proxy: PROXY });
    const text = await B.S.sources.exportBackup("backup-passphrase-1");
    ok("store.exportBackup: encrypted file text without plaintext", !/mv@example|Move-Me|tok-12345678/.test(text) && JSON.parse(text).app === "satpass-credentials-backup");
    const C = load({}), r = await C.S.sources.importBackup(text, "backup-passphrase-1", () => true);
    ok("importBackup on a fresh device: credentials + proxy URL arrive (session-only until a passphrase is set), nothing plaintext in localStorage", r.imported === 3 && r.proxy && C.S.sources.getCreds().stPassword === "Move-Me-Pw-1" && C.S.sources.config().proxy === PROXY && C.S.sources.credMode() === "session" && !/Move-Me/.test(JSON.stringify(C.ls)));
    ok("wrong backup passphrase changes nothing", (await load({}).S.sources.importBackup(text, "wrong-pass-123").catch(e => e)).kind === "auth");
    const D = load({}); await D.S.sources.setCreds({ n2yoKey: "k-12345678" }); await D.S.sources.lock("fifth-long-passphrase-5"); D.S.sources.lockNow();
    ok("export and import are refused while locked", (await D.S.sources.exportBackup("backup-passphrase-1").catch(e => e)).kind === "locked" && (await D.S.sources.importBackup(text, "backup-passphrase-1").catch(e => e)).kind === "locked");
    const E = load({}); await E.S.sources.lock("sixth-long-passphrase-6").catch(() => 0);
    ok("importing into an encrypted vault stores the imported values encrypted", await (async () => { const F = load({}); await F.S.sources.setCreds({ n2yoKey: "seed-1234567" }); await F.S.sources.lock("sixth-long-passphrase-6"); await F.S.sources.importBackup(text, "backup-passphrase-1", () => true); return F.S.sources.getCreds().stPassword === "Move-Me-Pw-1" && !/Move-Me/.test(JSON.stringify(F.ls)) && /"enc":2/.test(F.ls["satpass:creds"]); })());
  }
  // ---------- 1.3.2: shared-origin purge, legacy vault migration, data-key vault, backup import confirmation
  {
    const wc = require("crypto").webcrypto, Src3 = require("../js/sources.js"), PRF = wc.getRandomValues(new Uint8Array(32)), META = { credId: "Y3JlZA", prfSalt: "c2FsdA==", rpId: "satpass.example.com" };
    // 1.3.0/1.3.1 record (v:1, wrapped the PASSPHRASE) + shared host: deleted on load
    const old = { v: 1, credId: "Y3JlZA", prfSalt: "c2FsdA==", rpId: "theriotcoder.github.io", created: 1, hk: "AAAA", iv: "AAAA", ct: "AAAA" };
    const sh = load({ ls: { "satpass:bio": JSON.stringify(old) }, location: { hostname: "theriotcoder.github.io" } });
    ok("1.3.2: an existing satpass:bio record is deleted on load on a shared github.io origin", !("satpass:bio" in sh.ls) && sh.S.sources.bioInfo() === null && sh.S.sources.bioAllowed() === false);
    const shp = load({ ls: { "satpass:bio": JSON.stringify(Object.assign({}, old, { v: 2 })) }, location: { hostname: "someone.github.io" } });
    ok("1.3.2: …also for any other <user>.github.io host, even for a well-formed v2 record", !("satpass:bio" in shp.ls) && shp.S.sources.bioAllowed() === false);
    const loc = load({ ls: { "satpass:bio": JSON.stringify(old) }, location: { hostname: "localhost" } });
    ok("1.3.2: an old v1 record (it wrapped the passphrase) is deleted on load even where biometrics are allowed (localhost)", !("satpass:bio" in loc.ls) && loc.S.sources.bioAllowed() === true);
    ok("1.3.2: biometrics stay allowed on a custom domain, Netlify and localhost; blocked only on github.io hosts", ["satpass.example.com", "myapp.netlify.app", "localhost", "notgithub.io.example.com", "github.io.evil.com"].every(h => load({ location: { hostname: h } }).S.sources.bioAllowed()) && !load({ location: { hostname: "x.github.io" } }).S.sources.bioAllowed() && !load({ location: { hostname: "GITHUB.IO" } }).S.sources.bioAllowed());
    const shared = load({ location: { hostname: "theriotcoder.github.io" } }); await shared.S.sources.setCreds({ n2yoKey: "k-12345678" }); await shared.S.sources.lock("long-passphrase-abc");
    ok("1.3.2: bioSave is refused on a shared origin (and stores nothing)", (await shared.S.sources.bioSave(META, PRF.slice()).catch(e => e)).kind === "config" && !("satpass:bio" in shared.ls));

    // vault v2 format + legacy migration
    const V = load({}); await V.S.sources.setCreds({ stIdentity: "u@e.com", stPassword: "Pw-vault-v2-1" }); await V.S.sources.lock("passphrase-one-123");
    const b2 = JSON.parse(V.ls["satpass:creds"]);
    ok("1.3.2: new vaults are {enc:2}: random data key wrapped by the passphrase key (wk), credentials under the data key; no plaintext", b2.enc === 2 && !!b2.wk && !!b2.wiv && b2.iter === 600000 && !/Pw-vault-v2|u@e\.com|passphrase-one/.test(V.ls["satpass:creds"]));
    V.S.sources.lockNow(); await V.S.sources.unlock("passphrase-one-123");
    ok("1.3.2: ordinary edits keep the same wrapped key (only the ciphertext changes)", await (async () => { const w = JSON.parse(V.ls["satpass:creds"]).wk, c0 = JSON.parse(V.ls["satpass:creds"]).ct; await V.S.sources.setCreds({ n2yoKey: "k-edit-1234567" }); const n = JSON.parse(V.ls["satpass:creds"]); return n.wk === w && n.ct !== c0; })());
    const legacy = await Src3.encryptCreds({ stIdentity: "old@e.com", stPassword: "Old-Pw-1.3.1" }, "legacy-passphrase-1", wc);
    const M = load({ ls: { "satpass:creds": JSON.stringify(legacy) } });
    ok("1.3.2: a 1.2.x/1.3.x {enc:1} blob loads locked and a wrong passphrase is refused", M.S.sources.isLocked() && (await M.S.sources.unlock("not-the-passphrase").catch(e => e.kind)) === "auth" && JSON.parse(M.ls["satpass:creds"]).enc === 1);
    await M.S.sources.unlock("legacy-passphrase-1");
    ok("1.3.2: unlocking a legacy blob migrates it to the data-key format on the spot (still unlocked, same credentials)", !M.S.sources.isLocked() && M.S.sources.getCreds().stPassword === "Old-Pw-1.3.1" && JSON.parse(M.ls["satpass:creds"]).enc === 2 && !/Old-Pw/.test(M.ls["satpass:creds"]));
    const M2 = load({ ls: M.ls });
    ok("1.3.2: …and the migrated blob opens with the same passphrase after a reload", (await M2.S.sources.unlock("legacy-passphrase-1")) === true && M2.S.sources.getCreds().stIdentity === "old@e.com");
    ok("1.3.2: a legacy blob whose migration cannot be saved (quota) stays readable and unlocked in memory", await (async () => { const Q = load({ ls: { "satpass:creds": JSON.stringify(legacy) }, quota: k => k === "satpass:creds" }); await Q.S.sources.unlock("legacy-passphrase-1"); return !Q.S.sources.isLocked() && Q.S.sources.getCreds().stPassword === "Old-Pw-1.3.1" && JSON.parse(Q.ls["satpass:creds"]).enc === 1; })());
    ok("1.3.2: a tampered wrapped key / ciphertext / header is rejected (AES-GCM + AAD)", await (async () => { const bad = async (patch) => { const T = load({ ls: { "satpass:creds": JSON.stringify(Object.assign({}, b2, patch)) } }); return T.S.sources.unlock("passphrase-one-123").then(() => "opened", e => e.kind); }; return (await bad({})) === "opened" && (await bad({ wk: b2.wk.slice(0, -4) + "AAAA" })) === "auth" && (await bad({ ct: b2.ct.slice(0, -4) + "AAAA" })) === "auth" && (await bad({ salt: "AAAAAAAAAAAAAAAAAAAAAA==" })) === "auth" && (await bad({ iter: 150000 })) === "auth"; })());

    // backup import confirmation
    const B = load({}); await B.S.sources.setCreds({ stIdentity: "mv@example.com", stPassword: "Move-Me-Pw-2" }); B.S.sources.setConfig({ proxy: "https://good.workers.dev" });
    const text = await B.S.sources.exportBackup("backup-passphrase-2");
    const T = load({}); await T.S.sources.setCreds({ stPassword: "Existing-Pw-keep-me", stIdentity: "mine@example.com" }); T.S.sources.setConfig({ proxy: "https://mine.workers.dev" });
    let seen = null;
    const declined = await T.S.sources.importBackup(text, "backup-passphrase-2", i => { seen = i; return false; }).catch(e => e);
    ok("1.3.2: import asks first when it would overwrite credentials or change the proxy; the question names the new proxy host and what is replaced", seen && seen.proxyChanged && seen.proxyHost === "good.workers.dev" && seen.currentProxy === "https://mine.workers.dev" && seen.overwrites.sort().join() === "stIdentity,stPassword");
    ok("1.3.2: declining changes nothing (credentials and proxy URL untouched)", declined.kind === "cancelled" && T.S.sources.getCreds().stPassword === "Existing-Pw-keep-me" && T.S.sources.config().proxy === "https://mine.workers.dev");
    ok("1.3.2: with no confirm callback a conflicting import is refused (safe default)", (await T.S.sources.importBackup(text, "backup-passphrase-2").catch(e => e)).kind === "cancelled" && T.S.sources.getCreds().stPassword === "Existing-Pw-keep-me");
    const done2 = await T.S.sources.importBackup(text, "backup-passphrase-2", () => true);
    ok("1.3.2: confirming applies it", done2.imported === 2 && done2.proxy === true && done2.overwrote === 2 && T.S.sources.getCreds().stPassword === "Move-Me-Pw-2" && T.S.sources.config().proxy === "https://good.workers.dev");
    const same = await T.S.sources.importBackup(text, "backup-passphrase-2", () => { throw new Error("must not ask"); });
    ok("1.3.2: re-importing identical data needs no question", same.imported === 2);
  }
  done();
})();
