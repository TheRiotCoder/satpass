/* Doppler helpers for satellite radio (pure, UMD).
   Range rate rr is in km/s, positive when the satellite is moving AWAY from the observer. First-order (non-relativistic) model:
   received = transmitted·(1 − rr/c). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatDoppler = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var C_KMS = 299792.458;
  // Frequency (Hz) you hear when the satellite transmits fHz
  function received(fHz, rrKmS) { return fHz * (1 - rrKmS / C_KMS); }
  // Doppler shift (Hz) = received − nominal
  function shift(fHz, rrKmS) { return -fHz * rrKmS / C_KMS; }
  // Frequency (Hz) you must transmit so the satellite receives fSatHz (first-order inverse of `received`)
  function transmitFor(fSatHz, rrKmS) { return fSatHz * (1 + rrKmS / C_KMS); }
  // Linear transponder passband mapping. entry: {upLo, upHi, downLo, downHi, inverting} in Hz; frac 0..1 across the passband
  // (0 = lowest downlink frequency). Returns satellite-frame frequencies.
  function linearPair(entry, frac) {
    if (!(frac >= 0 && frac <= 1)) throw new RangeError("frac must be 0..1");
    var bw = entry.downHi - entry.downLo, down = entry.downLo + frac * bw;
    var up = entry.inverting ? entry.upHi - frac * bw : entry.upLo + frac * bw;
    return { upHz: up, downHz: down };
  }
  // Doppler-corrected frequencies at one instant. up/down are satellite-frame (nominal) Hz (either may be null).
  function corrected(upHz, downHz, rrKmS) {
    return {
      rxHz: downHz == null ? null : received(downHz, rrKmS),            // tune your receiver here
      txHz: upHz == null ? null : transmitFor(upHz, rrKmS),             // transmit here so the satellite hears upHz
      rxShiftHz: downHz == null ? null : shift(downHz, rrKmS),
      txShiftHz: upHz == null ? null : transmitFor(upHz, rrKmS) - upHz
    };
  }
  // Table over a pass track [{t, rangeKmS...}] – samples need {t, rrKmS}
  function series(samples, upHz, downHz) {
    return samples.map(function (s) { var c = corrected(upHz, downHz, s.rrKmS); c.t = s.t; c.rrKmS = s.rrKmS; return c; });
  }
  return { C_KMS: C_KMS, received: received, shift: shift, transmitFor: transmitFor, linearPair: linearPair, corrected: corrected, series: series };
});
