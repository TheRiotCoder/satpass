// Pure desktop policies, shared by the main process and its tests.
const path = require("node:path");
const ORIGIN = "satpass://app";
const ROOT_FILES = new Set(["index.html", "manifest.webmanifest", "LICENSE"]);
const ASSET_DIRS = new Set(["css", "js", "data", "icons"]);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon",
  ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8"
};
function isAppURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === "satpass:" && u.hostname === "app" && !u.port && !u.username && !u.password;
  } catch { return false; }
}
function assetPath(value, root) {
  if (!isAppURL(value)) return null;
  let name;
  try { name = decodeURIComponent(new URL(value).pathname).replace(/^\//, "") || "index.html"; }
  catch { return null; }
  if (/[\\\0]/.test(name) || name.split("/").some(p => !p || p === "." || p === "..")) return null;
  if (!ROOT_FILES.has(name) && (!ASSET_DIRS.has(name.split("/")[0]) || !MIME[path.extname(name)])) return null;
  const base = path.resolve(root), file = path.resolve(base, name);
  return file.startsWith(base + path.sep) ? file : null;
}
function isMainPage(value) {
  if (!isAppURL(value)) return false;
  const pathname = new URL(value).pathname;
  return pathname === "/" || pathname === "/index.html";
}
function externalURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
function contentType(file) { return MIME[path.extname(file)] || "text/plain; charset=utf-8"; }
function webPreferences() {
  return { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false };
}
module.exports = { ORIGIN, assetPath, isAppURL, isMainPage, externalURL, contentType, webPreferences };
