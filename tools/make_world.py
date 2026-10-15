"""Build data/world.js: a small simplified world outline for the live-tracker map.
Source: Natural Earth 110m land polygons (public domain, https://www.naturalearthdata.com/).
Usage: python3 tools/make_world.py path/to/ne_110m_land.geojson   (writes data/world.js)
Coordinates are quantised to 0.1 degree and Douglas-Peucker simplified (tolerance TOL degrees)."""
import json, sys, math
TOL = 0.35
def dp(pts, tol):
    if len(pts) < 3: return pts
    keep = [False]*len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts)-1)]
    while stack:
        a, b = stack.pop(); ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx-ax, by-ay; L = math.hypot(dx, dy); md = -1; mi = -1
        for i in range(a+1, b):
            px, py = pts[i]
            d = abs(dy*(px-ax) - dx*(py-ay))/L if L else math.hypot(px-ax, py-ay)
            if d > md: md, mi = d, i
        if md > tol: keep[mi] = True; stack += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]
gj = json.load(open(sys.argv[1]))
rings = []
for f in gj['features']:
    g = f['geometry']; polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        ring = [(x, y) for x, y in poly[0]]
        s = dp(ring, TOL)
        if len(s) >= 4 and (max(p[0] for p in s) - min(p[0] for p in s) > 1.2 or max(p[1] for p in s) - min(p[1] for p in s) > 1.2):
            rings.append([[round(x*10), round(y*10)] for x, y in s])
n = sum(len(r) for r in rings)
out = "/* Simplified world land outline (Natural Earth 110m, public domain). Rings of [lon*10, lat*10] integers. */\nwindow.SATPASS_WORLD=" + json.dumps(rings, separators=(',', ':')) + ";\n"
open('data/world.js', 'w').write(out)
print(len(rings), 'rings', n, 'points', len(out), 'bytes')
