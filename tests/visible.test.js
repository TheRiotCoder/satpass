const { ok, near, done, snapshot } = require('./harness');
const V = require('../js/visible'), P = require('../js/passes'), T = require('../js/tle');
const vm = require('vm'), fs = require('fs');
const base = { el: 20, az: 359, altKm: 500, latDeg: 30, lonDeg: -97, rangeKm: 800, sunlit: true, sunEl: -12 };
ok('above horizon included by default', V.eligible(base));
ok('eclipsed/daylight satellite still included by default', V.eligible({ ...base, sunlit: false, sunEl: 20 }));
ok('at or below horizon excluded', !V.eligible({ ...base, el: 0 }) && !V.eligible({ ...base, el: -2 }));
ok('minimum elevation includes threshold and excludes below', V.eligible(base, { minEl: 20 }) && !V.eligible(base, { minEl: 21 }));
ok('optical filter requires both sunlight and dark sky', V.eligible(base, { optical: true }) && !V.eligible({ ...base, sunlit: false }, { optical: true }) && !V.eligible({ ...base, sunEl: -6 }, { optical: true }));
ok('does not mark twilight as dark', V.conditions({ ...base, sunEl: -3 }) === 'Sunlit · twilight');
ok('eclipse and daylight labeled separately', V.conditions({ ...base, sunlit: false, sunEl: 10 }) === 'Eclipsed · daylight');
ok('dark sunlit conditions labeled without promising brightness', V.conditions(base) === 'Sunlit · dark sky');
ok('north sector wraps through 360 degrees', [0, 359, -1, 360, 22.49, 337.5].every(a => V.direction(a) === 'N'));
ok('compass sectors and exact edges', V.direction(22.5) === 'NE' && V.direction(180) === 'S' && V.direction(270) === 'W');
ok('compass filter', V.eligible(base, { direction: 'N' }) && !V.eligible(base, { direction: 'S' }));
ok('invalid positions excluded', !V.eligible(null) && !V.eligible({ ...base, el: NaN }) && !V.eligible({ ...base, az: NaN }) && !V.eligible({ ...base, altKm: -1 }));
ok('custom point accepts origin, poles and dateline', V.validPoint({ lat: 0, lon: 0, alt: 0 }) && V.validPoint({ lat: -90, lon: 180, alt: -500 }));
ok('custom point rejects missing, nonfinite and out of range values', [null, {}, {lat:91,lon:0,alt:0}, {lat:0,lon:181,alt:0}, {lat:0,lon:0,alt:9001}, {lat:0,lon:Infinity,alt:0}, {lat:'',lon:0,alt:0}].every(p => !V.validPoint(p)));

// Synthetic catalog proves a bad object cannot abort the scan or hide other rows.
const fake = { SatPasses: { VISIBLE_SUN_EL: -6, stateAt: s => { if (s === 'throw') throw new Error('bad orbit'); return s; } } };
vm.runInNewContext(fs.readFileSync(require.resolve('../js/visible'), 'utf8'), { self: fake });
const states = { 1: base, 2: {...base, el:80}, 3:null, 4:'throw', 5:{...base,el:-1}, 6:{...base,el:80} };
const result = fake.SatVisible.scan(Object.keys(states).map(n => ({norad:+n})), {}, 123, {}, n => states[n]);
ok('scans every catalog object, sorted by elevation with stable ties', result.rows.map(r => r.norad).join(',') === '2,6,1');
ok('counts above horizon and bad/decayed orbits separately', result.above === 3 && result.skipped === 2 && result.total === 6);
ok('filters do not change total above-horizon count', fake.SatVisible.scan([{norad:1},{norad:2}], {}, 123, {minEl:60}, n => states[n]).above === 2);

// Real SGP4 comparison at a snapshot epoch, independent of the execution date.
const entries = T.parse(snapshot().tle).sats, at = entries.find(e => e.norad === 25544).epochMs;
const cache = {}, getSat = n => cache[n] || (cache[n] = P.makeSat(entries.find(e => e.norad === n)));
const obs = P.makeObserver(30, -97, 150), actual = V.scan(entries, obs, at, {}, getSat);
const expected = entries.filter(e => { const s = P.stateAt(getSat(e.norad), obs, at, true); return s && s.altKm > 0 && s.el > 0; }).map(e => e.norad).sort((a,b)=>a-b);
ok('real SGP4 scan includes exactly the objects above observer horizon', actual.rows.map(r=>r.norad).sort((a,b)=>a-b).join() === expected.join() && expected.length > 0);
ok('all coordinates and compass readouts finite', actual.rows.every(r => ['latDeg','lonDeg','altKm','az','el','rangeKm'].every(k=>Number.isFinite(r.state[k]))));
const other = V.scan(entries, P.makeObserver(-30, 83, 0), at, {}, getSat);
ok('another point on Earth changes the visible group', actual.rows.map(r=>r.norad).join() !== other.rows.map(r=>r.norad).join());
near('all satellites share the same live timestamp', actual.rows[0].state.t, at, 0);
ok('moving time recomputes positions', V.scan(entries, obs, at + 60000, {}, getSat).rows.some(r => !actual.rows.some(p => p.norad === r.norad && p.state.az === r.state.az)));
done();
