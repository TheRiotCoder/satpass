# Adaptive dashboard (1.5.0)

The web app still uses static HTML, CSS and vanilla JavaScript. No framework,
CDN, extra runtime dependency or web build step was added. The existing local
Three.js and Astronomy Engine assets and orbital calculations are unchanged.

## Layout

- Below 600 px, content stacks above the six-section bottom navigation, including
  Visible Now. Important live telemetry comes before the selected visualization.
- From 600–899 px, navigation becomes a compact horizontal bar. Pass cards use
  two columns and Setup groups smaller settings together. A short landscape
  window gets a smaller header/navigation, with 44 px controls retained.
- From 900 px, Passes places its list beside a selected-pass preview, Live places
  the selected map/globe/sky beside telemetry, Visible Now places its list beside
  the visualization, and Doppler/catalog/Setup use separate regions.
- From 1200 px, navigation becomes a persistent sidebar. The main content fills
  the remaining space instead of stopping at 820 px.
- On wide screens from 1800 px, Live has three regions and Setup has three
  logical columns. Container queries let wide pass previews show metadata, the
  sky plot and the time-series table together. Tall windows retain a balanced
  layout. Map height is limited relative to the viewport; graphics keep their
  geometry while the rest of the dashboard uses the remaining space.

Breakpoints use viewport size and aspect ratio, never user-agent detection.
Forms and cards use container queries as well as fluid Grid tracks. Themes use
the existing palette. Tables scroll inside keyboard-focusable labeled regions.
The skip link focuses the current page without changing its hash route.

## Pass selection and graphics

The preview and full pass-detail route call the same `renderPassDetail()`
function. Desktop selections keep the list visible; **Open pass detail** retains
all existing deep links, calendar/reminder actions and Doppler links. On phones,
selecting a pass still navigates to its detail route. No prediction code was
copied or changed. Selection, drafts and view modes survive viewport changes.

Canvases measure their actual panel rather than the main content column. One
view-owned ResizeObserver watches panel widths and schedules at most one pending
redraw through requestAnimationFrame. It disconnects, and queued work is
cancelled, when the route changes. Preview replacements unobserve the old plot.
Live/Visible Now redraw their cached current positions on resize; the normal
one-second updates continue independently. Ground's existing Three.js resize and
suspend/dispose behavior remains in place.

Maps retain their 2:1 ratio and plots remain circular, including while CSS
rearranges panels before the next buffer redraw. Backing buffers retain the
existing device-pixel-ratio handling. Hidden pass plots defer drawing until
there is usable panel space.

## Files

- `index.html`: shell regions, sidebar brand and keyboard skip link.
- `css/style.css`: fluid shell, responsive navigation, screen grids, container
  queries and safe spacing for announcements/install/toast overlays.
- `js/app.js`: shared pass-detail/preview renderer, panel measurement, scoped
  observers and logical screen regions. Existing algorithms/source/security
  modules are reused.
- `js/draw.js`, `js/sky.js`, `js/globe.js`: proportional canvas CSS sizing while
  keeping high-density drawing buffers.
- `sw.js`: cache version bumped so deployments update the shell consistently.
- App/package/proxy version markers, README and CHANGELOG: 1.5.0 release metadata.
- `tests/responsive-smoke.cjs`: actual-browser geometry, navigation, selections,
  resize lifecycle, themes, overlays, view modes and offline checks.
- Existing smoke/unit fixtures: account for panel measurement and check actual
  compass sector bounds instead of assuming a particular text abbreviation.

Pre-existing Electron packaging work remains in the working tree. The earlier
location repair now uses a scoped preload and temporary browser handoff; see
[`electron/README.md`](../electron/README.md). Its new tests cover validation,
origin restrictions, cancellation, expiry and cleanup. Browser geolocation in
automation uses a simulated fix; actual GPS/provider availability still depends
on the user's browser and permissions.

## Run and review

For the web app, no npm install is required:

```sh
cd /home/owner/Projects/satpass
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/`. Existing PWA installations offer **Update** when the
new service worker is ready. Set an observing location and favorites in Setup,
then resize each screen. The installed desktop app needs a rebuilt installer;
editing source files does not change an already installed package.

Use Node 24 (minimum 22.12) for the tests and Electron development:

```sh
node tests/run-all.js
SKIP_NET=1 node --experimental-websocket tests/browser-smoke.js
node tests/responsive-smoke.cjs
npm run test:desktop:smoke
```

Both browser runners accept `CHROME_BIN=/path/to/chrome`. On this development
computer, the available runtime and browser can be selected with:

```sh
export PATH=/home/owner/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
export CHROME_BIN=/tmp/satpass-playwright/chromium-1234/chrome-linux64/chrome
```

The responsive runner checks every screen at 375×812, 812×375, 768×1024,
1024×768, 1440×900, 1920×1080, 2560×1440 and 3440×1440, plus 320 px and ten
intermediate/boundary configurations. Screenshots go to
`/tmp/satpass-responsive-shots/`. It also resizes all Live/Visible Now view modes,
checks browser-assisted location with a simulated fix, and reloads offline.

No deployment, push, merge or automatic publication is part of this change.

## Validation results

Validated locally on Linux with Node 24.19.0 and headless Chrome:

- Responsive runner: **667 checks passed**, including the eight requested sizes
  and ten intermediate/boundary sizes, all routes and all tracker view modes.
- Full browser smoke (`SKIP_NET=1`): **258/258 checks passed**, with no unexpected
  console problems. Deliberate offline refreshes log expected network failures.
- Desktop smoke: **17 checks passed** against both source and the packaged Linux
  app, including cold offline startup, 3D views and persistence across restarts.
- General suite: **1,129 passed, 1 failed** across 26 files. The existing
  `tests/store.test.js` SAR category freshness assertion also failed on the
  pre-layout baseline; it depends on the age of bundled category data. No
  propagation, prediction or source logic was changed to conceal this failure.
- Linux `.deb` and AppImage built successfully as version **1.5.0**. Debian
  package metadata was checked; installer outputs are ignored by Git.
- `git diff --check`: clean.

Chrome device emulation does not replace testing on physical iPads/phones or
Safari. The Windows configuration remains available, but no native Windows
installation was tested here. Real browser geolocation still needs the user's
permission and a working browser location provider; automated handoff checks use
simulated coordinates.
