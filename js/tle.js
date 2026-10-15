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
      var n1 = parseInt(l1.substr(2, 5), 10), n2 = parseInt(l2.substr(2, 5), 10);
      if (n1 !== n2) { errors.push("Catalog number mismatch for " + (name || n1)); continue; }
      sats.push({ norad: n1, name: name || ("NORAD " + n1), l1: l1.slice(0, 69), l2: l2.slice(0, 69), epochMs: epochMs(l1) });
    }
    return { sats: sats, errors: errors };
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
  return { parse: parse, merge: merge, ageDays: ageDays, isStale: isStale, serialize: serialize, checksumOk: checksumOk, epochMs: epochMs, STALE_DAYS: STALE_DAYS };
});
