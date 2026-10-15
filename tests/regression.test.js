// Regression tests for the peer-review findings on findPasses / makeObserver (cases reproduced from /workspace/satpass-review).
// Oracle: a brute-force 1-s (AO-10: 2-s) elevation scan using the same SGP4 state function, extended past the window end.
const { ok, near, throws, done, snapshot } = require("./harness");
const P = require("../js/passes.js"), T = require("../js/tle.js");
const sats = T.parse(snapshot().tle).sats, byId = id => sats.find(s => s.norad === id);
const AUSTIN = [30.27, -97.74, 150], TROMSO = [69.65, 18.96, 50], SYDNEY = [-33.87, 151.21, 20], QUITO = [-0.18, -78.47, 2850];
const DAY = 86400000;

// brute force: returns [{aos, los, max, startCut, endCut}] for passes that start at/before t1 (los searched up to t1+overrun)
function brute(S, obs, minEl, t0, t1, stepMs, overrun) {
  const out = []; let cur = null;
  for (let t = t0; t <= t1 + overrun; t += stepMs) {
    const e = P.stateAt(S, obs, t).el;
    if (e >= minEl) { if (!cur) { if (t > t1) break; cur = { aos: t, max: e, startCut: t === t0 }; } else cur.max = Math.max(cur.max, e); }
    else if (cur) { cur.los = t - stepMs / 2; cur.aos = cur.startCut ? cur.aos : cur.aos - stepMs / 2; out.push(cur); cur = null; }
  }
  if (cur) { cur.los = Infinity; out.push(cur); }
  return out;
}
function compare(label, noradId, loc, minEl, stepMs, overrun) {
  const e = byId(noradId); if (!e) { ok(label + ": satellite in snapshot", false); return; }
  const S = P.makeSat(e), obs = P.makeObserver(...loc), t0 = Math.ceil(e.epochMs / 3600000) * 3600000, t1 = t0 + 2 * DAY;
  const found = P.findPasses(S, obs, t0, t1, { minEl }), truth = brute(S, obs, minEl, t0, t1, stepMs, overrun);
  const tol = stepMs + 1500;
  const missed = truth.filter(b => !found.some(p => p.aos - tol <= b.los && p.los + tol >= b.aos));
  ok(`${label}: no pass missed (${truth.length} brute-force passes, ${found.length} found)`, missed.length === 0, missed.map(m => new Date(m.aos).toISOString()));
  ok(`${label}: no spurious passes`, found.length === truth.length, [found.length, truth.length]);
  const aosBad = truth.filter(b => !b.startCut).filter(b => { const p = found.find(q => q.aos - tol <= b.los && q.los + tol >= b.aos); return p && Math.abs(p.aos - b.aos) > tol; });
  ok(`${label}: AOS within ${tol / 1000} s of brute force`, aosBad.length === 0);
  const losBad = truth.filter(b => b.los !== Infinity).filter(b => { const p = found.find(q => q.aos - tol <= b.los && q.los + tol >= b.aos); return p && Math.abs(p.los - b.los) > tol; });
  ok(`${label}: LOS within ${tol / 1000} s of brute force (incl. passes ending after the window)`, losBad.length === 0, losBad.length);
  const last = found[found.length - 1], lastTruth = truth[truth.length - 1];
  if (last && lastTruth && last.aos <= t1 && last.los > t1) ok(`${label}: pass open at window end kept, flagged losAfterWindow, not truncated`, last.losAfterWindow === true && !last.truncated && last.los > t1);
  return { found, truth, t0, t1, S, obs };
}

// --- 1. pass still in progress at the END of the window is kept (reviewer cases)
const noaa = compare("NOAA 18 / Tromso / minEl 10", 28654, TROMSO, 10, 1000, 3600000);
ok("NOAA 18 / Tromso: the pass cut by the window end is the last pass returned", noaa.found.length > 0 && noaa.found[noaa.found.length - 1].los > noaa.t1);
compare("NOAA 18 / Tromso / minEl 0", 28654, TROMSO, 0, 1000, 3600000);
compare("FOX-1B / Austin / minEl 0", 43017, AUSTIN, 0, 1000, 3600000);
// AO-10 passes last ~9–11 h: the LOS search has to run well past the window end
const ao = [[AUSTIN, 0], [AUSTIN, 10], [AUSTIN, 30], [QUITO, 0], [QUITO, 10]].map(([loc, m]) => compare(`AO-10 / ${loc === AUSTIN ? "Austin" : "Quito"} / minEl ${m}`, 14129, loc, m, 2000, 14 * 3600000));

