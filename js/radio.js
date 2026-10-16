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
    { norad: 61781, short: "AO-123", label: "AO-123 (ASRTU-1)", group: "Amateur" },
    { norad: 43678, short: "PO-101", label: "PO-101 (Diwata-2)", group: "Amateur" },
    { norad: 67291, short: "RS95S", label: "RS95S (QMR-KWT-2)", group: "Amateur" },
    { norad: 40908, short: "CAS-3H", label: "CAS-3H (LilacSat-2)", group: "Amateur" },
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
    { norad: 57166, short: "METEOR-M2 3", label: "METEOR-M2 3", group: "Weather" },
    { norad: 59051, short: "METEOR-M2 4", label: "METEOR-M2 4", group: "Weather" },
    { norad: 25338, short: "NOAA 15", label: "NOAA 15", group: "Weather" },
    { norad: 28654, short: "NOAA 18", label: "NOAA 18", group: "Weather" },
    { norad: 33591, short: "NOAA 19", label: "NOAA 19", group: "Weather" }
  ];
  // radio entries. kind: "fm" | "linear" | "digital" | "beacon" | "apt"
  // linear: upLo/upHi/downLo/downHi/inverting. fm/digital: up (or null) and down. tone in Hz (CTCSS).
  var TEVEL = { mode: "FM", kind: "fm", label: "FM voice (all TEVEL sats share this)", up: 145.970 * M, down: 436.400 * M, tone: null, note: "TEVEL2-1 through TEVEL2-9 share this FM transponder (AMSAT Live FM list, Jul 2026); beacon 436.400 MHz 9600 bd BPSK G3RUH; operated in scheduled windows" };
  var RADIO = {
    25544: [
      { label: "APRS digipeater / packet", mode: "FM AFSK 1200 baud", kind: "digital", up: 145.825 * M, down: 145.825 * M, tone: null, note: "Simplex packet, 145.825 MHz both ways (region/status varies)" },
      { label: "Voice repeater (cross-band)", mode: "FM", kind: "fm", up: 145.990 * M, down: 437.800 * M, tone: 67.0, note: "When enabled by the crew; uplink needs 67.0 Hz tone" },
      { label: "SSTV event (ARISS)", mode: "FM SSTV (PD120)", kind: "digital", up: null, down: 145.800 * M, tone: null, note: "Only during announced events" }
    ],
    27607: [{ label: "FM repeater", mode: "FM", kind: "fm", up: 145.850 * M, down: 436.795 * M, tone: 67.0, note: "Arm first: transmit a 2 s carrier with a 74.4 Hz tone (starts a 10 min timer), then use 67.0 Hz. The timer stops the repeater 10 min after the last 74.4 Hz reset even while in use – send 74.4 Hz again to re-arm (AMSAT)." }],
    43017: [{ label: "FM repeater", mode: "FM", kind: "fm", up: 435.250 * M, down: 145.960 * M, tone: 67.0, note: "Fox-1B; operation reduced – check status" }],
    43137: [{ label: "FM repeater", mode: "FM", kind: "fm", up: 435.350 * M, down: 145.880 * M, tone: 67.0, note: "AO-92 (Fox-1D) re-entered 7 Feb 2024 (SatNOGS DB) – no signal." }],
    7530: [
      { label: "Mode B (U/V)", mode: "SSB/CW linear", kind: "linear", upLo: 432.125 * M, upHi: 432.175 * M, downLo: 145.925 * M, downHi: 145.975 * M, inverting: true, note: "Inverting (up LSB, down USB). Mode A/B switch on a ~24 h timer, sunlight only; Mode B beacon ≈145.97 MHz (AMSAT: AO-7 page, Live Linear list)" },
      { label: "Mode A (V/H)", mode: "SSB/CW linear", kind: "linear", upLo: 145.850 * M, upHi: 145.950 * M, downLo: 29.400 * M, downHi: 29.500 * M, inverting: false, note: "NON-inverting (up USB, down USB). Beacon 29.502 MHz. Mode A/B switch on a ~24 h timer, sunlight only (AMSAT)" }
    ],
    44909: [{ label: "Linear transponder (V/U)", mode: "SSB/CW", kind: "linear", upLo: 145.935 * M, upHi: 145.995 * M, downLo: 435.640 * M, downHi: 435.700 * M, inverting: true, note: "Inverting; CW beacon 435.605 MHz" }],
    24278: [{ label: "Linear transponder (JA)", mode: "SSB/CW", kind: "linear", upLo: 145.900 * M, upHi: 146.000 * M, downLo: 435.800 * M, downHi: 435.900 * M, inverting: true, note: "Inverting; operates on a schedule (digital/analog modes)" }],
    39444: [{ label: "Linear transponder", mode: "SSB/CW", kind: "linear", upLo: 435.130 * M, upHi: 435.150 * M, downLo: 145.950 * M, downHi: 145.970 * M, inverting: true, note: "Transponder mostly active in eclipse; beacon 145.935 MHz" }],
    42761: [{ label: "Linear transponder (historic)", mode: "SSB/CW", kind: "linear", upLo: 435.210 * M, upHi: 435.230 * M, downLo: 145.860 * M, downHi: 145.880 * M, inverting: true, note: "CAS-4A: UHF up, VHF down, inverting; CW beacon 145.855 MHz (SatNOGS DB). RE-ENTERED Oct 2025 – no signal." }],
    42759: [{ label: "Linear transponder (historic)", mode: "SSB/CW", kind: "linear", upLo: 435.270 * M, upHi: 435.290 * M, downLo: 145.915 * M, downHi: 145.935 * M, inverting: true, note: "CAS-4B: UHF up, VHF down, inverting; CW beacon 145.910 MHz (SatNOGS DB). RE-ENTERED Oct 2025 – no signal." }],
    61781: [{ label: "FM repeater", mode: "FM", kind: "fm", up: 145.850 * M, down: 435.400 * M, tone: 67.0, note: "AO-123 (ASRTU-1): V/U FM transceiver; telemetry BPSK 435.400, SSDV 436.210 MHz (AMSAT Live FM Jul 2026, SatNOGS DB)" }],
    43678: [{ label: "FM repeater (scheduled)", mode: "FM", kind: "fm", up: 437.500 * M, down: 145.900 * M, tone: 141.3, note: "PO-101 (Diwata-2): U/V FM, CTCSS 141.3 Hz, activated by schedule; CW beacon 145.900. AMSAT: \"seems to be dying\" – verify." }],
    67291: [{ label: "FM repeater (announced events)", mode: "FM", kind: "fm", up: 145.920 * M, down: 436.950 * M, tone: 67.0, note: "RS95S (QMR-KWT-2): V/U FM, CTCSS 67.0 Hz, IARU-coordinated; on only during testing/announced activations (watch AMSAT-BB); also SSTV and GMSK telemetry on 436.950" }],
    40908: [{ label: "FM repeater (no schedule)", mode: "FM", kind: "fm", up: 144.350 * M, down: 437.200 * M, tone: null, note: "CAS-3H (LilacSat-2): AMSAT: no set schedule, otherwise a telemetry beacon on 437.200; SatNOGS DB marks the FM transponder inactive since Oct 2025 – verify." }],
    53109: [{ label: "GMSK 9k6 digipeater", mode: "GMSK 9600", kind: "digital", up: 435.310 * M, down: 435.310 * M, tone: null, note: "Same frequency up and down (simplex digipeater)" }],
    25338: [{ label: "APT weather images (historic)", mode: "APT (FM 38 kHz)", kind: "apt", up: null, down: 137.620 * M, tone: null, note: "NOAA 15 was DECOMMISSIONED on 19 Aug 2025 (20:37 UTC) – no APT signal any more (NOAA OSPO). Frequency shown is historic." }],
    28654: [{ label: "APT weather images (historic)", mode: "APT (FM 38 kHz)", kind: "apt", up: null, down: 137.9125 * M, tone: null, note: "NOAA 18 was DECOMMISSIONED on 6 Jun 2025 (17:40 UTC) – no APT signal any more (NOAA OSPO). Frequency shown is historic." }],
    33591: [{ label: "APT weather images (historic)", mode: "APT (FM 38 kHz)", kind: "apt", up: null, down: 137.100 * M, tone: null, note: "NOAA 19 was DECOMMISSIONED on 13 Aug 2025 (16:55 UTC) – no APT signal any more (NOAA OSPO). Frequency shown is historic." }],
    57166: [
      { label: "LRPT 137.900 MHz (primary)", mode: "LRPT (QPSK 72k)", kind: "apt", up: null, down: 137.900 * M, tone: null, note: "Meteor-M2 3: operational but with a degraded/tilted LRPT antenna (fading). 137.900 is the usual frequency (SatDump 'primary', WMO OSCAR, N2YO)." },
      { label: "LRPT 137.100 MHz (backup)", mode: "LRPT (QPSK 72k)", kind: "apt", up: null, down: 137.100 * M, tone: null, note: "Backup frequency listed by WMO OSCAR / SatNOGS DB; sources disagree on which one is in use – check both." }
    ],
    59051: [
      { label: "LRPT 137.900 MHz (observed)", mode: "LRPT (QPSK 72k)", kind: "apt", up: null, down: 137.900 * M, tone: null, note: "Meteor-M2 4: a Sep 2026 reception found the signal on 137.900 MHz and none on 137.100. SatNOGS DB / WMO OSCAR list both." },
      { label: "LRPT 137.100 MHz (listed)", mode: "LRPT (QPSK 72k)", kind: "apt", up: null, down: 137.100 * M, tone: null, note: "Listed by SatNOGS DB, WMO OSCAR and some guides as primary; not seen on air in Sep 2026 – verify." }
    ]
  };
  [63217, 63219, 63218, 63213, 63214, 63215, 63238, 63239, 63237].forEach(function (id) { RADIO[id] = [TEVEL]; });
  // Satellites that no longer transmit. Shown as a warning in the UI; predictions are still computable but promise nothing.
  var STATUS = {
    25338: { state: "decommissioned", date: "2025-08-19", text: "NOAA 15 was decommissioned on 19 Aug 2025 (20:37 UTC). It no longer transmits APT/LRPT.", src: "https://www.ospo.noaa.gov/operations/poes/" },
    28654: { state: "decommissioned", date: "2025-06-06", text: "NOAA 18 was decommissioned on 6 Jun 2025 (17:40 UTC). It no longer transmits APT.", src: "https://www.ospo.noaa.gov/operations/poes/" },
    33591: { state: "decommissioned", date: "2025-08-13", text: "NOAA 19 was decommissioned on 13 Aug 2025 (16:55 UTC). It no longer transmits APT.", src: "https://www.ospo.noaa.gov/operations/poes/" },
    42761: { state: "re-entered", date: "2025-10-09", text: "CAS-4A re-entered the atmosphere in Oct 2025 (SatNOGS DB); CelesTrak no longer publishes elements.", src: "https://db.satnogs.org/satellite/" },
    42759: { state: "re-entered", date: "2025-10-15", text: "CAS-4B re-entered the atmosphere in Oct 2025 (SatNOGS DB); CelesTrak no longer publishes elements.", src: "https://db.satnogs.org/satellite/" },
    43137: { state: "re-entered", date: "2024-02-07", text: "AO-92 (Fox-1D) re-entered the atmosphere on 7 Feb 2024 (SatNOGS DB).", src: "https://db.satnogs.org/satellite/" }
  };
  function status(norad) { return STATUS[norad] || null; }
  var DISCLAIMER = "Frequencies are approximate and change. Always verify with the AMSAT status page (amsat.org/status) before operating.";
  function curated(norad) { for (var i = 0; i < CURATED.length; i++) if (CURATED[i].norad === norad) return CURATED[i]; return null; }
  function radios(norad) { return RADIO[norad] || []; }
  // Index of the radio/mode to show for a satellite given a stored choice (clamped; invalid/missing -> 0).
  function pickRadio(norad, stored) {
    var n = radios(norad).length, i = Math.floor(Number(stored));
    return n && i >= 0 && i < n ? i : 0;
  }
  // same clamping for a list that may include live (SatNOGS) entries after the bundled ones
  function pickIndex(count, stored) { var i = Math.floor(Number(stored)); return count && i >= 0 && i < count ? i : 0; }
  return { CURATED: CURATED, RADIO: RADIO, curated: curated, radios: radios, pickRadio: pickRadio, pickIndex: pickIndex, STATUS: STATUS, status: status, DISCLAIMER: DISCLAIMER };
});
