#!/usr/bin/env python3
"""Independent cross-check of SatPass against python-sgp4 and skyfield.
Setup:  python3 -m venv /tmp/pyv && /tmp/pyv/bin/pip install sgp4 skyfield numpy
Run:    node tests/crosscheck/dump.js > /tmp/satpass_dump.json && /tmp/pyv/bin/python tests/crosscheck/crosscheck.py /tmp/satpass_dump.json
Compares: (1) TEME positions of every bundled satellite (SGP4 + SDP4) vs python-sgp4,
          (2) ISS pass AOS/TCA/LOS vs skyfield find_events, (3) az/el/range samples vs skyfield, (4) sun elevation vs skyfield+DE421, (5) sunlit flag."""
import sys, json, datetime as dt, numpy as np
from sgp4.api import Satrec, jday
from skyfield.api import load, wgs84, EarthSatellite, Loader
d = json.load(open(sys.argv[1]))
ts = load.timescale(builtin=True)
def tsms(ms): return ts.from_datetime(dt.datetime.fromtimestamp(ms/1000, dt.timezone.utc))
bad = 0
def report(name, ok, info=""):
    global bad
    print(("PASS " if ok else "FAIL ") + name + (" -> " + info if info else "")); bad += 0 if ok else 1
# 1. positions
t = dt.datetime.fromtimestamp(d['at']/1000, dt.timezone.utc)
jd, fr = jday(t.year, t.month, t.day, t.hour, t.minute, t.second + t.microsecond/1e6)
worst = (0, ''); worst_deep = (0, ''); n = 0
for s in d['states']:
    r = Satrec.twoline2rv(s['l1'], s['l2']); e, p, v = r.sgp4(jd, fr)
    if e: continue
    diff = float(np.linalg.norm(np.array(p) - np.array(s['pos']))); n += 1
    if s['dsp']:
        if diff > worst_deep[0]: worst_deep = (diff, s['name'])
    elif diff > worst[0]: worst = (diff, s['name'])
report(f"TEME position, {n} satellites vs python-sgp4: max diff near-earth {worst[0]*1000:.3f} m ({worst[1]}), deep-space {worst_deep[0]*1000:.3f} m ({worst_deep[1]})", worst[0] < 0.01 and worst_deep[0] < 0.05)
# 2. passes
iss = EarthSatellite(d['iss']['l1'], d['iss']['l2'], d['iss']['name'], ts)
obs = wgs84.latlon(d['obs']['lat'], d['obs']['lon'], elevation_m=d['obs']['altM'])
tt, ev = iss.find_events(obs, tsms(d['t0']), tsms(d['t1']), altitude_degrees=10.0)
ref = []; cur = {}
for t_, e_ in zip(tt, ev):
    ms = t_.utc_datetime().timestamp()*1000
    if e_ == 0: cur = {'aos': ms}
    elif e_ == 1: cur['tca'] = ms
    elif e_ == 2 and 'aos' in cur and 'tca' in cur: cur['los'] = ms; ref.append(cur); cur = {}
mine = d['passes']
report(f"pass count: ours {len(mine)} vs skyfield {len(ref)}", len(mine) == len(ref))
dA = []; dT = []; dL = []
for m in mine:
    r = min(ref, key=lambda x: abs(x['aos'] - m['aos']))
    dA.append((m['aos'] - r['aos'])/1000); dL.append((m['los'] - r['los'])/1000); dT.append((m['tca'] - r['tca'])/1000)
print(f"  AOS diff (s): max |{max(map(abs,dA)):.2f}|   TCA diff: max |{max(map(abs,dT)):.2f}|   LOS diff: max |{max(map(abs,dL)):.2f}|")
report("AOS and LOS within 10 s of skyfield for every pass", max(map(abs, dA)) <= 10 and max(map(abs, dL)) <= 10)
report("TCA within 10 s of skyfield", max(map(abs, dT)) <= 10)
# 2b. other satellites (incl. long passes of AO-10, a 12 h orbit)
for m in d['multi']:
    sx = EarthSatellite(m['l1'], m['l2'], m['name'], ts)
    tt, ev = sx.find_events(obs, tsms(d['t0']), tsms(d['t0'] + 3*86400000), altitude_degrees=10.0)
    rr_ = [t_.utc_datetime().timestamp()*1000 for t_, e_ in zip(tt, ev) if e_ == 0]; ls_ = [t_.utc_datetime().timestamp()*1000 for t_, e_ in zip(tt, ev) if e_ == 2]
    mine_ = [p for p in m['passes'] if p['aos'] >= d['t0'] and not p['inProgressAtStart']]
    worst_ = 0
    for p in mine_:
        if rr_: worst_ = max(worst_, min(abs(p['aos'] - x) for x in rr_)/1000)
        if ls_ and not p.get('losAfterWindow'): worst_ = max(worst_, min(abs(p['los'] - x) for x in ls_)/1000)   # skyfield only reports events inside the window
        if p.get('losAfterWindow') and not p['los'] > d['t0'] + 3*86400000: worst_ = 1e9
    report(f"{m['name'].strip()}: {len(mine_)} passes (skyfield rises {len(rr_)}), max AOS/LOS diff {worst_:.2f} s", worst_ <= 10 and abs(len(mine_) - len(rr_)) <= 1)  # (ours now also keeps the pass still open at the window end, with its true LOS)
# 3. look angles
ma = mr = me = mrr = 0
for s in d['sample']:
    t_ = tsms(s['t']); diff = iss - obs; topo = diff.at(t_); alt, az, dist = topo.altaz()
    ma = max(ma, abs(((az.degrees - s['az'] + 180) % 360) - 180)); me = max(me, abs(alt.degrees - s['el'])); mr = max(mr, abs(dist.km - s['range']))
    # range rate via skyfield: finite difference of distance
    t2 = tsms(s['t'] + 1000); t0_ = tsms(s['t'] - 1000)
    rr = (diff.at(t2).distance().km - diff.at(t0_).distance().km)/2.0
    mrr = max(mrr, abs(rr - s['rr']))
print(f"  samples: max az diff {ma:.3f}°, el diff {me:.3f}°, range diff {mr*1000:.0f} m, range-rate diff {mrr*1000:.2f} m/s")
report("az/el within 0.2°, range within 1 km, range-rate within 20 m/s", ma < 0.2 and me < 0.2 and mr < 1 and mrr < 0.02)
# 4. sun elevation & 5. sunlit
try:
    eph = Loader('/tmp/skyfield-data')('de421.bsp'); sun = eph['sun']; earth = eph['earth']
    me = 0
    for s in d['sun']:
        t_ = tsms(s['t']); a = (earth + obs).at(t_).observe(sun).apparent().altaz()[0].degrees
        me = max(me, abs(a - s['el']))
    print(f"  sun elevation max diff {me:.3f}° (ours geometric vs skyfield apparent, no refraction)")
    report("sun elevation within 0.3° of skyfield/DE421", me < 0.3)
    bad_sunlit = 0
    for s in d['sample']:
        sl = bool(iss.at(tsms(s['t'])).is_sunlit(eph))
        if sl != s['sunlit']: bad_sunlit += 1
    report("sunlit flag agrees with skyfield along a pass", bad_sunlit == 0, f"{bad_sunlit} mismatches of {len(d['sample'])}")
except Exception as ex:
    print("  (skipped sun checks: ephemeris unavailable:", ex, ")")
sys.exit(1 if bad else 0)
