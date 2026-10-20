#!/usr/bin/env bash
# Serve this checkout locally; keep the server in the foreground for Ctrl+C.
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
usage() {
  printf 'Usage: %s [port]\n\nStart SatPass at http://127.0.0.1:8000 (or the supplied port).\nLeave this terminal open; press Ctrl+C to stop.\n' "${0##*/}"
}
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then usage; exit 0; fi
if (( $# > 1 )); then usage >&2; exit 1; fi
port="${1:-8000}"
if [[ ! "$port" =~ ^[0-9]{1,5}$ ]] || (( 10#$port < 1 || 10#$port > 65535 )); then
  printf 'Choose a port between 1 and 65535.\n' >&2; exit 1
fi
port="$((10#$port))"
if ! command -v python3 >/dev/null; then
  printf 'Python 3 is required. On Mint, install it with: sudo apt install python3\n' >&2; exit 1
fi

# A busy port must not silently send the user to some other application. Compare
# the current checkout's entry point and UI script before reusing a server.
if python3 - "$project_dir" "$port" <<'PY'
import errno
import http.client
from pathlib import Path
import sys

root, port = Path(sys.argv[1]), int(sys.argv[2])
for name in ("index.html", "js/app.js"):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        expected = (root / name).read_bytes()
        connection.request("GET", "/" + name)
        response = connection.getresponse()
        if response.status != 200 or response.read(len(expected) + 1) != expected:
            sys.exit(2)
    except OSError as error:
        sys.exit(1 if error.errno == errno.ECONNREFUSED else 2)
    except http.client.HTTPException:
        sys.exit(2)
    finally:
        connection.close()
sys.exit(0)
PY
then
  printf 'SatPass is already available at http://127.0.0.1:%s/\n' "$port"
  exit 0
else
  status=$?
  if (( status != 1 )); then
    printf 'Port %s is busy and does not match this SatPass checkout.\nTry another port, for example: %s 8001\n' "$port" "$0" >&2
    exit 1
  fi
fi

printf 'Open http://127.0.0.1:%s/ in your browser. Press Ctrl+C here to stop.\n' "$port"
exec python3 -u -m http.server "$port" --bind 127.0.0.1 --directory "$project_dir"
