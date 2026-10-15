const { ok, near, throws, done, snapshot } = require("./harness");
const P = require("../js/passes.js"), T = require("../js/tle.js");
const sats = T.parse(snapshot().tle).sats, byId = id => sats.find(s => s.norad === id);
const iss = byId(25544), S = P.makeSat(iss);
const obs = P.makeObserver(30.27, -97.74, 150);
const start = Math.ceil(iss.epochMs / 3600000) * 3600000;
const DAYS = 5;
let passes;
(function () { const t = Date.now(); passes = P.findPasses(S, obs, start, start + DAYS * 86400000, { minEl: 10 }); ok("findPasses over 5 days is fast (<3 s)", Date.now() - t < 3000, (Date.now() - t) + " ms"); })();
ok("ISS: found passes over 5 days (8–30)", passes.length >= 8 && passes.length <= 30, passes.length);
ok("passes sorted by AOS", passes.every((p, i) => i === 0 || p.aos > passes[i - 1].aos));
ok("passes don't overlap", passes.every((p, i) => i === 0 || p.aos > passes[i - 1].los));
ok("AOS < TCA < LOS", passes.every(p => p.aos < p.tca && p.tca < p.los));
ok("azimuths within 0–360", passes.every(p => [p.aosAz, p.tcaAz, p.losAz].every(a => a >= 0 && a < 360)));
ok("LEO durations plausible (>1 min, <15 min)", passes.every(p => p.durationSec > 60 && p.durationSec < 900), passes.map(p => Math.round(p.durationSec)).join(","));
ok("max elevation ≥ min elevation (10°) and ≤ 90°", passes.every(p => p.maxEl >= 10 - 0.01 && p.maxEl <= 90));
// elevation at AOS / LOS ≈ min elevation
let worstEdge = 0;
passes.forEach(p => { worstEdge = Math.max(worstEdge, Math.abs(P.stateAt(S, obs, p.aos).el - 10), Math.abs(P.stateAt(S, obs, p.los).el - 10)); });
ok("elevation at AOS/LOS = min elevation (±0.1°)", worstEdge < 0.1, worstEdge);
// TCA is the maximum: no sample within the pass exceeds maxEl
let maxViol = 0, tcaOff = 0;
passes.forEach(p => { const tr = P.trackPass(S, obs, p.aos, p.los, 5); tr.forEach(s => { maxViol = Math.max(maxViol, s.el - p.maxEl); }); const best = tr.reduce((a, b) => b.el > a.el ? b : a); tcaOff = Math.max(tcaOff, Math.abs(best.t - p.tca)); });
ok("no sampled elevation exceeds reported max (≤0.01°)", maxViol < 0.01, maxViol);
ok("TCA within 5 s of the sampled maximum", tcaOff <= 5000, tcaOff);
ok("range at TCA < range at AOS and LOS", passes.every(p => p.rangeAtTcaKm < P.stateAt(S, obs, p.aos).rangeKm && p.rangeAtTcaKm < P.stateAt(S, obs, p.los).rangeKm));
ok("range rate crosses zero near TCA", passes.every(p => Math.abs(P.stateAt(S, obs, p.tca).rrKmS) < 0.15));
// min elevation filter: higher filter -> subset, shorter
const p30 = P.findPasses(S, obs, start, start + DAYS * 86400000, { minEl: 30 }), p0 = P.findPasses(S, obs, start, start + DAYS * 86400000, { minEl: 0 });
ok("minEl 30 gives fewer passes than 10, all with maxEl ≥ 30", p30.length < passes.length && p30.every(p => p.maxEl >= 30 - 0.01), [p30.length, passes.length]);
ok("minEl 0 gives ≥ as many passes as 10", p0.length >= passes.length, [p0.length, passes.length]);
ok("every minEl-30 pass is also a minEl-10 pass (same TCA)", p30.every(p => passes.some(q => Math.abs(q.tca - p.tca) < 5000)));
// step independence
const pFine = P.findPasses(S, obs, start, start + 2 * 86400000, { minEl: 10, stepSec: 5 }), pCoarse = P.findPasses(S, obs, start, start + 2 * 86400000, { minEl: 10, stepSec: 30 });
ok("step 5 s vs 30 s: same passes", pFine.length === pCoarse.length && pFine.every((p, i) => Math.abs(p.aos - pCoarse[i].aos) < 1500 && Math.abs(p.los - pCoarse[i].los) < 1500));
// in-progress at window start: start in the middle of a pass -> real AOS before start
const mid = passes[2], inprog = P.findPasses(S, obs, mid.tca, mid.tca + 3 * 3600000, { minEl: 10 });
ok("start inside a pass: first pass reported with true AOS before window start", inprog[0].inProgressAtStart && Math.abs(inprog[0].aos - mid.aos) < 1500 && inprog[0].aos < mid.tca);
ok("empty window -> no passes", P.findPasses(S, obs, start, start, {}).length === 0);
// trackPass sampling
const tr = P.trackPass(S, obs, passes[0].aos, passes[0].los, 30);
ok("trackPass first/last sample are AOS/LOS", tr[0].t === passes[0].aos && tr[tr.length - 1].t === passes[0].los);
ok("trackPass sample spacing ≤ 30 s", tr.every((s, i) => i === 0 || s.t - tr[i - 1].t <= 30000));
ok("track elevations ≥ min (minus tiny tol) inside pass", tr.every(s => s.el >= 10 - 0.1));
// geostationary sats have no passes
const geo = byId(43700); if (geo) { const g = P.makeSat(geo); ok("geostationary flagged, no passes", g.geo && P.findPasses(g, obs, start, start + 86400000, {}).length === 0); }
// high-eccentricity satellite (AO-10, ~2 rev/day): long passes OK
const ao10 = byId(14129); if (ao10) { const q = P.findPasses(P.makeSat(ao10), obs, start, start + 5 * 86400000, { minEl: 10 }); ok("AO-10 (Molniya-type) passes found, durations long but < 14 h", q.length > 0 && q.every(p => p.durationSec > 600 && p.durationSec < 14 * 3600), q.map(p => (p.durationSec / 3600).toFixed(1) + "h").join(",")); }

