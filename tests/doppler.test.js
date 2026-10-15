const { ok, near, throws, done } = require("./harness");
const D = require("../js/doppler.js");
const c = 299792.458;
near("approaching 7 km/s at 435.8 MHz: f*(1-rr/c)", D.received(435.8e6, -7), 435.8e6 * (1 + 7 / c), 1e-3);
near("receding 5 km/s at 145.9 MHz", D.received(145.9e6, 5), 145.9e6 * (1 - 5 / c), 1e-3);
near("zero range-rate: no shift", D.received(145.8e6, 0), 145.8e6, 0);
near("shift = received - nominal", D.shift(435e6, -6), D.received(435e6, -6) - 435e6, 1e-6);
near("7.5 km/s at 435 MHz ≈ ±10.9 kHz", Math.abs(D.shift(435e6, 7.5)), 10882, 5);
near("LEO max |shift| at 145.8 MHz ≈ 3.6 kHz for 7.4 km/s", Math.abs(D.shift(145.8e6, -7.4)), 3598, 5);
near("shift scales linearly with frequency", D.shift(435.8e6, 3) / D.shift(145.8e6, 3), 435.8 / 145.8, 1e-9);
// uplink pre-compensation: the satellite should receive the nominal frequency
for (const rr of [-7.2, -3, 0, 2.2, 6.9]) {
  const tx = D.transmitFor(145.85e6, rr), atSat = D.received(tx, rr);
  near("uplink compensation rr=" + rr + " -> sat hears nominal (<1 Hz)", atSat, 145.85e6, 1);
}
const cor = D.corrected(145.85e6, 436.795e6, 5); // receding
ok("receding: RX below nominal, TX above nominal", cor.rxHz < 436.795e6 && cor.txHz > 145.85e6);
near("rxShift sign", cor.rxShiftHz, -436.795e6 * 5 / c, 1e-6);
ok("corrected with null uplink", D.corrected(null, 137.1e6, 1).txHz === null);
// linear transponder (RS-44: up 145.935–145.995, down 435.640–435.700, inverting)
const rs44 = { upLo: 145.935e6, upHi: 145.995e6, downLo: 435.640e6, downHi: 435.700e6, inverting: true };
let p = D.linearPair(rs44, 0); near("inverting frac0: down low", p.downHz, 435.640e6, 1e-6); near("inverting frac0: up high", p.upHz, 145.995e6, 1e-6);
p = D.linearPair(rs44, 1); near("inverting frac1: down high", p.downHz, 435.700e6, 1e-6); near("inverting frac1: up low", p.upHz, 145.935e6, 1e-6);
p = D.linearPair(rs44, 0.5); near("centre down", p.downHz, 435.670e6, 1e-6); near("centre up", p.upHz, 145.965e6, 1e-6);
const ni = D.linearPair({ upLo: 100e6, upHi: 100.1e6, downLo: 400e6, downHi: 400.1e6, inverting: false }, 0.25);
near("non-inverting frac .25 up", ni.upHz, 100.025e6, 1e-6); near("non-inverting frac .25 down", ni.downHz, 400.025e6, 1e-6);
throws("linearPair frac out of range", () => D.linearPair(rs44, 1.5), /frac/);
const ser = D.series([{ t: 0, rrKmS: -6 }, { t: 1, rrKmS: 0 }, { t: 2, rrKmS: 6 }], 145.85e6, 436.795e6);
ok("series: shift goes + to −", ser[0].rxShiftHz > 0 && Math.abs(ser[1].rxShiftHz) < 1e-6 && ser[2].rxShiftHz < 0);
done();
