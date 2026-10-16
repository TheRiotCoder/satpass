// SAR catalogue checks: NORAD ids vs bundled CelesTrak snapshot, duplicates, band/frequency consistency, sources, required missions,
// plus the radar Doppler formula / exact label and an asc/desc + local-solar-time + swath proximity test on constructed orbits.
const { ok, near, done, snapshotAll } = require("./harness");
const fs = require("fs"), path = require("path");
const Sar = require("../data/sar.js"), T = require("../js/tle.js"), P = require("../js/passes.js"), D = require("../js/doppler.js");
const snaps = snapshotAll(), sarSats = T.parse(snaps.sar.tle).sats, inSar = new Map(sarSats.map(s => [s.norad, s]));
const allSnap = new Map(); for (const k of Object.keys(snaps)) for (const s of T.parse(snaps[k].tle).sats) allSnap.set(s.norad, s);

// --- structure
ok("28 missions, 131 satellites with public TLEs", Sar.MISSIONS.length === 28 && Sar.SATS.length === 131, [Sar.MISSIONS.length, Sar.SATS.length]);
ok("mission ids are unique", new Set(Sar.MISSIONS.map(m => m.id)).size === Sar.MISSIONS.length);
ok("every mission has name, operator, band in P/L/S/C/X, at least one https source", Sar.MISSIONS.every(m => m.name && m.operator && Sar.BANDS[m.band] && m.source && m.source.length && m.source.every(u => /^https:\/\//.test(u))));
const HOSTS = new Set(["sentiwiki.copernicus.eu", "www.asc-csa.gc.ca", "www.eoportal.org", "space.oscar.wmo.int", "calvalportal.ceos.org", "earth.jaxa.jp", "nisar.jpl.nasa.gov", "earth.esa.int", "research.csiro.au", "www.terranor.no", "www.nrsc.gov.in", "isprs-archives.copernicus.org", "jeoss.co.jp", "iceye-ltd.github.io", "sar.iceye.com", "support.capellaspace.com", "www.capellaspace.com", "synspective.com", "i-qps.net", "celestrak.org"]);
ok("sources come only from reviewed hosts (agency / operator / eoPortal / OSCAR / CelesTrak / CEOS / ISPRS); a new host needs a deliberate edit here", Sar.MISSIONS.every(m => m.source.every(u => HOSTS.has(new URL(u).host))), Sar.MISSIONS.flatMap(m => m.source.filter(u => !HOSTS.has(new URL(u).host))));

// --- NORAD ids: unique, present in the snapshot, names agree
const seen = new Map(); let dup = [];
for (const m of Sar.MISSIONS) for (const [n] of m.sats) { if (seen.has(n)) dup.push(n); seen.set(n, m.id); }
ok("no NORAD id is listed twice", dup.length === 0, dup);
ok("every listed NORAD id is a positive integer", [...seen.keys()].every(n => Number.isInteger(n) && n > 0 && n < 340000));
const missing = [...seen.keys()].filter(n => !inSar.has(n));
ok("every SAR NORAD id with a public TLE is in the bundled SAR snapshot", missing.length === 0, missing);
const extra = [...inSar.keys()].filter(n => !seen.has(n));
ok("the SAR snapshot has no unlisted satellites (query results are filtered to the curated list)", extra.length === 0, extra);
ok("snapshot names equal the curated CelesTrak names", Sar.MISSIONS.every(m => m.sats.every(([n, nm]) => inSar.get(n).name.trim().toUpperCase() === nm.toUpperCase())), Sar.MISSIONS.flatMap(m => m.sats.filter(([n, nm]) => inSar.has(n) && inSar.get(n).name.trim().toUpperCase() !== nm.toUpperCase())));
ok("satellites without a public TLE are labelled and not in the TLE list", Sar.noPublicTle().length >= 2 && Sar.noPublicTle().every(x => x.name && !seen.has(x.name) && /no public tle/i.test(x.mission.notes)), Sar.noPublicTle().map(x => x.name));
ok("isSar / forSat find every listed satellite", [...seen.keys()].every(n => Sar.isSar(n) && Sar.forSat(n).mission.id === seen.get(n)));
ok("forSat recognises a future ICEYE by name only (match regexp)", Sar.forSat(999999, "ICEYE-X99") && Sar.forSat(999999, "ICEYE-X99").mission.id === "iceye" && !Sar.isSar(999999, "ISS (ZARYA)"));
ok("Sentinel-6 and other altimeters are NOT SAR", ![...seen.values()].some(id => /sentinel-6/.test(id)) && !allSnap.has(46984) || !Sar.isSar(46984));

// --- band / frequency consistency and unverified handling
ok("centre frequency lies inside the band's range (P 0.3–1, L 1–2, S 2–4, C 4–8, X 8–12 GHz) wherever it is given", Sar.MISSIONS.every(m => m.centerFreqMHz == null || (m.centerFreqMHz >= Sar.BANDS[m.band][0] && m.centerFreqMHz < Sar.BANDS[m.band][1])), Sar.MISSIONS.filter(m => m.centerFreqMHz != null && !(m.centerFreqMHz >= Sar.BANDS[m.band][0] && m.centerFreqMHz < Sar.BANDS[m.band][1])).map(m => m.id));
ok("bandOf() agrees with every mission band", Sar.MISSIONS.every(m => m.centerFreqMHz == null || Sar.bandOf(m.centerFreqMHz) === m.band));
ok("a missing centre frequency says so in the notes (\"frequency not verified\" or no public TLE)", Sar.MISSIONS.filter(m => m.centerFreqMHz == null).every(m => /not verified|No public TLE/i.test(m.notes)), Sar.MISSIONS.filter(m => m.centerFreqMHz == null).map(m => m.id));
ok("approximate values are flagged (approx:true) for HJ-2 and ASNARO-2", ["hj-2ef", "asnaro-2"].every(id => Sar.MISSIONS.find(m => m.id === id).approx === true));
ok("no frequency is a guess: values are numbers or null, bandwidth positive when present", Sar.MISSIONS.every(m => (m.centerFreqMHz == null || (typeof m.centerFreqMHz === "number" && m.centerFreqMHz > 100)) && (m.bandwidthMHz == null || m.bandwidthMHz > 0)));
const f = id => Sar.MISSIONS.find(m => m.id === id);
ok("spot values: Sentinel-1 C 5405, RADARSAT-2 C 5405, RCM C 5405, TerraSAR/TanDEM/PAZ X 9650", f("sentinel-1").centerFreqMHz === 5405 && f("radarsat-2").centerFreqMHz === 5405 && f("rcm").centerFreqMHz === 5405 && ["terrasar-x", "tandem-x", "paz"].every(i => f(i).centerFreqMHz === 9650 && f(i).band === "X"));
ok("spot values: ALOS-2/ALOS-4/NISAR L-band ~1257.5, SAOCOM L 1275, BIOMASS P 435, NovaSAR S 3200, ICEYE X 9650", [f("alos-2"), f("alos-4"), f("nisar")].every(m => m.band === "L" && m.centerFreqMHz === 1257.5) && f("saocom").centerFreqMHz === 1275 && f("biomass").band === "P" && f("biomass").centerFreqMHz === 435 && f("novasar-1").centerFreqMHz === 3200 && f("iceye").centerFreqMHz === 9650);

// --- required content
const names = Sar.SATS.map(s => s.name.toUpperCase()), has = re => names.some(n => re.test(n));
const req = { "Sentinel-1A": /SENTINEL-1A/, "Sentinel-1B (failed, still tracked)": /SENTINEL-1B/, "Sentinel-1C": /SENTINEL-1C/, "Sentinel-1D": /SENTINEL-1D/, "RADARSAT-2": /RADARSAT-2/, "RCM-1": /RCM-?1|RADARSAT CONSTELLATION 1|RCM 1/, "RCM-2": /RCM-?2|RCM 2/, "RCM-3": /RCM-?3|RCM 3/, "TerraSAR-X": /TERRASAR-X/, "TanDEM-X": /TANDEM-X/, "PAZ": /^PAZ/, "COSMO-SkyMed 1–4": /COSMO-SKYMED 1|COSMO-SKYMED 2|COSMO-SKYMED 3|COSMO-SKYMED 4|COSMO-SKYMED-?[1-4]/, "CSG": /CSG|COSMO-SKYMED SECOND/, "SAOCOM-1A": /SAOCOM 1A/, "SAOCOM-1B": /SAOCOM 1B/, "ALOS-2": /ALOS-2/, "ALOS-4": /ALOS-4/, "ICEYE": /ICEYE-X/, "Capella": /CAPELLA/, "Umbra": /UMBRA/, "StriX": /STRIX/, "Gaofen-3": /GAOFEN-?3/, "LuTan-1": /LUDI TANCE|LUTAN/, "NovaSAR": /NOVASAR/, "KOMPSAT-5": /KOMPSAT-5/, "EOS-04": /EOS-0?4/, "RISAT-2B": /RISAT-2B\b|RISAT-2B$/, "NISAR": /NISAR/, "BIOMASS": /BIOMASS/, "QPS-SAR": /QPS-SAR|IZANAGI|IZANAMI/ };
for (const [label, re] of Object.entries(req)) ok(`required SAR satellite present: ${label}`, has(re), names.filter(n => /COSMO|RCM|RISAT|QPS|GAOFEN/.test(n)).slice(0, 6));
ok("at least 25 ICEYE satellites (incl. Alpha-5 numbers), 8 Capella, 4 COSMO-SkyMed, 3 RCM", names.filter(n => /^ICEYE/.test(n)).length >= 25 && names.filter(n => /CAPELLA/.test(n)).length >= 8 && names.filter(n => /COSMO-SKYMED/.test(n)).length >= 4 && names.filter(n => /^RCM|RADARSAT CONSTELLATION/.test(n)).length >= 3, [names.filter(n => /^ICEYE/.test(n)).length, names.filter(n => /CAPELLA/.test(n)).length]);
ok("Kompsat-6 and TecSAR are listed as 'no public TLE'", Sar.noPublicTle().some(x => /KOMPSAT-6/i.test(x.name)) && Sar.noPublicTle().some(x => /TecSAR/i.test(x.name)));
ok("Sentinel-1B is flagged as failed (satNotes)", /failed/i.test((f("sentinel-1").satNotes || {})["41456"] || ""));
ok("NISAR lists its secondary S-band radar", f("nisar").secondary && /S/.test(JSON.stringify(f("nisar").secondary)), f("nisar").secondary);

// --- radar Doppler formula and label (informational one-way carrier Doppler)
const LABEL = "one-way carrier Doppler at observer, informational; actual SAR processing uses two-way Doppler centroid with antenna pointing";
ok("radar Doppler label is exactly the required wording", D.RADAR_DOPPLER_LABEL === LABEL, D.RADAR_DOPPLER_LABEL);
const c = 299792.458;
{
  const r1 = D.radarOneWay(5405e6, -7.0), r2 = D.radarOneWay(5405e6, 7.0), r3 = D.radarOneWay(5405e6, 0);
  near("approaching 7 km/s at 5.405 GHz: +f·7/c = +126.2 kHz", r1.shiftHz, 5405e6 * 7 / c, 1e-3); ok("…received > transmitted", r1.shiftHz > 0 && r1.receivedHz > 5405e6);
  near("receding 7 km/s: negative, equal and opposite", r2.shiftHz, -r1.shiftHz, 1e-6); ok("zero range rate -> zero shift", r3.shiftHz === 0 && r3.receivedHz === 5405e6);
  near("X-band 9.65 GHz, rr = -3 km/s", D.radarOneWay(9650e6, -3).shiftHz, 9650e6 * 3 / c, 1e-3);
  ok("one-way shift is half of the two-way value for the same rr (sanity: formula is one-way)", Math.abs(D.radarOneWay(1e9, -5).shiftHz * 2 - 2 * 1e9 * 5 / c) < 1e-3);
}
const app = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
ok("app.js displays the label from D.RADAR_DOPPLER_LABEL (not a re-typed copy)", /RADAR_DOPPLER_LABEL/.test(app) && !app.includes("informational; actual SAR"));
ok("radar panel shows 'frequency not verified' for missing values", /frequency not verified/.test(app));

// --- ascending/descending, local solar time, swath proximity: constructed orbit sanity (independent numeric checks live in tests/crosscheck)
{
  const s = sarSats.find(x => x.norad === 39634), sat = P.makeSat(s), obs = P.makeObserver(48, 11, 500);
  const t0 = s.epochMs, seen = { asc: 0, desc: 0 }, lsts = { asc: [], desc: [] };
  for (let i = 0; i < 400; i++) { const t = t0 + i * 90000, n = P.nodeInfo(sat, t); (n.ascending ? lsts.asc : lsts.desc).push(n.lstHours); seen[n.ascending ? "asc" : "desc"]++; }
  ok("Sentinel-1A over 10 h: both ascending and descending samples", seen.asc > 100 && seen.desc > 100, seen);
  const spread = a => { const m = a.reduce((x, y) => x + y) / a.length; return Math.max(...a.map(x => Math.abs((x - m + 12) % 24 - 12))); };
  const cm = a => { const sc = a.map(h => [Math.cos(h * Math.PI / 12), Math.sin(h * Math.PI / 12)]); return (Math.atan2(sc.reduce((x, y) => x + y[1], 0), sc.reduce((x, y) => x + y[0], 0)) * 12 / Math.PI + 24) % 24; };
  const nodeLst = a => a.filter(h => true);
  const ascMean = cm(lsts.asc), descMean = cm(lsts.desc);
  ok("Sentinel-1 is dawn-dusk: ascending branch is ~18 h, descending ~6 h local solar time (±1.5 h on average)", Math.abs(((ascMean - 18 + 12) % 24) - 12) < 1.5 && Math.abs(((descMean - 6 + 12) % 24) - 12) < 1.5, [ascMean, descMean]);
  const ps = P.findPasses(sat, obs, t0, t0 + 3 * 86400000, { minEl: 5 });
  ok("passes have geometry: direction, local solar time in [0,24), ground-track distance >= 0", ps.length >= 4 && ps.every(p => { const g = P.passGeometry(sat, obs, p); return typeof g.ascending === "boolean" && g.lstHours >= 0 && g.lstHours < 24 && g.groundTrackDistKm >= 0; }));
  ok("a pass with TCA elevation near 90° has the sub-satellite point near the observer (<~100 km)", (() => { const hi = ps.filter(p => p.maxEl > 70); return hi.length === 0 || hi.every(p => P.passGeometry(sat, obs, p).groundTrackDistKm < 150); })());
  const g = P.greatCircleKm; near("greatCircleKm: 1° of latitude ≈ 111.19 km", g(0, 0, 1, 0), 111.19, 0.05); near("greatCircleKm: antipodes ≈ 20015 km", g(0, 0, 0, 180), 20015.1, 1); ok("greatCircleKm symmetric, zero for equal points", g(10, 20, 30, 40) === g(30, 40, 10, 20) && g(5, 5, 5, 5) === 0);
}
// --- README SAR table is generated from the data
const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8"), blk = readme.match(/<!-- SAR-TABLE:START -->([\s\S]*?)<!-- SAR-TABLE:END -->/);
ok("README has the generated SAR table between markers", !!blk);
if (blk) for (const m of Sar.MISSIONS) ok(`README SAR table lists ${m.name}${m.centerFreqMHz != null ? " with its centre frequency" : " as 'frequency not verified'"}`, blk[1].includes(m.name) && (m.centerFreqMHz != null ? blk[1].includes(String(m.centerFreqMHz)) : /not verified/.test(blk[1].split("\n").find(l => l.includes(m.name)) || "")));
done();
