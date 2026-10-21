// Radio/mode selection logic + static guards for the "stale render timer overrides the chosen Doppler radio" bug (fixed in v1.0.2).
const { ok, done } = require("./harness"), fs = require("fs"), path = require("path");
const R = require("../js/radio.js");
// pickRadio: stored index per satellite, clamped
ok("ISS has 3 radios", R.radios(25544).length === 3);
ok("pickRadio keeps a valid stored index (ISS 0/1/2)", [0, 1, 2].every(i => R.pickRadio(25544, i) === i));
ok("pickRadio: out-of-range / negative / NaN / string-garbage -> 0", [3, 99, -1, NaN, undefined, null, "x", {}].every(v => R.pickRadio(25544, v) === 0));
ok("pickRadio accepts numeric strings from storage ('1' -> 1)", R.pickRadio(25544, "1") === 1);
ok("pickRadio: single-radio sat always 0", R.pickRadio(27607, 1) === 0 && R.pickRadio(27607, 0) === 0);
ok("pickRadio: sat without radios -> 0", R.pickRadio(99999, 3) === 0);
ok("pickRadio: AO-7 modes (2)", R.pickRadio(7530, 1) === 1 && R.pickRadio(7530, 2) === 0);
ok("each radio entry is distinguishable (label + frequencies differ) so a wrong index is detectable", (() => { const r = R.radios(25544); return new Set(r.map(x => x.label)).size === 3 && !(r[0].down === r[1].down); })());
// static guard: views must be re-rendered through rerender() (which clears the previous view's timers); direct ROUTES.x(...) calls are the bug
const app = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
const direct = [...app.matchAll(/ROUTES\.\w+\((?:a|\w*)\)/g)].map(m => m[0]);
ok("app.js never calls ROUTES.<view>() directly (only via route()/rerender())", direct.length === 0, direct);
ok("rerender() clears the view before rendering", /function rerender\(name, a\) \{ clearView\(\);[^}]*ROUTES\[name\]\(a\);/.test(app));
ok("every() timers are bound to the view token (stale callbacks are ignored)", /function every\(ms, fn\) \{ var tok = view\.token;[^}]*tok === view\.token/.test(app));
ok("Doppler radio index comes from R.pickIndex(list length, stored) over bundled+live entries", /R\.pickIndex\(radios\.length, S\.load\("dopRadio:" \+ n/.test(app));
ok("pickIndex clamps like pickRadio for any list length", R.pickIndex(5, 4) === 4 && R.pickIndex(5, 5) === 0 && R.pickIndex(5, -1) === 0 && R.pickIndex(0, 3) === 0 && R.pickIndex(3, "2") === 2 && R.pickIndex(3, NaN) === 0);
// ---------- v1.2.1: radio table cross-checked against real SatNOGS DB transmitter dumps (tests/fixtures/satnogs-tx-<norad>.json)
const sn = n => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "satnogs-tx-" + n + ".json"), "utf8"));
const M6 = 1e6, near = (a, b, tol) => Math.abs(a - b) <= tol;
{
  // every linear entry: a SatNOGS *transponder* with the same up/down band must agree on the invert flag, and UHF/VHF direction must match
  const linear = [[7530], [42761], [42759]];
  linear.forEach(([n]) => R.radios(n).filter(r => r.kind === "linear").forEach(r => {
    const t = sn(n).find(x => /transponder/i.test(x.type) && near(x.downlink_low, r.downLo, 6e3) && near(x.uplink_low, r.upLo, 6e3));
    ok("NORAD " + n + " '" + r.label + "': a SatNOGS transponder has the same up/down band", !!t, r.label);
    ok("NORAD " + n + " '" + r.label + "': inverting flag matches SatNOGS (" + (t && t.invert) + ")", !!t && r.inverting === t.invert);
  }));
  const a = R.radios(7530);
  ok("AO-7 Mode A (145.85 up / 29.4 down) is NON-inverting, Mode B (432.1 up / 145.9 down) is inverting", a.find(r => r.upLo === 145.850 * M6).inverting === false && a.find(r => r.upLo === 432.125 * M6).inverting === true);
  ok("CAS-4A/4B: UHF uplink (435 MHz) and VHF downlink (145 MHz), inverting – per SatNOGS", [42761, 42759].every(n => { const r = R.radios(n)[0]; return r.upLo > 435e6 && r.upHi < 436e6 && r.downLo > 145e6 && r.downHi < 146e6 && r.inverting === true; }));
  ok("CAS-4A beacon 145.855 / CAS-4B beacon 145.910 documented in the note", /145\.855/.test(R.radios(42761)[0].note) && /145\.910/.test(R.radios(42759)[0].note));
  // FM entries vs SatNOGS transceivers (SO-50 gets -2 kHz of listed drift, so a 3 kHz tolerance)
  [[27607, 0], [61781, 0], [43678, 0], [67291, 0], [40908, 0]].forEach(([n, i]) => {
    const r = R.radios(n)[i], t = sn(n).find(x => /transceiver/i.test(x.type) && x.mode === "FM" && x.uplink_low);
    ok("NORAD " + n + " FM entry up/down within 3 kHz of the SatNOGS transceiver", !!t && near(r.up, t.uplink_low, 3e3) && near(r.down, t.downlink_low, 3e3), t && [r.up, r.down, t.uplink_low, t.downlink_low]);
  });
  ok("FM tones: SO-50 67.0, AO-123 67.0, RS95S 67.0, PO-101 141.3 (AMSAT Live FM list)", R.radios(27607)[0].tone === 67 && R.radios(61781)[0].tone === 67 && R.radios(67291)[0].tone === 67 && R.radios(43678)[0].tone === 141.3);
  ok("RS95S SatNOGS transceiver description states CTCSS 67.0 Hz", /CTCSS 67\.0/.test(sn(67291).find(x => /transceiver/i.test(x.type)).description));
  ok("SO-50 note: 2 s carrier + 74.4 Hz arms a 10-minute timer, reset by 74.4 Hz", /2 s carrier/.test(R.radios(27607)[0].note) && /74\.4/.test(R.radios(27607)[0].note) && /10 min/.test(R.radios(27607)[0].note));
  ok("TEVEL note names TEVEL2-1 through TEVEL2-9", R.CURATED.filter(c => /^TEVEL/.test(c.short)).length === 9 && /TEVEL2-1 through TEVEL2-9/.test(R.radios(63217)[0].note));
}
// ---------- NOAA 15/18/19 decommissioned (NOAA OSPO, 2025)
{
  const dec = { 25338: "2025-08-19", 28654: "2025-06-06", 33591: "2025-08-13" };
  Object.keys(dec).forEach(n => {
    const st = R.status(+n);
    ok("NOAA " + n + " status decommissioned on " + dec[n] + " with an OSPO source", !!st && st.state === "decommissioned" && st.date === dec[n] && /ospo\.noaa\.gov/.test(st.src));
    ok("NOAA " + n + " radio note says DECOMMISSIONED (no signal promised)", R.radios(+n).every(r => /DECOMMISSIONED/.test(r.note) && /historic/.test(r.label)));
    ok("NOAA " + n + " is not a default favourite and sorts after every active curated satellite", !R.CURATED.find(c => c.norad === +n).fav);
    ok("NOAA " + n + ": SatNOGS DB lists its APT transmitters as inactive (independent evidence)", sn(+n).filter(t => /^APT/.test(t.mode)).every(t => t.status === "inactive" && t.alive === false));
  });
  const last3 = R.CURATED.slice(-3).map(c => c.norad).sort();
  ok("the three NOAA entries are the last curated entries", JSON.stringify(last3) === JSON.stringify([25338, 28654, 33591]));
  ok("re-entered: CAS-4A, CAS-4B, AO-92 are flagged", [42761, 42759, 43137].every(n => R.status(n) && R.status(n).state === "re-entered"));
  ok("active satellites have no status", [25544, 27607, 7530, 44909, 57166, 59051, 61781].every(n => R.status(n) === null));
}
// ---------- Meteor-M2 3/4 LRPT: 137.900 first, 137.100 backup; both exist in SatNOGS
ok("Meteor LRPT: 137.900 default (index 0) and 137.100 alternate, both present as active LRPT in SatNOGS", [57166, 59051].every(n => { const r = R.radios(n); return r.length === 2 && r[0].down === 137.9 * M6 && r[1].down === 137.1 * M6 && [137900000, 137100000].every(f => sn(n).some(t => t.mode === "LRPT" && t.downlink_low === f && t.status === "active")); }));
// ---------- new satellites present with correct status
ok("AO-123, PO-101, RS95S, CAS-3H are curated and have radios", [61781, 43678, 67291, 40908].every(n => R.CURATED.some(c => c.norad === n) && R.radios(n).length === 1));
ok("PO-101 note carries the AMSAT 'seems to be dying' caveat, CAS-3H the SatNOGS-inactive caveat", /dying/.test(R.radios(43678)[0].note) && /inactive/.test(R.radios(40908)[0].note) && sn(40908).filter(t => t.mode === "FM" && t.uplink_low).every(t => t.status === "inactive"));

done();
