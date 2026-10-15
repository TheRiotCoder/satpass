const { ok, near, done, snapshot } = require("./harness");
const sat = require("../js/vendor/satellite.min.js");
const P = require("../js/passes.js"), T = require("../js/tle.js");
// Vallado SGP4-VER.TLE case 00005 (near-earth, e=0.186). Reference output from the SGP4-VER reference run (km, km/s, TEME).
const rec = sat.twoline2satrec("1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753", "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667");
const REF = { 0: [7022.46529266, -1400.08296755, 0.03995155, 1.893841015, 6.405893759, 4.534807250], 360: [-7154.03120202, -3783.17682504, -3536.19412294, 4.741887409, -4.151817765, -2.093935425] };
for (const m of [0, 360]) {
  const pv = sat.sgp4(rec, m), got = [pv.position.x, pv.position.y, pv.position.z, pv.velocity.x, pv.velocity.y, pv.velocity.z];
  near(`Vallado 00005 t=${m} min position (km)`, Math.hypot(got[0] - REF[m][0], got[1] - REF[m][1], got[2] - REF[m][2]), 0, 1e-4);
  near(`Vallado 00005 t=${m} min velocity (km/s)`, Math.hypot(got[3] - REF[m][3], got[4] - REF[m][4], got[5] - REF[m][5]), 0, 1e-6);
}
// ISS from the bundled snapshot
const snap = snapshot(), parsed = T.parse(snap.tle);
ok("snapshot parses with no errors", parsed.errors.length === 0, parsed.errors.slice(0, 3));
ok("snapshot has >150 satellites", parsed.sats.length > 150, parsed.sats.length);
const iss = parsed.sats.find(s => s.norad === 25544), S = P.makeSat(iss), obs = P.makeObserver(30.27, -97.74, 150);
near("ISS period ≈ 92.7 min (88–94)", S.periodMin, 92.7, 1.5);
let minAlt = 1e9, maxAlt = 0, minV = 1e9, maxV = 0;
for (let i = 0; i < 100; i++) { const s = P.stateAt(S, obs, iss.epochMs + i * 60000, true); minAlt = Math.min(minAlt, s.altKm); maxAlt = Math.max(maxAlt, s.altKm); minV = Math.min(minV, s.speedKmS); maxV = Math.max(maxV, s.speedKmS); }
ok("ISS altitude within 395–440 km over one orbit", minAlt > 395 && maxAlt < 440, [minAlt.toFixed(1), maxAlt.toFixed(1)]);
ok("ISS speed ≈ 7.6–7.7 km/s", minV > 7.55 && maxV < 7.75, [minV.toFixed(3), maxV.toFixed(3)]);
const s0 = P.stateAt(S, obs, iss.epochMs, true);
ok("ISS latitude never exceeds inclination (51.6°)", Math.abs(s0.latDeg) <= 51.7);
// propagation at TLE epoch from independent (Python sgp4) – see crosscheck/; here just internal sanity: orbit closes after one period
const a = P.stateAt(S, obs, iss.epochMs, true), b = P.stateAt(S, obs, iss.epochMs + S.periodMin * 60000, true);
near("ISS altitude repeats after one period (±5 km)", b.altKm, a.altKm, 5);
// range-rate consistency: finite difference of range vs analytic range rate
const t0 = iss.epochMs + 3 * 3600000; let worst = 0;
for (let i = 0; i < 50; i++) { const t = t0 + i * 97000, r1 = P.stateAt(S, obs, t - 500), r2 = P.stateAt(S, obs, t + 500), m = P.stateAt(S, obs, t); worst = Math.max(worst, Math.abs((r2.rangeKm - r1.rangeKm) / 1 - m.rrKmS)); }
ok("analytic range-rate matches finite difference (<2 m/s)", worst < 0.002, worst);
done();
