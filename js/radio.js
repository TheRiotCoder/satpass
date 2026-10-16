/* Curated satellite catalogue + approximate radio frequency table (pure data, UMD).
   *** APPROXIMATE – frequencies, tones and operating status change. Verify with the AMSAT status page
   *** (https://www.amsat.org/status/) and the operator's announcements before relying on them.
   Frequencies are in Hz (satellite-frame, i.e. nominal). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatRadio = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var M = 1e6;
  // curated list (shown first / default favourites). bright = large enough for naked-eye passes.
  var CURATED = [
    { norad: 25544, short: "ISS", label: "ISS (ZARYA)", group: "Station", bright: true, fav: true },
    { norad: 48274, short: "CSS", label: "Tiangong (CSS/Tianhe)", group: "Station", bright: true },
    { norad: 27607, short: "SO-50", label: "SO-50 (SaudiSat-1C)", group: "Amateur", fav: true },
    { norad: 43017, short: "AO-91", label: "AO-91 (Fox-1B / RadFxSat)", group: "Amateur" },
    { norad: 43137, short: "AO-92", label: "AO-92 (Fox-1D)", group: "Amateur" },
    { norad: 7530, short: "AO-7", label: "AO-7 (OSCAR 7)", group: "Amateur", fav: true },
    { norad: 44909, short: "RS-44", label: "RS-44 (DOSAAF-85)", group: "Amateur", fav: true },
    { norad: 24278, short: "FO-29", label: "FO-29 (JAS-2)", group: "Amateur" },
    { norad: 39444, short: "AO-73", label: "AO-73 (FUNcube-1)", group: "Amateur" },
    { norad: 42761, short: "CAS-4A", label: "CAS-4A (Zhuhai-1 01)", group: "Amateur" },
    { norad: 42759, short: "CAS-4B", label: "CAS-4B (Zhuhai-1 02)", group: "Amateur" },
    { norad: 53109, short: "IO-117", label: "IO-117 (GreenCube)", group: "Amateur" },
    { norad: 63217, short: "TEVEL-1", label: "TEVEL2-1", group: "Amateur" },
    { norad: 63219, short: "TEVEL-2", label: "TEVEL2-2", group: "Amateur" },
    { norad: 63218, short: "TEVEL-3", label: "TEVEL2-3", group: "Amateur" },
    { norad: 63213, short: "TEVEL-4", label: "TEVEL2-4", group: "Amateur" },
    { norad: 63214, short: "TEVEL-5", label: "TEVEL2-5", group: "Amateur" },
    { norad: 63215, short: "TEVEL-6", label: "TEVEL2-6", group: "Amateur" },
    { norad: 63238, short: "TEVEL-7", label: "TEVEL2-7", group: "Amateur" },
    { norad: 63239, short: "TEVEL-8", label: "TEVEL2-8", group: "Amateur" },
    { norad: 63237, short: "TEVEL-9", label: "TEVEL2-9", group: "Amateur" },
    { norad: 25338, short: "NOAA 15", label: "NOAA 15", group: "Weather" },
    { norad: 28654, short: "NOAA 18", label: "NOAA 18", group: "Weather" },
    { norad: 33591, short: "NOAA 19", label: "NOAA 19", group: "Weather" },
    { norad: 57166, short: "METEOR-M2 3", label: "METEOR-M2 3", group: "Weather" },
    { norad: 59051, short: "METEOR-M2 4", label: "METEOR-M2 4", group: "Weather" }
  ];
  // radio entries. kind: "fm" | "linear" | "digital" | "beacon" | "apt"
  // linear: upLo/upHi/downLo/downHi/inverting. fm/digital: up (or null) and down. tone in Hz (CTCSS).
  var TEVEL = { mode: "FM", kind: "fm", label: "FM voice (all TEVEL sats share this)", up: 145.970 * M, down: 436.400 * M, tone: null, note: "Tevel 1–8 FM transponders; operated in scheduled windows" };
  var RADIO = {
    25544: [
      { label: "APRS digipeater / packet", mode: "FM AFSK 1200 baud", kind: "digital", up: 145.825 * M, down: 145.825 * M, tone: null, note: "Simplex packet, 145.825 MHz both ways (region/status varies)" },
      { label: "Voice repeater (cross-band)", mode: "FM", kind: "fm", up: 145.990 * M, down: 437.800 * M, tone: 67.0, note: "When enabled by the crew; uplink needs 67.0 Hz tone" },
      { label: "SSTV event (ARISS)", mode: "FM SSTV (PD120)", kind: "digital", up: null, down: 145.800 * M, tone: null, note: "Only during announced events" }
    ],
    27607: [{ label: "FM repeater", mode: "FM", kind: "fm", up: 145.850 * M, down: 436.795 * M, tone: 67.0, note: "Arm with 74.4 Hz tone for ~10 s, then 67.0 Hz; status varies" }],
    43017: [{ label: "FM repeater", mode: "FM", kind: "fm", up: 435.250 * M, down: 145.960 * M, tone: 67.0, note: "Fox-1B; operation reduced – check status" }],
    43137: [{ label: "FM repeater", mode: "FM", kind: "fm", up: 435.350 * M, down: 145.880 * M, tone: 67.0, note: "AO-92 – no current TLE in CelesTrak (may have re-entered)" }],
    7530: [
      { label: "Mode B (U/V)", mode: "SSB/CW linear", kind: "linear", upLo: 432.125 * M, upHi: 432.175 * M, downLo: 145.925 * M, downHi: 145.975 * M, inverting: true, note: "Mode changes on a schedule; beacons 145.972 / 29.502 MHz" },
      { label: "Mode A (V/H)", mode: "SSB/CW linear", kind: "linear", upLo: 145.850 * M, upHi: 145.950 * M, downLo: 29.400 * M, downHi: 29.500 * M, inverting: true, note: "Mode changes on a schedule" }
    ],
    44909: [{ label: "Linear transponder (V/U)", mode: "SSB/CW", kind: "linear", upLo: 145.935 * M, upHi: 145.995 * M, downLo: 435.640 * M, downHi: 435.700 * M, inverting: true, note: "Inverting; CW beacon 435.605 MHz" }],
    24278: [{ label: "Linear transponder (JA)", mode: "SSB/CW", kind: "linear", upLo: 145.900 * M, upHi: 146.000 * M, downLo: 435.800 * M, downHi: 435.900 * M, inverting: true, note: "Inverting; operates on a schedule (digital/analog modes)" }],
    39444: [{ label: "Linear transponder", mode: "SSB/CW", kind: "linear", upLo: 435.130 * M, upHi: 435.150 * M, downLo: 145.950 * M, downHi: 145.970 * M, inverting: true, note: "Transponder mostly active in eclipse; beacon 145.935 MHz" }],
    42761: [{ label: "Linear transponder", mode: "SSB/CW", kind: "linear", upLo: 145.855 * M, upHi: 145.875 * M, downLo: 435.210 * M, downHi: 435.230 * M, inverting: true, note: "CAS-4A – no current TLE in CelesTrak; likely inactive" }],
    42759: [{ label: "Linear transponder", mode: "SSB/CW", kind: "linear", upLo: 145.925 * M, upHi: 145.945 * M, downLo: 435.280 * M, downHi: 435.300 * M, inverting: true, note: "CAS-4B – no current TLE in CelesTrak; likely inactive" }],
    53109: [{ label: "GMSK 9k6 digipeater", mode: "GMSK 9600", kind: "digital", up: 435.310 * M, down: 435.310 * M, tone: null, note: "Same frequency up and down (simplex digipeater)" }],
    25338: [{ label: "APT weather images", mode: "APT (FM 38 kHz)", kind: "apt", up: null, down: 137.620 * M, tone: null, note: "NOAA 15/18/19 APT was being retired – verify the satellite is still transmitting" }],
    28654: [{ label: "APT weather images", mode: "APT (FM 38 kHz)", kind: "apt", up: null, down: 137.9125 * M, tone: null, note: "NOAA 15/18/19 APT was being retired – verify the satellite is still transmitting" }],
    33591: [{ label: "APT weather images", mode: "APT (FM 38 kHz)", kind: "apt", up: null, down: 137.100 * M, tone: null, note: "NOAA 15/18/19 APT was being retired – verify the satellite is still transmitting" }],
    57166: [{ label: "LRPT weather images", mode: "LRPT (QPSK 72k)", kind: "apt", up: null, down: 137.900 * M, tone: null, note: "Digital LRPT; frequency/status varies – verify" }],
    59051: [{ label: "LRPT weather images", mode: "LRPT (QPSK 72k)", kind: "apt", up: null, down: 137.900 * M, tone: null, note: "Digital LRPT; frequency/status varies – verify" }]
  };
  [63217, 63219, 63218, 63213, 63214, 63215, 63238, 63239, 63237].forEach(function (id) { RADIO[id] = [TEVEL]; });
  var DISCLAIMER = "Frequencies are approximate and change. Always verify with the AMSAT status page (amsat.org/status) before operating.";
  function curated(norad) { for (var i = 0; i < CURATED.length; i++) if (CURATED[i].norad === norad) return CURATED[i]; return null; }
  function radios(norad) { return RADIO[norad] || []; }
  // Index of the radio/mode to show for a satellite given a stored choice (clamped; invalid/missing -> 0).
  function pickRadio(norad, stored) {
    var n = radios(norad).length, i = Math.floor(Number(stored));
    return n && i >= 0 && i < n ? i : 0;
  }
  return { CURATED: CURATED, RADIO: RADIO, curated: curated, radios: radios, pickRadio: pickRadio, DISCLAIMER: DISCLAIMER };
});
