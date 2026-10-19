/* SatPass CORS proxy (Cloudflare Worker, ES module). Deploy it to YOUR OWN Cloudflare account; see proxy/README.md.
   Why it exists: space-track.org, db.satnogs.org and api.n2yo.com do not send CORS headers, so a static web page (the SatPass PWA) cannot read their
   responses. This worker adds them, for the browser origins listed in ALLOWED_ORIGINS only, and it is NOT an open proxy: it can only perform the few
   fixed, validated requests below.

     GET /health
     GET /spacetrack/gp?ids=25544,43017        one Space-Track login+query (class/gp, json), cached >= 1 h
     GET /satnogs/tle?ids=25544,43017          SatNOGS DB /api/tle/ (bulk, cached 1 h), optionally filtered by ids
     GET /satnogs/transmitters?ids=25544       SatNOGS DB /api/transmitters/ per satellite (cached 6 h), max 30 ids
     GET /n2yo/tle?id=25544                    N2YO /tle/{id}              (cached 1 h)
     GET /n2yo/radiopasses?id=&lat=&lng=&alt=&days=&minEl=   (cached 30 min)

   Credentials: sent by the browser in headers (URL-encoded): X-SpaceTrack-Identity / X-SpaceTrack-Password, X-SatNOGS-Token, X-N2YO-Key
   — or stored as Worker secrets (ST_IDENTITY, ST_PASSWORD, SATNOGS_TOKEN, N2YO_KEY), the recommended setup. Secrets are only used when PROXY_TOKEN
   is also set and the request carries it (X-SatPass-Proxy-Token), so strangers who find the URL cannot spend your quota.
   Nothing is logged; secrets are never put in response bodies or headers. */
const VERSION = "1.3.13";
const UA = "SatPass-proxy/" + VERSION + " (+https://github.com/TheRiotCoder/satpass)";
const ST = "https://www.space-track.org", SN = "https://db.satnogs.org/api", N2 = "https://api.n2yo.com/rest/v1/satellite";
const TTL = { stgp: 3600, sntle: 3600, sntx: 21600, n2tle: 3600, n2pass: 1800 };
const MAX_IDS = { spacetrack: 200, satnogsTle: 400, satnogsTx: 30 };

const dec = (v) => { if (v == null) return ""; try { return decodeURIComponent(v); } catch (e) { return String(v); } };
function ids(q, max) {
  const out = (q || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!out.length || out.length > max || !out.every((s) => /^\d{1,9}$/.test(s))) return null;
  return [...new Set(out.map(Number))].sort((a, b) => a - b);
}
function origins(env) { return String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean); }
function cors(req, env, extra) {
  const o = req.headers.get("Origin"), h = new Headers(extra || {});
  h.set("Vary", "Origin");
  if (o && origins(env).includes(o)) {
    h.set("Access-Control-Allow-Origin", o);
    h.set("Access-Control-Expose-Headers", "X-SatPass-Error, X-SatPass-Cache, X-SatPass-Upstream-Status, Retry-After");
  }
  return h;
}
function json(req, env, status, body, extra) {
  const h = cors(req, env, extra); h.set("Content-Type", "application/json; charset=utf-8"); h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}
function fail(req, env, status, kind, msg, extra) { return json(req, env, status, { error: msg }, Object.assign({ "X-SatPass-Error": kind }, extra || {})); }
function eq(a, b) { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }
async function sha(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join(""); }

// Cache API wrapper (no-op where caches is unavailable)
async function cacheGet(key) { try { return globalThis.caches && (await caches.default.match(new Request(key))); } catch (e) { return null; } }
async function cachePut(key, body, ttl, ctype) {
  try { if (globalThis.caches) await caches.default.put(new Request(key), new Response(body, { headers: { "Content-Type": ctype || "application/json", "Cache-Control": "public, max-age=" + ttl } })); } catch (e) {}
}
function fromCache(req, env, hit, body) { const h = cors(req, env, { "X-SatPass-Cache": "HIT" }); h.set("Content-Type", "application/json; charset=utf-8"); h.set("Cache-Control", "private, max-age=60"); return new Response(body, { status: 200, headers: h }); }
function ok(req, env, body, cacheState) { const h = cors(req, env, { "X-SatPass-Cache": cacheState }); h.set("Content-Type", "application/json; charset=utf-8"); h.set("Cache-Control", "private, max-age=60"); return new Response(body, { status: 200, headers: h }); }

