const { app, BrowserWindow, Menu, dialog, protocol, session, shell, ipcMain } = require("electron");
const { readFile } = require("node:fs/promises");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const P = require("./policy.cjs");
const { requestLocation } = require("./location.cjs");

// Standard/secure gives relative URLs, ES modules, localStorage and Web Crypto
// a stable local origin. Service workers are deliberately not enabled: desktop
// assets always come from the installed package, including on the first launch.
protocol.registerSchemesAsPrivileged([{ scheme: "satpass", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName("SatPass");
app.setAppUserModelId("io.github.guardst7.satpass");
const profile = process.env.SATPASS_PROFILE_DIR || path.join(app.getPath("appData"), "SatPass");
mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.setPath("sessionData", profile);
let mainWindow, locationRequest, locationController;

function openExternal(url) {
  const safe = P.externalURL(url);
  if (safe) shell.openExternal(safe).catch(err => console.warn("Could not open link:", err.message));
}
function openDocument(url, parent = mainWindow) {
  const viewer = new BrowserWindow({ parent, width: 760, height: 640, title: "SatPass licenses", webPreferences: P.webPreferences() });
  viewer.removeMenu(); protectWindow(viewer, true); viewer.loadURL(url);
}
function protectWindow(win, documents = false) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (!documents && P.assetPath(url, app.getAppPath()) && !P.isMainPage(url)) {
      openDocument(url, win);
    } else openExternal(url);
    return { action: "deny" };
  });
  function navigation(event, url) {
    url = event.url || url;
    const allowed = documents ? P.assetPath(url, app.getAppPath()) : P.isMainPage(url);
    if (!allowed) { event.preventDefault(); openExternal(url); }
  }
  wc.on("will-navigate", navigation);
  wc.on("will-redirect", navigation);
  wc.on("will-attach-webview", event => event.preventDefault());
}
async function configureSession() {
  const ses = session.defaultSession, root = app.getAppPath();
  const html = await readFile(path.join(root, "index.html"), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1] + "; frame-ancestors 'none'";
  protocol.handle("satpass", async request => {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const file = P.assetPath(request.url, root);
    if (!file) return new Response("Not found", { status: 404 });
    try {
      const data = await readFile(file);
      return new Response(request.method === "HEAD" ? null : data, { headers: {
        "Content-Type": P.contentType(file), "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"
      } });
    } catch { return new Response("Not found", { status: 404 }); }
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (!wc || wc.isDestroyed() || !P.isMainPage(wc.getURL()) || !P.isAppURL(origin)) return false;
    // Geolocation uses the default browser, whose location provider is already
    // configured. Electron's network provider requires a separate billable key.
    return ["notifications", "clipboard-sanitized-write"].includes(permission);
  });
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!wc || wc.isDestroyed() || !P.isMainPage(wc.getURL()) || !details.isMainFrame || !P.isAppURL(details.requestingUrl)) return callback(false);
    if (["notifications", "clipboard-sanitized-write"].includes(permission)) return callback(true);
    callback(false);
  });
  ses.on("will-download", (event, item, wc) => {
    if (!wc || !P.isMainPage(wc.getURL())) { event.preventDefault(); return; }
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), path.basename(item.getFilename())) });
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120, height: 850, minWidth: 360, minHeight: 540, show: false,
    backgroundColor: "#0b1220", icon: path.join(app.getAppPath(), "icons/icon-512.png"),
    webPreferences: { ...P.webPreferences(), preload: path.join(app.getAppPath(), "electron/preload.cjs") }
  });
  mainWindow.removeMenu();
  protectWindow(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { locationController?.abort(); mainWindow = null; app.quit(); });
  mainWindow.loadURL(P.ORIGIN + "/index.html");
  return mainWindow;
}
async function start() {
  // Test processes use their own temporary profile and can run alongside SatPass.
  if (!process.env.SATPASS_PROFILE_DIR && !app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  await app.whenReady(); await configureSession();
  ipcMain.handle("satpass:request-location", async event => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame || !P.isMainPage(event.senderFrame.url)) return { ok: false, code: 1, message: "Location request is not allowed here." };
    if (locationRequest) return locationRequest;
    locationController = new AbortController();
    locationRequest = requestLocation({ openExternal: url => shell.openExternal(url), signal: locationController.signal });
    try {
      const result = await locationRequest;
      if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
      return result;
    } finally { locationRequest = null; locationController = null; }
  });
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}
app.on("window-all-closed", () => app.quit());
start().catch(err => { console.error(err); dialog.showErrorBox("SatPass could not start", err.message); app.quit(); });
