# Changelog

## 1.5.0 – Adaptive dashboard

- Adds executable `start-web.sh` and `build-install-mint.sh` helpers for the local Python server and Linux Mint desktop build/install workflow.
- Desktop windows omit the File/Edit/View/Help menu bar.

- Uses a fluid Grid shell, a desktop sidebar, compact tablet navigation, and mobile bottom navigation. Passes gains a shared selected-pass preview; Live/Visible Now, Doppler, Satellites and Setup use their available panel space.
- Canvas renderers measure their actual panels, keep their aspect ratios and high-density backing buffers, and redraw through a cleaned-up ResizeObserver lifecycle without restarting predictions during resize.
- Adds responsive browser regression coverage for all routes, 18 viewport sizes, all live views, themes, offline use, and timer/observer cleanup.
- Fixes desktop automatic location by requesting a consented browser handoff over a temporary loopback-only connection; no Google API account is required.

## 1.4.0 – Electron desktop packaging
- Adds the native desktop wrapper in this repository, pinned Electron/build dependencies, Linux AppImage and `.deb` targets, and a Windows NSIS target with a Linux/Windows GitHub Actions artifact workflow. Application assets and all offline catalogs are packaged directly; no separate web server or initial online cache fill is needed.
- Adds an isolated, sandboxed desktop window, native menu, controlled external links, local license viewers, save dialogs and permission prompts. A restricted local asset protocol supports the existing ES modules and Web Crypto without exposing Node.js to renderer code. Settings live in a persistent desktop profile, separate from browser storage.
- Desktop skips web install/service-worker updates and uses manual package updates. Passphrase credential encryption remains available; unsupported local-origin browser passkeys are not offered. Documents Linux/Windows development, installation, offline behavior and runtime limitations. Adds desktop policy and offline launch/restart/3D smoke tests.

## 1.3.13 – 3D Sky horizon scenery
- Adds two seamless layers of locally drawn tree silhouettes around the 3D Sky horizon on Live Tracker and Visible Now. Distant and nearby trees adapt their dark colors to the illustrative day/night sky, helping distinguish ground from sky.
- Scenery rotates with the camera and works offline without additional assets or libraries. Compass marks still identify the true, level horizon; decorative trees do not alter visibility calculations or hide satellite/reference markers.

## 1.3.12 – Interactive 3D Sky
- Adds a fourth 3D Sky tab on Live Tracker and Visible Now, with an observer-centered perspective camera, 360° mouse/touch look, wheel/pinch/button zoom, keyboard controls, compass directions, overhead/reset controls and Find selected.
- Reuses active-point satellite and astronomical positions, filters, selection/readouts and the Moon/planet/Polaris toggle. Draws only above-horizon objects; symbols are enlarged for identification, including in daylight. A level horizon, elevation grid and optional minimum-elevation ring provide orientation. Sky colors are illustrative; no terrain, cloud, additional star catalog or device sensors.
- Bundles pinned Three.js 0.180.0 under MIT, including its license and provenance. Lazy initialization, offline precaching, graceful WebGL 2 fallback, responsive layout, hidden-tab suspension and GPU/event cleanup keep the feature isolated from orbital calculations and existing views.

## 1.3.11 – Polaris sky reference
- Adds “Polaris · North Star” to the shared reference layer in both Sky Views, with a lavender star marker, automatic label and selectable bearing/elevation readout. The renamed Moon/planets/Polaris toggle retains the existing preference.
- Uses SIMBAD J2000 coordinates and parallax with Astronomy Engine’s user-defined star support, including date/observer transformations. Small proper motion is omitted; source and approximation are documented in README. Polaris is only drawn above the active observing point’s horizon and is not pinned to exact north. No additional library or runtime network request.

## 1.3.10 – Moon and planets in Sky View
- Both Sky Views include an optional reference layer for the Moon and seven planets, on by default with a shared remembered toggle. Uses the active saved/custom observing point and time, including observer parallax; geometric elevations match the satellite chart convention.
- White Moon disc and orange planet diamonds, labels, selectable readouts, and Moon illuminated percentage. References appear above the horizon independently of satellite filters/counts. Satellite and celestial selection identities remain separate; astronomical calculation errors leave satellite rendering available.
- Astronomy Engine 2.1.19 is bundled unchanged from the official release, with its MIT license, provenance/checksums, About attribution, and offline precaching. No external requests, credentials or API keys are needed at runtime.