// --- 2. grazing passes are not missed (SO-50 / Sydney / 30°: 5 s above threshold, max 30.01°)
const graze = compare("SO-50 / Sydney / minEl 30 (barely clears)", 27607, SYDNEY, 30, 1000, 600000);
ok("SO-50 / Sydney: the 5-second grazing pass is reported with maxEl just above 30°", graze.found.some(p => p.maxEl >= 30 && p.maxEl < 30.1 && p.durationSec < 15), graze.found.filter(p => p.maxEl < 30.5).map(p => [p.maxEl, p.durationSec]));
// synthetic grazing: raise minEl to just under / over a real pass maximum
(function () {
  const e = byId(25544), S = P.makeSat(e), obs = P.makeObserver(...AUSTIN), t0 = Math.ceil(e.epochMs / 3600000) * 3600000;
  const base = P.findPasses(S, obs, t0, t0 + 3 * DAY, { minEl: 10 });
  let hit = 0, leak = 0, dur = [];
  base.slice(0, 12).forEach(p => {
    const under = P.findPasses(S, obs, p.aos - 600000, p.los + 600000, { minEl: p.maxEl - 0.004 }).filter(q => Math.abs(q.tca - p.tca) < 60000);
    const over = P.findPasses(S, obs, p.aos - 600000, p.los + 600000, { minEl: p.maxEl + 0.004 }).filter(q => Math.abs(q.tca - p.tca) < 60000);
    if (under.length === 1) { hit++; dur.push(under[0].durationSec); } if (over.length) leak++;
  });
  ok("ISS: minEl 0.004° below a pass maximum -> pass still found (12/12), a few seconds long", hit === 12 && Math.max(...dur) < 12, [hit, dur.map(d => +d.toFixed(1))]);
  ok("ISS: minEl 0.004° above a pass maximum -> pass not reported", leak === 0, leak);
})();
// default scan is fine enough: coarse user step doesn't lose passes either
(function () {
  const e = byId(27607), S = P.makeSat(e), obs = P.makeObserver(...SYDNEY), t0 = Math.ceil(e.epochMs / 3600000) * 3600000;
  const a = P.findPasses(S, obs, t0, t0 + 2 * DAY, { minEl: 30 }), b = P.findPasses(S, obs, t0, t0 + 2 * DAY, { minEl: 30, stepSec: 60 }), c = P.findPasses(S, obs, t0, t0 + 2 * DAY, { minEl: 30, stepSec: 5 });
  ok("scan step option (5/default/60 s) gives identical pass sets", a.length === b.length && a.length === c.length && a.every((p, i) => Math.abs(p.aos - c[i].aos) < 1000), [a.length, b.length, c.length]);
})();

