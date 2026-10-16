// Dumps SatPass SAR geometry for tests/crosscheck/sar_crosscheck.py (independent check against python-sgp4 + skyfield).
const P = require("../../js/passes.js"), T = require("../../js/tle.js"), D = require("../../js/doppler.js"), Sar = require("../../data/sar.js"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", ".."), obsLL = { lat: 30.27, lon: -97.74, altM: 150 };
const snap = require("../harness").snapshotAll().sar;
const sats = T.parse(snap.tle).sats, ids = [39634, 39766, 32382, 43619, 100889, 63772, 60182, 51444];
const obs = P.makeObserver(obsLL.lat, obsLL.lon, obsLL.altM), out = [];
const omm = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "omm-alpha5.json"), "utf8"));
for (const id of ids) {
  const e = sats.find(s => s.norad === id); if (!e) throw new Error("missing " + id);
  const sat = P.makeSat(e), t0 = Math.ceil(e.epochMs / 600000) * 600000, samples = [];
  for (let i = 0; i < 48; i++) {
    const t = t0 + i * 61 * 60000 + 17000 * i;           // ~2 days, irregular spacing
    const ni = P.nodeInfo(sat, t), st = P.stateAt(sat, obs, t, true), f = (Sar.forSat(id, e.name).mission.centerFreqMHz || 5405) * 1e6;
    samples.push({ t, asc: ni.ascending, vz: ni.vzKmS, lat: ni.latDeg, lon: ni.lonDeg, lst: ni.lstHours, rr: st.rrKmS, range: st.rangeKm, dop: D.radarOneWay(f, st.rrKmS).shiftHz, f });
  }
  const passes = P.findPasses(sat, obs, t0, t0 + 3 * 86400000, { minEl: 5 }).slice(0, 6).map(p => { const g = P.passGeometry(sat, obs, p); return { tca: p.tca, asc: g.ascending, lst: g.lstHours, dist: g.groundTrackDistKm, subLat: g.subLatDeg, subLon: g.subLonDeg }; });
  out.push({ norad: id, name: e.name, l1: e.l1, l2: e.l2, samples, passes, omm: omm.find(o => o.NORAD_CAT_ID === id) || null });
}
console.log(JSON.stringify({ obs: obsLL, sats: out }));
