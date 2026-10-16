/* Data-source adapters for orbital elements (pure, UMD): CelesTrak (direct), Space-Track, SatNOGS DB and N2YO (through the user's own proxy).
   WHY A PROXY: verified with a real browser from the GitHub Pages origin (see README "Data sources"): celestrak.org sends
   `Access-Control-Allow-Origin: *`; space-track.org, db.satnogs.org and api.n2yo.com send NO CORS headers, so a web page cannot read their responses.
   The three need a tiny forwarder that adds CORS headers: proxy/worker.js (Cloudflare Worker you deploy yourself). The proxy URL is configured in
   Setup → Data sources. Credentials are sent to the proxy in request HEADERS (never in the URL), and the proxy forwards them only to the matching service.
   Nothing in this file performs I/O: request builders return {url, init}; parsers take response text; the caller (store.js) does the fetch. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./tle.js"));
  else root.SatSources = factory(root.SatTle);
})(typeof self !== "undefined" ? self : this, function (Tle) {
  "use strict";
  var IDS = ["celestrak", "spacetrack", "satnogs", "n2yo"];
  var META = {
    celestrak: { id: "celestrak", label: "CelesTrak", direct: true, creds: [], site: "https://celestrak.org", docs: "https://celestrak.org/NORAD/documentation/gp-data-formats.php",
      limits: "asks for at most one identical query every 2 h", terms: "https://celestrak.org/webmaster.php" },
    spacetrack: { id: "spacetrack", label: "Space-Track", direct: false, creds: ["stIdentity", "stPassword"], site: "https://www.space-track.org", docs: "https://www.space-track.org/documentation",
      limits: "API: < 30 requests/minute and < 300/hour; GP (TLE) data: at most 1 pull per hour for the same query; batch NORAD ids in one request", terms: "https://www.space-track.org/documentation#/user_agree" },
    satnogs: { id: "satnogs", label: "SatNOGS DB", direct: false, creds: [], optionalCreds: ["satnogsToken"], site: "https://db.satnogs.org", docs: "https://db.satnogs.org/api/",
      limits: "anonymous API access is throttled (SatNOGS staff: 60 requests/hour anonymous, 240/hour with an API token); no published per-endpoint limits for tle/transmitters", terms: "https://db.satnogs.org/" },
    n2yo: { id: "n2yo", label: "N2YO", direct: false, creds: ["n2yoKey"], site: "https://www.n2yo.com", docs: "https://www.n2yo.com/api/",
      limits: "free key, per hour: tle 1000, positions 1000, visualpasses 100, radiopasses 100, above 100", terms: "https://www.n2yo.com/api/" }
  };
  /* Rate windows enforced client-side BEFORE sending (kept below the published limits). key = source or source:op. */
  var LIMITS = {
    spacetrack: [{ n: 25, ms: 60e3 }, { n: 240, ms: 3600e3 }],
    satnogs: [{ n: 40, ms: 3600e3 }],
    "n2yo:tle": [{ n: 900, ms: 3600e3 }],
    "n2yo:radiopasses": [{ n: 90, ms: 3600e3 }],
    "n2yo:visualpasses": [{ n: 90, ms: 3600e3 }]
  };
  var MIN_PULL_MS = { celestrak: 2 * 3600e3, spacetrack: 3600e3, satnogs: 3600e3, n2yo: 3600e3 };   // same-query / same-batch minimum spacing (manual and automatic)
  var AUTO_MIN_MS = { celestrak: 6 * 3600e3, spacetrack: 6 * 3600e3, satnogs: 6 * 3600e3, n2yo: 12 * 3600e3 };   // automatic refresh spacing per source
  var N2YO_MAX_SATS = 40;   // per refresh (one transaction each); favourites first
  var ST_CHUNK = 150;       // NORAD ids per Space-Track request

  /* ---------- errors ---------- */
  function SourceError(kind, message, status) { var e = new Error(message); e.name = "SourceError"; e.kind = kind; e.status = status || 0; return e; }
  // kind: "config" (not set up), "network" (unreachable / CORS / blocked), "auth" (credentials or proxy token rejected), "rate" (HTTP 429 / quota), "server", "parse", "locked"
  function classifyHttp(status, headerKind) {
    if (headerKind === "proxy-token") return "auth";
    if (status === 401 || status === 403) return headerKind === "upstream-forbidden" ? "rate" : "auth";
    if (status === 429) return "rate";
    if (status >= 500) return "server";
    return "server";
  }
  // Remove every secret (and apiKey=… patterns) from a string that might be shown or logged.
  function redact(text, secrets) {
    var s = String(text == null ? "" : text);
    (secrets || []).forEach(function (x) { if (x && String(x).length >= 4) { s = s.split(String(x)).join("***"); try { s = s.split(encodeURIComponent(String(x))).join("***"); } catch (e) {} } });
    return s.replace(/(apikey|api_key|token|password|identity)=([^&\s"']+)/ig, "$1=***").replace(/(Token\s+)[A-Za-z0-9_-]{8,}/g, "$1***");
  }

  /* ---------- configuration ---------- */
  function defaultConfig() { return { order: IDS.slice(), enabled: { celestrak: true, spacetrack: false, satnogs: false, n2yo: false }, proxy: "" }; }
  function normalizeConfig(c) {
    var d = defaultConfig(); c = c && typeof c === "object" ? c : {};
    var order = Array.isArray(c.order) ? c.order.filter(function (x, i, a) { return IDS.indexOf(x) >= 0 && a.indexOf(x) === i; }) : [];
    IDS.forEach(function (x) { if (order.indexOf(x) < 0) order.push(x); });
    var en = {}; IDS.forEach(function (x) { en[x] = c.enabled && typeof c.enabled[x] === "boolean" ? c.enabled[x] : d.enabled[x]; });
    return { order: order, enabled: en, proxy: typeof c.proxy === "string" ? c.proxy.trim().replace(/\/+$/, "") : "" };
  }
  /* The proxy must be https (or http on localhost for development), carry no user:password, query or fragment. */
  function validateProxyUrl(u) {
    u = String(u || "").trim().replace(/\/+$/, "");
    if (!u) return { ok: false, reason: "No proxy URL set." };
    var m = /^(https?):\/\/([^\/?#@]+)((?:\/[^?#]*)?)$/i.exec(u);
    if (!m) return { ok: false, reason: /@/.test(u) ? "The proxy URL must not contain a user name or password." : /[?#]/.test(u) ? "The proxy URL must not contain a query string or #fragment." : "That does not look like a URL (expected https://your-proxy.example.workers.dev)." };
    var host = m[2].replace(/:\d+$/, "").toLowerCase(), local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (m[1].toLowerCase() === "http" && !local) return { ok: false, reason: "Use https:// (plain http is only accepted for localhost): credentials are sent to this URL." };
    return { ok: true, url: m[1].toLowerCase() + "://" + m[2] + m[3], host: host, local: local };
  }
  /* The page's Content-Security-Policy (index.html) limits connect-src to these hosts. */
  var CSP_CONNECT = ["'self'", "https://celestrak.org", "https://*.workers.dev", "http://localhost:*", "http://127.0.0.1:*"];
  function proxyAllowedByCsp(u) {
    var v = validateProxyUrl(u); if (!v.ok) return false;
    if (v.local) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/.test(v.host);
  }
  function credsComplete(id, creds) {
    creds = creds || {};
    if (creds.proxyToken && (id === "spacetrack" || id === "n2yo")) return true;   // "secrets mode": the user's proxy holds the credentials and accepts this access token
    if (id === "spacetrack") return !!(creds.stIdentity && creds.stPassword);
    if (id === "n2yo") return !!creds.n2yoKey;
    return true;
  }
  // Is a source usable right now? {ready, reason}
  function readiness(id, cfg, creds, opts) {
    opts = opts || {};
    if (id === "celestrak") return { ready: true };
    if (opts.locked) return { ready: false, reason: "credentials are locked – enter your passphrase in Setup → Data sources", kind: "locked" };
    var p = validateProxyUrl(cfg && cfg.proxy);
    if (!p.ok) return { ready: false, reason: id === "spacetrack" || id === "satnogs" || id === "n2yo" ? META[id].label + " cannot be called straight from a browser (no CORS). Set your proxy URL in Setup → Data sources." : p.reason, kind: "config" };
    if (!proxyAllowedByCsp(cfg.proxy)) return { ready: false, reason: "the proxy host is not allowed by this page's Content-Security-Policy (only *.workers.dev and localhost; edit index.html to allow another host)", kind: "config" };
    if (!credsComplete(id, creds)) return { ready: false, reason: id === "spacetrack" ? "Space-Track user name and password are not set" : "N2YO API key is not set", kind: "config" };
    return { ready: true };
  }

  /* ---------- request builders (credentials only in headers) ---------- */
  function hdr(id, creds) {
    creds = creds || {}; var h = { Accept: "application/json" };
    if (creds.proxyToken) h["X-SatPass-Proxy-Token"] = enc(creds.proxyToken);
    if (id === "spacetrack") { h["X-SpaceTrack-Identity"] = enc(creds.stIdentity || ""); h["X-SpaceTrack-Password"] = enc(creds.stPassword || ""); }
    if (id === "satnogs" && creds.satnogsToken) h["X-SatNOGS-Token"] = enc(creds.satnogsToken);
    if (id === "n2yo") h["X-N2YO-Key"] = enc(creds.n2yoKey || "");
    return h;
  }
  function enc(v) { return encodeURIComponent(String(v)); }
  function intList(ids) { return (ids || []).map(Number).filter(function (n) { return isFinite(n) && n > 0 && Math.floor(n) === n && n < 1e9; }); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? Number(n.toFixed(d)) : 0; }
  /* op: "gp" (spacetrack {ids}), "tle" (satnogs {ids} | n2yo {id}), "transmitters" (satnogs {ids}), "radiopasses" (n2yo {id,lat,lng,alt,days,minEl}), "health"/"ping" */
  function buildRequest(id, op, args, cfg, creds) {
    var p = validateProxyUrl(cfg && cfg.proxy); if (!p.ok) throw SourceError("config", p.reason);
    args = args || {}; var base = p.url, url;
    if (op === "health") url = base + "/health";
    else if (id === "spacetrack" && op === "gp") url = base + "/spacetrack/gp?ids=" + intList(args.ids).join(",");
    else if (id === "satnogs" && op === "tle") url = base + "/satnogs/tle" + (args.ids && args.ids.length ? "?ids=" + intList(args.ids).join(",") : "");
    else if (id === "satnogs" && op === "transmitters") url = base + "/satnogs/transmitters?ids=" + intList(args.ids).join(",");
    else if (id === "n2yo" && op === "tle") url = base + "/n2yo/tle?id=" + intList([args.id])[0];
    else if (id === "n2yo" && op === "radiopasses") url = base + "/n2yo/radiopasses?id=" + intList([args.id])[0] + "&lat=" + num(args.lat, 2) + "&lng=" + num(args.lng, 2) + "&alt=" + Math.max(0, Math.round(Number(args.alt) || 0)) + "&days=" + Math.max(1, Math.min(10, Math.round(Number(args.days) || 2))) + "&minEl=" + Math.max(0, Math.min(90, Math.round(Number(args.minEl) || 0)));
    else throw SourceError("config", "Unknown operation " + id + "/" + op);
    if (/[?&]ids=$/.test(url) || /id=undefined/.test(url)) throw SourceError("config", "No satellites to request.");
    return { url: url, init: { method: "GET", headers: hdr(id === "health" ? "" : id, creds), mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" } };
  }
  function chunk(list, n) { var out = []; for (var i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; }

  /* ---------- parsers ---------- */
  function jsonOrThrow(text, what) {
    try { return JSON.parse(text); } catch (e) {
      if (/^\s*</.test(text)) throw SourceError("parse", what + " returned a web page instead of data (wrong proxy URL?)");
      throw SourceError("parse", what + " returned something that is not JSON");
    }
  }
  function validLine(l, n) { return typeof l === "string" && l.length === 69 && l.charAt(0) === String(n) && Tle.checksum(l) === +l.charAt(68); }
  function toSats(texts, errors) { var r = Tle.parse(texts.join("\n")); r.errors = (errors || []).concat(r.errors); return r; }
  /* Space-Track /class/gp JSON (OMM-style, all values strings). Uses the TLE_LINE1/2 it ships when present and valid (ids < 100000),
     otherwise builds the Alpha-5 TLE from the OMM fields. */
  function parseSpaceTrackGp(text) {
    var arr = jsonOrThrow(text, "Space-Track");
    if (!Array.isArray(arr)) {
      if (arr && arr.Login) throw SourceError("auth", "Space-Track rejected the login (" + String(arr.Login).slice(0, 120) + ")", 401);
      if (arr && arr.error) throw SourceError("server", String(arr.error).slice(0, 160));
      throw SourceError("parse", "Space-Track response was not a list of element sets");
    }
    var texts = [], errors = [];
    arr.forEach(function (o) {
      try {
        if (o && o.TLE_LINE1 && o.TLE_LINE2 && validLine(o.TLE_LINE1, 1) && validLine(o.TLE_LINE2, 2)) {
          var nm = String(o.TLE_LINE0 || o.OBJECT_NAME || "").replace(/^0 /, "").trim() || String(o.OBJECT_NAME || "NORAD " + o.NORAD_CAT_ID).trim();
          texts.push(nm + "\n" + o.TLE_LINE1 + "\n" + o.TLE_LINE2);
        } else { var t = Tle.fromOmm(o); texts.push(t.name + "\n" + t.l1 + "\n" + t.l2); }
      } catch (e) { errors.push(e.message); }
    });
    return toSats(texts, errors);
  }
  /* SatNOGS DB /api/tle/ -> [{tle0,tle1,tle2,tle_source,norad_cat_id,updated}]; only ids in `wanted` (array, optional) are kept. */
  function parseSatnogsTle(text, wanted) {
    var arr = jsonOrThrow(text, "SatNOGS");
    if (!Array.isArray(arr)) { if (arr && arr.detail) throw SourceError(/throttl/i.test(arr.detail) ? "rate" : "auth", "SatNOGS: " + String(arr.detail).slice(0, 140), /throttl/i.test(arr.detail) ? 429 : 401); throw SourceError("parse", "SatNOGS response was not a list"); }
    var want = wanted ? {} : null; (wanted || []).forEach(function (n) { want[n] = 1; });
    var texts = [], errors = [];
    arr.forEach(function (o) {
      if (want && !want[o.norad_cat_id]) return;
      if (validLine(o.tle1, 1) && validLine(o.tle2, 2)) texts.push(String(o.tle0 || "NORAD " + o.norad_cat_id).replace(/^0 /, "").trim() + "\n" + o.tle1 + "\n" + o.tle2);
      else errors.push("SatNOGS TLE for " + o.norad_cat_id + " is malformed");
    });
    return toSats(texts, errors);
  }
  /* N2YO /tle/{id}: {"info":{satid,satname,transactionscount},"tle":"line1\r\nline2"}; errors come as HTTP 200 + {"error":"…"} */
  function n2yoError(o) {
    if (o && o.error) { var m = String(o.error); throw SourceError(/key/i.test(m) ? "auth" : /limit|exceed|too many/i.test(m) ? "rate" : "server", "N2YO: " + m.slice(0, 140), /key/i.test(m) ? 401 : 0); }
  }
  function parseN2yoTle(text) {
    var o = jsonOrThrow(text, "N2YO"); n2yoError(o);
    if (!o || !o.info || typeof o.tle !== "string") throw SourceError("parse", "N2YO response has no TLE");
    var lines = o.tle.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (lines.length < 2 || !validLine(lines[0], 1) || !validLine(lines[1], 2)) throw SourceError("parse", "N2YO returned a malformed TLE for " + o.info.satid);
    var r = toSats([String(o.info.satname || "NORAD " + o.info.satid).trim() + "\n" + lines[0] + "\n" + lines[1]]);
    // N2YO's Alpha-5 note: ask by the real NORAD id, the TLE carries the letter form; Tle.parse maps it back
    return { sats: r.sats, errors: r.errors, satid: o.info.satid, transactions: o.info.transactionscount };
  }
  /* N2YO /radiopasses -> normalised passes (ms timestamps) + quota */
  function parseN2yoPasses(text) {
    var o = jsonOrThrow(text, "N2YO"); n2yoError(o);
    if (!o || !o.info || !Array.isArray(o.passes || [])) throw SourceError("parse", "N2YO response has no passes");
    return { satid: o.info.satid, satname: o.info.satname, transactions: o.info.transactionscount, passes: (o.passes || []).map(function (p) {
      return { aos: p.startUTC * 1000, tca: p.maxUTC * 1000, los: p.endUTC * 1000, maxEl: p.maxEl, aosAz: p.startAz, tcaAz: p.maxAz, losAz: p.endAz, aosCompass: p.startAzCompass, tcaCompass: p.maxAzCompass, losCompass: p.endAzCompass };
    }) };
  }
  /* Our passes (computed with minEl 0) vs N2YO radio passes: nearest TCA within tol. Returns rows + unmatched counts. */
  function matchPasses(ours, theirs, tolMs) {
    tolMs = tolMs || 10 * 60e3; var used = {}, rows = [];
    ours.forEach(function (a) {
      var best = null, bi = -1; theirs.forEach(function (b, i) { var d = Math.abs(a.tca - b.tca); if (!used[i] && d <= tolMs && (best === null || d < best)) { best = d; bi = i; } });
      if (bi >= 0) { used[bi] = 1; var b = theirs[bi]; rows.push({ ours: a, theirs: b, dAosS: (a.aos - b.aos) / 1000, dTcaS: (a.tca - b.tca) / 1000, dLosS: (a.los - b.los) / 1000, dMaxEl: a.maxEl - b.maxEl }); }
      else rows.push({ ours: a, theirs: null });
    });
    var onlyTheirs = theirs.filter(function (b, i) { return !used[i]; });
    return { rows: rows, onlyTheirs: onlyTheirs };
  }

  /* ---------- SatNOGS transmitters -> Doppler radio entries ---------- */
  function finiteOrNull(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  /* CTCSS/PL tone in a SatNOGS description ("CTCSS 67.0 Hz", "PL 88.5Hz", "tone 74.4") -> number or null. Only the 67-254.1 Hz CTCSS range is accepted. */
  function toneFromText(txt) {
    var m = /(?:ctcss|\bPL\b|tone)\s*[:=]?\s*(\d{2,3}(?:\.\d)?)\s*(?:hz)?/i.exec(String(txt || "")); if (!m) return null;
    var v = parseFloat(m[1]); return v >= 60 && v <= 260 ? v : null;
  }
  /* SatNOGS drift fields are parts per billion of the listed frequency (checked: SO-50 -4579 ppb on 436.795 MHz = -2.0 kHz, AO-7 -30827 ppb on 145.9775 MHz = -4.5 kHz, matching the known on-air offsets). */
  function driftHz(f, ppb) { return f && ppb ? Math.round(f * ppb / 1e9) : 0; }
  function normalizeTx(o) {
    return { uuid: o.uuid, description: String(o.description || "").slice(0, 80), type: o.type, alive: o.alive !== false, status: o.status, mode: o.mode || null, uplinkMode: o.uplink_mode || null,
      upLo: o.uplink_low || null, upHi: o.uplink_high || null, downLo: o.downlink_low || null, downHi: o.downlink_high || null, invert: !!o.invert, baud: o.baud || null, upDrift: finiteOrNull(o.uplink_drift), downDrift: finiteOrNull(o.downlink_drift), updated: o.updated || null, citation: o.citation || "" };
  }
  function parseSatnogsTransmitters(text) {
    var arr = jsonOrThrow(text, "SatNOGS"); if (!Array.isArray(arr)) { if (arr && arr.detail) throw SourceError(/throttl/i.test(arr.detail) ? "rate" : "auth", "SatNOGS: " + String(arr.detail).slice(0, 140), /throttl/i.test(arr.detail) ? 429 : 401); throw SourceError("parse", "SatNOGS response was not a list"); }
    var by = {};
    arr.forEach(function (o) { if (o && o.norad_cat_id && o.alive !== false && o.status === "active" && (o.downlink_low || o.uplink_low)) (by[o.norad_cat_id] = by[o.norad_cat_id] || []).push(normalizeTx(o)); });
    return by;
  }
  // SatNOGS transmitter -> radio entry usable by the Doppler tab (same fields as radio.js entries), flagged live
  function txToRadio(t, fetchedAt) {
    var linear = t.upLo && t.upHi && t.downLo && t.downHi && /transponder/i.test(t.type || ""), M = 1e6;
    var label = "SatNOGS: " + (t.description || t.mode || "transmitter");
    var dd = driftHz(t.downLo, t.downDrift), ud = driftHz(t.upLo, t.upDrift);
    var note = "Live from SatNOGS DB (status " + t.status + ", entry updated " + String(t.updated || "?").slice(0, 10) + (t.citation ? ", source: " + t.citation : "") + ")."
      + (dd || ud ? " Listed drift applied: " + (dd ? "downlink " + (dd > 0 ? "+" : "") + dd + " Hz" : "") + (dd && ud ? ", " : "") + (ud ? "uplink " + (ud > 0 ? "+" : "") + ud + " Hz" : "") + " (SatNOGS value in ppb)." : "")
      + " Crowd-sourced – verify before operating.";
    if (linear) return { label: label, mode: t.mode || "linear", kind: "linear", upLo: t.upLo + ud, upHi: t.upHi + ud, downLo: t.downLo + dd, downHi: t.downHi + dd, inverting: t.invert, note: note, live: true, source: "SatNOGS DB", fetchedAt: fetchedAt };
    var fm = /^FM$/i.test(t.mode || "") && t.upLo && t.downLo, up = t.upLo ? t.upLo + ud : null, down = t.downLo ? t.downLo + dd : null;
    var tone = toneFromText(t.description);
    return { label: label + (up && !down ? " (uplink only)" : ""), mode: (t.mode || t.uplinkMode || "?") + (t.baud ? " " + t.baud + " baud" : ""), kind: fm ? "fm" : "digital", up: up, down: down, tone: tone, note: note + (tone ? " CTCSS " + tone + " Hz taken from the description." : ""), live: true, source: "SatNOGS DB", fetchedAt: fetchedAt };
  }
  /* Compare a bundled (nominal) radio entry with the live list: matched if some live downlink (or linear band) is within tolHz. */
  function compareNominal(nominal, live, tolHz) {
    tolHz = tolHz || 5000;
    return (nominal || []).map(function (r) {
      var lo = r.kind === "linear" ? r.downLo : r.down, hi = r.kind === "linear" ? r.downHi : r.down, best = null;
      (live || []).forEach(function (t) { var tl = t.downLo, th = t.downHi || t.downLo; if (!tl || lo == null) return; var d = (th < lo ? lo - th : tl > hi ? tl - hi : 0); if (best === null || d < best.d) best = { d: d, tx: t }; });
      return { label: r.label, nominalDownHz: lo, matched: !!best && best.d <= tolHz, nearestDeltaHz: best ? best.d : null, nearest: best ? best.tx.description : null };
    });
  }

  /* ---------- politeness: sliding-window limiter, backoff, hourly-minute avoidance ---------- */
  function limiterKey(id, op) { return LIMITS[id + ":" + op] ? id + ":" + op : LIMITS[id] ? id : null; }
  // hist: {key: [timestamps]} (mutated copy returned). check -> {ok, waitMs}
  function limitCheck(hist, id, op, now) {
    var k = limiterKey(id, op); if (!k) return { ok: true, waitMs: 0 };
    var wait = 0, ts = (hist && hist[k]) || [];
    LIMITS[k].forEach(function (w) { var inWin = ts.filter(function (t) { return now - t < w.ms; }); if (inWin.length >= w.n) wait = Math.max(wait, w.ms - (now - inWin[0])); });
    return { ok: wait === 0, waitMs: wait };
  }
  function limitRecord(hist, id, op, now) {
    var k = limiterKey(id, op); hist = hist || {}; if (!k) return hist;
    var maxMs = Math.max.apply(null, LIMITS[k].map(function (w) { return w.ms; }));
    hist[k] = (hist[k] || []).filter(function (t) { return now - t < maxMs; }); hist[k].push(now); return hist;
  }
  function limitUsed(hist, id, op, now) { var k = limiterKey(id, op); if (!k) return null; var w = LIMITS[k][LIMITS[k].length - 1]; return { used: ((hist && hist[k]) || []).filter(function (t) { return now - t < w.ms; }).length, limit: w.n, windowMs: w.ms }; }
  function backoffMs(fails, kind) {
    var ms = Math.min(12 * 3600e3, 30 * 60e3 * Math.pow(2, Math.max(0, (fails || 1) - 1)));
    if (kind === "rate") ms = Math.max(ms, 2 * 3600e3);
    return ms;
  }
  // Space-Track asks that hourly scripts avoid the top and bottom of the hour: defer automatic pulls that fall in those minutes.
  function avoidBusyMinute(now) { var m = new Date(now).getMinutes(); return m >= 58 || m <= 2 || (m >= 28 && m <= 32); }
  function nextOkMinuteMs(now) { var t = now; for (var i = 0; i < 70 && avoidBusyMinute(t); i++) t += 60e3; return t - now; }

  /* ---------- optional passphrase encryption of the stored credentials (WebCrypto PBKDF2 -> AES-GCM) ---------- */
  function b64(buf) { var s = "", a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64")); }
  function unb64(str) { var s = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("binary"), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function getSubtle(c) { c = c || (typeof crypto !== "undefined" ? crypto : null); if (!c || !c.subtle) throw SourceError("config", "This browser has no WebCrypto (needs HTTPS)."); return c; }
  var PBKDF2_ITER = 250000;
  function deriveKey(c, pass, salt, iter) {
    return c.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]).then(function (k) {
      return c.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function encryptCreds(obj, pass, c) {
    c = getSubtle(c); var salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    return deriveKey(c, pass, salt, PBKDF2_ITER).then(function (key) { return c.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj))); })
      .then(function (ct) { return { enc: 1, iter: PBKDF2_ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }; });
  }
  function decryptCreds(blob, pass, c) {
    c = getSubtle(c);
    return deriveKey(c, pass, unb64(blob.salt), blob.iter || PBKDF2_ITER).then(function (key) { return c.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct)); })
      .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); }, function () { throw SourceError("auth", "Wrong passphrase."); });
  }

  /* ---------- user-facing messages ---------- */
  function kindWord(kind) { return kind === "network" ? "unreachable" : kind === "rate" ? "rate-limited" : kind === "auth" ? "rejected the credentials" : kind === "config" ? "not set up" : kind === "locked" ? "locked" : kind === "parse" ? "sent unusable data" : "returned an error"; }
  function fallbackMessage(failed, used) {   // failed: [{id, kind}], used: id | null
    var parts = failed.map(function (f) { return META[f.id].label + " " + kindWord(f.kind); });
    if (!parts.length) return used ? "Updated from " + META[used].label + "." : "";
    return parts.join("; ") + (used ? " — using " + META[used].label : "");
  }

  return {
    IDS: IDS, META: META, LIMITS: LIMITS, MIN_PULL_MS: MIN_PULL_MS, AUTO_MIN_MS: AUTO_MIN_MS, N2YO_MAX_SATS: N2YO_MAX_SATS, ST_CHUNK: ST_CHUNK, CSP_CONNECT: CSP_CONNECT, PBKDF2_ITER: PBKDF2_ITER,
    SourceError: SourceError, classifyHttp: classifyHttp, redact: redact, defaultConfig: defaultConfig, normalizeConfig: normalizeConfig, validateProxyUrl: validateProxyUrl, proxyAllowedByCsp: proxyAllowedByCsp,
    credsComplete: credsComplete, readiness: readiness, buildRequest: buildRequest, chunk: chunk, intList: intList,
    parseSpaceTrackGp: parseSpaceTrackGp, parseSatnogsTle: parseSatnogsTle, parseN2yoTle: parseN2yoTle, parseN2yoPasses: parseN2yoPasses, matchPasses: matchPasses,
    parseSatnogsTransmitters: parseSatnogsTransmitters, txToRadio: txToRadio, toneFromText: toneFromText, compareNominal: compareNominal,
    limitCheck: limitCheck, limitRecord: limitRecord, limitUsed: limitUsed, backoffMs: backoffMs, avoidBusyMinute: avoidBusyMinute, nextOkMinuteMs: nextOkMinuteMs,
    encryptCreds: encryptCreds, decryptCreds: decryptCreds, fallbackMessage: fallbackMessage, kindWord: kindWord
  };
});
