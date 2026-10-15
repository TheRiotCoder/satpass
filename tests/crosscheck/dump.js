// Dumps our results as JSON for tests/crosscheck/crosscheck.py (independent check against python-sgp4 + skyfield).
const P = require("../../js/passes.js"), T = require("../../js/tle.js"), { snapshot } = require("../harness");
const snap = snapshot(), sats = T.parse(snap.tle).sats;
const iss = sats.find(s => s.norad === 25544), S = P.makeSat(iss);
const obs = P.makeObserver(30.27, -97.74, 150);
const t0 = Math.ceil(iss.epochMs / 3600000) * 3600000, t1 = t0 + 3 * 86400000;
const passes = P.findPasses(S, obs, t0, t1, { minEl: 10 });
const sun = [];
for (let i = 0; i < 24; i++) { const t = t0 + i * 3600000 * 1.37; sun.push({ t, el: P.sunElevation(obs, t) }); }
const states = [];
const at = t0 + 2 * 3600000;
for (const s of sats) {
  const S2 = P.makeSat(s);
  const sat = require("../../js/vendor/satellite.min.js"), pv = sat.propagate(S2.rec, new Date(at));
  if (pv && pv.position) states.push({ norad: s.norad, name: s.name, l1: s.l1, l2: s.l2, pos: [pv.position.x, pv.position.y, pv.position.z], dsp: S2.revsPerDay < 6.4 });
}
const sample = P.trackPass(S, obs, passes[1].aos, passes[1].los, 60).map(s => ({ t: s.t, az: s.az, el: s.el, range: s.rangeKm, rr: s.rrKmS, sunlit: s.sunlit, vis: s.visible }));
const multi = [27607, 7530, 44909, 33591, 14129, 43017].map(id => { const e = sats.find(x => x.norad === id); if (!e) return null; const Sx = P.makeSat(e); return { name: e.name, l1: e.l1, l2: e.l2, passes: P.findPasses(Sx, obs, t0, t0 + 3 * 86400000, { minEl: 10 }) }; }).filter(Boolean);
console.log(JSON.stringify({ multi, iss: { l1: iss.l1, l2: iss.l2, name: iss.name }, obs: { lat: 30.27, lon: -97.74, altM: 150 }, t0, t1, at, passes, sun, states, sample }));
