/* SatPass core: SGP4 state -> look angles, sun/shadow/visibility, pass prediction (pure, UMD).
   Orbit propagation (SGP4/SDP4) is done by the vendored satellite.js (MIT); everything else here is our own code. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./vendor/satellite.min.js"));
  else root.SatPasses = factory(root.satellite);
})(typeof self !== "undefined" ? self : this, function (satellite) {
  "use strict";
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var WGS84_A = 6378.137, WGS84_F = 1 / 298.257223563, WGS84_E2 = WGS84_F * (2 - WGS84_F);
  var OMEGA_E = 7.29211514670698e-5;   // rad/s
  var AU_KM = 149597870.7, EARTH_R_SHADOW = 6378.137;
  var VISIBLE_SUN_EL = -6;             // civil twilight limit (deg)

  function fail(m) { throw new RangeError(m); }

  /* ---------- satellite + observer ---------- */
  // satellite.js expects a numeric catalog field; Alpha-5 TLEs (letter + 4 digits, NORAD id >= 100000) get a numeric stand-in
  // (the number is not used by SGP4) and recomputed checksums.
  function sgp4Lines(tle) {
    if (/^[0-9 ]/.test(tle.l1.substr(2, 5))) return [tle.l1, tle.l2];
    var num = ("00000" + (tle.norad % 100000)).slice(-5);
    function fix(l, first) { var b = l.slice(0, 2) + num + l.slice(7, 68), sum = 0; for (var i = 0; i < 68; i++) { var c = b.charAt(i); if (c >= "0" && c <= "9") sum += +c; else if (c === "-") sum += 1; } return b + (sum % 10); }
    return [fix(tle.l1), fix(tle.l2)];
  }
  function makeSat(tle) {
    var ls = sgp4Lines(tle), rec = satellite.twoline2satrec(ls[0], ls[1]);
    if (rec.error) fail("Could not initialise orbit for " + (tle.name || "satellite") + " (SGP4 error " + rec.error + ")");
    var revsPerDay = rec.no * 1440 / (2 * Math.PI);          // rad/min -> rev/day
    return { tle: tle, name: tle.name, norad: tle.norad, rec: rec, revsPerDay: revsPerDay, periodMin: 1440 / revsPerDay, ecc: rec.ecco,
             geo: revsPerDay < 1.3 && rec.ecco < 0.1 };
  }
  function makeObserver(latDeg, lonDeg, altM) {
    if (!(latDeg >= -90 && latDeg <= 90)) fail("Latitude must be between -90 and 90");
    if (!(lonDeg >= -180 && lonDeg <= 180)) fail("Longitude must be between -180 and 180 (east positive; use -90, not 270)");
    altM = altM || 0;
    var lat = latDeg * D2R, lon = lonDeg * D2R, h = altM / 1000;
    var sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
    var N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);
    return {
      latDeg: latDeg, lonDeg: lonDeg, altM: altM, lat: lat, lon: lon,
      ecf: [(N + h) * cl * co, (N + h) * cl * so, (N * (1 - WGS84_E2) + h) * sl],
      east: [-so, co, 0], north: [-sl * co, -sl * so, cl], up: [cl * co, cl * so, sl]
    };
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function rotZ(v, th) { var c = Math.cos(th), s = Math.sin(th); return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]]; } // ECI -> ECF by GMST angle th

  /* ---------- sun & shadow ---------- */
  // Low-precision solar position (Astronomical Almanac / Meeus), ~0.01° — plenty for twilight and eclipse tests. Returns km vector (equatorial, of date).
  function julianDate(ms) { return ms / 86400000 + 2440587.5; }
  function sunEci(ms) {
    var n = julianDate(ms) - 2451545.0;
    var L = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * D2R;
    var lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
    var eps = (23.439 - 0.0000004 * n) * D2R;
    var r = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU_KM;
    return [r * Math.cos(lam), r * Math.cos(eps) * Math.sin(lam), r * Math.sin(eps) * Math.sin(lam)];
  }
  function gmstAt(ms) { return satellite.gstime(new Date(ms)); }
  // true if a satellite at ECI position r (km) is in sunlight (cylindrical Earth shadow)
  function isSunlit(rEci, sunVec) {
    var sh = norm(sunVec), s = [sunVec[0] / sh, sunVec[1] / sh, sunVec[2] / sh];
    var along = dot(rEci, s);
    if (along >= 0) return true;
    var perp2 = dot(rEci, rEci) - along * along;
    return perp2 > EARTH_R_SHADOW * EARTH_R_SHADOW;
  }
  // geometric sun elevation (deg) at the observer
  function sunElevation(obs, ms, gmst) {
    if (gmst === undefined) gmst = gmstAt(ms);
    var s = rotZ(sunEci(ms), gmst), n = norm(s);
    return Math.asin(dot(s, obs.up) / n) * R2D;
  }

  /* ---------- state of a satellite at one time ---------- */
  // returns null if SGP4 fails (decayed / bad elements)
  function stateAt(sat, obs, ms, wantGeo) {
    var date = new Date(ms), pv = satellite.propagate(sat.rec, date);
    if (!pv || !pv.position || typeof pv.position === "boolean" || !pv.velocity) return null;
    var p = pv.position, v = pv.velocity, gmst = satellite.gstime(date);
    var rEci = [p.x, p.y, p.z], rEcf = rotZ(rEci, gmst);
    var vEcf0 = rotZ([v.x, v.y, v.z], gmst);
    var vEcf = [vEcf0[0] + OMEGA_E * rEcf[1], vEcf0[1] - OMEGA_E * rEcf[0], vEcf0[2]]; // v_ecf = R·v_eci − ω×r_ecf
    var rho = [rEcf[0] - obs.ecf[0], rEcf[1] - obs.ecf[1], rEcf[2] - obs.ecf[2]], range = norm(rho);
    var e = dot(rho, obs.east), n = dot(rho, obs.north), u = dot(rho, obs.up);
    var az = Math.atan2(e, n) * R2D; if (az < 0) az += 360;
    var el = Math.asin(u / range) * R2D;
    var sunV = sunEci(ms), sunlit = isSunlit(rEci, sunV);
    var sunEl = Math.asin(dot(rotZ(sunV, gmst), obs.up) / norm(sunV)) * R2D;
    var st = { t: ms, az: az, el: el, rangeKm: range, rrKmS: dot(rho, vEcf) / range, sunlit: sunlit, sunEl: sunEl,
               visible: sunlit && sunEl < VISIBLE_SUN_EL && el > 0, speedKmS: norm([v.x, v.y, v.z]) };
    if (wantGeo) {
      var gd = satellite.eciToGeodetic(p, gmst);
      st.latDeg = gd.latitude * R2D; st.lonDeg = gd.longitude * R2D; st.altKm = gd.height;
      if (st.lonDeg > 180) st.lonDeg -= 360; if (st.lonDeg < -180) st.lonDeg += 360;
    }
    return st;
  }
  function elAt(sat, obs, ms) { var s = stateAt(sat, obs, ms); return s ? s.el : -90; }

  /* ---------- pass prediction ---------- */
  function bisectCross(sat, obs, tLo, tHi, minEl, risingFlag) {
    // find t in [tLo,tHi] where el crosses minEl; risingFlag: el(tLo)<minEl<=el(tHi) else the opposite
    for (var i = 0; i < 28 && tHi - tLo > 100; i++) {
      var tm = (tLo + tHi) / 2, above = elAt(sat, obs, tm) >= minEl;
      if (above === risingFlag) tHi = tm; else tLo = tm;
    }
    return risingFlag ? tHi : tLo;
  }
  function maxElevation(sat, obs, tA, tB, tGuess) {
    var lo = Math.max(tA, tGuess - 30000), hi = Math.min(tB, tGuess + 30000), gr = 0.6180339887;
    var a = lo, b = hi, c = b - gr * (b - a), d = a + gr * (b - a), fc = elAt(sat, obs, c), fd = elAt(sat, obs, d);
    for (var i = 0; i < 40 && b - a > 200; i++) {
      if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = elAt(sat, obs, c); }
      else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = elAt(sat, obs, d); }
    }
    var tm = (a + b) / 2, e = elAt(sat, obs, tm);
    var e0 = elAt(sat, obs, tA), e1 = elAt(sat, obs, tB);
    if (e0 > e && e0 >= e1) return { t: tA, el: e0 };
    if (e1 > e) return { t: tB, el: e1 };
    return { t: tm, el: e };
  }
  function finishPass(sat, obs, aos, los, tMaxSample, flags) {
    var m = maxElevation(sat, obs, aos, los, tMaxSample);
    var a = stateAt(sat, obs, aos), l = stateAt(sat, obs, los), tc = stateAt(sat, obs, m.t);
    // visibility along the pass at ≤10 s resolution
    var vis0 = null, vis1 = null, n = Math.max(2, Math.ceil((los - aos) / 10000));
    for (var i = 0; i <= n; i++) {
      var s = stateAt(sat, obs, aos + (los - aos) * i / n);
      if (s && s.visible) { if (vis0 === null) vis0 = s.t; vis1 = s.t; }
    }
    return {
      satName: sat.name, norad: sat.norad, aos: aos, tca: m.t, los: los,
      aosAz: a.az, tcaAz: tc.az, losAz: l.az, maxEl: tc.el, durationSec: (los - aos) / 1000, rangeAtTcaKm: tc.rangeKm,
      visible: vis0 !== null, visStart: vis0, visEnd: vis1, sunlitAtTca: tc.sunlit, sunElAtTca: tc.sunEl,
      inProgressAtStart: false, aosBeforeStart: false, losAfterWindow: false, truncated: !!flags.truncated, aosTruncated: !!flags.aosTruncated
    };
  }
  /* findPasses(sat, obs, startMs, endMs, {minEl=10, stepSec=30, maxOverrunMs=14 h}) -> [pass] sorted by AOS.
     AOS/LOS are the times the satellite crosses `minEl`; passes that never reach minEl are not listed.
     Window semantics (a pass is reported if any part of it overlaps [startMs, endMs] and it begins no later than endMs):
       - pass already in progress at startMs: reported with its TRUE AOS (found by looking back up to 24 h) and
         aosBeforeStart = inProgressAtStart = true (aosTruncated = true if it has been up for more than 24 h);
       - pass still open at endMs: the LOS search continues past the window end until the pass really ends, bounded by
         maxOverrunMs (default 14 h, enough for AO-10-style passes); losAfterWindow = true. If LOS still can't be found the pass
         is kept, LOS = the search limit (a lower bound) and truncated = true.
     Scan: adaptive step outside a pass (10 s when the elevation is within ~20° of the threshold, up to stepSec = 30 s when far
     below it), 20 s inside a pass, plus local-maximum detection so a pass that peaks just above minEl between two samples is
     refined and found (grazing passes). Passes shorter than 0.2 s above minEl (numerical noise) are ignored. */
  var MIN_DURATION_MS = 200, MIN_STEP_MS = 10000, IN_PASS_STEP_MS = 20000, EL_RATE_BOUND_DEG_S = 2, GRAZE_MARGIN_DEG = 3, DEFAULT_OVERRUN_MS = 14 * 3600000, BACKTRACK_LIMIT_MS = 24 * 3600000;
  function findPasses(sat, obs, startMs, endMs, opts) {
    opts = opts || {};
    var minEl = opts.minEl === undefined ? 10 : opts.minEl, maxStep = Math.max(1000, (opts.stepSec || 30) * 1000), minStep = Math.min(MIN_STEP_MS, maxStep), inStep = Math.min(IN_PASS_STEP_MS, maxStep);
    var overrun = opts.maxOverrunMs === undefined ? DEFAULT_OVERRUN_MS : Math.max(0, opts.maxOverrunMs), hardEnd = endMs + overrun, out = [];
    if (sat.geo || !(endMs > startMs)) return out;
    var t = startMs, e = elAt(sat, obs, t), inPass = false, aos = 0, tMax = t, eMax = -90, flags = {}, tp = null, ep = 0, tn, en, step;
    function push(aosT, losT, tPeak, fl) { if (losT - aosT >= MIN_DURATION_MS) out.push(finishPass(sat, obs, aosT, losT, tPeak, fl)); }
    if (e >= minEl) { // already above the threshold: walk back to the real AOS
      var back = t, limit = t - BACKTRACK_LIMIT_MS, stride = 60000;
      while (back > limit && elAt(sat, obs, back) >= minEl) back -= stride;
      if (back > limit) aos = bisectCross(sat, obs, back, back + stride, minEl, true);
      else { aos = back; flags.aosTruncated = true; }   // above the threshold for more than 24 h: AOS is a lower bound
      inPass = true; tMax = t; eMax = e;
    }
    for (;;) {
      if (inPass) {
        if (t >= hardEnd) { flags.truncated = true; push(aos, t, tMax, flags); inPass = false; break; }   // LOS not found within the overrun limit
        tn = Math.min(t + inStep, hardEnd); en = elAt(sat, obs, tn);
        if (en > eMax) { eMax = en; tMax = tn; }
        if (en < minEl) { push(aos, bisectCross(sat, obs, t, tn, minEl, false), tMax, flags); inPass = false; tp = null; }
        t = tn; e = en;
        continue;
      }
      if (t >= endMs) break;
      step = Math.min(maxStep, Math.max(minStep, (minEl - e) / EL_RATE_BOUND_DEG_S * 1000));
      tn = Math.min(t + step, endMs); en = elAt(sat, obs, tn);
      if (en >= minEl) { aos = bisectCross(sat, obs, t, tn, minEl, true); inPass = true; flags = {}; tMax = tn; eMax = en; }
      else if (tp !== null && e >= ep && e >= en && e > minEl - GRAZE_MARGIN_DEG) {   // local maximum just below the threshold: does the true peak clear it?
        var m = maxElevation(sat, obs, tp, tn, t);
        if (m.el >= minEl) push(bisectCross(sat, obs, tp, m.t, minEl, true), bisectCross(sat, obs, m.t, tn, minEl, false), m.t, {});
      }
      tp = t; ep = e; t = tn; e = en;
    }
    out.forEach(function (p) { p.aosBeforeStart = p.aos < startMs; p.inProgressAtStart = p.aosBeforeStart; p.losAfterWindow = p.los > endMs; });
    return out.filter(function (p) { return p.aos <= endMs && p.los >= startMs; });
  }
  // samples every stepSec (aligned to AOS) plus the exact LOS: [{t, az, el, rangeKm, rrKmS, sunlit, visible}]
  function trackPass(sat, obs, aosMs, losMs, stepSec) {
    var st = (stepSec || 30) * 1000, out = [];
    for (var t = aosMs; t < losMs; t += st) { var s = stateAt(sat, obs, t); if (s) out.push(s); }
    var last = stateAt(sat, obs, losMs); if (last) out.push(last);
    return out;
  }
  // ground track for the map: [{t, lat, lon}]
  function groundTrack(sat, obs, startMs, endMs, stepSec) {
    var out = [];
    for (var t = startMs; t <= endMs; t += stepSec * 1000) { var s = stateAt(sat, obs, t, true); if (s) out.push({ t: t, lat: s.latDeg, lon: s.lonDeg, alt: s.altKm }); }
    return out;
  }
  /* ---------- orbit direction / local solar time / ground-track distance (SAR helpers) ---------- */
  // Sub-satellite point and orbit direction at ms. ascending = the satellite is moving north (ECI/ECEF velocity z > 0; the z axis is
  // shared by both frames). lstHours = MEAN local solar time (0–24 h) at the sub-satellite longitude: UTC hour + lon/15 (no equation of time).
  function nodeInfo(sat, ms) {
    var date = new Date(ms), pv = satellite.propagate(sat.rec, date);
    if (!pv || !pv.position || typeof pv.position === "boolean" || !pv.velocity) return null;
    var gd = satellite.eciToGeodetic(pv.position, satellite.gstime(date)), lon = gd.longitude * R2D;
    if (lon > 180) lon -= 360; if (lon < -180) lon += 360;
    var utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3600000;
    return { latDeg: gd.latitude * R2D, lonDeg: lon, altKm: gd.height, vzKmS: pv.velocity.z, ascending: pv.velocity.z > 0, lstHours: (((utcH + lon / 15) % 24) + 24) % 24 };
  }
  // great-circle distance (km, mean Earth radius) between two lat/lon points in degrees
  function greatCircleKm(lat1, lon1, lat2, lon2) {
    var a1 = lat1 * D2R, a2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var h = Math.sin((a2 - a1) / 2) * Math.sin((a2 - a1) / 2) + Math.cos(a1) * Math.cos(a2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Pass geometry for a SAR-style view: orbit direction and local solar time at the time of closest approach, and the great-circle distance from the
  // observer to the sub-satellite point then (ground-track distance). pass = a findPasses() result (uses pass.tca).
  function passGeometry(sat, obs, pass) {
    var ni = nodeInfo(sat, pass.tca); if (!ni) return null;
    return { ascending: ni.ascending, lstHours: ni.lstHours, subLatDeg: ni.latDeg, subLonDeg: ni.lonDeg, groundTrackDistKm: greatCircleKm(obs.latDeg, obs.lonDeg, ni.latDeg, ni.lonDeg) };
  }
  // footprint radius (central angle, degrees) for a satellite at altitude altKm seen above elevation elDeg
  function footprintAngleDeg(altKm, elDeg) {
    var re = 6371, el = (elDeg || 0) * D2R, x = re * Math.cos(el) / (re + altKm);
    return (Math.acos(Math.min(1, x)) - el) * R2D;
  }
  return {
    makeSat: makeSat, makeObserver: makeObserver, stateAt: stateAt, findPasses: findPasses, trackPass: trackPass, groundTrack: groundTrack,
    nodeInfo: nodeInfo, greatCircleKm: greatCircleKm, passGeometry: passGeometry, sgp4Lines: sgp4Lines, sunEci: sunEci, sunElevation: sunElevation, isSunlit: isSunlit, gmstAt: gmstAt, footprintAngleDeg: footprintAngleDeg, julianDate: julianDate,
    VISIBLE_SUN_EL: VISIBLE_SUN_EL, OMEGA_E: OMEGA_E
  };
});
