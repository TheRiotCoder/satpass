const { ok, done } = require("./harness");
const path = require("node:path"), fs = require("node:fs"), P = require("../electron/policy.cjs");
const root = path.resolve(__dirname, ".."), config = require("../package.json");
ok("desktop uses the same release version as the web app", fs.readFileSync(path.join(root, "js/app.js"), "utf8").includes('APP_VERSION = "' + config.version + '"'));
for (const file of ["index.html", "js/app.js", "js/vendor/three.module.min.js", "data/snap/nav.js", "css/style.css", "icons/icon-512.png", "LICENSE"]) {
  ok("local app protocol serves bundled " + file, P.assetPath("satpass://app/" + file, root) === path.join(root, file));
}
ok("root URL resolves to the app entry point", P.assetPath("satpass://app/", root) === path.join(root, "index.html"));
for (const value of [
  "https://app/js/app.js", "satpass://elsewhere/index.html", "satpass://app:123/index.html",
  "satpass://user:pass@app/index.html", "satpass://app/package.json", "satpass://app/.git/config",
  "satpass://app/electron/main.cjs", "satpass://app/node_modules/electron/package.json",
  "satpass://app/js/..%2f..%2fpackage.json", "satpass://app/js/%2e%2e%5cpackage.json",
  "satpass://app/js/%00app.js", "satpass://app/js/%ZZ", "not a URL"
]) ok("local app protocol refuses " + value, P.assetPath(value, root) === null);
ok("hash navigation stays in the app", P.isMainPage("satpass://app/index.html#/visible") && P.isMainPage("satpass://app/#/settings"));
ok("scripts/documents cannot replace the main page", !P.isMainPage("satpass://app/js/app.js") && !P.isMainPage("https://example.com"));
ok("external links accept HTTPS", P.externalURL("https://github.com/guardst7/satpass") === "https://github.com/guardst7/satpass");
ok("external links refuse file, javascript, HTTP and embedded credentials", ["file:///etc/passwd", "javascript:alert(1)", "http://example.com", "https://user:pass@example.com"].every(u => P.externalURL(u) === null));
ok("ES modules and snapshot scripts have a JavaScript MIME type", P.contentType("three.module.min.js").startsWith("text/javascript"));
const prefs = P.webPreferences();
ok("renderer is sandboxed and isolated with Node disabled", prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration && prefs.webSecurity && !prefs.webviewTag);
ok("packages include app assets and vendor licenses", ["index.html", "js/**/*", "data/**/*", "icons/**/*", "LICENSE"].every(f => config.build.files.includes(f)));
ok("packages omit tests, credentials, build tools and the web service worker", !config.build.files.some(f => /^(tests|proxy|tools|\.git|node_modules|sw\.js)/.test(f)));
ok("Linux has AppImage and Debian targets", ["AppImage", "deb"].every(t => config.build.linux.target.includes(t)));
ok("Windows has an NSIS installer and keeps settings on uninstall", config.build.win.target.includes("nsis") && config.build.nsis.deleteAppDataOnUninstall === false);
ok("distribution commands do not publish automatically", ["dist:linux", "dist:win"].every(s => config.scripts[s].includes("--publish never")));
done();
