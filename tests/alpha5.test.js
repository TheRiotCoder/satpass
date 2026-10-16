// Alpha-5 catalogue numbers (NORAD >= 100000) and CelesTrak OMM(JSON) -> TLE conversion.
const { ok, near, throws, done, snapshotAll } = require("./harness");
const T = require("../js/tle.js"), P = require("../js/passes.js"), fs = require("fs"), path = require("path");
const fx = f => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");

// --- encode / decode
ok("catField: < 100000 stays 5 digits", T.catField(25544) === "25544" && T.catField(7530) === "07530");
ok("catField: 100000 -> A0000, 100889 -> A0889, 339999 -> Z9999", T.catField(100000) === "A0000" && T.catField(100889) === "A0889" && T.catField(339999) === "Z9999");
ok("catField skips I and O (180000 -> J0000, 230000 -> P0000)", T.catField(180000) === "J0000" && T.catField(230000) === "P0000" && T.catField(170000) === "H0000");
ok("parseCat is the inverse of catField for every 1000th number up to 339999", (() => { for (let n = 0; n <= 339999; n += 1000) if (T.parseCat(T.catField(n)) !== n) return false; return true; })());
ok("parseCat: plain numbers, padded numbers", T.parseCat("25544") === 25544 && T.parseCat("  544") === 544 && T.parseCat("00900") === 900);
ok("parseCat rejects garbage / lowercase-I/O style letters", isNaN(T.parseCat("I0000")) && isNaN(T.parseCat("O1234")) && isNaN(T.parseCat("AB123")) && isNaN(T.parseCat("")));
throws("catField rejects numbers beyond Z9999", () => T.catField(340000), /out of range/);

