/* Visible Now: observer-based horizon/compass filters over the loaded catalog. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./passes.js"));
  else root.SatVisible = factory(root.SatPasses);
})(typeof self !== "undefined" ? self : this, function (P) {
  "use strict";
  var DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function validPoint(p) { return !!(p && Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90 && Number.isFinite(p.lon) && p.lon >= -180 && p.lon <= 180 && Number.isFinite(p.alt) && p.alt >= -500 && p.alt <= 9000); }
  function validState(s) { return !!(s && [s.el, s.az, s.altKm, s.latDeg, s.lonDeg, s.rangeKm, s.sunEl].every(Number.isFinite) && s.altKm > 0); }
  function direction(az) { return DIRECTIONS[Math.floor((((az % 360) + 360) % 360 + 22.5) / 45) % 8]; }
  function eligible(s, options) {
    options = options || {};
    var minEl = Number(options.minEl) || 0;
    return !!(validState(s) && s.el > 0 && s.el >= minEl &&
      (!options.optical || (s.sunlit && s.sunEl < P.VISIBLE_SUN_EL)) &&
      (!options.direction || options.direction === "all" || direction(s.az) === options.direction));
  }
  function conditions(s) {
    return (s.sunlit ? "Sunlit" : "Eclipsed") + " · " + (s.sunEl < P.VISIBLE_SUN_EL ? "dark sky" : s.sunEl < 0 ? "twilight" : "daylight");
  }
  function scan(entries, obs, now, options, getSat) {
    var rows = [], skipped = 0, above = 0;
    entries.forEach(function (e) {
      try {
        var sat = getSat ? getSat(e.norad) : P.makeSat(e), s = sat && P.stateAt(sat, obs, now, true);
        if (!validState(s)) { skipped++; return; }
        if (s.el > 0) above++;
        if (eligible(s, options)) rows.push({ norad: e.norad, state: s });
      } catch (err) { skipped++; }
    });
    rows.sort(function (a, b) { return b.state.el - a.state.el || a.norad - b.norad; });
    return { rows: rows, skipped: skipped, above: above, total: entries.length };
  }
  return { scan: scan, eligible: eligible, conditions: conditions, direction: direction, validPoint: validPoint, DIRECTIONS: DIRECTIONS };
});
