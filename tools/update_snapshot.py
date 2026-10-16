#!/usr/bin/env python3
"""Fetch current element sets from CelesTrak and write the bundled first-launch / offline snapshots:
    data/tle-snapshot.js      core: stations, amateur, weather (+ NOAA 15/18/19)   -> window.SATPASS_SNAPSHOT
    data/snap/<category>.js   sar, eo, nav, science (lazy-loaded by the app)        -> window.SATPASS_SNAPSHOTS[<category>]
The query list per category is the one in js/catalog.js / data/sar.js (read through node), so the app and the snapshot always agree.
Be polite: CelesTrak asks for no more than one request per query every ~2 hours. Responses are cached in --cache (default /tmp/satpass-celestrak-cache)
and reused for 2 h; queries are spaced 2 s apart. Run this at release time, not in a loop.
SAR sets are fetched as JSON (OMM) because satellites numbered >= 100000 do not exist in TLE format; they are written as Alpha-5 TLEs
(first digit of the catalog number becomes a letter: 100889 -> A0889), exactly like js/tle.js fromOmm().
Usage (from repo root): python3 tools/update_snapshot.py [--cache DIR] [--only core,sar,...]"""
import json, time, datetime, urllib.request, subprocess, os, sys, re, hashlib, math

A5 = "ABCDEFGHJKLMNPQRSTUVWXYZ"
def cat_field(n):
    if n < 100000: return "%05d" % n
    return A5[n // 10000 - 10] + "%04d" % (n % 10000)
def checksum(l):
    return sum(int(c) if c.isdigit() else (1 if c == "-" else 0) for c in l[:68]) % 10
def exp_field(v):
    v = float(v or 0)
    if v == 0: return " 00000+0"
    e = math.floor(math.log10(abs(v))) + 1
    d = int(round(abs(v) / 10 ** e * 1e5))
    if d >= 100000: d, e = 10000, e + 1
    return ("-" if v < 0 else " ") + "%05d" % d + ("-" if e < 0 else "+") + str(abs(e))
def omm_to_tle(o):
    """CelesTrak OMM JSON record -> (name, line1, line2); Alpha-5 for NORAD ids >= 100000. Mirrors js/tle.js fromOmm()."""
    ep = o["EPOCH"]; t = datetime.datetime.fromisoformat(ep.replace("Z", "")).replace(tzinfo=datetime.timezone.utc)
    y0 = datetime.datetime(t.year, 1, 1, tzinfo=datetime.timezone.utc)
    doy = (t - y0).total_seconds() / 86400 + 1
    m = re.match(r"^(\d{4})-(\d{3})(\w*)$", o.get("OBJECT_ID", "")); oid = (m.group(1)[2:] + m.group(2) + m.group(3)) if m else o.get("OBJECT_ID", "")
    nd = float(o.get("MEAN_MOTION_DOT") or 0); nds = ("-" if nd < 0 else " ") + ("%.8f" % abs(nd))[1:]
    cat = cat_field(int(o["NORAD_CAT_ID"]))
    l1 = "1 %s%s %-8s %02d%s %s %s %s %d %4d" % (cat, o.get("CLASSIFICATION_TYPE", "U"), oid[:8], t.year % 100, ("%.8f" % doy).rjust(12, "0"), nds,
                                              exp_field(o.get("MEAN_MOTION_DDOT")), exp_field(o.get("BSTAR")), int(o.get("EPHEMERIS_TYPE") or 0), int(o.get("ELEMENT_SET_NO") or 0))
    l2 = "2 %s %8.4f %8.4f %07d %8.4f %8.4f %11.8f%5d" % (cat, float(o["INCLINATION"]), float(o["RA_OF_ASC_NODE"]), int(round(float(o["ECCENTRICITY"]) * 1e7)),
                                                         float(o["ARG_OF_PERICENTER"]), float(o["MEAN_ANOMALY"]), float(o["MEAN_MOTION"]), int(o.get("REV_AT_EPOCH") or 0) % 100000)
    assert len(l1) == 68 and len(l2) == 68, (l1, l2)
    return o.get("OBJECT_NAME", "NORAD " + str(o["NORAD_CAT_ID"])).strip(), l1 + str(checksum(l1)), l2 + str(checksum(l2))

def node_json(js):
    return json.loads(subprocess.check_output(["node", "-e", js], text=True))

def main():
    args = sys.argv[1:]; cache = "/tmp/satpass-celestrak-cache"; only = None
    if "--cache" in args: cache = args[args.index("--cache") + 1]
    if "--only" in args: only = args[args.index("--only") + 1].split(",")
    os.makedirs(cache, exist_ok=True)
    cats = node_json("const C=require('./js/catalog.js');console.log(JSON.stringify(C.CATEGORIES.map(c=>({id:c.id,core:!!c.core,fetch:c.fetch,url:c.fetch.map(f=>C.queryUrl(f))}))))")
    sar = node_json("const S=require('./data/sar.js');console.log(JSON.stringify({norads:S.SATS.map(s=>s.norad),match:S.MISSIONS.filter(m=>m.match).map(m=>m.match)}))")
    sar_ok = set(sar["norads"]); sar_re = [re.compile(r) for r in sar["match"]]
    def accept(cid, norad, name):
        if cid == "sar": return norad in sar_ok or any(r.search(name.upper()) for r in sar_re)
        return True
    def get(url):
        key = os.path.join(cache, hashlib.sha1(url.encode()).hexdigest() + ".txt")
        if os.path.exists(key) and time.time() - os.path.getmtime(key) < 7200:
            return open(key, encoding="utf-8").read(), False
        req = urllib.request.Request(url, headers={"User-Agent": "SatPass-snapshot/1.1 (+personal PWA)"})
        txt = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
        open(key, "w", encoding="utf-8").write(txt); return txt, True
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    core_out, core_seen, core_groups = [], set(), {}
    report = []
    for c in cats:
        if only and c["id"] not in only and not (c["core"] and "core" in only): continue
        out, seen, ids = [], set(), []
        for spec, url in zip(c["fetch"], c["url"]):
            txt, fetched = get(url)
            if spec["fmt"] == "json":
                recs = [] if txt.lstrip().startswith("No GP data found") else json.loads(txt)
                items = [omm_to_tle(o) for o in recs]
            else:
                lines = [l.rstrip() for l in txt.splitlines() if l.strip()]
                if len(lines) % 3: raise SystemExit("unexpected response for " + url + ": " + txt[:80])
                items = []
                for i in range(0, len(lines), 3):
                    n, l1, l2 = lines[i:i + 3]
                    if not (l1.startswith("1 ") and l2.startswith("2 ")): raise SystemExit("bad TLE block in " + url)
                    items.append((n.strip(), l1, l2))
            for n, l1, l2 in items:
                f = l1[2:7]; norad = int(f) if f[0].isdigit() or f[0] == " " else (A5.index(f[0]) + 10) * 10000 + int(f[1:])
                if not accept(c["id"], norad, n): continue
                if norad not in ids: ids.append(norad)
                if norad in seen: continue
                seen.add(norad); out += [n, l1, l2]
            if fetched: time.sleep(2)
        if not out: raise SystemExit("category %s produced no satellites" % c["id"])
        if c["core"]:
            core_groups[c["id"]] = ids
            for i in range(0, len(out), 3):
                k = out[i + 1][2:7]
                if k not in core_seen: core_seen.add(k); core_out += out[i:i + 3]
        else:
            js = "/* Bundled TLE snapshot for category '%s' from CelesTrak (https://celestrak.org). Lazy-loaded; regenerate with tools/update_snapshot.py */\nwindow.SATPASS_SNAPSHOTS=window.SATPASS_SNAPSHOTS||{};\nwindow.SATPASS_SNAPSHOTS[%s]=%s;\n" % (
                c["id"], json.dumps(c["id"]), json.dumps({"fetchedAt": stamp, "source": "CelesTrak GP (" + c["id"] + ")", "tle": "\n".join(out) + "\n", "groups": {c["id"]: ids}}))
            os.makedirs("data/snap", exist_ok=True); open("data/snap/%s.js" % c["id"], "w").write(js)
            report.append((c["id"], len(out) // 3, len(js)))
    if core_out:
        js = "/* Bundled TLE snapshot from CelesTrak (https://celestrak.org). Regenerate with tools/update_snapshot.py */\nwindow.SATPASS_SNAPSHOT=" + json.dumps({"fetchedAt": stamp, "source": "CelesTrak GP (groups stations, amateur, weather + NOAA 15/18/19)", "tle": "\n".join(core_out) + "\n", "groups": core_groups}) + ";\n"
        open("data/tle-snapshot.js", "w").write(js); report.insert(0, ("core", len(core_out) // 3, len(js)))
    for r in report: print("%-8s %4d satellites %8d bytes" % r)
    print("fetchedAt", stamp, "total bytes", sum(r[2] for r in report))
if __name__ == "__main__": main()
