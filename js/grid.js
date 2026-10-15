/* Maidenhead grid locator conversions (pure, UMD). 2–10 character locators. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatGrid = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var RE = /^[A-Ra-r]{2}([0-9]{2}([A-Xa-x]{2}([0-9]{2}([A-Xa-x]{2})?)?)?)?$/;
  function isValid(g) { return typeof g === "string" && RE.test(g.trim()); }
  // cell size (degrees) after n characters: [lon, lat]
  function cellSize(chars) {
    var lon = 20, lat = 10;
    for (var i = 2; i < chars; i += 2) {
      var div = (i % 4 === 2) ? 10 : 24; // pairs: 2-3 digits (÷10), 4-5 letters (÷24), 6-7 digits (÷10), 8-9 letters (÷24)
      lon /= div; lat /= div;
    }
    return [lon, lat];
  }
  // lat/lon (degrees) -> locator with `chars` characters (2,4,6,8,10); default 6
  function toGrid(lat, lon, chars) {
    chars = chars || 6;
    if (typeof lat !== "number" || typeof lon !== "number" || isNaN(lat) || isNaN(lon)) throw new RangeError("lat/lon must be numbers");
    if (lat < -90 || lat > 90) throw new RangeError("Latitude must be between -90 and 90");
    if (lon < -180 || lon > 180) throw new RangeError("Longitude must be between -180 and 180");
    if (lon === 180) lon = -180;                     // 180°E is the same meridian as 180°W
    var eps = 1e-9;
    var x = lon + 180, y = Math.min(lat + 90, 180 - eps);
    var out = "";
    var cw = 20, ch = 10;
    for (var i = 0; i < chars; i += 2) {
      var ix = Math.min(Math.floor(x / cw + eps), (i === 0 ? 17 : (i % 4 === 2 ? 9 : 23)));
      var iy = Math.min(Math.floor(y / ch + eps), (i === 0 ? 17 : (i % 4 === 2 ? 9 : 23)));
      if (i === 0) out += String.fromCharCode(65 + ix) + String.fromCharCode(65 + iy);
      else if (i % 4 === 2) out += ix + "" + iy;
      else out += String.fromCharCode(97 + ix) + String.fromCharCode(97 + iy);
      x -= ix * cw; y -= iy * ch;
      var div = (i % 4 === 0) ? 10 : 24;            // next level divisor
      cw /= div; ch /= div;
    }
    return out;
  }
  // locator -> {lat, lon (cell centre), latMin, latMax, lonMin, lonMax, chars}
  function fromGrid(g) {
    if (!isValid(g)) throw new RangeError("Not a valid Maidenhead locator (e.g. EM10 or EM10bk)");
    g = g.trim(); var n = g.length;
    var lon = -180, lat = -90, cw = 20, ch = 10;
    for (var i = 0; i < n; i += 2) {
      var a = g.charAt(i), b = g.charAt(i + 1), ix, iy;
      if (i === 0) { ix = a.toUpperCase().charCodeAt(0) - 65; iy = b.toUpperCase().charCodeAt(0) - 65; }
      else if (i % 4 === 2) { ix = +a; iy = +b; }
      else { ix = a.toLowerCase().charCodeAt(0) - 97; iy = b.toLowerCase().charCodeAt(0) - 97; }
      lon += ix * cw; lat += iy * ch;
      if (i + 2 < n) { var div = (i % 4 === 0) ? 10 : 24; cw /= div; ch /= div; }
    }
    return { lat: lat + ch / 2, lon: lon + cw / 2, latMin: lat, latMax: lat + ch, lonMin: lon, lonMax: lon + cw, chars: n };
  }
  // great-circle distance (km) and initial bearing between two points (handy for the UI)
  function distanceKm(lat1, lon1, lat2, lon2) {
    var r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    var a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin(dLon / 2), 2);
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return { isValid: isValid, toGrid: toGrid, fromGrid: fromGrid, cellSize: cellSize, distanceKm: distanceKm };
});
