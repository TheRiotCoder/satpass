# Changelog

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
