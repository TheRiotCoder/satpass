// Dumps findPasses output over a satellite x observer x minEl matrix (2-day window from each TLE epoch) as JSON on stdout.
// Matrix adapted from the peer review scripts in /workspace/satpass-review. Compared by brute_passes.py.
const P = require("../../js/passes.js"), T = require("../../js/tle.js"), { snapshot } = require("../harness");
const sats = T.parse(snapshot().tle).sats;
const ids = [25544, 48274, 27607, 7530, 33591, 43017, 28654, 25338, 14129];
const obsList = [["Austin", 30.27, -97.74, 150], ["Tromso", 69.65, 18.96, 50], ["Sydney", -33.87, 151.21, 20], ["Singapore", 1.35, 103.82, 10], ["Dateline", -17.7, 179.95, 0], ["Quito", -0.18, -78.47, 2850], ["SouthPole", -89.9, 0, 2800]];
const out = [];
for (const id of ids) {
  const e = sats.find(x => x.norad === id); if (!e) continue; const S = P.makeSat(e);
  for (const [n, la, lo, al] of obsList) {
    const obs = P.makeObserver(la, lo, al);
    for (const minEl of [0, 10, 30]) {
      const t0 = Math.ceil(e.epochMs / 3600000) * 3600000, t1 = t0 + 2 * 86400000;
      const ps = P.findPasses(S, obs, t0, t1, { minEl });
      out.push({ id, name: e.name, l1: e.l1, l2: e.l2, obs: n, la, lo, al, minEl, t0, t1,
        passes: ps.map(p => ({ aos: p.aos, tca: p.tca, los: p.los, maxEl: p.maxEl, aosAz: p.aosAz, losAz: p.losAz, truncated: p.truncated, losAfterWindow: p.losAfterWindow, aosBeforeStart: p.aosBeforeStart })) });
    }
  }
}
process.stdout.write(JSON.stringify(out));
