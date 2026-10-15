/* iCalendar (.ics) export for passes (pure, UMD). RFC 5545: CRLF line ends, 75-octet folding, escaped text. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatIcs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function utcStamp(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  function esc(s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function utf8len(ch) { var c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  function fold(line) { // fold at 75 octets without splitting a character
    var out = [], cur = "", bytes = 0;
    for (var ch of line) {
      var l = utf8len(ch), limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
      if (bytes + l > limit) { out.push(cur); cur = ""; bytes = 0; }
      cur += ch; bytes += l;
    }
    out.push(cur);
    return out.map(function (s, i) { return i === 0 ? s : " " + s; }).join("\r\n");
  }
  function compass16(az) { var p = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]; return p[Math.round(((az % 360) + 360) % 360 / 22.5) % 16]; }
  // pass: from SatPasses.findPasses. opts: {observerLabel, alarmMin (0 = none), nowMs, tleAgeDays, prodId}
  function eventLines(pass, opts) {
    opts = opts || {};
    var desc = [
      "Satellite: " + pass.satName + " (NORAD " + pass.norad + ")",
      "AOS " + utcStamp(pass.aos).slice(9, 15).replace(/(..)(..)(..)/, "$1:$2:$3") + " UTC, azimuth " + Math.round(pass.aosAz) + "° " + compass16(pass.aosAz),
      "Max elevation " + pass.maxEl.toFixed(0) + "° at " + utcStamp(pass.tca).slice(9, 15).replace(/(..)(..)(..)/, "$1:$2:$3") + " UTC, azimuth " + Math.round(pass.tcaAz) + "° " + compass16(pass.tcaAz),
      "LOS " + utcStamp(pass.los).slice(9, 15).replace(/(..)(..)(..)/, "$1:$2:$3") + " UTC, azimuth " + Math.round(pass.losAz) + "° " + compass16(pass.losAz),
      "Duration " + (pass.truncated ? "at least " : "") + Math.floor(pass.durationSec / 60) + "m " + Math.round(pass.durationSec % 60) + "s" + (pass.truncated ? " (LOS not found within the search limit)" : "") + (pass.visible ? " – visible pass (sunlit satellite, dark sky)" : ""),
      opts.observerLabel ? "Observer: " + opts.observerLabel : null,
      opts.tleAgeDays !== undefined ? "Prediction uses a TLE that is " + opts.tleAgeDays.toFixed(1) + " days old; accuracy degrades with TLE age." : null,
      "Predictions are estimates – check a live tracker before relying on them."
    ].filter(Boolean).join("\n");
    var lines = [
      "BEGIN:VEVENT",
      "UID:satpass-" + pass.norad + "-" + Math.round(pass.aos / 1000) + "@satpass.local",
      "DTSTAMP:" + utcStamp(opts.nowMs || Date.now()),
      "DTSTART:" + utcStamp(pass.aos),
      "DTEND:" + utcStamp(pass.los),
      "SUMMARY:" + esc(pass.satName + " pass – max " + pass.maxEl.toFixed(0) + "°"),
      "DESCRIPTION:" + esc(desc),
      "CATEGORIES:Satellite pass"
    ];
    if (opts.alarmMin > 0) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(pass.satName + " pass in " + opts.alarmMin + " min"), "TRIGGER:-PT" + opts.alarmMin + "M", "END:VALARM");
    lines.push("END:VEVENT");
    return lines;
  }
  function build(passes, opts) {
    opts = opts || {};
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:" + (opts.prodId || "-//SatPass//Satellite pass predictor//EN"), "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Satellite passes"];
    passes.forEach(function (p) { lines = lines.concat(eventLines(p, opts)); });
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }
  return { build: build, utcStamp: utcStamp, escapeText: esc, fold: fold };
});
