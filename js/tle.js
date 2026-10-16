/* TLE parsing / merging (pure, UMD). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatTle = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function checksumOk(line) {
    if (line.length < 69) return false;
    var sum = 0;
    for (var i = 0; i < 68; i++) { var c = line.charAt(i); if (c >= "0" && c <= "9") sum += +c; else if (c === "-") sum += 1; }
    return sum % 10 === +line.charAt(68);
  }
  /* Alpha-5 catalog numbers: from 100000 up, NORAD ids no longer fit the 5 TLE digits, so the first digit becomes a letter
     (A=10 … Z=33, skipping I and O): 100889 -> "A0889". CelesTrak serves such objects only as JSON/OMM; fromOmm() writes them as Alpha-5 TLEs. */
  var A5 = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  function parseCat(field) {
    field = String(field);
    var c = field.charAt(0), i = A5.indexOf(c.toUpperCase());
    if (i >= 0 && /^[A-Za-z]\d{4}$/.test(field)) return (10 + i) * 10000 + parseInt(field.slice(1), 10);
    return /^\s*\d+\s*$/.test(field) ? parseInt(field, 10) : NaN;
  }
  function catField(n) {
    n = Math.floor(n);
    if (n < 0 || n > 339999) throw new RangeError("catalog number out of range: " + n);
    if (n < 100000) return ("00000" + n).slice(-5);
    return A5.charAt(Math.floor(n / 10000) - 10) + ("0000" + (n % 10000)).slice(-4);
  }
  function checksum(line68) {
    var sum = 0;
    for (var i = 0; i < 68; i++) { var c = line68.charAt(i); if (c >= "0" && c <= "9") sum += +c; else if (c === "-") sum += 1; }
    return sum % 10;
  }
  function epochMs(line1) {
    var yy = +line1.substr(18, 2), day = parseFloat(line1.substr(20, 12));
    var year = yy < 57 ? 2000 + yy : 1900 + yy;
    return Date.UTC(year, 0, 1) + (day - 1) * 86400000;
  }
  // Parse 2-line or 3-line (name + 2 lines) element sets. Returns {sats, errors}
  function parse(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim() !== ""; });
    var sats = [], errors = [], i = 0;
    while (i < lines.length) {
      var name = null, l1, l2;
      if (lines[i].charAt(0) === "1" && lines[i].charAt(1) === " " && lines[i + 1] && lines[i + 1].charAt(0) === "2") { l1 = lines[i]; l2 = lines[i + 1]; i += 2; }
      else if (lines[i + 2] && lines[i + 1].charAt(0) === "1" && lines[i + 2].charAt(0) === "2") { name = lines[i].replace(/^0 /, "").trim(); l1 = lines[i + 1]; l2 = lines[i + 2]; i += 3; }
      else { errors.push("Skipped unrecognised line: " + lines[i].slice(0, 30)); i++; continue; }
      if (l1.length < 69 || l2.length < 69) { errors.push("Short TLE line for " + (name || l1.slice(2, 7))); continue; }
      if (!checksumOk(l1) || !checksumOk(l2)) { errors.push("Checksum error for " + (name || l1.slice(2, 7))); continue; }
      var n1 = parseCat(l1.substr(2, 5)), n2 = parseCat(l2.substr(2, 5));
      if (isNaN(n1) || n1 !== n2) { errors.push("Catalog number mismatch for " + (name || n1)); continue; }
      sats.push({ norad: n1, name: name || ("NORAD " + n1), l1: l1.slice(0, 69), l2: l2.slice(0, 69), epochMs: epochMs(l1) });
    }
    return { sats: sats, errors: errors };
  }
  // CelesTrak OMM (JSON GP record) -> {name, l1, l2} Alpha-5 capable TLE text (checksums computed). Throws on missing fields.
  function pad(str, w) { str = String(str); while (str.length < w) str = " " + str; return str; }
  function fx(v, w, d) { return pad(Number(v).toFixed(d), w); }
  function expField(v) {   // TLE "±NNNNN±N" decimal-point-assumed exponent format
    v = Number(v); if (!v) return " 00000+0";
    var e = Math.floor(Math.log10(Math.abs(v))) + 1, d = Math.round(Math.abs(v) / Math.pow(10, e) * 1e5);
    if (d >= 100000) { d = 10000; e++; }
    return (v < 0 ? "-" : " ") + ("00000" + d).slice(-5) + (e < 0 ? "-" : "+") + Math.abs(e);
  }
  function fromOmm(o) {
    ["NORAD_CAT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY"].forEach(function (k) {
      if (o[k] === undefined || o[k] === null || o[k] === "") throw new Error("OMM record is missing " + k);
    });
    var t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(o.EPOCH) ? o.EPOCH : o.EPOCH + "Z");
    if (isNaN(t)) throw new Error("OMM record has a bad EPOCH");
    var d = new Date(t), y0 = Date.UTC(d.getUTCFullYear(), 0, 1), doy = (t - y0) / 86400000 + 1;
    var id = String(o.OBJECT_ID || "").replace(/^(\d{4})-(\d{3})(\w*)$/, function (m, yr, no, pc) { return yr.slice(2) + no + pc; });
    var ndot = Number(o.MEAN_MOTION_DOT || 0), ndotS = (ndot < 0 ? "-" : " ") + Math.abs(ndot).toFixed(8).slice(1);
    var eph = o.EPHEMERIS_TYPE || 0, cat = catField(o.NORAD_CAT_ID);
    var l1 = "1 " + cat + (o.CLASSIFICATION_TYPE || "U") + " " + (id + "        ").slice(0, 8) + " " + ("0" + (d.getUTCFullYear() % 100)).slice(-2) + ("000" + Number(doy).toFixed(8)).slice(-12) + " " +
      ndotS + " " + expField(o.MEAN_MOTION_DDOT) + " " + expField(o.BSTAR) + " " + eph + " " + pad(o.ELEMENT_SET_NO || 0, 4);
    var l2 = "2 " + cat + " " + fx(o.INCLINATION, 8, 4) + " " + fx(o.RA_OF_ASC_NODE, 8, 4) + " " + ("0000000" + Math.round(Number(o.ECCENTRICITY) * 1e7)).slice(-7) + " " + fx(o.ARG_OF_PERICENTER, 8, 4) + " " + fx(o.MEAN_ANOMALY, 8, 4) + " " + fx(o.MEAN_MOTION, 11, 8) + pad((o.REV_AT_EPOCH || 0) % 100000, 5);
    if (l1.length !== 68 || l2.length !== 68) throw new Error("Could not format OMM record " + o.NORAD_CAT_ID + " as TLE");
    return { name: String(o.OBJECT_NAME || "NORAD " + o.NORAD_CAT_ID).trim(), l1: l1 + checksum(l1), l2: l2 + checksum(l2) };
  }
  // Array of OMM records -> parse() result (same shape as parse(): {sats, errors})
  function parseOmm(json) {
    var arr = typeof json === "string" ? JSON.parse(json) : json, texts = [], errors = [];
    if (!Array.isArray(arr)) return { sats: [], errors: ["Not an OMM array"] };
    arr.forEach(function (o) { try { var t = fromOmm(o); texts.push(t.name + "\n" + t.l1 + "\n" + t.l2); } catch (e) { errors.push(e.message); } });
    var r = parse(texts.join("\n")); r.errors = errors.concat(r.errors); return r;
  }
  // merge lists keyed by NORAD id, keeping the newest epoch
  function merge() {
    var map = {};
    for (var a = 0; a < arguments.length; a++) (arguments[a] || []).forEach(function (s) { if (!map[s.norad] || s.epochMs >= map[s.norad].epochMs) map[s.norad] = s; });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function ageDays(sat, nowMs) { return (nowMs - sat.epochMs) / 86400000; }
  var STALE_DAYS = 7;
  function isStale(sat, nowMs) { return ageDays(sat, nowMs) > STALE_DAYS; }
  function serialize(sats) { return sats.map(function (s) { return s.name + "\n" + s.l1 + "\n" + s.l2; }).join("\n") + "\n"; }
  return { parse: parse, parseOmm: parseOmm, fromOmm: fromOmm, parseCat: parseCat, catField: catField, checksum: checksum, merge: merge, ageDays: ageDays, isStale: isStale, serialize: serialize, checksumOk: checksumOk, epochMs: epochMs, STALE_DAYS: STALE_DAYS };
});