// --- 3. windows that cut a pass at either end
(function () {
  const e = byId(25544), S = P.makeSat(e), obs = P.makeObserver(...AUSTIN), t0 = Math.ceil(e.epochMs / 3600000) * 3600000;
  const full = P.findPasses(S, obs, t0, t0 + 2 * DAY, { minEl: 10 }), p = full[3], mid = (p.aos + p.los) / 2;
  const endMid = P.findPasses(S, obs, t0, mid, { minEl: 10 }), last = endMid[endMid.length - 1];
  ok("window ending mid-pass keeps that pass with its true LOS", endMid.length === 4 && Math.abs(last.los - p.los) < 1500 && last.losAfterWindow === true && !last.truncated, last && [last.los - p.los, last.losAfterWindow]);
  const only = P.findPasses(S, obs, p.aos - 3600000, mid, { minEl: 10 });
  ok("a window containing only the first half of a pass still returns it (was dropped before)", only.length === 1 && Math.abs(only[0].los - p.los) < 1500, only.length);
  const startMid = P.findPasses(S, obs, mid, mid + 20 * 60000, { minEl: 10 });
  ok("window starting mid-pass: pass kept with true AOS before the window, aosBeforeStart/inProgressAtStart set", startMid.length >= 1 && startMid[0].aosBeforeStart === true && startMid[0].inProgressAtStart === true && Math.abs(startMid[0].aos - p.aos) < 1500 && startMid[0].aos < mid, startMid[0] && [startMid[0].aos - p.aos, startMid[0].aosBeforeStart]);
  ok("window starting mid-pass: a pass that began inside the window is not flagged aosBeforeStart", full.every(q => q.aosBeforeStart === false) && !full[3].truncated && full[3].losAfterWindow === false);
  const before = P.findPasses(S, obs, p.aos - 1800000, p.aos - 60000, { minEl: 10 });
  ok("window ending just before AOS excludes the pass", before.every(q => Math.abs(q.aos - p.aos) > 60000));
  // bounded overrun: if LOS can't be found within maxOverrunMs the pass is flagged truncated (LOS is a lower bound)
  const tr = P.findPasses(S, obs, p.aos - 60000, mid, { minEl: 10, maxOverrunMs: 30000 });
  ok("LOS not found within maxOverrunMs -> pass kept and flagged truncated", tr.length === 1 && tr[0].truncated === true && tr[0].los <= mid + 30000 + 1000 && tr[0].los < p.los, tr[0] && [tr[0].truncated, tr[0].los - p.los]);
  const unb = P.findPasses(S, obs, p.aos - 60000, mid, { minEl: 10 });
  ok("default overrun finds the real LOS for LEO passes (not truncated)", unb.length === 1 && !unb[0].truncated && Math.abs(unb[0].los - p.los) < 1500);
})();
// a continuous (never ending) case is bounded and flagged: AO-10 above 0° for > 3 h overrun cap
(function () {
  const e = byId(14129); if (!e) return ok("AO-10 in snapshot", false);
  const S = P.makeSat(e), obs = P.makeObserver(...AUSTIN), t0 = Math.ceil(e.epochMs / 3600000) * 3600000;
  const full = P.findPasses(S, obs, t0, t0 + 2 * DAY, { minEl: 0 }), p = full.find(q => q.durationSec > 8 * 3600);
  ok("AO-10: long pass (>8 h) found", !!p, full.map(q => q.durationSec / 3600));
  if (!p) return;
  const cut = P.findPasses(S, obs, p.aos + 3600000, p.aos + 2 * 3600000, { minEl: 0, maxOverrunMs: 3 * 3600000 });
  ok("AO-10: 3 h overrun cap on an 9–10 h pass -> truncated flag, LOS = lower bound", cut.length === 1 && cut[0].truncated === true && cut[0].los < p.los, cut[0] && [cut[0].truncated, (cut[0].los - p.los) / 3600000]);
  const ok2 = P.findPasses(S, obs, p.aos + 3600000, p.aos + 2 * 3600000, { minEl: 0 });
  ok("AO-10: default overrun reaches the real LOS", ok2.length === 1 && !ok2[0].truncated && Math.abs(ok2[0].los - p.los) < 3000, ok2[0] && ok2[0].los - p.los);
})();

// --- 4. makeObserver longitude validation: accepts exactly -180..180, message matches
ok("makeObserver accepts lon -180 and 180", (() => { try { P.makeObserver(0, -180, 0); P.makeObserver(0, 180, 0); return true; } catch (e) { return false; } })());
throws("makeObserver rejects lon 180.0001", () => P.makeObserver(0, 180.0001, 0), /Longitude must be between -180 and 180/);
throws("makeObserver rejects lon 270 (0..360 convention not accepted)", () => P.makeObserver(0, 270, 0), /Longitude must be between -180 and 180/);
throws("makeObserver rejects lon 360", () => P.makeObserver(0, 360, 0), /Longitude must be between -180 and 180/);
throws("makeObserver rejects lon -180.0001", () => P.makeObserver(0, -180.0001, 0), /Longitude must be between -180 and 180/);
throws("makeObserver rejects lon NaN", () => P.makeObserver(0, NaN, 0), /Longitude/);
throws("makeObserver rejects lon undefined", () => P.makeObserver(0, undefined, 0), /Longitude/);
throws("makeObserver rejects lat 90.0001", () => P.makeObserver(90.0001, 0, 0), /Latitude must be between -90 and 90/);
throws("makeObserver rejects lat NaN", () => P.makeObserver(NaN, 0, 0), /Latitude/);
ok("makeObserver keeps lonDeg exactly as given inside the valid range", P.makeObserver(10, -123.456, 0).lonDeg === -123.456 && P.makeObserver(-90, 180, 0).lonDeg === 180);
done();
