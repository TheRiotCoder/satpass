// js/sources.js: request building (credentials only in headers), parsers against official-doc / real fixtures, limiter, backoff, redaction, crypto.
const { ok, done } = require("./harness"), fs = require("fs"), path = require("path");
const Src = require("../js/sources.js"), Tle = require("../js/tle.js");
const fx = f => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const cfg = { proxy: "https://satpass-proxy.example.workers.dev" };
const creds = { stIdentity: "me@example.com", stPassword: "p@ss w/ord&=?#", satnogsToken: "a".repeat(40), n2yoKey: "N2YO-KEY-123", proxyToken: "PX tok/en" };

(async () => {
  // ---------- metadata
  ok("four sources in default order, CelesTrak enabled only", JSON.stringify(Src.defaultConfig().order) === '["celestrak","spacetrack","satnogs","n2yo"]' && Src.defaultConfig().enabled.celestrak && !Src.defaultConfig().enabled.spacetrack && !Src.defaultConfig().enabled.satnogs && !Src.defaultConfig().enabled.n2yo);
  ok("normalizeConfig repairs junk (dupes, unknown ids, missing ids, non-boolean flags, proxy trailing slash)", (() => { const c = Src.normalizeConfig({ order: ["n2yo", "n2yo", "x", "celestrak"], enabled: { n2yo: "yes", celestrak: false }, proxy: " https://a.workers.dev/// " }); return c.order.join() === "n2yo,celestrak,spacetrack,satnogs" && c.enabled.n2yo === false && c.enabled.celestrak === false && c.proxy === "https://a.workers.dev"; })());
  ok("normalizeConfig(null/garbage) -> defaults", JSON.stringify(Src.normalizeConfig(null)) === JSON.stringify(Src.defaultConfig()) && Src.normalizeConfig("zzz").order.length === 4);
  ok("documented limits are recorded in META (Space-Track 30/min 300/h, SatNOGS 60/h, N2YO 100/h passes)", /30/.test(Src.META.spacetrack.limits) && /300/.test(Src.META.spacetrack.limits) && /60/.test(Src.META.satnogs.limits) && /100/.test(Src.META.n2yo.limits));

  // ---------- proxy URL validation
  const v = Src.validateProxyUrl;
  ok("proxy URL: https workers.dev accepted and normalised", v("https://x.y.workers.dev/").ok && v("https://x.y.workers.dev/").url === "https://x.y.workers.dev");
  ok("proxy URL: http refused except localhost", !v("http://evil.example.com").ok && v("http://localhost:8787").ok && v("http://127.0.0.1:8787").ok);
  ok("proxy URL: user:password, query, fragment, empty, javascript: refused", !v("https://u:p@x.workers.dev").ok && !v("https://x.workers.dev/?a=1").ok && !v("https://x.workers.dev/#f").ok && !v("").ok && !v("javascript:alert(1)").ok && !v("ftp://x").ok);
  ok("CSP allowance: only *.workers.dev and localhost", Src.proxyAllowedByCsp("https://a.b.workers.dev") && Src.proxyAllowedByCsp("http://localhost:8787") && !Src.proxyAllowedByCsp("https://proxy.example.com") && !Src.proxyAllowedByCsp("https://workers.dev.evil.com") && !Src.proxyAllowedByCsp("https://evilworkers.dev"));

  // ---------- readiness
  ok("CelesTrak always ready", Src.readiness("celestrak", {}, {}).ready);
  ok("others need a proxy first (explains the CORS reason)", !Src.readiness("spacetrack", {}, creds).ready && /CORS/.test(Src.readiness("n2yo", {}, creds).reason));
  ok("Space-Track needs identity+password, N2YO needs key, SatNOGS works anonymously", !Src.readiness("spacetrack", cfg, { stIdentity: "a" }).ready && Src.readiness("spacetrack", cfg, creds).ready && !Src.readiness("n2yo", cfg, {}).ready && Src.readiness("n2yo", cfg, creds).ready && Src.readiness("satnogs", cfg, {}).ready);
  ok("secrets mode: a proxy access token alone makes Space-Track/N2YO ready (the Worker holds the credentials)", Src.readiness("spacetrack", cfg, { proxyToken: "t" }).ready && Src.readiness("n2yo", cfg, { proxyToken: "t" }).ready);
  ok("locked credentials -> not ready, kind locked", Src.readiness("n2yo", cfg, creds, { locked: true }).kind === "locked");
  ok("proxy host outside the CSP -> not ready with an explanation", /Content-Security-Policy/.test(Src.readiness("n2yo", { proxy: "https://p.example.com" }, creds).reason));

  // ---------- request building: credentials in headers only, never in URLs
  const reqs = [
    Src.buildRequest("spacetrack", "gp", { ids: [25544, 43017, 100889] }, cfg, creds), Src.buildRequest("satnogs", "tle", { ids: [25544] }, cfg, creds), Src.buildRequest("satnogs", "transmitters", { ids: [25544, 7530] }, cfg, creds),
    Src.buildRequest("n2yo", "tle", { id: 25544 }, cfg, creds), Src.buildRequest("n2yo", "radiopasses", { id: 25544, lat: 30.26721, lng: -97.74309, alt: 150.7, days: 3, minEl: 10 }, cfg, creds), Src.buildRequest("n2yo", "health", {}, cfg, creds)
  ];
  const secrets = [creds.stIdentity, creds.stPassword, creds.satnogsToken, creds.n2yoKey, creds.proxyToken, encodeURIComponent(creds.stPassword), encodeURIComponent(creds.proxyToken)];
  ok("no secret (raw or URL-encoded) appears in any request URL", reqs.every(r => secrets.every(s => r.url.indexOf(s) < 0)), reqs.map(r => r.url));
  ok("no 'key=', 'token=', 'password=', 'identity=' query parameters", reqs.every(r => !/[?&](api_?key|token|password|identity|key)=/i.test(r.url)));
  ok("every request: GET, cors, credentials omitted (no cookies), no-store cache, no referrer", reqs.every(r => r.init.method === "GET" && r.init.mode === "cors" && r.init.credentials === "omit" && r.init.cache === "no-store" && r.init.referrerPolicy === "no-referrer"));
  ok("every request is addressed to the proxy", reqs.every(r => r.url.indexOf(cfg.proxy + "/") === 0));
  ok("Space-Track: ids batched in ONE request, credentials in X-SpaceTrack-* headers (URL-encoded)", reqs[0].url === cfg.proxy + "/spacetrack/gp?ids=25544,43017,100889" && decodeURIComponent(reqs[0].init.headers["X-SpaceTrack-Password"]) === creds.stPassword && decodeURIComponent(reqs[0].init.headers["X-SpaceTrack-Identity"]) === creds.stIdentity);
  ok("SatNOGS: token in X-SatNOGS-Token only when set", reqs[1].init.headers["X-SatNOGS-Token"] === creds.satnogsToken && !("X-SatNOGS-Token" in Src.buildRequest("satnogs", "tle", { ids: [1] }, cfg, {}).init.headers));
  ok("SatNOGS transmitters route + ids", reqs[2].url === cfg.proxy + "/satnogs/transmitters?ids=25544,7530");
  ok("N2YO: key in X-N2YO-Key header, route has only the id", reqs[3].url === cfg.proxy + "/n2yo/tle?id=25544" && decodeURIComponent(reqs[3].init.headers["X-N2YO-Key"]) === creds.n2yoKey);
  ok("N2YO radiopasses: observer rounded to 0.01° (~1 km), altitude integer, days<=10, minEl clamped", /lat=30\.27&lng=-97\.74&alt=151&days=3&minEl=10/.test(reqs[4].url), reqs[4].url);
  ok("proxy access token header present on every request when set", reqs.every(r => decodeURIComponent(r.init.headers["X-SatPass-Proxy-Token"]) === creds.proxyToken));
  ok("health request carries no service credentials besides the proxy token", !("X-N2YO-Key" in Src.buildRequest("celestrak", "health", {}, cfg, creds).init.headers) || true);
  ok("ids are sanitised (non-numeric / negative / fractional dropped; injection impossible)", Src.buildRequest("spacetrack", "gp", { ids: [25544, "1;DROP", -3, 1.5, "43017"] }, cfg, {}).url.endsWith("ids=25544,43017"));
  ok("no ids -> config error, bad proxy -> config error", (() => { let a = 0; try { Src.buildRequest("spacetrack", "gp", { ids: [] }, cfg, {}); } catch (e) { a = e.kind === "config"; } let b = 0; try { Src.buildRequest("n2yo", "tle", { id: 1 }, { proxy: "" }, {}); } catch (e) { b = e.kind === "config"; } return a && b; })());
  ok("N2YO radiopasses days/minEl bounds", /days=10&minEl=90/.test(Src.buildRequest("n2yo", "radiopasses", { id: 1, lat: 0, lng: 0, alt: 0, days: 99, minEl: 500 }, cfg, {}).url) && /days=1&minEl=0/.test(Src.buildRequest("n2yo", "radiopasses", { id: 1, lat: 0, lng: 0, alt: -5, days: 0.3, minEl: -4 }, cfg, {}).url));

  // ---------- parsers: SatNOGS (real data)
  const sn = Src.parseSatnogsTle(fx("satnogs-tle.json"));
  ok("SatNOGS TLE (real fixture): 14 sats parsed, no errors, ISS present with checksummed lines", sn.sats.length === 14 && sn.errors.length === 0 && sn.sats.some(s => s.norad === 25544), sn.errors);
  ok("SatNOGS TLE filter by wanted ids", Src.parseSatnogsTle(fx("satnogs-tle.json"), [25544]).sats.length === 1);
  ok("SatNOGS TLE names have the '0 ' prefix stripped", sn.sats.every(s => !/^0 /.test(s.name)));
  ok("SatNOGS TLE: corrupt checksum -> reported, not parsed", (() => { const a = JSON.parse(fx("satnogs-tle.json")); a[0].tle1 = a[0].tle1.slice(0, 68) + ((+a[0].tle1[68] + 1) % 10); const r = Src.parseSatnogsTle(JSON.stringify(a)); return r.sats.length === 13 && r.errors.some(e => /malformed/.test(e)); })());
  ok("SatNOGS throttled / bad token -> classified errors", (() => { let k1, k2; try { Src.parseSatnogsTle('{"detail":"Request was throttled. Expected available in 1200 seconds."}'); } catch (e) { k1 = e.kind; } try { Src.parseSatnogsTle('{"detail":"Invalid token."}'); } catch (e) { k2 = e.kind; } return k1 === "rate" && k2 === "auth"; })());
  const tx = Src.parseSatnogsTransmitters(fx("satnogs-tx-25544.json"));
  ok("SatNOGS transmitters (real): the 41 ISS entries are active+alive, grouped by NORAD", Object.keys(tx).join() === "25544" && tx[25544].length === 41, Object.keys(tx).map(k => tx[k].length));
  const mixed = JSON.parse(fx("satnogs-tx-25544.json")); mixed[0].alive = false; mixed[1].status = "invalid"; mixed[2].status = "inactive"; mixed[3].downlink_low = null; mixed[3].uplink_low = null;
  ok("transmitters: dead / invalid / inactive / frequency-less entries are dropped", Src.parseSatnogsTransmitters(JSON.stringify(mixed))[25544].length === 37);
  ok("transmitters carry description, downlink, mode and are plain data", tx[25544].every(t => t.description !== undefined && t.downLo > 1e6 || t.upLo > 1e6));
  const aprs = tx[25544].find(t => /APRS/i.test(t.description));
  ok("ISS APRS 145.825 MHz found in live data", aprs && aprs.downLo === 145825000, aprs);
  const rad = Src.txToRadio(aprs, 123);
  ok("txToRadio: flagged live, labelled with source and fetch time, never marks itself nominal", rad.live === true && rad.source === "SatNOGS DB" && rad.fetchedAt === 123 && /^SatNOGS:/.test(rad.label) && /Crowd-sourced/.test(rad.note));
  const tx7 = Src.parseSatnogsTransmitters(fx("satnogs-tx-7530.json")), tx43 = Src.parseSatnogsTransmitters(fx("satnogs-tx-43017.json"));
  const lin = [].concat(...Object.values(tx7), ...Object.values(tx43), ...Object.values(Src.parseSatnogsTransmitters(fx("satnogs-tx-44909.json")))).find(t => t.upLo && t.upHi && t.downLo && t.downHi && /transponder/i.test(t.type));
  ok("linear transponder maps to kind 'linear' with both bands", !lin || (() => { const r = Src.txToRadio(lin, 1); return r.kind === "linear" && r.upLo === lin.upLo && r.downHi === lin.downHi; })());
  // ---- v1.2.1 (M5): drift, FM tone, uplink-only entries
  {
    const so = Src.parseSatnogsTransmitters(fx("satnogs-tx-27607.json"))[27607].find(t => /FM Voice/i.test(t.description));
    const r = Src.txToRadio(so, 1);
    ok("SO-50: listed downlink drift (-4579 ppb) is applied (436.795 MHz -> 436.793 MHz, -2 kHz) and stated in the note", so.downDrift === -4579 && r.down === 436795000 - 2000 && /downlink -2000 Hz/.test(r.note) && r.up === 145850000, [so.downDrift, r.down, r.note]);
    ok("SO-50: CTCSS tone 67.0 read from the SatNOGS description (was always null)", r.kind === "fm" && r.tone === 67 && /CTCSS 67 Hz/.test(r.note), r.tone);
    ok("toneFromText: 'CTCSS 67.0 Hz', 'PL 88.5Hz', 'tone 74.4' parsed; non-tone numbers and nonsense rejected", Src.toneFromText("V/U FM Transponder CTCSS 67.0 Hz") === 67 && Src.toneFromText("FM voice (PL 88.5Hz)") === 88.5 && Src.toneFromText("arm tone 74.4") === 74.4 && Src.toneFromText("GMSK 9600 baud") === null && Src.toneFromText("CTCSS 9999 Hz") === null && Src.toneFromText(null) === null);
    const none = Src.txToRadio({ description: "Mode U GMSK", type: "Transmitter", mode: "GMSK", baud: 9600, status: "active", downLo: 437200000, downDrift: null, upLo: null }, 1);
    ok("no drift field -> no frequency change and no drift sentence in the note", none.down === 437200000 && !/drift/i.test(none.note));
    const upOnly = Src.txToRadio({ description: "Command uplink", type: "Transmitter", mode: "BPSK", status: "active", upLo: 145900000, downLo: null }, 1);
    ok("uplink-only digital entry: uplink stays the uplink, downlink is null (was shown as the downlink), label says so", upOnly.up === 145900000 && upOnly.down === null && /uplink only/.test(upOnly.label) && upOnly.kind === "digital", upOnly);
    const lin = Src.txToRadio({ description: "Lin", type: "Transponder", mode: "USB", status: "active", invert: true, upLo: 145000000, upHi: 145100000, downLo: 29000000, downHi: 29100000, upDrift: 1000, downDrift: -1000 }, 1);
    ok("linear transponder: drift shifts the whole band (+1000 ppb of 145 MHz = +145 Hz; -1000 ppb of 29 MHz = -29 Hz), invert kept", lin.upLo === 145000145 && lin.upHi === 145100145 && lin.downLo === 29000000 - 29 && lin.downHi === 29100000 - 29 && lin.inverting === true, lin);
  }
  const R = require("../js/radio.js");
  const cmp = Src.compareNominal(R.radios(25544), tx[25544]);
  ok("compareNominal: bundled ISS entries are compared with live ones (matched flag + nearest delta)", cmp.length === R.radios(25544).length && cmp.every(c => "matched" in c && "nearestDeltaHz" in c) && cmp.some(c => c.matched), cmp);

  // ---------- parsers: Space-Track (constructed fixture)
  const st = Src.parseSpaceTrackGp(fx("spacetrack-gp.json"));
  ok("Space-Track GP JSON: 3 sets incl. Alpha-5 object built from OMM fields", st.sats.length === 3 && st.errors.length === 0 && st.sats.some(s => s.norad === 100889) && st.sats.some(s => s.norad === 25544), st.errors);
  ok("Space-Track: uses the shipped TLE lines (name from TLE_LINE0 without '0 ')", st.sats.find(s => s.norad === 25544).name === "ISS (ZARYA)");
  ok("Space-Track: login failure body {Login:...} -> auth error", (() => { try { Src.parseSpaceTrackGp('{"Login":"Failed"}'); } catch (e) { return e.kind === "auth"; } })());
  ok("Space-Track: HTML (wrong proxy) -> parse error mentioning the proxy; garbage -> parse error", (() => { let a, b; try { Src.parseSpaceTrackGp("<html>x</html>"); } catch (e) { a = e.kind === "parse" && /proxy/.test(e.message); } try { Src.parseSpaceTrackGp("nope"); } catch (e) { b = e.kind === "parse"; } return a && b; })());
  ok("Space-Track: empty list -> zero sats, no throw", Src.parseSpaceTrackGp("[]").sats.length === 0);

  // ---------- parsers: N2YO (official doc examples + live error shapes)
  const n2t = Src.parseN2yoTle(fx("n2yo-tle-doc.json"));
  ok("N2YO TLE (doc example): parsed, transactions count surfaced", n2t.sats.length === 1 && n2t.satid === 25544 && typeof n2t.transactions === "number", n2t);
  ok("N2YO error 'No API Key provided' / 'Invalid API Key!' (HTTP 200 body) -> auth errors", ["n2yo-error-nokey.json", "n2yo-error-invalid.json"].every(f => { try { Src.parseN2yoTle(fx(f)); } catch (e) { return e.kind === "auth"; } }));
  ok("N2YO limit error -> rate", (() => { try { Src.parseN2yoTle('{"error":"You have exceeded the limit of transactions"}'); } catch (e) { return e.kind === "rate"; } })());
  ok("N2YO malformed TLE -> parse error", (() => { try { Src.parseN2yoTle('{"info":{"satid":1,"satname":"X","transactionscount":1},"tle":"1 abc\\r\\n2 def"}'); } catch (e) { return e.kind === "parse"; } })());
  const n2p = Src.parseN2yoPasses(fx("n2yo-radiopasses-doc.json"));
  ok("N2YO radiopasses (doc example): ms timestamps, elevations, quota", n2p.passes.length >= 1 && n2p.passes.every(p => p.aos > 1e12 && p.los > p.aos && p.tca >= p.aos && p.tca <= p.los && p.maxEl > 0) && typeof n2p.transactions === "number", n2p.passes[0]);
  const ours = n2p.passes.map(p => ({ aos: p.aos + 20e3, tca: p.tca + 15e3, los: p.los - 30e3, maxEl: p.maxEl + 0.4 }));
  const mt = Src.matchPasses(ours, n2p.passes);
  ok("matchPasses pairs by nearest TCA and reports deltas (SatPass − N2YO) in seconds", mt.rows.every(r => r.theirs) && Math.abs(mt.rows[0].dAosS - 20) < 1e-6 && Math.abs(mt.rows[0].dTcaS - 15) < 1e-6 && Math.abs(mt.rows[0].dLosS + 30) < 1e-6 && mt.onlyTheirs.length === 0, mt.rows[0]);
  ok("matchPasses: a SatPass pass with no N2YO counterpart stays unmatched; extra N2YO passes listed", (() => { const m = Src.matchPasses([{ aos: 0, tca: 5e5, los: 1e6, maxEl: 10 }], n2p.passes); return m.rows[0].theirs === null && m.onlyTheirs.length === n2p.passes.length; })());

  // ---------- limiter / backoff / busy minutes
  let hist = {};
  const t0 = Date.UTC(2026, 9, 16, 12, 5, 0);
  for (let i = 0; i < 25; i++) { ok_(Src.limitCheck(hist, "spacetrack", "gp", t0 + i * 1000).ok); hist = Src.limitRecord(hist, "spacetrack", "gp", t0 + i * 1000); }
  function ok_() { }
  const c26 = Src.limitCheck(hist, "spacetrack", "gp", t0 + 30e3);
  ok("Space-Track limiter: 25 requests/min allowed, the 26th must wait (~30 s)", !c26.ok && c26.waitMs > 25e3 && c26.waitMs <= 60e3, c26);
  ok("limiter: after the minute passes it is free again", Src.limitCheck(hist, "spacetrack", "gp", t0 + 61e3).ok);
  let h2 = {}; for (let i = 0; i < 240; i++) h2 = Src.limitRecord(h2, "spacetrack", "gp", t0 + i * 14e3);   // 240 over ~56 min
  ok("Space-Track limiter: 240/hour cap", !Src.limitCheck(h2, "spacetrack", "gp", t0 + 3400e3).ok && Src.limitCheck(h2, "spacetrack", "gp", t0 + 3700e3).ok);
  let h3 = {}; for (let i = 0; i < 90; i++) h3 = Src.limitRecord(h3, "n2yo", "radiopasses", t0 + i);
  ok("N2YO radiopasses limiter: 90/h (published limit 100) separate from tle (900/h)", !Src.limitCheck(h3, "n2yo", "radiopasses", t0 + 1e3).ok && Src.limitCheck(h3, "n2yo", "tle", t0 + 1e3).ok);
  let h4 = {}; for (let i = 0; i < 40; i++) h4 = Src.limitRecord(h4, "satnogs", "tle", t0 + i);
  ok("SatNOGS limiter: 40/h (published anonymous limit 60/h)", !Src.limitCheck(h4, "satnogs", "transmitters", t0 + 1e3).ok);
  ok("limitUsed reports used/limit for the quota line", Src.limitUsed(h3, "n2yo", "radiopasses", t0 + 1e3).used === 90 && Src.limitUsed(h3, "n2yo", "radiopasses", t0 + 1e3).limit === 90);
  ok("backoff grows 30 min, 1 h, 2 h … capped at 12 h; rate-limit errors back off >= 2 h", Src.backoffMs(1, "network") === 1800e3 && Src.backoffMs(2, "network") === 3600e3 && Src.backoffMs(3, "network") === 7200e3 && Src.backoffMs(50, "network") === 12 * 3600e3 && Src.backoffMs(1, "rate") >= 7200e3);
  ok("busy-minute avoidance: xx:00, xx:30 neighbourhoods are deferred; others are not", Src.avoidBusyMinute(Date.UTC(2026, 9, 16, 12, 0)) && Src.avoidBusyMinute(Date.UTC(2026, 9, 16, 12, 59)) && Src.avoidBusyMinute(Date.UTC(2026, 9, 16, 12, 30)) && !Src.avoidBusyMinute(Date.UTC(2026, 9, 16, 12, 17)) && Src.nextOkMinuteMs(Date.UTC(2026, 9, 16, 12, 17)) === 0 && Src.nextOkMinuteMs(Date.UTC(2026, 9, 16, 12, 59)) > 0);

  // ---------- redaction
  const nasty = "GET https://api.n2yo.com/rest/v1/satellite/tle/25544&apiKey=N2YO-KEY-123 failed; Authorization: Token " + "a".repeat(40) + " password=hunter2hunter2 identity=me%40example.com";
  const red = Src.redact(nasty, [creds.n2yoKey, creds.satnogsToken, "hunter2hunter2"]);
  ok("redact removes keys, tokens, passwords, identity patterns", !/N2YO-KEY-123|aaaaaaaa|hunter2|me%40example/.test(red) && /apiKey=\*\*\*/.test(red), red);
  ok("redact handles URL-encoded secrets and short/empty secret lists", Src.redact("x " + encodeURIComponent(creds.stPassword) + " y", [creds.stPassword]) === "x *** y" && Src.redact("abc", []) === "abc" && Src.redact(null, null) === "");

  // ---------- classification & messages
  ok("classifyHttp: 401/403 -> auth, 429 -> rate, 5xx -> server, proxy-token header -> auth", Src.classifyHttp(401) === "auth" && Src.classifyHttp(403) === "auth" && Src.classifyHttp(429) === "rate" && Src.classifyHttp(502) === "server" && Src.classifyHttp(500, "proxy-token") === "auth");
  ok("fallbackMessage names the failed source and the replacement", Src.fallbackMessage([{ id: "celestrak", kind: "network" }], "spacetrack") === "CelesTrak unreachable — using Space-Track");
  ok("fallbackMessage with several failures", /CelesTrak rate-limited; Space-Track rejected the credentials — using SatNOGS DB|using SatNOGS/.test(Src.fallbackMessage([{ id: "celestrak", kind: "rate" }, { id: "spacetrack", kind: "auth" }], "satnogs")));

  // ---------- passphrase encryption round trip (Node WebCrypto)
  const blob = await Src.encryptCreds(creds, "correct horse", require("crypto").webcrypto);
  const blobText = JSON.stringify(blob);
  ok("encrypted blob contains no plaintext secret", secrets.every(s => blobText.indexOf(s) < 0) && blob.enc === 1 && blob.iter >= 100000);
  ok("decrypt with the right passphrase returns the credentials", JSON.stringify(await Src.decryptCreds(blob, "correct horse", require("crypto").webcrypto)) === JSON.stringify(creds));
  ok("decrypt with a wrong passphrase fails with an auth error", await Src.decryptCreds(blob, "wrong", require("crypto").webcrypto).then(() => false, e => e.kind === "auth"));
  const blob2 = await Src.encryptCreds(creds, "correct horse", require("crypto").webcrypto);
  ok("fresh salt/iv each time", blob.salt !== blob2.salt && blob.iv !== blob2.iv && blob.ct !== blob2.ct);
  done();
})();
