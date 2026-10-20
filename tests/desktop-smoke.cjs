// Node 22+ black-box test of Electron, without a web server or user-profile data.
// npm run test:desktop:smoke
// DESKTOP_BINARY=release/linux-unpacked/satpass npm run test:desktop:smoke
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), testDir = fs.mkdtempSync(path.join(os.tmpdir(), "satpass-desktop-")), profile = path.join(testDir, "profile");
const binary = process.env.DESKTOP_BINARY ? path.resolve(process.env.DESKTOP_BINARY) : require("electron");
const packaged = !!process.env.DESKTOP_BINARY, shotDir = path.join(os.tmpdir(), "satpass-desktop-shots");
fs.mkdirSync(shotDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let child, ws, nextId = 1, pending = new Map(), errors = [], stderr = "", passed = 0;
function check(name, value) { assert(value, name); passed++; console.log("PASS " + name); }
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("DevTools command timed out: " + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: err => { clearTimeout(timer); reject(err); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "Renderer evaluation failed");
  return r.result.value;
}
async function until(expression, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression).catch(() => false)) return; await sleep(100); }
  throw new Error("Timed out: " + expression + "\n" + stderr.slice(-4000));
}
async function launch() {
  stderr = ""; errors = []; const requests = new Map(); pending = requests;
  const args = [...(packaged ? [] : [root]), "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--ozone-platform=headless", "--headless", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--host-resolver-rules=MAP * ~NOTFOUND"];
  // This flag is limited to the isolated, offline smoke process. The shipped
  // launcher never disables Chromium's sandbox (CI containers need this).
  if (process.platform === "linux") args.push("--no-sandbox");
  const env = { ...process.env, SATPASS_PROFILE_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(binary, args, { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
  let launchError;
  child.on("error", e => { launchError = e; }); child.stderr.on("data", d => { stderr += d; });
  let port;
  for (let i = 0; i < 150; i++) {
    if (launchError) throw launchError;
    const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (match) { port = match[1]; break; }
    if (child.exitCode !== null) throw new Error("Electron exited: " + stderr);
    await sleep(100);
  }
  if (!port) throw new Error("Electron did not expose its test endpoint: " + stderr);
  let target;
  for (let i = 0; i < 100; i++) {
    const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
    target = targets.find(t => t.type === "page" && t.url.startsWith("satpass:"));
    if (target) break; await sleep(100);
  }
  assert(target, "SatPass window did not open: " + stderr);
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = requests.get(m.id); if (p) { requests.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } }
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  ws.addEventListener("close", () => { for (const p of requests.values()) p.reject(new Error("Desktop window closed")); requests.clear(); });
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
  await send("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
  await until("!!window.SatApp && !!document.querySelector('#app')");
}
async function close() {
  if (!child || child.exitCode !== null) return;
  await evaluate("window.close(); true").catch(() => {});
  for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100);
  if (child.exitCode === null) { child.kill(); throw new Error("App did not quit when its window closed"); }
  if (ws) ws.close();
}
(async () => {
  await launch();
  check("creates a new persistent desktop profile on first launch", fs.existsSync(profile));
  check("starts directly from local packaged files", await evaluate("location.origin==='satpass://app' && isSecureContext"));
  check("renderer has no Node or Electron access", await evaluate("typeof require==='undefined' && typeof process==='undefined'"));
  check("isolated location bridge exposes only its specific request", await evaluate("Object.keys(window.satpassDesktop).join()==='requestLocation' && typeof satpassDesktop.requestLocation==='function'"));
  check("Web Crypto is available for encrypted credentials", await evaluate("!!crypto.subtle"));
  check("first offline launch loads bundled satellites", await evaluate("SatStore.data.sats.length>0"));
  check("internal packaging files are inaccessible", await evaluate("Promise.all(['package.json','electron/main.cjs','node_modules/electron/package.json'].map(p=>fetch(p).then(r=>r.status))).then(s=>s.every(n=>n===404))"));
  await evaluate("SatStore.set({lat:30,lon:-97,alt:150,favs:[],theme:'dark'}); location.hash='#/visible'; true");
  await until("SatStore.allLoaded() && document.querySelector('#visibleTabground')");
  check("lazy catalogs load offline", await evaluate("SatStore.allLoaded() && SatStore.data.sats.length>100"));
  await evaluate("document.querySelector('#visibleTabground').click(); true");
  await until("document.querySelector('#visibleGround .ground-message')?.hidden");
  check("3D sky and local ES module imports render offline", await evaluate("document.querySelector('#visibleGround .ground-scene').width>100"));
  await evaluate("document.querySelector('#visibleGroundE').click(); true");
  await until("document.querySelector('.ground-hud').textContent.includes('LOOKING E · 90°')");
  check("3D camera controls work in Electron", true);
  await evaluate("document.querySelector('#visibleGround').scrollIntoView({block:'center'}); true"); await sleep(100);
  fs.writeFileSync(path.join(shotDir, "visible-3d.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await evaluate("location.hash='#/live/25544'; true"); await until("!!document.querySelector('#tabground')");
  await evaluate("document.querySelector('#tabground').click(); true"); await until("document.querySelector('#liveGround .ground-message')?.hidden");
  check("Live Tracker 3D sky works in Electron", true);
  await evaluate("location.hash='#/settings'; true"); await until("document.querySelector('#installBody')?.textContent.includes('desktop app')");
  check("desktop Setup explains packaged updates and storage", await evaluate("document.querySelector('#installBody').textContent.includes('separately from your browser') && !document.querySelector('#aboutInstall')"));
  check("desktop never registers the web service worker", await evaluate("!navigator.serviceWorker.controller && navigator.serviceWorker.getRegistrations().then(r=>r.length===0,()=>true)"));
  check("desktop has no misleading biometric enrollment", await evaluate("SatBio.supported().then(r=>!r.ok)"));
  await send("Page.reload"); await until("!!window.SatStore && !!document.querySelector('#installBody')");
  check("settings survive an offline reload", await evaluate("SatStore.settings.lat===30 && SatStore.settings.lon===-97"));
  check("no renderer exceptions", errors.length === 0);
  await close(); await launch();
  check("settings persist across app restarts", await evaluate("SatStore.settings.lat===30 && SatStore.settings.lon===-97 && SatStore.load('visibleView')==='ground'"));
  await close(); console.log("\n" + passed + " desktop smoke checks passed; screenshots: " + shotDir);
})().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => {
  if (ws) ws.close(); if (child && child.exitCode === null) child.kill();
  fs.rmSync(testDir, { recursive: true, force: true });
});