## 1.3.9 – Live Tracker Sky View
- Adds the third Sky View tab to the single-satellite Live Tracker using the shared looking-up chart. Shows the selected satellite with its name, live bearing, elevation, range, lighting conditions and minimum-elevation ring from the saved observing location.
- Below-horizon objects are not plotted on the sky dome; a message explains when they will appear. A missing location prompts Setup instead of using the fallback coordinates. Unusable orbital positions hide stale chart data.
- Three-tab keyboard navigation and remembered selection work across satellite changes. Existing map/globe views remain available.

## 1.3.8 – Sky View
- Third tab in Visible Now shows the satellite sky from the active saved/custom observing point, using the same 1 s SGP4 positions and filters as the map/globe. Looking-up projection: north at top, east on left, overhead at center, horizon at rim; 30° and 60° elevation circles and the optional minimum-elevation ring.
- Tap/click a marker or select a satellite in the keyboard-accessible list to highlight it and see its name, true-north bearing, elevation, range and viewing conditions. Optional chart labels avoid collisions. The view choice is remembered and three-tab keyboard navigation wraps correctly.
- Responsive chart supports high-DPI displays, empty results, and offline use. No star catalog, constellation overlay or device orientation tracking in this version.

## 1.3.7 – Visible Now
- New navigation page shows all above-horizon satellites in the app catalog (all bundled categories plus imported/looked-up objects), updated every second from SGP4. Saved location or a separate custom point controls both views and is marked You. Custom coordinates never overwrite the global location.
- Multi-satellite 2D Map and 3D Globe tabs, selection highlighting and labels, observer centering, and links to each satellite’s Live page. Globe heights are compressed by default to keep Earth readable with mixed LEO/navigation/high-altitude objects; actual altitude scale is optional. Numeric readouts always use actual positions. Existing single-satellite Live behavior is retained.
- Highest-elevation-first list shows true-north bearing, elevation, range, sunlight/sky conditions, and TLE age. Filters for minimum elevation, compass sector and optional sunlit + dark sky. Default includes all above-horizon objects; brightness is not modeled and the catalog is not exhaustive.
- New filtering module is precached for offline use; bad/decayed orbits are skipped independently.

## 1.3.6 – Live tracker globe
- Separate accessible 2D Map and 3D Globe tabs, with the last selection remembered across satellites and reloads. The existing readouts and map remain available.
- Self-contained Canvas renderer uses the bundled coastline data: rotatable textured sphere, actual satellite altitude (spherical Earth approximation), Earth-fixed past/future trajectories, observer and radio coverage rings, with far-side occlusion. Shading is decorative, not a day/night model. No external library or runtime downloads.
- Mouse drag, touch rotation and pinch zoom, wheel zoom, keyboard rotation/zoom, and center-on-satellite controls. Rendering is on demand; pending frames and pointer listeners are cleaned up on tab/view changes. The new renderer is precached for offline use.

## 1.3.5 – service worker vs. redirecting hosts (fix for the new Cloudflare Pages origin)
- **Bug (found by the live smoke on the new origin):** Cloudflare Pages answers `/index.html` with a 308 redirect to `/`. The service worker pre-cached that **redirected** response and served it to navigations, which Chrome refuses ("a redirected response was used for a request whose redirect mode is not follow"): after the first visit every navigation/reload showed a browser error page. 1.3.4 on Pages was affected; GitHub Pages is not (no redirect).
- **Fix:** every shell response is rebuilt as a plain (non-redirected) `Response` when precaching and again before it is served (so entries cached by 1.3.4 heal themselves on the next load). Pre-caching now fetches each file itself (`cache: "reload"`, all must be OK, same all-or-nothing install as before). Regression tests with a redirecting host; the live smoke now also checks a real navigation under an active service worker. No other change.

