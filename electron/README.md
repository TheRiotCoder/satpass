# SatPass desktop

The Linux and Windows desktop wrappers live in the same repository as the web
app and use its HTML, CSS, JavaScript, catalogs, globe and sky views. Electron
44.9.0 (MIT) and electron-builder 26.15.3 are pinned in the root package manifest
and lockfile. The web/PWA deployment still has no npm dependency or build step.

## Use the Linux app

On Linux Mint, open the `.deb` installer with your package installer. It installs
SatPass into your applications menu. Or install from a terminal:

```sh
sudo apt install ./release/SatPass-1.5.2-linux-amd64.deb
```

The AppImage is an alternative portable package. Mark it executable in its file
properties and open it, or run:

```sh
chmod +x release/SatPass-1.5.2-linux-x86_64.AppImage
./release/SatPass-1.5.2-linux-x86_64.AppImage
```

Some Linux systems need FUSE support to mount AppImages; use the `.deb` on Mint
if the AppImage cannot start. The installed `.deb` also supplies the Chromium
sandbox/AppArmor integration needed by recent Ubuntu/Mint systems. Normal
launchers keep the sandbox enabled. Do not run the app as root.

No terminal, web server, Node.js installation, or initial online visit is needed
to use a packaged app. All app assets and catalog snapshots are included, so the
first launch works offline. Internet access is used to refresh orbital elements
or follow external documentation links. Old TLEs still reduce accuracy.

Enter your observing location in Setup. **Use my current location** opens a
local page in your default browser. Choose **Share location with SatPass**, allow
the browser's location request, and return to the app. Your browser may contact
its location provider. Coordinates return only to this app over a temporary
loopback-only connection that closes after the request (or two minutes). No
Google API key or billing account is needed. Browser location still depends on
your browser/provider and may be unavailable offline; manual coordinates work
offline. Settings, favorites and downloaded elements persist in the desktop
profile, separately from browser/PWA data. On Linux this is normally
`~/.config/SatPass/`, and on Windows `%APPDATA%\SatPass\`.
Encrypted credential backups can be exported from the web app and imported in
desktop Setup; set location and favorites separately. Desktop vault unlock uses
the existing passphrase encryption; browser passkey/biometric enrollment is not
offered for the desktop app's local address.

Updates are manual: close SatPass and install a newer desktop package. The stable
profile path keeps settings across updates. The web service worker and web
update/install banners are skipped in desktop, so cached web assets cannot mask
a packaged update. Closing the main window quits SatPass; reminders only run
while the app is open. The normal calendar export remains available.

## Develop and build

On Linux Mint, the executable `./build-install-mint.sh` in the repository root
installs the locked build dependencies, runs the desktop policy checks, builds
both Linux packages, and installs the `.deb` with sudo. Run it as your normal
user. It detects a supported user Node runtime or accepts `NODE_BIN=/path/to/node`.
It closes a running installed copy only after build/validation and sudo
authentication succeed. Settings are preserved; open SatPass from the applications
menu afterwards. `./build-install-mint.sh --build-only` skips installation and
leaves any running app alone. `./start-web.sh` starts the Python browser version.

Use Node.js **24 LTS** (minimum 22.12) and npm. From the repository root:

```sh
npm ci
npm start
```

`npm start` opens the desktop app without a web server. On a Linux development
machine that restricts unprivileged Chromium sandboxes, use the installed `.deb`
for normal use; the packaging tools supply its platform integration.

Build on Linux:

```sh
npm run dist:linux
```

Outputs are in `release/`: an x64 AppImage, an amd64 `.deb`, and the unpacked
application directory. That directory contains the complete runtime, not just a
single executable. Artifacts and `node_modules/` are ignored by Git. Electron
bundles Chromium and Node.js, so desktop downloads are much larger than the web
assets (roughly 100–130 MB for these Linux installers).

On the Windows development laptop, clone this same repository, install Node 24,
and run these commands in PowerShell:

```powershell
npm ci
npm start
npm run dist:win
```

This builds an x64 NSIS installer under `release/`. Installation is per-user by
default, offers a destination-folder choice, and preserves the data profile on
uninstall. Signing credentials are not configured; public distribution can add
Windows code signing later. Windows runtime behavior must be tested on Windows.

The `Desktop packages` GitHub Actions workflow builds both Linux and Windows
installers on their respective runners, either on relevant pushes/PRs or via
**Actions → Desktop packages → Run workflow**. Downloads appear under the run's
Artifacts for 30 days. Builds do not publish a release automatically; installers
can later be attached to a GitHub Release in this repository.

## Verification

```sh
npm run test:desktop
npm run test:desktop:smoke
DESKTOP_BINARY=release/linux-unpacked/satpass npm run test:desktop:smoke
```

The policy tests check file/URL boundaries and packaging rules. The smoke test
launches a separate temporary profile, blocks network access, exercises both 3D
sky views, checks Web Crypto and settings persistence across restarts, and quits
the app. It uses headless Chromium with a test-only sandbox override for Linux
CI containers; production launchers never add that override. It writes preview
screenshots to the system temporary directory. Interactive permission dialogs,
real GPS, system notifications, and Windows installation need platform testing.

## Desktop implementation

`electron/main.cjs` supplies a native window without an application menu bar, download dialogs, permission
prompts and a `satpass://app/` asset protocol. It reads only allowlisted packaged
files. The optional browser location handoff briefly starts a token-protected
HTTP listener on 127.0.0.1; it serves only the location consent page and accepts
one validated result. The app itself is not served over HTTP. The isolated
preload exposes only a location-request function, with IPC restricted to the main
local page. Renderer Node integration is disabled;
context isolation, renderer sandboxing, web security and the web app's CSP remain
enabled. External HTTPS links open in the default browser. License files can be
read in isolated local document windows, including offline.

The application MIT license and bundled library notices are included in the app
archive. Electron's runtime license and Chromium's third-party notices are kept
in the distribution alongside the executable. The packaging dependencies are
development tools and are not shipped inside the application archive.

The pinned build tools currently report eight moderate npm audit findings from
one underlying `sprintf-js` formatting issue inherited through the builder's
proxy/logging dependency chain. This development-only chain is excluded from
the packaged app; the archive was checked to contain no `node_modules` directory.