async function upstream(url, init) { return fetch(url, Object.assign({ redirect: "manual", headers: { "User-Agent": UA } }, init)); }
function mapStatus(req, env, r, what, retry) {
  if (r.status === 401 || r.status === 403) return fail(req, env, 401, "upstream-auth", what + " rejected the credentials (HTTP " + r.status + ").", { "X-SatPass-Upstream-Status": String(r.status) });
  if (r.status === 429) return fail(req, env, 429, "rate", what + " is rate-limiting this proxy (HTTP 429).", { "X-SatPass-Upstream-Status": "429", "Retry-After": r.headers.get("Retry-After") || "3600" });
  return fail(req, env, 502, "upstream", what + " answered HTTP " + r.status + ".", { "X-SatPass-Upstream-Status": String(r.status) });
}

/* ---- Space-Track: POST /ajaxauth/login with identity, password and the full query URL (one request); then log out ---- */
async function spacetrack(req, env, ctx, url, who) {
  const list = ids(url.searchParams.get("ids"), MAX_IDS.spacetrack);
  if (!list) return fail(req, env, 400, "bad-request", "ids must be 1–" + MAX_IDS.spacetrack + " comma-separated NORAD numbers.");
  const identity = who.stIdentity, password = who.stPassword;
  if (!identity || !password) return fail(req, env, 401, "no-credentials", "No Space-Track credentials (send them from the app or set ST_IDENTITY / ST_PASSWORD secrets).");
  const key = "https://satpass-cache.invalid/st/gp/" + (await sha(identity + "\n" + password)) + "/" + list.join(","), hit = await cacheGet(key);
  if (hit) return fromCache(req, env, hit, await hit.text());   // Space-Track: same query at most once per hour
  const query = ST + "/basicspacedata/query/class/gp/NORAD_CAT_ID/" + list.join(",") + "/orderby/NORAD_CAT_ID%20asc/format/json";
  let r;
  try { r = await upstream(ST + "/ajaxauth/login", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ identity, password, query }).toString() }); }
  catch (e) { return fail(req, env, 502, "upstream", "Space-Track is unreachable from the proxy."); }
  const cookie = ((r.headers.get("set-cookie") || "").match(/chocolatechip=[^;,\s]+/) || [])[0];
  const text = await r.text();
  if (cookie && ctx && ctx.waitUntil) ctx.waitUntil(upstream(ST + "/ajaxauth/logout", { method: "POST", headers: { "User-Agent": UA, Cookie: cookie } }).catch(() => {}));
  if (r.status !== 200) return mapStatus(req, env, r, "Space-Track");
  if (/^\s*\{/.test(text)) { let o = {}; try { o = JSON.parse(text); } catch (e) {} if (o.Login) return fail(req, env, 401, "upstream-auth", "Space-Track rejected the login: " + String(o.Login).slice(0, 100)); return fail(req, env, 502, "upstream", "Unexpected Space-Track answer."); }
  if (!/^\s*\[/.test(text)) return fail(req, env, 502, "upstream", "Space-Track did not return data (login page?).");
  await cachePut(key, text, TTL.stgp);
  return ok(req, env, text, "MISS");
}

/* ---- SatNOGS DB ---- */
function snHeaders(who) { const h = { "User-Agent": UA, Accept: "application/json" }; if (who.satnogsToken) h.Authorization = "Token " + who.satnogsToken; return h; }
async function satnogsTle(req, env, url, who) {
  const raw = url.searchParams.get("ids"), list = raw ? ids(raw, MAX_IDS.satnogsTle) : null;
  if (raw && !list) return fail(req, env, 400, "bad-request", "ids must be up to " + MAX_IDS.satnogsTle + " comma-separated NORAD numbers.");
  const key = "https://satpass-cache.invalid/sn/tle/" + (who.satnogsToken ? "t" + (await sha(who.satnogsToken)) : "a"), hit = await cacheGet(key);
  let text, state = "HIT";
  if (hit) text = await hit.text();
  else {
    let r; try { r = await upstream(SN + "/tle/?format=json", { headers: snHeaders(who) }); } catch (e) { return fail(req, env, 502, "upstream", "SatNOGS DB is unreachable from the proxy."); }
    if (r.status !== 200) return mapStatus(req, env, r, "SatNOGS DB");
    text = await r.text(); state = "MISS"; await cachePut(key, text, TTL.sntle);
  }
  if (!list) return ok(req, env, text, state);
  let arr; try { arr = JSON.parse(text); } catch (e) { return fail(req, env, 502, "upstream", "SatNOGS DB sent invalid JSON."); }
  const want = new Set(list);
  return ok(req, env, JSON.stringify(arr.filter((o) => want.has(o.norad_cat_id))), state);
}
async function satnogsTx(req, env, url, who) {
  const list = ids(url.searchParams.get("ids"), MAX_IDS.satnogsTx);
  if (!list) return fail(req, env, 400, "bad-request", "ids must be 1–" + MAX_IDS.satnogsTx + " comma-separated NORAD numbers.");
  const out = []; let state = "HIT";
  for (const id of list) {
    const key = "https://satpass-cache.invalid/sn/tx/" + id + "/" + (who.satnogsToken ? "t" + (await sha(who.satnogsToken)) : "a"), hit = await cacheGet(key); let text;
    if (hit) text = await hit.text();
    else {
      let r; try { r = await upstream(SN + "/transmitters/?format=json&satellite__norad_cat_id=" + id, { headers: snHeaders(who) }); } catch (e) { return fail(req, env, 502, "upstream", "SatNOGS DB is unreachable from the proxy."); }
      if (r.status !== 200) return mapStatus(req, env, r, "SatNOGS DB");
      text = await r.text(); state = "MISS"; await cachePut(key, text, TTL.sntx);
    }
    try { out.push(...JSON.parse(text)); } catch (e) { return fail(req, env, 502, "upstream", "SatNOGS DB sent invalid JSON."); }
  }
  return ok(req, env, JSON.stringify(out), state);
}

/* ---- N2YO: key goes only into the upstream URL (documented form …/tle/25544&apiKey=KEY); errors arrive as HTTP 200 + {"error":…} ---- */
async function n2yo(req, env, url, who, op) {
  if (!who.n2yoKey) return fail(req, env, 401, "no-credentials", "No N2YO API key (send it from the app or set the N2YO_KEY secret).");
  const id = url.searchParams.get("id"); if (!/^\d{1,9}$/.test(id || "")) return fail(req, env, 400, "bad-request", "id must be a NORAD number.");
  let path, ttl, keyPart;
  if (op === "tle") { path = "/tle/" + id; ttl = TTL.n2tle; keyPart = "tle/" + id; }
  else {
    const f = (n, lo, hi) => { const raw = url.searchParams.get(n); if (raw === null || raw.trim() === "") return null; const v = Number(raw); return isFinite(v) && v >= lo && v <= hi ? v : null; };
    const lat = f("lat", -90, 90), lng = f("lng", -180, 180), alt = f("alt", -500, 9000), days = f("days", 1, 10), minEl = f("minEl", 0, 90);
    if ([lat, lng, alt, days, minEl].some((v) => v === null)) return fail(req, env, 400, "bad-request", "lat/lng/alt/days/minEl are required numbers in range.");
    path = "/radiopasses/" + id + "/" + lat + "/" + lng + "/" + Math.round(alt) + "/" + Math.round(days) + "/" + Math.round(minEl) + "/"; ttl = TTL.n2pass; keyPart = "rp/" + path;
  }
  const key = "https://satpass-cache.invalid/n2/" + (await sha(who.n2yoKey)) + "/" + keyPart, hit = await cacheGet(key);
  if (hit) return fromCache(req, env, hit, await hit.text());
  let r; try { r = await upstream(N2 + path + "&apiKey=" + encodeURIComponent(who.n2yoKey)); } catch (e) { return fail(req, env, 502, "upstream", "N2YO is unreachable from the proxy."); }
  if (r.status !== 200) return mapStatus(req, env, r, "N2YO");
  const text = await r.text(); let o = null; try { o = JSON.parse(text); } catch (e) { return fail(req, env, 502, "upstream", "N2YO sent invalid JSON."); }
  if (o && o.error) {
    const m = String(o.error);
    if (/key/i.test(m)) return fail(req, env, 401, "upstream-auth", "N2YO: " + m.replace(who.n2yoKey, "***"));
    if (/limit|exceed|too many/i.test(m)) return fail(req, env, 429, "rate", "N2YO: " + m);
    return fail(req, env, 502, "upstream", "N2YO: " + m.replace(who.n2yoKey, "***"));
  }
  await cachePut(key, text, ttl);
  return ok(req, env, text, "MISS");
}

export default {
  async fetch(req, env, ctx) {
    env = env || {};
    const url = new URL(req.url), origin = req.headers.get("Origin"), allowed = origins(env);
    if (req.method === "OPTIONS") {
      if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403 });
      const h = cors(req, env); h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      h.set("Access-Control-Allow-Headers", "X-SatPass-Proxy-Token, X-SpaceTrack-Identity, X-SpaceTrack-Password, X-SatNOGS-Token, X-N2YO-Key, Accept, Content-Type");
      h.set("Access-Control-Max-Age", "86400"); return new Response(null, { status: 204, headers: h });
    }
    if (req.method !== "GET") return fail(req, env, 405, "method", "GET only.");
    if (origin && !allowed.includes(origin)) return fail(req, env, 403, "origin", "This origin is not in ALLOWED_ORIGINS.");
    // proxy access token (required whenever the worker holds secrets; recommended always)
    const sentToken = dec(req.headers.get("X-SatPass-Proxy-Token")), tokenOk = !!env.PROXY_TOKEN && sentToken && eq(sentToken, env.PROXY_TOKEN);
    // Browsers always send Origin on cross-origin requests. A request without one (curl, scripts, server-side) is only served when it proves itself with the access token.
    if (!origin && !tokenOk) return fail(req, env, 403, "origin", "Requests without an Origin header need the proxy access token (X-SatPass-Proxy-Token).");
    if (env.PROXY_TOKEN && !tokenOk) return fail(req, env, 401, "proxy-token", "Missing or wrong proxy access token.");
    const hasSecrets = !!(env.ST_IDENTITY || env.ST_PASSWORD || env.SATNOGS_TOKEN || env.N2YO_KEY);
    if (hasSecrets && !env.PROXY_TOKEN) return fail(req, env, 500, "config", "This worker holds credentials as secrets but PROXY_TOKEN is not set; refusing to serve (set PROXY_TOKEN).");
    // credentials: request headers first, then (token-authenticated) secrets
    const who = {
      stIdentity: dec(req.headers.get("X-SpaceTrack-Identity")) || (tokenOk ? env.ST_IDENTITY : "") || "",
      stPassword: dec(req.headers.get("X-SpaceTrack-Password")) || (tokenOk ? env.ST_PASSWORD : "") || "",
      satnogsToken: dec(req.headers.get("X-SatNOGS-Token")) || (tokenOk ? env.SATNOGS_TOKEN : "") || "",
      n2yoKey: dec(req.headers.get("X-N2YO-Key")) || (tokenOk ? env.N2YO_KEY : "") || ""
    };
    const p = url.pathname.replace(/\/+$/, "");
    try {
      if (p === "/health" || p === "") return json(req, env, 200, { ok: true, name: "satpass-proxy", version: VERSION, tokenRequired: !!env.PROXY_TOKEN, secrets: { spacetrack: !!(env.ST_IDENTITY && env.ST_PASSWORD), satnogs: !!env.SATNOGS_TOKEN, n2yo: !!env.N2YO_KEY }, services: ["spacetrack", "satnogs", "n2yo"] });
      if (p === "/spacetrack/gp") return await spacetrack(req, env, ctx, url, who);
      if (p === "/satnogs/tle") return await satnogsTle(req, env, url, who);
      if (p === "/satnogs/transmitters") return await satnogsTx(req, env, url, who);
      if (p === "/n2yo/tle") return await n2yo(req, env, url, who, "tle");
      if (p === "/n2yo/radiopasses") return await n2yo(req, env, url, who, "radiopasses");
      return fail(req, env, 404, "not-found", "Unknown route.");
    } catch (e) { return fail(req, env, 500, "internal", "Proxy error."); }   // never echo e.message: it could contain request data
  }
};
