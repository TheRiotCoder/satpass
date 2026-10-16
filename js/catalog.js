/* Satellite categories and the generalised radio-descriptor model (pure, UMD).
   A satellite can belong to several categories (e.g. COSMO-SkyMed is both "SAR" and "Earth observation"). Category membership comes from the
   CelesTrak GP group (or curated query list) that was fetched; it is not stored per satellite in the TLE.
   Radio descriptor types: "amateur" (transponder / beacon table in radio.js: uplink + downlink) and "radar" (SAR instrument in sar.js:
   nominal radar band / centre frequency, informational only). Starlink / OneWeb mega-constellations are deliberately not in any category. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../data/sar.js"), require("./radio.js"));
  else root.SatCatalog = factory(root.SatSar, root.SatRadio);
})(typeof self !== "undefined" ? self : this, function (Sar, Radio) {
  "use strict";
  var BASE = "https://celestrak.org/NORAD/elements/gp.php?";
  function grp(g) { return { id: g, q: "GROUP=" + g, fmt: "tle" }; }
  function cat(n) { return { id: "catnr" + n, q: "CATNR=" + n, fmt: "tle" }; }
  var CATEGORIES = [
    { id: "amateur", label: "Amateur", core: true, fetch: [grp("amateur"), cat(67291)] },   // 67291 = RS95S (QMR-KWT-2), not yet in GROUP=amateur
    { id: "stations", label: "Stations", core: true, fetch: [grp("stations")] },
    { id: "weather", label: "Weather", core: true, fetch: [grp("weather")] },   // NOAA 15/18/19 were decommissioned in 2025 (no longer fetched)
    { id: "sar", label: "SAR", fetch: Sar.QUERIES.map(function (q) { return { id: q, q: q, fmt: "json" }; }), accept: function (s) { return Sar.isSar(s.norad, s.name); },
      note: "Synthetic-aperture radar satellites (curated list, see data/sar.js)" },
    { id: "eo", label: "Earth observation", fetch: [grp("resource")] },
    { id: "nav", label: "Navigation", fetch: [grp("gps-ops"), grp("galileo"), grp("glo-ops"), grp("beidou")], note: "GPS, Galileo, GLONASS, BeiDou" },
    { id: "science", label: "Science", fetch: [grp("science")] }
  ];
  var BY_ID = {}; CATEGORIES.forEach(function (c) { BY_ID[c.id] = c; });
  var CORE = CATEGORIES.filter(function (c) { return c.core; }).map(function (c) { return c.id; });
  function queryUrl(spec) { return BASE + spec.q + "&FORMAT=" + spec.fmt; }
  // Sats-tab view modes: the three v1.0.1 modes plus one per category.
  var MODES = ["curated", "favs", "all"].concat(CATEGORIES.map(function (c) { return c.id; })).concat(["searched"]);
  function validMode(m) { return MODES.indexOf(m) >= 0; }

  /* --- radio descriptor ---
     Returns {type: "amateur", radios: [...]} | {type: "radar", sar: {mission, name}} | null. A satellite can have both (none today). */
  function radioKinds(norad, name) {
    var out = [];
    if (Radio.radios(norad).length) out.push("amateur");
    if (Sar.forSat(norad, name)) out.push("radar");
    return out;
  }
  function describe(norad, name) {
    var r = Radio.radios(norad), s = Sar.forSat(norad, name);
    return { amateur: r.length ? r : null, radar: s || null };
  }

  /* --- text search --- */
  function haystack(norad, name) {
    var c = Radio.curated(norad), r = Sar.forSat(norad, name), h = (c ? c.label + " " + c.short : String(name || "")) + " " + norad;
    if (r) h += " " + r.name + " " + r.mission.name + " " + r.mission.operator + " " + (r.mission.band || "") + "-band sar radar";
    return h.toLowerCase();
  }
  // ids: [{norad, name}] -> those matching every word of the query (case-insensitive); empty query matches all
  function filterText(items, query) {
    var words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(function (it) { var h = haystack(it.norad, it.name); return words.every(function (w) { return h.indexOf(w) >= 0; }); });
  }

  /* --- on-demand lookup guard ---
     Search of CelesTrak by name is only offered for specific text; the huge constellations (Starlink / OneWeb: thousands of satellites,
     ~1 MB responses) need a number, e.g. "STARLINK-1234", and any response is capped. */
  var MAX_LOOKUP_RESULTS = 40, MEGA = /starlink|oneweb|kuiper|cosmos|iridium|flock|lemur/i;
  function lookupCheck(text) {
    var t = String(text || "").trim();
    if (t.length < 3) return { ok: false, reason: "Type at least 3 characters." };
    if (/[^A-Za-z0-9 ._()\/-]/.test(t)) return { ok: false, reason: "Use letters, digits, space, dash or dot only." };
    if (MEGA.test(t) && !/\d{2,}/.test(t)) return { ok: false, reason: "That name matches thousands of satellites. Add a number, e.g. “STARLINK-1234”, or search by NORAD id." };
    if (/^\d{1,6}$/.test(t)) return { ok: true, url: BASE + "CATNR=" + parseInt(t, 10) + "&FORMAT=json", kind: "catnr" };
    return { ok: true, url: BASE + "NAME=" + encodeURIComponent(t) + "&FORMAT=json", kind: "name" };
  }

  /* --- v1.0.1 → v1.1.0 state migration (pure: takes the parsed localStorage values, returns the fixed ones) --- */
  function migrate(settings, satMode) {
    settings = settings && typeof settings === "object" ? settings : {};
    var favs = Array.isArray(settings.favs) ? settings.favs.map(Number).filter(function (n) { return isFinite(n) && n > 0 && Math.floor(n) === n; }) : null;
    if (favs) { var seen = {}; favs = favs.filter(function (n) { return seen[n] ? false : (seen[n] = 1); }); }
    var out = Object.assign({}, settings);
    if (favs) out.favs = favs; else delete out.favs;
    // range-check numeric settings read from storage (a corrupt / hand-edited value must not reach the SGP4 observer or the pass search)
    function num(v, lo, hi, d) { v = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : d; }
    if (out.lat != null || out.lon != null) {
      var la = num(out.lat, -90, 90, null), lo = num(out.lon, -180, 180, null);
      if (la === null || lo === null) { delete out.lat; delete out.lon; } else { out.lat = la; out.lon = lo; }   // no half-valid location
    }
    if ("alt" in out) out.alt = num(out.alt, -500, 9000, 0);
    if ("minEl" in out) out.minEl = num(out.minEl, 0, 80, 10);
    if ("days" in out) { var dd = num(out.days, 1, 10, 3); out.days = Math.floor(dd); }
    if ("leadMin" in out) out.leadMin = num(out.leadMin, 0, 120, 10);
    out.schema = 2;
    return { settings: out, satMode: validMode(satMode) ? satMode : "curated" };
  }
  return { CATEGORIES: CATEGORIES, BY_ID: BY_ID, CORE: CORE, MODES: MODES, validMode: validMode, queryUrl: queryUrl, radioKinds: radioKinds, describe: describe,
           lookupCheck: lookupCheck, haystack: haystack, filterText: filterText, MAX_LOOKUP_RESULTS: MAX_LOOKUP_RESULTS, migrate: migrate, BASE: BASE };
});