// --- OMM -> TLE against CelesTrak's own TLE for the same objects (fetched together; tolerances = last printed digit)
for (const id of [25544, 39634, 43800]) {
  const o = JSON.parse(fx(`omm-${id}.json`))[0], mine = T.fromOmm(o), ref = fx(`tle-${id}.txt`).split(/\r?\n/).filter(Boolean);
  const A = T.parse(mine.name + "\n" + mine.l1 + "\n" + mine.l2).sats[0], B = T.parse(ref.join("\n")).sats[0];
  ok(`fromOmm(${id}): parses with valid checksums, same catalogue number and name`, !!A && !!B && A.norad === B.norad && A.name === B.name.trim(), A && A.name);
  near(`fromOmm(${id}): epoch within 1 ms of CelesTrak's TLE`, A.epochMs, B.epochMs, 1);
  const f = (l, a, b) => parseFloat(l.slice(a, b));
  ok(`fromOmm(${id}): intl. designator, ndot, B*, element-set no. identical`, mine.l1.slice(9, 17) === ref[1].slice(9, 17) && mine.l1.slice(33, 43) === ref[1].slice(33, 43) && mine.l1.slice(44, 52) === ref[1].slice(44, 52) && mine.l1.slice(53, 61) === ref[1].slice(53, 61) && mine.l1.slice(64, 68) === ref[1].slice(64, 68), [mine.l1, ref[1]]);
  ok(`fromOmm(${id}): inclination, RAAN, argp, mean anomaly, mean motion within 1e-4° / 1e-8 rev/day`, [[8, 16], [17, 25], [34, 42], [43, 51]].every(([a, b]) => Math.abs(f(mine.l2, a, b) - f(ref[2], a, b)) < 1.5e-4) && Math.abs(f(mine.l2, 52, 63) - f(ref[2], 52, 63)) < 2e-8, [mine.l2, ref[2]]);
  near(`fromOmm(${id}): eccentricity within 1e-7`, f("0." + mine.l2.slice(26, 33), 0, 9), f("0." + ref[2].slice(26, 33), 0, 9), 1.01e-7);
}
// --- sgp4 equivalence: positions from the converted TLE match those from CelesTrak's TLE
{
  const o = JSON.parse(fx("omm-25544.json"))[0], mine = P.makeSat(T.parse(T.fromOmm(o).name + "\n" + T.fromOmm(o).l1 + "\n" + T.fromOmm(o).l2).sats[0]), ref = P.makeSat(T.parse(fx("tle-25544.txt")).sats[0]), obs = P.makeObserver(30, -97, 0);
  const t = Date.parse(o.EPOCH + "Z") + 6 * 3600000, a = P.stateAt(mine, obs, t, true), b = P.stateAt(ref, obs, t, true);
  near("OMM-derived ISS TLE vs CelesTrak TLE: sub-point latitude after 6 h", a.latDeg, b.latDeg, 0.01); near("… longitude", a.lonDeg, b.lonDeg, 0.01); near("… range (km)", a.rangeKm, b.rangeKm, 1);
}
// --- Alpha-5 satellites parse, round-trip, propagate
const omm5 = JSON.parse(fx("omm-alpha5.json"));
ok("fixture has two satellites numbered >= 100000", omm5.length === 2 && omm5.every(o => o.NORAD_CAT_ID >= 100000), omm5.map(o => o.NORAD_CAT_ID));
const r5 = T.parseOmm(omm5);
ok("parseOmm: Alpha-5 satellites accepted, NORAD kept as the real number", r5.errors.length === 0 && r5.sats.length === 2 && r5.sats.every(s => s.norad >= 100000) && /^[A-Z]\d{4}$/.test(r5.sats[0].l1.slice(2, 7)), r5.sats.map(s => [s.norad, s.l1.slice(2, 7)]));
ok("Alpha-5 TLE text has valid checksums and length 69", r5.sats.every(s => s.l1.length === 69 && s.l2.length === 69 && T.checksumOk(s.l1) && T.checksumOk(s.l2)));
ok("serialize -> parse round trip keeps Alpha-5 satellites", (() => { const b = T.parse(T.serialize(r5.sats)); return b.errors.length === 0 && b.sats.map(s => s.norad).join() === r5.sats.map(s => s.norad).join(); })());
ok("parse: Alpha-5 line 1 with a different number on line 2 is rejected", (() => { const s = r5.sats[0], bad = T.parse(s.name + "\n" + s.l1 + "\n" + s.l2.slice(0, 2) + "A0890" + s.l2.slice(7, 68) + T.checksum(s.l2.slice(0, 2) + "A0890" + s.l2.slice(7, 68))); return bad.sats.length === 0 && /mismatch/i.test(bad.errors[0]); })());
{
  const s = r5.sats[0], sat = P.makeSat(s), obs = P.makeObserver(30, -97, 0), st = P.stateAt(sat, obs, s.epochMs + 3600000, true);
  ok("makeSat on an Alpha-5 TLE: SGP4 initialises, ICEYE orbit ~95 min, ~500–600 km", sat.norad === 100889 && sat.periodMin > 93 && sat.periodMin < 97 && st.altKm > 450 && st.altKm < 650, [sat.norad, sat.periodMin, st.altKm]);
  // numeric stand-in gives identical propagation (the catalogue number is not used by SGP4)
  const num = ("00000" + (s.norad % 100000)).slice(-5), fix = l => { const b = l.slice(0, 2) + num + l.slice(7, 68); return b + T.checksum(b); };
  const alt = P.makeSat({ name: s.name, norad: s.norad, l1: fix(s.l1), l2: fix(s.l2) }), st2 = P.stateAt(alt, obs, s.epochMs + 3600000, true);
  near("Alpha-5 vs numeric stand-in: identical sub-point longitude", st.lonDeg, st2.lonDeg, 1e-9);
}
ok("fromOmm: missing field -> error message", (() => { try { T.fromOmm({ NORAD_CAT_ID: 1 }); } catch (e) { return /missing/.test(e.message); } return false; })());
ok("parseOmm: skips bad records but keeps good ones", (() => { const r = T.parseOmm([omm5[0], { NORAD_CAT_ID: 5 }]); return r.sats.length === 1 && r.errors.length === 1; })());
// --- every bundled snapshot parses, includes Alpha-5 satellites in SAR
const all = snapshotAll();
ok("all bundled snapshots parse with no errors", Object.keys(all).every(k => T.parse(all[k].tle).errors.length === 0), Object.keys(all));
ok("SAR snapshot contains Alpha-5 satellites (>= 100000) and they all propagate", (() => { const a = T.parse(all.sar.tle).sats.filter(s => s.norad >= 100000); return a.length >= 3 && a.every(s => { const x = P.makeSat(s); return x.periodMin > 80 && x.periodMin < 110; }); })());
done();
