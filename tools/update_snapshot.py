#!/usr/bin/env python3
"""Fetch current TLEs from CelesTrak and write data/tle-snapshot.js (the bundled first-launch / offline snapshot).
Be polite: CelesTrak asks for no more than one request per group every ~2 hours. Run this at release time, not in a loop.
Usage (from repo root): python3 tools/update_snapshot.py"""
import json, time, datetime, urllib.request
BASE = "https://celestrak.org/NORAD/elements/gp.php?%s&FORMAT=tle"
QUERIES = ["GROUP=stations", "GROUP=amateur", "GROUP=weather", "CATNR=25338", "CATNR=28654", "CATNR=33591"]  # NOAA 15/18/19 are not in 'weather'
seen, out = set(), []
for q in QUERIES:
    req = urllib.request.Request(BASE % q, headers={"User-Agent": "SatPass-snapshot/1.0 (+personal PWA)"})
    txt = urllib.request.urlopen(req, timeout=30).read().decode("ascii", "replace")
    lines = [l.rstrip() for l in txt.splitlines() if l.strip()]
    if len(lines) % 3: raise SystemExit("unexpected response for " + q + ": " + txt[:80])
    for i in range(0, len(lines), 3):
        n, l1, l2 = lines[i:i+3]
        if not (l1.startswith("1 ") and l2.startswith("2 ")): raise SystemExit("bad TLE block in " + q)
        key = l1[2:7]
        if key in seen: continue
        seen.add(key); out += [n.strip(), l1, l2]
    time.sleep(2)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
js = "/* Bundled TLE snapshot from CelesTrak (https://celestrak.org). Regenerate with tools/update_snapshot.py */\nwindow.SATPASS_SNAPSHOT=" + json.dumps({"fetchedAt": stamp, "source": "CelesTrak GP (groups stations, amateur, weather + NOAA 15/18/19)", "tle": "\n".join(out) + "\n"}) + ";\n"
open("data/tle-snapshot.js", "w").write(js)
print(len(out)//3, "satellites,", len(js), "bytes, fetchedAt", stamp)
