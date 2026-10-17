#!/bin/sh
# Builds dist/ = exactly the files the Cloudflare Worker (static assets) serves: the app + public/_headers. No tests, proxy, tools or .git.
# Usage: sh tools/build-site.sh   (then: npx wrangler deploy). Idempotent.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist
cp index.html manifest.webmanifest sw.js dist/
cp -R css js data icons dist/
cp public/_headers dist/_headers
# a real 404 for unknown paths (Pages otherwise answers every unknown path with index.html and 200); hash routing needs no SPA fallback
cat > dist/404.html <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found – SatPass</title><link rel="icon" href="/icons/favicon-32.png"></head><body style="font-family:system-ui,sans-serif;background:#0b1220;color:#e8eefc;text-align:center;padding:3em 1em"><h1>404</h1><p>Nothing here. <a href="/" style="color:#7fb6ff">Open SatPass</a></p></body></html>
HTML
echo "dist/ ready: $(find dist -type f | wc -l) files"
