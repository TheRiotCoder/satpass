# Changelog

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