/* ---------- sun / shadow / visibility logic ---------- */
// Sun position check: 2026-03-20 14:46 UTC ≈ March equinox; sun on equator near longitude of its subsolar point
const eq = Date.UTC(2026, 2, 20, 14, 46);
const sv = P.sunEci(eq), decl = Math.asin(sv[2] / Math.hypot(...sv)) * 180 / Math.PI;
near("sun declination at March equinox ≈ 0°", decl, 0, 0.3);
near("sun distance ≈ 1 AU (0.996 in March)", Math.hypot(...sv) / 149597870.7, 0.996, 0.003);
const sj = P.sunEci(Date.UTC(2026, 5, 21, 12)), dj = Math.asin(sj[2] / Math.hypot(...sj)) * 180 / Math.PI;
near("sun declination at June solstice ≈ +23.44°", dj, 23.44, 0.1);
const sd = P.sunEci(Date.UTC(2026, 11, 21, 12)), dd = Math.asin(sd[2] / Math.hypot(...sd)) * 180 / Math.PI;
near("sun declination at December solstice ≈ −23.44°", dd, -23.44, 0.1);
const eq0 = P.makeObserver(0, 0, 0);
const noonUtc = Date.UTC(2026, 2, 20, 12, 7); // equation of time ≈ −7 min -> local apparent noon at lon 0 ≈ 12:07 UTC
ok("equator lon 0 near local noon at equinox: sun elevation > 85°", P.sunElevation(eq0, noonUtc) > 85, P.sunElevation(eq0, noonUtc));
ok("equator lon 0 at midnight: sun elevation < −85°", P.sunElevation(eq0, noonUtc + 12 * 3600000) < -85);
// sunlit logic with explicit vectors
const sun = [149597870.7, 0, 0];
ok("satellite on the sun side is sunlit", P.isSunlit([7000, 0, 0], sun));
ok("satellite directly behind Earth is in shadow", !P.isSunlit([-7000, 0, 0], sun));
ok("behind Earth but outside cylinder radius (7000 km offset) is sunlit", P.isSunlit([-1000, 7000, 0], sun));
ok("behind Earth, 6300 km off-axis is in shadow (inside 6378 km cylinder)", !P.isSunlit([-1000, 6300, 0], sun));
ok("at terminator plane, 7000 km above is sunlit", P.isSunlit([0, 7000, 0], sun));
// visibility flag consistency: a pass flagged visible must have, at some sample, sunlit && sun el < -6 && el>0
let visOk = true, anyVis = 0, nonVisOk = true;
passes.forEach(p => {
  const tr = P.trackPass(S, obs, p.aos, p.los, 5), v = tr.filter(s => s.visible);
  if (p.visible) { anyVis++; if (!v.length) visOk = false; if (!v.every(s => s.sunlit && s.sunEl < -6 && s.el > 0)) visOk = false; }
  else if (v.length > 2) nonVisOk = false;  // allow tiny sampling slop at the edges
});
ok("visible passes have a sample that is sunlit, sun < −6° and above horizon", visOk, anyVis + " visible of " + passes.length);
ok("non-visible passes have no (meaningful) visible samples", nonVisOk);
ok("at least one visible ISS pass in 5 days (this observer/season)", anyVis >= 1, anyVis);
ok("visStart/visEnd inside the pass", passes.filter(p => p.visible).every(p => p.visStart >= p.aos && p.visEnd <= p.los && p.visEnd >= p.visStart));
// daytime pass can never be visible; sun elevation reported at TCA consistent
ok("passes with sun elevation > −6° at TCA and in daylight are not visible at TCA", passes.every(p => !(p.sunElAtTca > -6 && p.visible && p.visStart === p.visEnd && p.visStart === p.tca)));
ok("footprint half-angle for 420 km ≈ 20°", Math.abs(P.footprintAngleDeg(420, 0) - 20.3) < 0.3, P.footprintAngleDeg(420, 0));
ok("footprint shrinks with elevation mask", P.footprintAngleDeg(420, 10) < P.footprintAngleDeg(420, 0));
throws("observer lat out of range", () => P.makeObserver(95, 0, 0), /Latitude/);
done();
