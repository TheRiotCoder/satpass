#!/usr/bin/env bash
# Build without root privileges; elevate only the Debian package installation.
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
usage() {
  printf 'Usage: %s [--build-only]\n\nBuild SatPass for 64-bit Linux Mint and install its .deb package.\nRun as your normal user; sudo is requested for installation.\n--build-only builds the packages without closing or installing the app.\nSet NODE_BIN to a Node.js binary if it is not on PATH.\n' "${0##*/}"
}
build_only=false
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --build-only) build_only=true ;;
  '') ;;
  *) usage >&2; exit 1 ;;
esac
if (( $# > 1 )); then usage >&2; exit 1; fi
if (( EUID == 0 )); then printf 'Run this script without sudo; it requests sudo only when installing.\n' >&2; exit 1; fi
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  printf 'This installer targets 64-bit (x86_64) Linux Mint/Ubuntu.\n' >&2; exit 1
fi

# Prefer the user's PATH, then existing user runtimes. The final candidate is
# the Node runtime already available on the original Mint development computer.
if [[ -n "${NODE_BIN:-}" ]]; then
  candidates=("$NODE_BIN")
else
  candidates=("$(command -v node || true)"
    "$HOME"/.nvm/versions/node/v24.*/bin/node
    "$HOME"/.nvm/versions/node/v22.*/bin/node
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
fi
node_bin=''
for candidate in "${candidates[@]}"; do
  if [[ -x "$candidate" ]] && "$candidate" -e 'const [m,n]=process.versions.node.split(".").map(Number);process.exit(m>22 || m===22&&n>=12 ? 0 : 1)' 2>/dev/null; then
    node_bin="$candidate"; break
  fi
done
if [[ -z "$node_bin" ]]; then
  printf 'Node.js 24 LTS (minimum 22.12) is required. Install it, or set NODE_BIN=/path/to/node.\n' >&2; exit 1
fi
export PATH="$(dirname -- "$node_bin"):$PATH"
if ! command -v npm >/dev/null; then printf 'npm is required with your Node.js installation.\n' >&2; exit 1; fi
if ! command -v dpkg-deb >/dev/null; then printf 'dpkg-deb is required (included with Linux Mint).\n' >&2; exit 1; fi
if [[ "$build_only" == false ]]; then
  for command_name in sudo apt-get; do
    if ! command -v "$command_name" >/dev/null; then printf '%s is required to install on Mint.\n' "$command_name" >&2; exit 1; fi
  done
fi

cd -- "$project_dir"
printf 'Building with Node %s\n' "$(node --version)"
printf '\nInstalling the locked build dependencies…\n'
npm ci --include=dev
printf '\nChecking desktop configuration…\n'
npm run test:desktop
printf '\nBuilding Linux packages…\n'
npm run dist:linux

version="$(node -p 'require("./package.json").version')"
package="$project_dir/release/SatPass-$version-linux-amd64.deb"
if [[ ! -f "$package" ]] || [[ "$(dpkg-deb -f "$package" Package)" != satpass ]] ||
   [[ "$(dpkg-deb -f "$package" Version)" != "$version" ]] || [[ "$(dpkg-deb -f "$package" Architecture)" != amd64 ]]; then
  printf 'The expected SatPass .deb package was not produced or has unexpected metadata.\n' >&2; exit 1
fi
printf '\nBuilt: %s\n' "$package"
if [[ "$build_only" == true ]]; then exit 0; fi

# Authenticate before closing the app, so a cancelled password prompt leaves
# the user's running copy alone. Do not modify or remove the settings profile.
printf '\nAdministrator access is needed to install.\n'
sudo -v
printf 'Closing the installed SatPass app, if running…\n'
node <<'JS'
const fs = require('node:fs');
const executable = '/opt/SatPass/satpass', pids = [];
for (const name of fs.readdirSync('/proc')) {
  if (!/^\d+$/.test(name)) continue;
  try {
    if (fs.statSync('/proc/'+name).uid !== process.getuid() || fs.readlinkSync('/proc/'+name+'/exe') !== executable) continue;
    const args = fs.readFileSync('/proc/'+name+'/cmdline', 'utf8').split('\0');
    if (!args.some(a=>a.startsWith('--type='))) pids.push(Number(name));
  } catch (error) { if (!['ENOENT','ESRCH','EACCES','EPERM'].includes(error.code)) throw error; }
}
(async()=>{
  for (const pid of pids) { try { process.kill(pid,'SIGTERM'); } catch(error) { if(error.code!=='ESRCH') throw error; } }
  for (let attempt=0;attempt<50;attempt++) {
    const alive=pids.some(pid=>{try{return fs.readlinkSync('/proc/'+pid+'/exe')===executable;}catch{return false;}});
    if(!alive) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('SatPass did not close. Close it and run the script again.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
JS
sudo apt-get install --reinstall -y "$package"
printf '\nInstalled SatPass %s. Open it from the applications menu, or run: satpass\n' "$version"
