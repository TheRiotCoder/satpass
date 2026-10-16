#!/usr/bin/env python3
"""Independent cross-check of SatPass' SAR helpers against python-sgp4 + skyfield (not sharing any code with the app).
Setup:  python3 -m venv /tmp/pyv && /tmp/pyv/bin/pip install sgp4 skyfield numpy
Run:    node tests/crosscheck/dump_sar.js > /tmp/satpass_sar_dump.json && /tmp/pyv/bin/python tests/crosscheck/sar_crosscheck.py /tmp/satpass_sar_dump.json
Checks, for Sentinel-1A, ALOS-2, RADARSAT-2, NovaSAR-1, ICEYE-X83 (NORAD 100889, Alpha-5), BIOMASS, ALOS-4, CSG-2:
  1. ascending/descending flag (ours: sign of the velocity z component) vs the TREND of the geodetic latitude from skyfield (lat(t+30 s) > lat(t-30 s));
  2. sub-satellite latitude / longitude vs skyfield; mean local solar time vs UTC hour + longitude/15 from skyfield's sub-point;
  3. range rate (finite difference of the skyfield slant range) and the one-way carrier Doppler  -f*rr/c;
  4. per-pass geometry (direction, local solar time, ground-track distance at TCA with an independent haversine);
  5. Alpha-5 TLE (letter catalogue number) vs python-sgp4 initialised from the OMM record: ICEYE-X83 position agreement."""
import sys, json, math, datetime as dt, numpy as np
from sgp4.api import Satrec, jday
from sgp4 import omm as sgp4omm
from skyfield.api import load, wgs84, EarthSatellite
d = json.load(open(sys.argv[1]))
ts = load.timescale(builtin=True)
def tsms(ms): return ts.from_datetime(dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc))
bad = 0
def report(name, ok, info=""):
    global bad
    print(("PASS " if ok else "FAIL ") + name + (" -> " + info if info else "")); bad += 0 if ok else 1
def hav(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2); dl = math.radians(lon2 - lon1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(min(1, math.sqrt(a)))
C = 299792.458
obs = wgs84.latlon(d['obs']['lat'], d['obs']['lon'], elevation_m=d['obs']['altM'])
for s in d['sats']:
    # Alpha-5 TLE: python-sgp4 cannot take the letter number in every version, so give it a numeric stand-in (SGP4 does not use the number)
    l1, l2 = s['l1'], s['l2']
    if not l1[2:7].strip().isdigit():
        num = "%05d" % (s['norad'] % 100000)
        def fix(l):
            b = l[:2] + num + l[7:68]; return b + str(sum(int(c) if c.isdigit() else (1 if c == '-' else 0) for c in b) % 10)
        l1, l2 = fix(l1), fix(l2)
    sf = EarthSatellite(l1, l2, s['name'], ts)
    n = nasc = 0; dlat = dlon = dlst = drr = ddop = 0.0; mism = []
    maxlat = max(abs(x['lat']) for x in s['samples'])
    for x in s['samples']:
        t = tsms(x['t']); a = wgs84.subpoint_of(sf.at(t)); lat, lon = a.latitude.degrees, a.longitude.degrees
        t1, t0 = tsms(x['t'] + 30000), tsms(x['t'] - 30000)
        lat1_, lat0_ = wgs84.subpoint_of(sf.at(t1)).latitude.degrees, wgs84.subpoint_of(sf.at(t0)).latitude.degrees
        ref_asc = lat1_ > lat0_
        near_turn = abs(lat) > abs(maxlat) - 0.3          # velocity z ~ 0 at the northern/southern extreme: the finite-difference trend is ambiguous there
        if not near_turn:
            n += 1; nasc += ref_asc
            if ref_asc != x['asc']: mism.append((x['t'], lat))
        dlat = max(dlat, abs(lat - x['lat'])); dl = (lon - x['lon'] + 180) % 360 - 180; dlon = max(dlon, abs(dl))
        u = dt.datetime.fromtimestamp(x['t'] / 1000, dt.timezone.utc); uh = u.hour + u.minute / 60 + u.second / 3600 + u.microsecond / 3.6e9
        lst = (uh + lon / 15) % 24; dd = abs((lst - x['lst'] + 12) % 24 - 12); dlst = max(dlst, dd)
        rng = lambda ms: (sf - obs).at(tsms(ms)).distance().km
        rr = (rng(x['t'] + 500) - rng(x['t'] - 500)) / 1.0
        drr = max(drr, abs(rr - x['rr']))
        dop = -x['f'] * rr / C; ddop = max(ddop, abs(dop - x['dop']))
    report(f"{s['name']} ({s['norad']}): ascending/descending matches the latitude trend in {n - len(mism)}/{n} samples ({nasc} asc, {n - nasc} desc)", not mism and 0 < nasc < n, str(mism[:2]))
    report(f"{s['name']}: sub-point max diff lat {dlat:.4f}°, lon {dlon:.4f}°; local solar time max diff {dlst * 3600:.1f} s", dlat < 0.05 and dlon < 0.05 and dlst < 0.005)
    report(f"{s['name']}: range rate max diff {drr * 1000:.2f} m/s; one-way carrier Doppler max diff {ddop:.2f} Hz at {s['samples'][0]['f'] / 1e6:.0f} MHz", drr < 0.002 and ddop < 0.002 / C * s['samples'][0]['f'] + 0.5)
    # per-pass geometry
    worst = 0; amis = 0
    for p in s['passes']:
        t = tsms(p['tca']); a = wgs84.subpoint_of(sf.at(t)); lat1_ = wgs84.subpoint_of(sf.at(tsms(p['tca'] + 30000))).latitude.degrees; lat0_ = wgs84.subpoint_of(sf.at(tsms(p['tca'] - 30000))).latitude.degrees
        if (lat1_ > lat0_) != p['asc'] and abs(a.latitude.degrees) < abs(maxlat) - 0.3: amis += 1
        ref = hav(d['obs']['lat'], d['obs']['lon'], a.latitude.degrees, a.longitude.degrees); worst = max(worst, abs(ref - p['dist']))
    report(f"{s['name']}: {len(s['passes'])} passes: direction agrees, ground-track distance at TCA max diff {worst:.2f} km", amis == 0 and worst < 5 and len(s['passes']) > 0)
# 5. Alpha-5 vs OMM
for s in d['sats']:
    if s['omm']:
        sat = Satrec(); sgp4omm.initialize(sat, s['omm'])
        l1, l2 = s['l1'], s['l2']; num = "%05d" % (s['norad'] % 100000)
        def fix(l):
            b = l[:2] + num + l[7:68]; return b + str(sum(int(c) if c.isdigit() else (1 if c == '-' else 0) for c in b) % 10)
        sat2 = Satrec.twoline2rv(fix(l1), fix(l2)); worst = 0
        for k in range(0, 48):
            t = dt.datetime.fromtimestamp(s['samples'][k]['t'] / 1000, dt.timezone.utc); jd, fr = jday(t.year, t.month, t.day, t.hour, t.minute, t.second)
            e1, p1, _ = sat.sgp4(jd, fr); e2, p2, _ = sat2.sgp4(jd, fr)
            worst = max(worst, float(np.linalg.norm(np.array(p1) - np.array(p2))))
        report(f"{s['name']} (NORAD {s['norad']}, Alpha-5 '{s['l1'][2:7]}'): TLE built from the OMM record vs python-sgp4 on the OMM itself: max position diff {worst * 1000:.1f} m over 2 days", worst < 0.5)
print("\nFAILURES: %d" % bad); sys.exit(1 if bad else 0)
