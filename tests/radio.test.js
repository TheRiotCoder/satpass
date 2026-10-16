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
ok("rerender() clears the view before rendering", /function rerender\(name, a\) \{ clearView\(\); ROUTES\[name\]\(a\); \}/.test(app));
ok("every() timers are bound to the view token (stale callbacks are ignored)", /function every\(ms, fn\) \{ var tok = view\.token;[^}]*tok === view\.token/.test(app));
ok("Doppler radio index comes from R.pickIndex(list length, stored) over bundled+live entries", /R\.pickIndex\(radios\.length, S\.load\("dopRadio:" \+ n/.test(app));
ok("pickIndex clamps like pickRadio for any list length", R.pickIndex(5, 4) === 4 && R.pickIndex(5, 5) === 0 && R.pickIndex(5, -1) === 0 && R.pickIndex(0, 3) === 0 && R.pickIndex(3, "2") === 2 && R.pickIndex(3, NaN) === 0);
done();
