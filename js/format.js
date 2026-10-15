/* Formatting helpers (pure, UMD). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatFmt = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var PTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = "0" + n; return n; }
  function norm360(a) { a = a % 360; return a < 0 ? a + 360 : a; }
  function compass(azDeg) { return PTS[Math.round(norm360(azDeg) / 22.5) % 16]; }
  // utc: true -> UTC, false -> device local time
  function parts(ms, utc) {
    var d = new Date(ms);
    return utc ? { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() }
               : { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), dow: d.getDay() };
  }
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function clock(ms, utc, withSec) { var p = parts(ms, utc); return pad(p.h) + ":" + pad(p.mi) + (withSec ? ":" + pad(p.s) : ""); }
  function date(ms, utc) { var p = parts(ms, utc); return DOW[p.dow] + " " + MON[p.mo - 1] + " " + p.d; }
  function dateKey(ms, utc) { var p = parts(ms, utc); return p.y + "-" + pad(p.mo) + "-" + pad(p.d); }
  function tzLabel(ms, utc) {
    if (utc) return "UTC";
    var off = -new Date(ms).getTimezoneOffset(), sign = off < 0 ? "−" : "+", a = Math.abs(off);
    return "UTC" + sign + Math.floor(a / 60) + (a % 60 ? ":" + pad(a % 60) : "");
  }
  function duration(sec) { sec = Math.round(sec); var m = Math.floor(sec / 60), s = sec % 60; return m + "m " + pad(s) + "s"; }
  function countdown(ms) { // ms until; "2h 05m", "12m 30s", "45s"
    var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h >= 24) return Math.floor(h / 24) + "d " + (h % 24) + "h";
    if (h > 0) return h + "h " + pad(m) + "m";
    if (m > 0) return m + "m " + pad(s % 60) + "s";
    return s + "s";
  }
  function age(ms) { var d = ms / 86400000; return d < 1 ? Math.max(0, Math.round(d * 24)) + " h" : d.toFixed(1) + " d"; }
  function mhz(hz, digits) { return (hz / 1e6).toFixed(digits === undefined ? 4 : digits); }
  function signedHz(hz) { return (hz >= 0 ? "+" : "−") + Math.abs(Math.round(hz)).toLocaleString("en-US") + " Hz"; }
  return { compass: compass, pad: pad, norm360: norm360, clock: clock, date: date, dateKey: dateKey, tzLabel: tzLabel, duration: duration, countdown: countdown, age: age, mhz: mhz, signedHz: signedHz, parts: parts };
});