## 1.3.4 – own origin on Cloudflare Pages
- SatPass is now served from **https://satpass-3wj.pages.dev** (Cloudflare Pages project `satpass`): its own origin, so biometric unlock is offered there (`sharedOrigin()` is false on `*.pages.dev`; verified live with the virtual authenticator). GitHub Pages stays as a deprecated mirror.
- Repo: `public/_headers` (real CSP identical to the meta CSP + `frame-ancestors 'none'`, nosniff, no-referrer, X-Frame-Options, COOP, HSTS, Permissions-Policy, no-cache for the shell, Pages' default `Access-Control-Allow-Origin: *` removed), `tools/build-site.sh` (dist/ with only the app files + a real 404), `wrangler.toml` (Pages config). README: new primary URL, redeploy steps, optional Git auto-deploy, token hygiene. Proxy `ALLOWED_ORIGINS` now lists the new origin (redeploy the proxy if you already deployed it).
- GitHub Pages build: a dismissible notice points to the new address and reminds users to move saved logins with *Encrypted backup* (storage is per origin). No redirect, so existing offline users keep working and keep their data.

## 1.3.3 – lock races, key rotation, hosting wording
- **Medium – lock raced with the data key:** `lockNow()`/auto-lock zeroed the shared key array in place while a seal/wrap still used it. Verified: a lock during a passphrase change sealed the credentials under an all-zero key; `setCreds` + lock in the same tick left a vault that could not be unlocked. Fixed three ways: (1) every vault operation (save, first encryption/passphrase change, passphrase removal, unlock, biometric enrol/unlock, lock) now goes through one async queue and a lock waits behind pending operations (edits requested after a lock are refused as "locked"); (2) `sealVault`/`createVault` copy the key bytes synchronously on entry and the store never hands its mutable array to async work; (3) Forget bumps a generation counter so an operation finishing afterwards cannot resurrect anything. Regression tests for both repros, lock during first encryption/biometric enrolment/Forget, plus a seeded stress test of interleaved operations.
- **Low-Medium – passphrase change now rotates the data key:** new random key, credentials re-encrypted, wrapped by the new passphrase; an old copy of the vault plus the old passphrase no longer opens anything saved afterwards. The biometric record (it wrapped the old key; the PRF secret is not kept) is removed in the same step and the UI says so – turn it on again with one tap; the passphrase works meanwhile, nothing is lost.
- **Low – hosting wording:** a GitHub Pages custom domain on the user site still serves all project repos from one origin. `sharedOrigin()` can only detect `*.github.io`, so README, the UI help text and the code comments now say biometrics need a host dedicated to SatPass, and enabling biometrics on any non-localhost host asks you to confirm SatPass is the only app there.

## 1.3.2 – biometric unlock security recheck
- **M1 shared origin:** biometric unlock is no longer offered on any `github.io` host (one origin shared by all of an account's project sites: a sibling app could read the wrapped record from shared localStorage and ask the same passkey for the PRF output). Existing `satpass:bio` records are deleted on load there (and v1 records everywhere). UI shows a short explanation; README documents hosting SatPass on its own origin (Netlify Drop / Cloudflare Pages / dedicated custom domain, plus the proxy's `ALLOWED_ORIGINS`). Still enabled on localhost, custom domains and dedicated hosts. The false "harmless" comment in `js/biometric.js` is replaced by an explicit SHARED-ORIGIN LIMIT note.
- **M2 data key:** vault format `{enc:2}`: credentials are encrypted under a random 256-bit data key; the passphrase-derived key (PBKDF2 600k) and the optional PRF key each wrap that data key. The passphrase is never stored/wrapped; a passphrase change re-wraps only the key (biometric stays valid). 1.2.x/1.3.x `{enc:1}` blobs still open and are migrated on the next passphrase unlock. Header/KDF fields are authenticated (AAD).
- **Low:** wrapped secrets padded to a fixed size (no length leak); backup header (app/version/created/note) bound as AAD, v1 backups still import; confirm before a backup import replaces credentials or changes the proxy URL (names the new proxy host; refused without confirmation by default); passkey `residentKey: "discouraged"`; *Reset* keeps credentials **and** the biometric record/auto-lock settings and says so (it used to silently delete the biometric record and orphan the passkey); `wrapSecret`/`unwrapSecret` reject asynchronously on a short PRF; PRF bytes and data-key bytes are zeroed after use/lock (strings cannot be). Session-only credentials: documented as not auto-locked / not idle-cleared (locking would destroy them) – left as is by design.

## 1.3.1 – Export SAR list
- Sats → *SAR radar*: **⬇ CSV**, **⬇ JSON**, **⧉ Copy (spreadsheet/TSV)** and **⧉ Copy CSV**. One row per satellite (135 rows, 28 missions) with `mission, operator, band, centerFreqMHz, bandwidthMHz, approx, polarizations, modes, swathKm, swathMode, secondaryBands, noradId, satName, satNote, notes, sources`; unverified values blank (not guessed); missions with no public TLE included; offline from `data/sar.js` (`SatSar.exportRows/toCsv/toTsv/toJson`); UTF-8 BOM CSV, proper quoting. Output is byte-identical to the reference CSV (now `tests/fixtures/satpass-sar-stats.csv`).
- Tests: 13 new export checks in `sar.test.js` (counts, header, BOM, round-trip through a strict parser, quoting edge cases, blanks vs nulls, TSV/JSON), shell wiring check, browser check of the buttons (download + clipboard).

## 1.3.0 – credential vault
- **Password managers:** all credential inputs are real `<form method="post" action="#">` fields with `name` + `autocomplete` (Space-Track `username`/`current-password`; tokens/keys `current-password` with a visually-hidden account label; passphrases `new-password`, `current-password` when unlocking). No `autocomplete="off"` on credentials. *Test connection*, *Save proxy settings* and the passphrase button are submit buttons with `preventDefault()` handlers; after a successful test the card re-renders so managers offer to save. Help text: "Save in your password manager; SatPass can store an encrypted copy on this device". CSP unchanged (`form-action 'none'`, `connect-src` as before); tests assert nothing secret reaches the URL, text or attributes.
- **Biometric unlock (optional):** WebAuthn PRF. Platform passkey (rpId = page host, UV required) → PRF → HKDF-SHA256 → AES-GCM wrapping of the vault passphrase (record bound to rpId/credential/salt). New `js/biometric.js`; `Src.wrapSecret/unwrapSecret`. Passphrase is always the fallback; the vault format is unchanged (1.2.x blobs still open). Hidden when unsupported; PRF-less authenticators refused with a message. Record removed on passphrase change/removal and on Forget. Shared-origin caveats documented in README.
- **Proxy first:** the proxy + Worker secrets route is section 1 of Setup → Data sources and the Space-Track entry points to it before the password fields; README lists it first.
- **Auto-lock:** idle (default 15 min) and page-hidden (default 5 min) timers, configurable (0 = never); *Lock now*; lock wipes decrypted credentials + passphrase from memory and clears the fields. Pure rule `Src.lockDue`, store `lockNow()`.
- **Encrypted backup:** export/import of a passphrase-encrypted credentials file (PBKDF2 600k → AES-GCM), proxy URL included, refused while locked, tamper/junk/size handling.
- Tests: node 17 → 18 files (new `biometric.test.js`), new store/sources/shell checks; new `tests/browser-vault.js` (form structure, submit semantics, secret scan, auto-lock, backup through the UI, biometric flows on Chrome's virtual authenticator with PRF). **Not tested on a real device.**

## 1.2.2 – peer-review recheck
- Fixed a 1 ms race between a category's `fetchedAt` and the source's `lastOk` (flaky "second manual refresh within the hour" test): one shared timestamp, and the hourly pull rule now remembers which categories the last pull covered instead of comparing timestamps (it also keeps working after a pull that found nothing newer).
- After a tab close, session-only credentials are reported as "Credentials were session-only and need to be re-entered" instead of "No credentials stored".
- Wording: "not saved to local storage" instead of "never on disk" (browser session-restore may persist sessionStorage); UI, README, CHANGELOG.

## 1.2.1 – peer-review round 1

Every radio-data claim was checked against a primary source before it was changed (SatNOGS DB API, AMSAT Live Linear/FM lists and AO-7/SO-50 pages, NOAA OSPO / NESDIS, WMO OSCAR, CelesTrak GP availability). The SatNOGS dumps used are committed as `tests/fixtures/satnogs-tx-<norad>.json` and the radio table is tested against them.

### Radio data
- **Fixed** CAS-4A/4B: UHF *uplink* (435.210–.230 / 435.270–.290), VHF *downlink* (145.860–.880 / 145.915–.935), inverting, beacons 145.855 / 145.910. Both satellites re-entered in Oct 2025 – flagged "re-entered / no signal".
- **Fixed** AO-7 Mode A is *non-inverting* (SatNOGS `invert:false`, AMSAT); Mode B stays inverting.
- **Fixed** NOAA 15 (19 Aug 2025), 18 (6 Jun 2025), 19 (13 Aug 2025) are decommissioned: marked "no signal" in pass list, pass detail and Doppler; sorted last in the curated list; no longer fetched on refresh or listed in the Weather category.
- **Partly disputed** Meteor-M2 4 "137.100 primary": SatNOGS and WMO OSCAR list both 137.100 and 137.900, SatDump documents 137.900 as the primary and a Sep 2026 reception found only 137.900. 137.900 stays the default; 137.100 added as a second entry for M2 3 and M2 4.
- **Fixed** SO-50 note (2 s carrier with 74.4 Hz arms a 10-minute timer; re-send 74.4 Hz to re-arm); TEVEL note (TEVEL2-1 … 2-9).
- **Added** AO-123, PO-101, RS95S (QMR-KWT-2), CAS-3H (AMSAT Live FM list Jul 2026 + SatNOGS). IO-86 not added: AMSAT lists it but CelesTrak publishes no element set, so its state cannot be verified.
- **SatNOGS live entries**: listed drift is applied (ppb, cross-checked against SO-50 and AO-7 on-air offsets), CTCSS tone is read from the description, uplink-only entries are no longer shown as a downlink.

### Security / PWA
- Credentials are not saved to localStorage in plaintext; passphrase (≥ 10 chars, PBKDF2 600 000) required to persist; session/memory otherwise; legacy plaintext migrates (encrypt or remove). Warning next to the Space-Track password pointing at the proxy token mode.
- "Test connection" (and any `setCreds`) can no longer overwrite or delete a locked encrypted blob; fields/Test disabled while locked. Stored PBKDF2 iterations clamped to 100 000–2 000 000.
- Space-Track / SatNOGS proxy cache keys include the password / token hash; the proxy rejects a missing `Origin` unless the access token is supplied.
- CSP: `style-src 'self'` (+ `style-src-attr 'unsafe-inline'`), no localhost in the deployed `connect-src`; README documents the `*.workers.dev` limit and how to edit it.
- Space-Track, N2YO and the SatNOGS token path are labelled *untested live* in the UI and README.
- Malformed `#/%E0%A4%A` hash no longer aborts boot.
- Imported TLEs / pulls with nothing newer no longer reset "fetched N days ago"; storage-quota failures are surfaced; stored lat/lon/minEl/days range-checked; a partial CelesTrak failure falls back to the next source for the missing categories.
- Service worker is cache-consistent per version (no overwrite from the network on every load); update bar for an already-waiting worker; `reg.update()` on visibility and hourly.
- Calendar (.ics) is the primary reminder action; in-app reminder labelled as open-app-only. Install banner only after a saved location or the 2nd visit; ≥ 44 px targets for the Local/UTC pill and Install; location placeholders no longer look pre-filled.
- Added MIT `LICENSE`.

### Not done / deferred
- Portrait orientation lock for the sky plot (would break tablets/desktop; the plot is already responsive).
- Optional manifest screenshots.
- A live test of Space-Track / N2YO / SatNOGS-token paths (needs real accounts).

## 1.2.0
Data sources: Space-Track, SatNOGS DB and N2YO through a user-deployed Cloudflare Worker proxy; credentials UI; fallback chain; SatNOGS live transmitters; N2YO pass comparison.

## 1.1.0
Categories (Amateur, Stations, Weather, SAR, Earth observation, Navigation, Science) and the SAR radar panel.

## 1.0.2 and earlier
See the README release notes.
