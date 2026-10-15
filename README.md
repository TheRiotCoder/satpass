# SatPass

Satellite and ISS pass predictor for ham radio operators, as an installable, offline-capable web app (PWA). It runs on Android, iPhone, Windows, Mac and Linux. It is plain HTML/CSS/vanilla JS with **no build step and no CDN at runtime**.

Predictions use public orbital elements (TLEs) from [CelesTrak](https://celestrak.org), propagated on your device with SGP4/SDP4. Your location never leaves the device.

> **Heads-up on accuracy:** predictions are only as good as the TLE behind them. A fresh LEO TLE is typically good to a km or two (a few seconds of pass timing), and it degrades every day. SatPass warns when element sets are older than 7 days. Frequencies in the Doppler tab are approximate. See [Caveats](#caveats).

## Features

- **Location**: GPS button, manual lat/lon/elevation, **Maidenhead grid** entry and display (type a grid to get lat/lon, or lat/lon to get the grid; 4/6/8/10 characters). Saved in `localStorage`. Local-time / UTC toggle in the header.
- **Satellite list** with search and favorites. Defaults to the **ISS (25544)**. The curated set covers ISS, Tiangong (CSS), SO-50, AO-91, AO-92, AO-7, RS-44, FO-29, AO-73, CAS-4A/4B, IO-117, TEVEL 1–9, NOAA 15/18/19 and Meteor-M2 3/4. All ~185 bundled satellites are searchable.
- **Pass prediction** for 1–10 days: AOS / max-elevation (TCA) / LOS times, azimuth + compass point, duration, max elevation, sorted list, tap a pass for detail. Minimum-elevation filter (default 10°; AOS/LOS are when the satellite crosses that elevation). **VISIBLE** flag for ISS/Tiangong: satellite sunlit (Earth shadow test), observer's sun elevation below −6°, satellite above horizon.
- **Pass detail**: polar sky plot (AOS/TCA/LOS marks, time ticks, visible part highlighted, live "NOW" marker), az/el/range/range-rate table at 10/20/30 s, `.ics` export, in-app reminder.
- **Live tracker**: az, el, range, range-rate, lat/lon/alt, speed, sunlit/eclipsed, 1 s updates; equirectangular map with a small bundled coastline, ground track (past + future), footprint circle (0° horizon and your minimum elevation).
- **Doppler calculator** with a bundled, *approximate* frequency table (FM repeaters, linear transponders, APRS/digital, APT/LRPT): live Doppler-corrected receive/transmit frequency, a passband slider for linear transponders, and a Doppler-vs-time table across any upcoming pass.
- **Alerts**: "Next pass" countdown banner (favorites); per-pass reminders with the Notification API where the platform allows it; `.ics` calendar export (with an alert) for one pass or the whole list.
- **Offline**: app shell, a bundled TLE snapshot and the map are precached. First launch offline works from the snapshot; cached TLEs are used afterwards.

## Install

**iPhone / iPad (Safari)**
1. Open the app URL in **Safari** (not an in-app browser).
2. Tap **Share** (square with the up arrow).
3. Tap **Add to Home Screen**, then **Add**.

**Android (Chrome)**
1. Open the app URL in **Chrome**.
2. Tap **Install** on the in-app banner, or **⋮ → Install app** (or **Add to Home screen**).

**Desktop (Chrome / Edge)**: click the install icon in the address bar.

After the first visit it works without a connection.

### Notifications on iPhone / Android

- **Android / desktop Chrome**: tap "Remind me" on a pass and allow notifications. Reminders fire while the app is open or still running in the background.
- **iPhone**: web notifications only exist for apps **added to the Home Screen** (iOS 16.4+). In plain Safari the button explains this and the in-app banner/toast is used instead.
- **Limitation (all platforms)**: a web app that is fully closed cannot be woken at a scheduled time without a push server, and SatPass has none (nothing is sent off-device). For a dependable alarm use **Add to calendar (.ics)**; the exported events include an alert. The in-app **Next pass** banner always works while the app is open.

## Data sources and attribution

- **Orbital elements**: [CelesTrak](https://celestrak.org) GP data (Dr. T.S. Kelso) via `https://celestrak.org/NORAD/elements/gp.php` (`GROUP=stations|amateur|weather` plus `CATNR=25338/28654/33591` for NOAA 15/18/19, which aren't in a group). CelesTrak serves `Access-Control-Allow-Origin: *`, so the browser can fetch it directly. SatPass is not affiliated with or endorsed by CelesTrak.
- **Rate courtesy**: CelesTrak asks clients not to re-download the same data more than about once every 2 hours. SatPass refreshes automatically at most every **6 h** (on launch/when back online), the manual button is allowed at most every **2 h**, failures back off 30 min, and a network error or HTTP 403/429 stops the batch immediately.
- **Fallbacks**: if CelesTrak can't be reached (offline, blocked by a network or content blocker) SatPass keeps the last cached/bundled TLEs and says so. You can also **paste TLEs** on the Sats tab.
- **Bundled snapshot** (`data/tle-snapshot.js`, with its fetch time): used on first launch and offline. Regenerate with `python3 tools/update_snapshot.py` at release time.
- **Coastline** (`data/world.js`): simplified from Natural Earth 110m land (public domain), generated by `tools/make_world.py`.
- **Frequencies** (`js/radio.js`): compiled from public amateur-satellite information; approximate and out of date quickly. Verify with [AMSAT's status page](https://www.amsat.org/status/) before operating.

## How it works / SGP4 choice

Propagation uses **[satellite.js](https://github.com/shashwatak/satellite-js) 6.0.2** (MIT; the UMD minified build is vendored in `js/vendor/` with its licence), which implements SGP4/SDP4 (near-earth and deep-space) per Vallado's reference code. Chosen over writing our own SGP4 (error-prone) and over satellite.js 7.x (ESM-only/WASM, no single-file build, which doesn't fit "no build step, works from any static host").

Everything else is our own code: TEME→ECEF rotation, WGS-84 observer geometry, az/el/range/range-rate, Meeus low-precision sun position (~0.01°), cylindrical Earth-shadow test, pass search (20 s sampling + bisection for AOS/LOS, golden-section for max elevation), Doppler, `.ics`, Maidenhead.

## Tests

```
node tests/run-all.js                                       # 172 pure-module unit tests (Node 18+)
node --experimental-websocket tests/browser-smoke.js        # headless Chrome (CDP) end-to-end, served under /satpass/
SKIP_NET=1 node --experimental-websocket tests/browser-smoke.js   # same, without touching celestrak.org
python3 -m venv /tmp/pyv && /tmp/pyv/bin/pip install sgp4 skyfield   # independent cross-check:
node tests/crosscheck/dump.js > /tmp/d.json && /tmp/pyv/bin/python tests/crosscheck/crosscheck.py /tmp/d.json
```

The cross-check compares our output with python-sgp4 and Skyfield (JPL DE421) for all bundled satellites (positions < 0.3 m), pass AOS/TCA/LOS for ISS, SO-50, AO-7, RS-44, NOAA 19, AO-10 and AO-91 (< 0.25 s), az/el, range-rate, sun elevation and sunlit state.

Project layout: `index.html`, `css/`, `js/` (pure UMD modules `grid`, `doppler`, `format`, `tle`, `passes`, `ics`, `radio`; browser layers `store`, `draw`, `app`; `vendor/satellite.min.js`), `data/`, `icons/`, `sw.js`, `manifest.webmanifest`, `tools/` (icon, snapshot and map generators), `tests/`.

## Hosting

Static files only; all paths are relative, so it works from a sub-path such as GitHub Pages `https://<user>.github.io/satpass/` (`.nojekyll` is included). Serve over HTTPS (required for the service worker, geolocation and notifications). Bump `VERSION` in `sw.js` on every release; the app shows an "update ready" bar when a new service worker is waiting.

## Caveats

- **TLE age/accuracy**: SGP4 + TLE error grows with age (ISS can lose several km/day after reboosts or manoeuvres). A pass can be minutes off with week-old elements. Always confirm important passes with a live source.
- **Visible passes** are geometric (sunlit satellite, dark sky, above the horizon). Brightness, weather, terrain, refraction and attitude are not modelled. The VISIBLE tag is only applied to bright objects (ISS, Tiangong).
- **Doppler** is first-order (non-relativistic); frequencies, tones and satellite status change and some satellites are off for long periods. Approximate by design.
- **AO-92, CAS-4A and CAS-4B** are in the catalogue/frequency table but have **no current element set in CelesTrak's public data** at the time of the snapshot (retired/decayed/unpublished); paste TLEs if you have them. NOAA 15/18/19 APT was being retired; check they're still transmitting.
- **Geostationary** satellites are skipped by the pass finder (they don't "pass").
- **Notifications**: see above. iOS requires a Home Screen install, and nothing can fire while the app is fully closed.
- **Privacy**: location and settings live only in this browser's `localStorage`. The only network traffic is the CelesTrak GET requests.
- Developed and tested in desktop headless Chrome and node; not yet exercised on physical Android/iOS devices.

## Licenses

- App code: no licence file has been chosen yet (all rights reserved by default until the owner adds one).
- `js/vendor/satellite.min.js`: satellite.js © Shashwat Kandadai, MIT (see `js/vendor/satellite.js-LICENSE.md`).
- TLE data © CelesTrak; follow [CelesTrak's usage terms](https://celestrak.org/webmaster.php). Natural Earth data is public domain.
