/* Astronomy Engine 2.1.19 (MIT): geometric Moon, planet and Polaris positions.
   No refraction is applied, matching the satellite sky chart's horizon. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./vendor/astronomy.browser.min.js"));
  else root.SatCelestial = factory(root.Astronomy);
})(typeof self !== "undefined" ? self : this, function (A) {
  "use strict";
  var BODIES = ["Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
  // SIMBAD alf UMi, ICRS epoch J2000 (Hipparcos re-reduction, van Leeuwen 2007):
  // Source and accuracy notes: README.md, "Polaris reference".
  // RA 02h31m49.09456s, Dec +89d15m50.7923s; parallax 7.54 mas.
  // Engine applies precession/nutation and observer corrections. Proper motion
  // is omitted (about 1 arcsecond since J2000 in 2026, below chart resolution).
  // Star1 is reserved for Polaris; no external star catalog is fetched.
  var POLARIS = { ra: 2 + 31 / 60 + 49.09456 / 3600, dec: 89 + 15 / 60 + 50.7923 / 3600, distance: 3261.563777 / 7.54 };
  var starDefined = false;
  var cachedKey = "", cached = null;
  function positions(point, ms) {
    if (!point || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lon) || Math.abs(point.lon) > 180 || !Number.isFinite(point.alt) || !Number.isFinite(ms)) throw new RangeError("An observing location and time are required.");
    var key = [point.lat, point.lon, point.alt, Math.floor(ms / 1000)].join("|");
    if (key === cachedKey && cached) return cached;
    if (!A) throw new Error("Astronomy Engine is unavailable.");
    if (!starDefined) { A.DefineStar(A.Body.Star1, POLARIS.ra, POLARIS.dec, POLARIS.distance); starDefined = true; }
    var date = new Date(ms), observer = new A.Observer(point.lat, point.lon, point.alt);
    var result = BODIES.map(function (name) {
      // Of-date coordinates and observer parallax matter especially for the Moon.
      var eq = A.Equator(name, date, observer, true, true), hor = A.Horizon(date, observer, eq.ra, eq.dec);
      var moon = name === "Moon";
      return { id: "body:" + name, name: name, kind: moon ? "moon" : "planet", az: hor.azimuth, el: hor.altitude,
        color: moon ? "#e2e8f0" : "#fb923c", illumination: moon ? A.Illumination(name, date).phase_fraction : null };
    });
    var starEq = A.Equator(A.Body.Star1, date, observer, true, true), starHor = A.Horizon(date, observer, starEq.ra, starEq.dec);
    result.push({ id: "star:Polaris", name: "Polaris · North Star", kind: "star", az: starHor.azimuth, el: starHor.altitude, color: "#c4b5fd", illumination: null });
    if (!result.every(function (r) { return Number.isFinite(r.az) && Number.isFinite(r.el); })) throw new Error("Astronomical positions could not be calculated.");
    cachedKey = key; cached = result; return result;
  }
  return { positions: positions, BODIES: BODIES, VERSION: "2.1.19" };
});
