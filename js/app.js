/* SatPass UI. Plain vanilla JS, hash-routed. Pure computation lives in the other modules (grid, doppler, passes, tle, ics, radio, format). */
(function () {
  "use strict";
  var S = window.SatStore, P = window.SatPasses, G = window.SatGrid, D = window.SatDoppler, F = window.SatFmt, Tle = window.SatTle, R = window.SatRadio, I = window.SatIcs, Dr = window.SatDraw, Sar = window.SatSar, Cat = window.SatCatalog, Src = window.SatSources;
  var DAY = 86400000, APP_VERSION = "1.5.2";
  var main, titleEl;

  /* ---------- tiny helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(msg, ms) {
    var t = $("#toast"); t.textContent = msg; t.hidden = false; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); t.hidden = true; }, ms || 2600);
  }
  /* 1.3.4: SatPass now lives on its own origin (biometric unlock needs one). The GitHub Pages copy keeps working offline and keeps its data - no redirect - and shows this notice. */
  var HOME_URL = "https://satpass-3wj.pages.dev/";
  function movedBar() {
    var bar = $("#moved-bar"); if (!bar || !Src.sharedOrigin(location.hostname) || S.load("movedHide", false)) return;
    bar.innerHTML = '📦 <span>SatPass has a new home: <a href="' + HOME_URL + '" rel="noopener">' + esc(HOME_URL.replace(/^https:\/\//, "").replace(/\/$/, "")) + '</a> (its own address, so biometric unlock works there). This copy keeps working, also offline. Saved logins and favourites do not move automatically: use <a href="#/settings">Setup → Encrypted backup</a> here, then import it there.</span> <button class="btn sm" id="movedHide" type="button">Hide</button>';
    bar.hidden = false; $("#movedHide").onclick = function () { S.save("movedHide", true); bar.hidden = true; };
  }
  function isDesktop() { return location.protocol === "satpass:"; }
  function isStandalone() { return isDesktop() || window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function utc() { return !!S.settings.utc; }
  function clk(ms, sec) { return F.clock(ms, utc(), sec); }
  function nextFrame() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function fmt(n, d) { return Number(n).toFixed(d === undefined ? 1 : d); }
  function az(a) { return Math.round(a) + "° " + F.compass(a); }

  /* ---------- satellites / observer ---------- */
  var satCache = {};
  function entry(n) { return S.data.byId[n] || null; }
  function satObj(n) {
    var e = entry(n); if (!e) return null;
    var c = satCache[n]; if (c && c.l1 === e.l1 && c.l2 === e.l2) return c.sat;
    try { var s = P.makeSat(e); satCache[n] = { l1: e.l1, l2: e.l2, sat: s }; return s; } catch (err) { console.warn(err.message); satCache[n] = { l1: e.l1, l2: e.l2, sat: null }; return null; }
  }
  function nameOf(n) { var c = R.curated(n), e = entry(n); return c ? c.short : (e ? e.name : "NORAD " + n); }
  /* Satellites that no longer transmit (decommissioned / re-entered), see radio.js STATUS */
  function deadBanner(n) { var st = R.status(n); return st ? '<div class="banner warn">🚫 <b>No signal.</b> ' + esc(st.text) + " Predicted passes below are geometric only – there is nothing to hear." + "</div>" : ""; }
  function longName(n) { var c = R.curated(n), e = entry(n); return c ? c.label : (e ? e.name : "NORAD " + n); }
  function observer() {
    var k = S.settings.lat + "|" + S.settings.lon + "|" + S.settings.alt;
    if (!observer._o || observer._k !== k) { observer._o = P.makeObserver(S.settings.lat, S.settings.lon, S.settings.alt || 0); observer._k = k; }
    return observer._o;
  }
  function obsLabel() { return G.toGrid(S.settings.lat, S.settings.lon, 6) + " (" + fmt(S.settings.lat, 3) + ", " + fmt(S.settings.lon, 3) + ")"; }

  /* ---------- pass cache ---------- */
  var passCache = {};
  function passKey(n) { return [S.settings.lat, S.settings.lon, S.settings.alt, S.settings.minEl, entry(n).l1, entry(n).l2].join("|"); }
  function passesCurrent(n, days) {
    var c = passCache[n], now = Date.now();
    return !!(c && c.key === passKey(n) && c.end >= now + days * DAY - 3 * 3600e3 && now - c.at < 6 * 3600e3);
  }
  function computePasses(n, days) {  // synchronous (≈ tens of ms per satellite)
    var e = entry(n); if (!e) return [];
    if (passesCurrent(n, days)) return passCache[n].passes;
    var sat = satObj(n), now = Date.now(), end = now + Math.max(days, 2) * DAY, list = [];
    if (sat) { try { list = P.findPasses(sat, observer(), now, end, { minEl: S.settings.minEl }); } catch (err) { console.warn(err.message); } }
    var bright = !!(R.curated(n) && R.curated(n).bright);   // only large objects (ISS, Tiangong) are realistically naked-eye visible
    list.forEach(function (p) { p.bright = bright; p.naked = bright && p.visible; });
    passCache[n] = { key: passKey(n), at: now, end: end, passes: list };
    return list;
  }
  function passesFor(n, days) {
    var now = Date.now(), lim = now + days * DAY;
    return (passCache[n] ? passCache[n].passes : []).filter(function (p) { return p.los > now && p.aos <= lim; });
  }
  S.onChange(function () { satCache = {}; });
  var lastFailToast = 0;
  S.onSaveFail(function (f) {   // storage quota / blocked: tell the user once a minute instead of failing silently
    var now = Date.now(); if (now - lastFailToast < 60e3) return; lastFailToast = now;
    toast("⚠ Couldn't save to this browser (" + (f && f.quota ? "storage is full" : "storage blocked") + "; " + (f && f.key || "data") + "). Recent changes may be lost when you close the app.", 7000);
  });

  /* ---------- views infrastructure ---------- */
  var view = { token: 0, timers: [], tick: null, resize: null, dispose: null, observer: null, frame: null };
  function clearView() {
    view.token++; view.timers.forEach(clearInterval); view.timers = [];
    if (view.frame !== null) cancelAnimationFrame(view.frame); view.frame = null;
    if (view.observer) view.observer.disconnect(); view.observer = null;
    if (view.dispose) view.dispose(); view.dispose = null; view.tick = null; view.resize = null;
  }
  // Timers are bound to the view that created them: a callback that fires after its view was replaced is ignored.
  function every(ms, fn) { var tok = view.token; view.timers.push(setInterval(function () { if (tok === view.token) fn(); }, ms)); }
  function setTitle(t) { titleEl.textContent = t; document.title = t === "SatPass" ? "SatPass – Satellite & ISS Pass Predictor" : t + " – SatPass"; }
  function panelWidth(el) { return Math.max(1, el ? el.clientWidth : 1); }
  function queueResize() {
    if (view.frame !== null) return;
    var token = view.token;
    view.frame = requestAnimationFrame(function () { view.frame = null; if (token === view.token && view.resize) view.resize(); });
  }
  function watchSize(el) {
    if (!el || typeof ResizeObserver === "undefined") return function () {};
    if (!view.observer) {
      var widths = new WeakMap();
      view.observer = new ResizeObserver(function (entries) {
        var changed = false;
        entries.forEach(function (e) { var w = e.contentRect.width; if (widths.get(e.target) !== w) { widths.set(e.target, w); changed = true; } });
        if (changed) queueResize();
      });
    }
    var observer = view.observer; observer.observe(el);
    return function () { observer.unobserve(el); };
  }
  function pageLayout(name) { main.className = "page page-" + name; }
  function accessibleTables(host) {
    $$(".tblwrap", host).forEach(function (el) {
      el.tabIndex = 0; el.setAttribute("role", "region");
      var section = el.closest("section"), heading = section && section.querySelector("h2,summary");
      el.setAttribute("aria-label", (heading ? heading.textContent : "Data") + " table, scroll for more");
    });
  }

  // a malformed percent escape in the URL hash (e.g. #/%E0%A4%A) used to throw URIError here and abort boot (the service worker was never registered)
  function safeDecode(x) { try { return decodeURIComponent(x); } catch (e) { return ""; } }
  var ROUTES = {};
  // Re-render the current view in place (e.g. after a select changed). Must go through here, never invoke a view function directly:
  // that would leave the previous render's 1 s / 30 s timers running and they would keep overwriting the new DOM with stale state.
  function rerender(name, a) { clearView(); pageLayout(name); ROUTES[name](a); watchSize(main); accessibleTables(main); }
  function route() {
    clearView();
    var h = (location.hash || "#/").replace(/^#\/?/, ""), parts = h.split("?")[0].split("/").map(safeDecode), name = parts[0] || "passes";
    var fn = ROUTES[name] || ROUTES.passes;
    // deep link / favourite to a satellite that lives in a lazily loaded category snapshot: load them first, then render
    var wanted = parts.slice(1).map(Number).filter(function (x) { return x > 1000 && x < 400000; });
    if (!S.allLoaded() && wanted.some(function (x) { return !entry(x); })) {
      main.innerHTML = '<div class="banner">Loading satellite data…</div>'; var tk = view.token;
      S.ensureAll().then(function () { if (tk === view.token) route(); }); return;
    }
    $$("#tabs a").forEach(function (a) { var active = a.dataset.tab === (name === "pass" ? "passes" : ROUTES[name] ? name : "passes"); a.classList.toggle("on", active); if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    window.scrollTo(0, 0);
    pageLayout(ROUTES[name] ? name : "passes");
    try { fn(parts.slice(1)); watchSize(main); accessibleTables(main); } catch (e) { console.error(e); main.innerHTML = '<div class="err">Something went wrong: ' + esc(e.message) + "</div>"; }
  }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }

  /* ---------- location card (shared by Passes-empty-state and Setup) ---------- */
  /* ---------- Setup → Data sources ---------- */
  function dataSourcesCard() {
    var el = document.createElement("section"); el.className = "card"; el.id = "srcCard";
    var SS = S.sources, META = SS.META;
    // Credential inputs are real form fields (name + autocomplete) so iCloud Keychain / Google / 1Password / Bitwarden can save and fill them.
    // type "text" = a user name (autocomplete=username); everything else is type=password with autocomplete=current-password (never "off").
    function pwField(id, label, key, ph, type, name) {
      var dis = SS.isLocked() ? " disabled" : "", user = type === "text";
      return '<div class="field"><label for="' + id + '">' + label + '</label><div class="pwrow"><input class="inp" id="' + id + '" name="' + (name || (user ? "username" : "password")) + '"' + dis + ' type="' + (user ? "text" : "password") + '" autocomplete="' + (user ? "username" : "current-password") + '" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="' + ph + '" value="' + esc(SS.getCreds()[key] || "") + '" data-key="' + key + '">' +
        (user ? "" : '<button type="button" class="btn sm showpw" data-for="' + id + '" aria-pressed="false"' + dis + ">Show</button>") + "</div></div>";
    }
    // a visually-hidden (not display:none: managers ignore those) account label so a manager can file an API token under "<service> (SatPass)"
    function acct(label) { return '<input class="sr-only" type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" value="' + esc(label) + '">'; }
    function mins(opts, v) { return opts.map(function (o) { return '<option value="' + o + '"' + (o === v ? " selected" : "") + ">" + (o ? o + " min" : "Never") + "</option>"; }).join(""); }
    function when(t) { return new Date(t).toLocaleString() + " (" + F.age(Date.now() - t) + " ago)"; }
    function statusText(id) {
      var cfg = SS.config(), st = SS.status(id), rd = SS.readiness(id), out = [];
      if (!cfg.enabled[id]) out.push("Disabled – skipped.");
      else if (!rd.ready) out.push("Not set up: " + rd.reason + ".");
      if (st.lastOk) out.push("Last success: " + when(st.lastOk) + (st.lastNote ? " – " + st.lastNote : "") + ".");
      if (st.lastError) out.push("Last problem: " + st.lastError + " (" + new Date(st.lastAttempt).toLocaleTimeString() + ").");
      if (st.blocked) out.push("Automatic use is paused because the credentials were rejected – change them (or press Test connection) to retry.");
      else if (SS.inBackoff(id)) out.push("Backing off until " + new Date(st.backoffUntil).toLocaleTimeString() + ".");
      if (!st.lastOk && !st.lastError && cfg.enabled[id] && rd.ready) out.push("Not used yet.");
      if (id === "n2yo" && st.quota) out.push("N2YO reports " + st.quota.transactions + " API transactions in the last 60 min (" + new Date(st.quota.at).toLocaleTimeString() + ").");
      if (id === "spacetrack") out.push("This browser has made " + SS.usage("spacetrack").used + " Space-Track requests in the last hour.");
      return out.join(" ");
    }
    function render() {
      var cfg = SS.config(), locked = SS.isLocked(), txi = S.txInfo(), vc = SS.vaultCfg();
      var rows = cfg.order.map(function (id, i) {
        var m = META[id], fields = "";
        if (id === "spacetrack") fields = '<div class="banner good" id="stBest">🛡 <b>Best option for Space-Track: the proxy access token</b> (section 1 above). Put your Space-Track login in the Worker\'s secrets and your password never enters this browser at all (<a class="link" href="https://github.com/TheRiotCoder/satpass/tree/main/proxy" target="_blank" rel="noopener">proxy/README</a>).</div>' +
          '<div class="banner warn" id="stWarn">🔑 <b>Your Space-Track password is sensitive.</b> If you enter it here anyway: save it in your password manager. SatPass does not save it to local storage in plaintext – without a passphrase it is kept for this browser tab only (gone when you close it; a browser\'s session-restore may keep tab data), with a passphrase it is stored AES-GCM encrypted. This page shares its origin with every other project on the same GitHub account, so a script there could read anything stored in the clear.</div>' +
          pwField("stId", "Space-Track user name (your account e-mail)", "stIdentity", "you@example.com", "text") + pwField("stPw", "Space-Track password", "stPassword", "password", "password", "password");
        if (id === "satnogs") fields = acct("SatNOGS API token (SatPass)") + pwField("snToken", "SatNOGS API token", "satnogsToken", "40 hex characters, from your db.satnogs.org profile", "password", "satnogs-token");
        if (id === "n2yo") fields = acct("N2YO API key (SatPass)") + pwField("n2Key", "N2YO API key", "n2yoKey", "from your n2yo.com profile", "password", "n2yo-key");
        return '<div class="srcrow" data-id="' + id + '"><div class="srchead"><b>' + (i + 1) + ". " + esc(m.label) + "</b>" + (m.untested ? ' <span class="tag warn" title="' + esc(m.untested) + '">untested live</span>' : "") +
          '<label class="sw"><input type="checkbox" class="srcEn" data-id="' + id + '"' + (cfg.enabled[id] ? " checked" : "") + "> use</label>" +
          '<span class="grow"></span><button type="button" class="btn sm srcUp" data-id="' + id + '" aria-label="Move ' + esc(m.label) + ' up"' + (i === 0 ? " disabled" : "") + '>↑</button><button type="button" class="btn sm srcDn" data-id="' + id + '" aria-label="Move ' + esc(m.label) + ' down"' + (i === cfg.order.length - 1 ? " disabled" : "") + ">↓</button></div>" +
          (m.untested ? '<div class="note">⚠ ' + esc(m.untested) + "</div>" : "") +
          '<div class="note srcStatus" data-id="' + id + '">' + esc(statusText(id)) + "</div>" +
          '<form class="credForm" method="post" action="#" autocomplete="on" data-id="' + id + '">' + fields +
          '<div class="actions"><button type="submit" class="btn sm srcTest" data-id="' + id + '"' + (locked ? ' disabled title="Unlock your credentials first"' : "") + '>Test connection</button></div></form><div class="note srcTestMsg" data-id="' + id + '" aria-live="polite"></div>' +
          '<details class="more"><summary>About ' + esc(m.label) + '</summary><p class="note">' + esc(m.limits) + '. <a class="link" href="' + esc(m.docs || m.site) + '" target="_blank" rel="noopener">Documentation</a></p></details></div>';
      }).join("");
      el.innerHTML = "<h2>Data sources</h2>" +
        '<p class="note">Element sets (TLE/GP) come from the first enabled source that answers. If a source fails (network, blocked, 403/429) SatPass tells you and tries the next one. CelesTrak is the default and needs nothing. <b>If you can\'t get any source working, you can always import a TLE/OMM file or paste TLEs on the Sats tab.</b></p>' +
        '<h3>1 · Recommended: your own proxy with Worker secrets</h3>' +
        '<div class="banner good" id="proxyBest">🛡 <b>Most secure route for Space-Track, SatNOGS and N2YO.</b> Deploy the small proxy to your own free Cloudflare account and store your service logins as <i>Worker secrets</i> there. Then SatPass only needs the proxy URL and a <b>proxy access token</b> – your Space-Track password never enters this browser. See <a class="link" href="https://github.com/TheRiotCoder/satpass/tree/main/proxy" target="_blank" rel="noopener">proxy/README</a>. Browsers cannot read these three services directly (they send no CORS headers), so a proxy is needed in any case; whoever runs it can see what you send, so use your own.</div>' +
        '<form class="credForm" id="proxyForm" method="post" action="#" autocomplete="on">' + acct("SatPass proxy access token") +
        '<div class="field"><label for="srcProxy">Proxy URL (your Cloudflare Worker, https only)</label><input class="inp" id="srcProxy" name="proxy-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://satpass-proxy.yourname.workers.dev" value="' + esc(cfg.proxy) + '"></div><div class="note" id="srcProxyMsg"></div>' +
        pwField("srcProxyToken", "Proxy access token", "proxyToken", "from your Worker setup", "password", "proxy-token") +
        '<div class="actions"><button type="submit" class="btn sm" id="proxySave">Save proxy settings</button></div><div class="note" id="proxyMsg" aria-live="polite"></div></form>' +
        '<h3>2 · Sources, and (optional) logins typed into this browser</h3>' +
        '<p class="note">Prefer the proxy above. If you do type a login or token here: <b>save it in your password manager</b> (iCloud Passwords / Keychain, Google Password Manager, 1Password, Bitwarden – these are standard login fields, so they can save and fill them), and SatPass can additionally keep an <b>encrypted copy on this device</b> (section 3).</p>' +
        rows +
        '<h3>3 · Credentials on this device</h3>' +
        '<p class="note" id="credHelp"><b>Save in your password manager; SatPass can store an encrypted copy on this device</b> (passphrase-encrypted, optionally unlocked with Face ID / fingerprint). Credentials are never put in a URL.</p>' +
        '<p class="note" id="credNote"></p><div id="legacyBox"></div>' +
        '<form class="credForm" id="passForm" method="post" action="#" autocomplete="on">' + acct("SatPass vault passphrase") +
        '<div class="field"><label for="passIn">Passphrase – <b>required to keep credentials across sessions</b> (AES-GCM, PBKDF2 600k)</label><div class="pwrow"><input class="inp" id="passIn" name="vault-passphrase" type="password" autocomplete="' + (locked ? "current-password" : "new-password") + '" autocapitalize="off" spellcheck="false" placeholder="' + 'at least ' + SS.minPassphrase + ' characters' + '"><button type="button" class="btn sm showpw" data-for="passIn" aria-pressed="false">Show</button></div></div>' +
        '<div class="actions"><button type="submit" class="btn sm" id="passLock">' + (locked ? "Unlock" : "Encrypt &amp; keep with passphrase") + '</button><span id="bioUnlockSlot"></span>' + (SS.hasPassphrase() && !locked ? '<button type="button" class="btn sm" id="passRemove">Remove passphrase</button><button type="button" class="btn sm" id="lockNow">Lock now</button>' : "") + '<button type="button" class="btn sm danger" id="forgetCreds">Forget credentials</button></div></form><div class="note" id="passMsg" aria-live="polite"></div>' +
        '<div id="bioBox"></div>' +
        '<details class="more" id="lockBox"' + (SS.credMode() === "encrypted" || locked ? " open" : "") + '><summary>Auto-lock</summary>' +
        '<p class="note">An encrypted vault locks itself and forgets the decrypted credentials (and the passphrase) held in memory. While locked, fields are disabled and automatic refreshes skip the services that need a login. Credentials kept for this tab only (no passphrase) cannot be locked – they would be lost – so they simply disappear when the tab closes.</p>' +
        '<div class="field"><label for="lockIdle">Lock after no activity for</label><select class="inp" id="lockIdle">' + mins([0, 1, 5, 15, 30, 60], vc.idleMin) + '</select></div>' +
        '<div class="field"><label for="lockHidden">Lock when SatPass is hidden or in the background for</label><select class="inp" id="lockHidden">' + mins([0, 1, 5, 15, 30], vc.hiddenMin) + '</select></div></details>' +
        '<details class="more" id="backupBox"><summary>Encrypted backup (move credentials to another device)</summary>' +
        '<p class="note">The file is encrypted with its own passphrase (≥ ' + SS.minPassphrase + ' characters, PBKDF2 600k → AES-GCM); it contains no plaintext. It also carries your proxy URL. Keep it somewhere you trust and the passphrase in your password manager.</p>' +
        '<form class="credForm" id="bkExportForm" method="post" action="#" autocomplete="on">' + acct("SatPass credentials backup") +
        '<div class="field"><label for="bkPass">Backup passphrase</label><input class="inp" id="bkPass" name="backup-passphrase" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="at least ' + SS.minPassphrase + ' characters"' + (locked ? " disabled" : "") + '></div>' +
        '<div class="actions"><button type="submit" class="btn sm" id="bkExport"' + (locked ? ' disabled title="Unlock first"' : "") + '>Export encrypted backup</button></div></form>' +
        '<form class="credForm" id="bkImportForm" method="post" action="#" autocomplete="on">' + acct("SatPass credentials backup (import)") +
        '<div class="field"><label for="bkFile">Backup file</label><input class="inp" id="bkFile" name="backup-file" type="file" accept=".json,.satpass-creds,application/json"' + (locked ? " disabled" : "") + '></div>' +
        '<div class="field"><label for="bkPass2">Backup passphrase</label><input class="inp" id="bkPass2" name="backup-passphrase-import" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false"' + (locked ? " disabled" : "") + '></div>' +
        '<div class="actions"><button type="submit" class="btn sm" id="bkImport"' + (locked ? ' disabled title="Unlock first"' : "") + '>Import backup</button></div></form><div class="note" id="bkMsg" aria-live="polite"></div></details>' +
        '<h3>SatNOGS live transmitters (optional)</h3>' +
        '<p class="note">Adds SatNOGS DB transmitters (active, alive only) to the Doppler tab <i>below</i> the bundled table. The bundled nominal frequencies stay the default and are never overwritten.' + (txi ? " Currently stored: " + txi.satellites + " satellites, fetched " + when(txi.fetchedAt) + "." : "") + '</p>' +
        '<div class="actions"><button type="button" class="btn sm" id="txFetch">Fetch live transmitters from SatNOGS</button>' + (txi ? '<button type="button" class="btn sm" id="txClear">Remove live transmitters</button>' : "") + '</div><div class="note" id="txMsg" aria-live="polite"></div><div id="txReport"></div>' +
        '<details class="more" id="srcPrivacy"><summary>Privacy &amp; rate limits</summary>' +
        '<p class="note"><b>Privacy.</b> Credentials are <b>not saved to local storage unless encrypted</b>. Without a passphrase they live in this tab (sessionStorage/memory) and disappear when it closes (a browser\'s session-restore feature may still write tab data to disk); with a passphrase they are stored AES-GCM encrypted in this browser\'s localStorage (you re-enter the passphrase each session). This origin is shared with every other project on the same GitHub Pages account, so keeping secrets out of the clear matters; the proxy access-token mode keeps your Space-Track password out of the browser entirely. They are sent only to your own proxy, in request headers (never in URLs, never cached by the service worker, never written to logs or exported .ics files), and the proxy forwards them only to the matching service. SatPass has no server and no analytics. Anyone using this browser tab can read session credentials; a passphrase does not protect against malicious browser extensions or a compromised device. “Forget credentials” deletes them.</p>' +
        '<p class="note"><b>Rate limits.</b> Space-Track: under 30 requests/minute and 300/hour, and the same GP query at most once an hour – SatPass batches NORAD ids, never asks for the same set more than hourly and stops at 25/min. SatNOGS DB: 60/hour anonymous, 240/hour with a token – SatPass allows itself 40/hour. N2YO free key: 1000/hour for TLE, 100/hour for radio/visual passes, 100/hour for “above” – SatPass allows itself 900 and 90. After any failure SatPass waits (30 min, then longer) before trying that source again automatically; wrong credentials stop automatic use altogether so your account is never hammered.</p>' +
        '<p class="note"><b>Terms.</b> Space-Track data is for your own use and may not be redistributed (<a class="link" href="https://www.space-track.org/documentation#/user_agree" target="_blank" rel="noopener">user agreement</a>); SatPass keeps it only in this browser. SatNOGS DB data is CC-BY-SA; N2YO data is subject to the <a class="link" href="https://www.n2yo.com/api/" target="_blank" rel="noopener">N2YO API terms</a>.</p></details>';
      wire();
    }
    function refreshStatus() {
      $$(".srcStatus", el).forEach(function (n) { n.textContent = statusText(n.dataset.id); });
      var locked = SS.isLocked();
      var cm = SS.credMode();
      $("#credNote", el).textContent = locked ? "🔒 Stored credentials are encrypted – enter your passphrase and press Unlock. Fields and Test are disabled until then so nothing can overwrite them." : cm === "encrypted" ? "🔐 Stored credentials are encrypted with your passphrase (unlocked for this session)." : cm === "legacy-plain" ? "⚠ Credentials saved by SatPass 1.2.0 are still stored in plaintext in this browser." : cm === "session" ? "🧠 Kept for this browser tab only (not saved to local storage; a browser's session-restore feature may still keep tab data). They are gone when you close the tab – set a passphrase below to keep them." : cm === "session-lost" ? "ℹ️ Credentials were session-only and need to be re-entered (the tab was closed). Set a passphrase below if you want SatPass to keep them." : "No credentials stored.";
      $("#legacyBox", el).innerHTML = cm === "legacy-plain" ? '<div class="banner warn">⚠️ Version 1.2.0 saved your credentials <b>unencrypted</b> in this browser, where any script from this site\'s origin could read them. Encrypt them with a passphrase below (recommended), or <button type="button" class="btn sm" id="dropPlain">remove the plaintext copy (keep them for this tab only)</button></div>' : "";
      var dp = $("#dropPlain", el); if (dp) dp.onclick = function () { SS.dropPlaintextCopy().then(function () { toast("Plaintext copy removed – credentials now live in this tab only."); render(); }, function (e) { toast(e.message); }); };
      var pm = $("#srcProxyMsg", el), v = Src.validateProxyUrl(SS.config().proxy), px = SS.config().proxy;
      pm.textContent = !px ? "" : !v.ok ? "⚠ " + v.reason : !Src.proxyAllowedByCsp(px) ? "⚠ This page's Content-Security-Policy only allows proxies on https://*.workers.dev. To use another host (or http://localhost for local development) add it to connect-src in index.html – see the README." : "";
    }
    // Biometric unlock (WebAuthn PRF): shown only where the browser can plausibly do it (HTTPS, platform authenticator, real host name).
    function bioWire() {
      var box = $("#bioBox", el), slot = $("#bioUnlockSlot", el), info = SS.bioInfo(), locked = SS.isLocked();
      if (!window.SatBio) return;
      SatBio.supported().then(function (sup) {
        if (!document.body.contains(box)) return;   // (the card may have been re-rendered while we asked)
        if (sup.shared) { box.innerHTML = '<p class="note" id="bioShared">🔒 <b>Biometric unlock is not offered on this address</b> (' + esc(location.hostname) + '). Every app under this host shares the same browser storage and passkeys, so another app could use the biometric key to read the unlock record. To get Face ID / fingerprint unlock, host SatPass on a host used only by SatPass (its own Netlify site, or a custom domain that serves no other app – a GitHub Pages custom domain still shares one origin across all of the account’s projects) – see “Hosting SatPass on its own origin” in the README. Your passphrase works everywhere.</p>'; return; }
        if (!sup.ok && !info) return;
        function msg(t) { var m = $("#passMsg", el); if (m) m.textContent = t; }
        if (locked && info && sup.ok) {
          slot.innerHTML = '<button type="button" class="btn sm primary" id="bioUnlock">🔓 Unlock with biometrics</button>';
          $("#bioUnlock", el).onclick = function () { msg("Waiting for Face ID / fingerprint…"); SS.bioUnlock(function (rec) { return SatBio.assertPrf(rec); }).then(function () { render(); $("#passMsg", el).textContent = "Unlocked."; }, function (e) { msg("✖ " + e.message + " You can still use your passphrase."); }); };
        } else if (!locked && SS.credMode() === "encrypted") {
          if (info) {
            box.innerHTML = '<p class="note" id="bioOn">🔐 <b>Biometric unlock is on</b> for this device (set up ' + esc(new Date(info.created).toLocaleDateString()) + '). Changing the passphrase changes the encryption key and switches this off (turn it on again afterwards). The passphrase still works and is your recovery.</p><div class="actions"><button type="button" class="btn sm" id="bioRemove">Turn off biometric unlock</button></div>';
            $("#bioRemove", el).onclick = function () { var rec = S.load("bio", null); SS.bioRemove(); (window.SatBio ? SatBio.forget(rec) : Promise.resolve()).then(function () { render(); $("#passMsg", el).textContent = "Biometric unlock turned off (you can also delete the “SatPass vault unlock” passkey in your device\'s passkey settings)."; }); };
          } else if (sup.ok) {
            box.innerHTML = '<p class="note" id="bioHelp"><b>Unlock with biometrics (optional).</b> Uses a passkey on this device (Face ID, Touch ID, Android fingerprint, Windows Hello) to open the encrypted copy without typing the passphrase. Needs a browser with the WebAuthn PRF extension (iOS/iPadOS 18+, Android Chrome, desktop Chrome/Edge/Safari). The passphrase always remains the fallback. The passkey is created for this host (“'+esc(location.hostname)+'”), is labelled “SatPass vault unlock (not a login)” and holds no account. <b>Only turn this on if SatPass is the only app served from this host</b> – every app on the same host could use the same passkey and read the unlock record. Changing the passphrase later changes the encryption key and switches this off (you turn it on again).</p><div class="actions"><button type="button" class="btn sm" id="bioEnable">Enable biometric unlock</button></div>';
            $("#bioEnable", el).onclick = function () {
              if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !confirm("Biometric unlock is only safe if SatPass is the ONLY app served from " + location.hostname + " (apps on the same host share storage and passkeys – this includes a GitHub Pages custom domain that also serves your other project sites). Continue?")) return;
              msg("Waiting for Face ID / fingerprint…");
              SatBio.enroll().then(function (r) { return SS.bioSave({ credId: r.credId, prfSalt: r.prfSalt, rpId: r.rpId }, r.prf); }).then(function () { render(); $("#passMsg", el).textContent = "✔ Biometric unlock enabled. Lock now and try it."; }, function (e) { msg("✖ " + e.message); });
            };
          }
        }
      });
    }
    function wire() {
      refreshStatus();
      $$(".showpw", el).forEach(function (b) { b.onclick = function () { var i = document.getElementById(b.dataset.for), show = i.type === "password"; i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-pressed", String(show)); }; });
      $$("input[data-key]", el).forEach(function (i) { i.onchange = function () { var patch = {}; patch[i.dataset.key] = i.value; SS.setCreds(patch).then(function () { refreshStatus(); }, function (e) { toast(e.message); }); }; });
      $("#srcProxy", el).onchange = function () { SS.setConfig({ proxy: this.value }); this.value = SS.config().proxy; refreshStatus(); };
      $$(".srcEn", el).forEach(function (c) { c.onchange = function () { var p = {}; p[c.dataset.id] = c.checked; SS.setConfig({ enabled: p }); refreshStatus(); }; });
      function move(id, d) { var o = SS.config().order.slice(), i = o.indexOf(id), j = i + d; if (j < 0 || j >= o.length) return; o.splice(i, 1); o.splice(j, 0, id); SS.setConfig({ order: o }); render(); var b = $((d < 0 ? ".srcUp" : ".srcDn") + '[data-id="' + id + '"]', el); if (b && !b.disabled) b.focus(); }
      $$(".srcUp", el).forEach(function (b) { b.onclick = function () { move(b.dataset.id, -1); }; });
      $$(".srcDn", el).forEach(function (b) { b.onclick = function () { move(b.dataset.id, 1); }; });
      // "Test connection" is the form's submit button: a real submit event (preventDefault) is what password managers watch to offer saving the login.
      // After a SUCCESSFUL test the card is re-rendered (the old form disappears) which is the other signal managers use; a failed test keeps the form so a wrong password is not offered for saving.
      $$("form.credForm[data-id]", el).forEach(function (f) {
        f.onsubmit = function (ev) {
          ev.preventDefault();
          var b = $(".srcTest", f), id = f.dataset.id, out = $('.srcTestMsg[data-id="' + id + '"]', el);
          if (SS.isLocked()) { out.textContent = "🔒 Unlock your credentials first (nothing was changed)."; return; }
          var patch = {}; $$("input[data-key]", el).forEach(function (i) { patch[i.dataset.key] = i.value; });   // test what is typed
          SS.setConfig({ proxy: $("#srcProxy", el).value });
          b.disabled = true; out.textContent = "Testing…";
          SS.setCreds(patch).then(function () { return SS.test(id); }, function (e) { return { ok: false, message: e.message }; }).then(function (r) {
            var txt = (r.ok ? "✔ " : "✖ ") + r.message, cls = "note srcTestMsg " + (r.ok ? "okmsg" : "badmsg");
            if (r.ok) { render(); out = $('.srcTestMsg[data-id="' + id + '"]', el); } else { b.disabled = false; refreshStatus(); }
            out.textContent = txt; out.className = cls;
          });
        };
      });
      $("#proxyForm", el).onsubmit = function (ev) {
        ev.preventDefault(); var m = $("#proxyMsg", el);
        if (SS.isLocked()) { m.textContent = "🔒 Unlock your credentials first (nothing was changed)."; return; }
        SS.setConfig({ proxy: $("#srcProxy", el).value });
        SS.setCreds({ proxyToken: $("#srcProxyToken", el).value }).then(function () { render(); $("#proxyMsg", el).textContent = "✔ Saved. Use “Test connection” on a source below to check the proxy."; }, function (e) { m.textContent = e.message; });
      };
      $("#passForm", el).onsubmit = function (ev) {
        ev.preventDefault();
        var pw = $("#passIn", el).value, m = $("#passMsg", el);
        (SS.isLocked() ? SS.unlock(pw) : SS.lock(pw)).then(function (r) { var note = r && r.bioRemoved ? " Biometric unlock was switched off because the encryption key changed with the passphrase – turn it on again below (the new passphrase works meanwhile)." : ""; render(); $("#passMsg", el).textContent = (SS.hasPassphrase() ? "Done – credentials are encrypted on this device." : "Done.") + note; $("#passIn", el).value = ""; }, function (e) { m.textContent = e && (e.kind === "config" || e.kind === "storage" || e.kind === "locked") ? e.message : "Wrong passphrase or unreadable data."; });
      };
      var pr = $("#passRemove", el); if (pr) pr.onclick = function () { SS.removePassphrase().then(function () { $("#passMsg", el).textContent = "Passphrase removed – the encrypted copy was deleted; credentials now stay in this tab only (nothing is saved to local storage)."; render(); }); };
      $("#forgetCreds", el).onclick = function () { if (!confirm("Delete all stored Space-Track / SatNOGS / N2YO credentials and the proxy access token from this browser?")) return; SS.forgetCreds(); render(); $("#passMsg", el).textContent = "All credentials were deleted from this device."; };
      var ln = $("#lockNow", el); if (ln) ln.onclick = function () { if (SS.lockNow()) SS.whenIdle().then(function () { if (!SS.isLocked()) return; render(); $("#passMsg", el).textContent = "🔒 Locked – decrypted credentials were cleared from memory."; }); };
      $("#lockIdle", el).onchange = function () { SS.setVaultCfg({ idleMin: this.value }); };
      $("#lockHidden", el).onchange = function () { SS.setVaultCfg({ hiddenMin: this.value }); };
      bioWire();
      $("#bkExportForm", el).onsubmit = function (ev) {
        ev.preventDefault(); var m = $("#bkMsg", el), pw = $("#bkPass", el).value;
        SS.exportBackup(pw).then(function (text) {
          var blob = new Blob([text], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a");
          a.href = url; a.download = "satpass-credentials-" + new Date().toISOString().slice(0, 10) + ".satpass-creds.json"; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          $("#bkPass", el).value = ""; m.textContent = "✔ Backup file created (encrypted). Keep the passphrase safe – it cannot be recovered.";
        }, function (e) { m.textContent = "✖ " + e.message; });
      };
      $("#bkImportForm", el).onsubmit = function (ev) {
        ev.preventDefault(); var m = $("#bkMsg", el), f = $("#bkFile", el).files && $("#bkFile", el).files[0], pw = $("#bkPass2", el).value;
        if (!f) { m.textContent = "✖ Choose a backup file first."; return; }
        if (f.size > 100000) { m.textContent = "✖ That file is too large to be a SatPass backup."; return; }
        function sure(i) {   // a crafted backup could overwrite credentials or repoint the proxy: always ask first, and name the proxy host
          var lines = ["Import this backup?"];
          if (i.overwrites.length) lines.push("• It replaces " + i.overwrites.length + " credential value(s) you already have.");
          if (i.proxyChanged) lines.push("• It sets the proxy URL to " + i.proxyHost + (i.currentProxy ? " (now: " + i.currentProxy.replace(/^https?:\/\//, "") + ")" : " (none set now)") + ". Your logins and tokens will be sent to that host – only continue if it is YOUR proxy.");
          return confirm(lines.join("\n"));
        }
        f.text().then(function (text) { return SS.importBackup(text, pw, sure); }).then(function (r) {
          render(); $("#bkMsg", el).textContent = "✔ Imported " + r.imported + " credential value(s)" + (r.proxy ? " and the proxy URL" : "") + (SS.hasPassphrase() ? " (stored encrypted on this device)." : " (kept for this tab only – set a passphrase in section 3 to keep them).");
        }, function (e) { m.textContent = "✖ " + e.message; });
      };
      $("#txFetch", el).onclick = function () {
        var b = this, m = $("#txMsg", el); m.textContent = "Fetching…"; b.disabled = true;
        S.fetchTransmitters().then(function (r) {
          m.textContent = (r.ok ? "✔ " : "✖ ") + r.message; b.disabled = false; refreshStatus();
          if (r.ok) { var cmp = S.txCompare(), rows = []; Object.keys(cmp).forEach(function (k) { cmp[k].forEach(function (c) { rows.push('<tr><td>' + esc(nameOf(Number(k))) + " – " + esc(c.label) + "</td><td>" + (c.matched ? "✔ matches" : "⚠ no live match") + "</td><td>" + (c.nearestDeltaHz == null ? "–" : fmt(c.nearestDeltaHz / 1000, 1) + " kHz") + "</td></tr>"); }); });
            $("#txReport", el).innerHTML = '<div class="tblwrap"><table><thead><tr><th>Bundled entry</th><th>vs SatNOGS</th><th>Nearest Δ</th></tr></thead><tbody>' + rows.join("") + '</tbody></table></div><p class="note">The bundled nominal values are still the default. Live entries appear as separate choices on each Doppler tab.</p>'; }
        });
      };
      var tc = $("#txClear", el); if (tc) tc.onclick = function () { S.clearLiveTx(); render(); };
    }
    el.rerender = render;
    var lastLocked = SS.isLocked();   // the vault locking (auto-lock, Lock now, another code path) must always clear the decrypted values out of the fields
    S.onChange(function () { if (!document.body.contains(el)) return; if (SS.isLocked() !== lastLocked) { lastLocked = SS.isLocked(); render(); } });
    render();
    return el;
  }

  /* ---------- Pass detail: compare with N2YO ---------- */
  function n2yoCompareUi(n, pass, sat, host) {
    function q(sel) { return $(sel, host); }
    var box = q("#n2box"); if (!box) return;
    var cfg = S.sources.config(), rd = S.sources.readiness("n2yo");
    if (!cfg.enabled.n2yo || !rd.ready) { box.innerHTML = '<p class="note">Optional: compare this pass with N2YO – set it up in <a class="link" href="#/settings">Setup → Data sources</a>.</p>'; return; }
    box.innerHTML = '<div class="actions"><button class="btn" id="n2cmp" type="button">Compare with N2YO</button></div><div class="note" id="n2msg" aria-live="polite"></div><div id="n2out"></div>';
    q("#n2cmp").onclick = function () {
      var b = this, msg = q("#n2msg"), out = q("#n2out"), now = Date.now();
      if (pass.los < now) { msg.textContent = "N2YO only predicts upcoming passes; this one is over."; return; }
      var days = Math.min(10, Math.max(1, Math.ceil((pass.los - now) / DAY))), o = observer();
      b.disabled = true; msg.textContent = "Asking N2YO (one radiopasses request; free tier is 100/hour)…"; out.innerHTML = "";
      S.n2yoPasses(n, { lat: S.settings.lat, lon: S.settings.lon, alt: S.settings.alt || 0 }, { days: days, minEl: 0 }).then(function (r) {
        b.disabled = false;
        if (!r.ok) { msg.textContent = "✖ " + r.message; return; }
        var ours = P.findPasses(sat, o, now, now + days * DAY, { minEl: 0 }).filter(function (p) { return p.maxEl >= (S.settings.minEl || 0); });
        var m = Src.matchPasses(ours, r.passes.filter(function (p) { return p.maxEl >= (S.settings.minEl || 0); })), q = S.sources.n2yoUsage().used;
        var rows = m.rows.slice(0, 8).map(function (x) {
          var mine = Math.abs(x.ours.aos - pass.aos) < 5000, a = x.ours, t = x.theirs;
          function d(v) { return v == null ? "–" : (v > 0 ? "+" : "") + fmt(v, 0) + " s"; }
          return '<tr' + (mine ? ' class="mine"' : "") + '><td>' + F.clock(a.aos, utc(), true) + "<br>" + F.clock(a.tca, utc(), true) + " (" + fmt(a.maxEl, 0) + "°)<br>" + F.clock(a.los, utc(), true) + "</td><td>" + (t ? F.clock(t.aos, utc(), true) + "<br>" + F.clock(t.tca, utc(), true) + " (" + fmt(t.maxEl, 0) + "°)<br>" + F.clock(t.los, utc(), true) : "not listed by N2YO") + "</td><td>" + (t ? d(x.dAosS) + "<br>" + d(x.dTcaS) + "<br>" + d(x.dLosS) : "–") + "</td></tr>";
        }).join("");
        out.innerHTML = '<div class="tblwrap"><table class="cmp"><thead><tr><th>SatPass<br><small>AOS / max / LOS</small></th><th>N2YO<br><small>AOS / max / LOS</small></th><th>Δ SatPass − N2YO</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
          '<p class="note">' + (r.cached ? "Cached answer from " + F.age(r.ageMs) + " ago (no new request used). " : "") + (r.transactions != null ? "N2YO transactions in the last 60 min: " + r.transactions + " (free key: 100/h for passes). " : "") + "SatPass has sent " + q + " radiopasses requests from this browser in the last hour. " +
          "Both lists use 0° horizon crossings, so AOS/LOS are comparable; N2YO uses its own element set (" + esc(r.satname || "") + "), so small differences of seconds to a minute are normal. Highlighted row = this pass.</p>" + (m.onlyTheirs.length ? '<p class="note">' + m.onlyTheirs.length + " N2YO pass(es) have no SatPass counterpart in the same window.</p>" : "");
        msg.textContent = r.cached ? "✔ From cache." : "✔ Done.";
      });
    };
  }

  function locationCard(onSaved) {
    var s = S.settings, el = document.createElement("section"); el.className = "card"; el.id = "locCard";
    el.innerHTML = '<h2>Your location</h2>' +
      '<button class="btn primary block" id="gpsBtn" type="button">📍 Use my current location</button>' +
      '<p class="note" id="gpsMsg">' + (isDesktop() ? 'Opens your regular browser to request location, then returns it to SatPass on this computer. Your browser may use an online location provider.' : 'SatPass stores your location on this device. Your browser may use an online location provider to find your position.') + '</p>' +
      '<div class="fields">' +
      '<div class="field"><label for="latIn">Latitude (°, N+)</label><input class="inp" id="latIn" inputmode="decimal" autocomplete="off" placeholder="e.g. 47.6 (decimal °)" value="' + (S.hasLocation() ? s.lat : "") + '"></div>' +
      '<div class="field"><label for="lonIn">Longitude (°, E+)</label><input class="inp" id="lonIn" inputmode="decimal" autocomplete="off" placeholder="e.g. -122.3 (decimal °)" value="' + (S.hasLocation() ? s.lon : "") + '"></div>' +
      '<div class="field"><label for="altIn">Elevation (m)</label><input class="inp" id="altIn" inputmode="decimal" autocomplete="off" placeholder="0" value="' + (s.alt || 0) + '"></div>' +
      '<div class="field"><label for="gridIn">Maidenhead grid</label><input class="inp" id="gridIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. CN87ts (optional)" value="' + (S.hasLocation() ? G.toGrid(s.lat, s.lon, 6) : "") + '"></div>' +
      '</div><div class="note" id="locMsg">Type a grid square and the centre of it is used as lat/lon, or type lat/lon and the grid is filled in.</div>' +
      '<div class="actions"><button class="btn primary" id="saveLoc" type="button">Save location</button></div>';
    var lat = $("#latIn", el), lon = $("#lonIn", el), alt = $("#altIn", el), grid = $("#gridIn", el), msg = $("#locMsg", el);
    function num(v) { v = String(v).trim().replace(",", ".").replace("−", "-"); return v === "" || isNaN(Number(v)) ? NaN : Number(v); }
    function fromLatLon() {
      var a = num(lat.value), o = num(lon.value);
      if (a >= -90 && a <= 90 && o >= -180 && o <= 180) { grid.value = G.toGrid(a, o, 6); grid.classList.remove("bad"); }
    }
    function fromGridIn() {
      var g = grid.value.trim();
      if (!g) { grid.classList.remove("bad"); return; }
      if (G.isValid(g)) { try { var c = G.fromGrid(g); lat.value = c.lat.toFixed(4); lon.value = c.lon.toFixed(4); grid.classList.remove("bad"); msg.textContent = "Grid " + g + " → centre of square (" + c.lat.toFixed(4) + ", " + c.lon.toFixed(4) + "). Use lat/lon for better accuracy."; } catch (e) { grid.classList.add("bad"); } }
      else grid.classList.toggle("bad", g.length >= 4);
    }
    lat.addEventListener("input", fromLatLon); lon.addEventListener("input", fromLatLon); grid.addEventListener("input", fromGridIn);
    $("#saveLoc", el).onclick = function () {
      var a = num(lat.value), o = num(lon.value), h = alt.value.trim() === "" ? 0 : num(alt.value);
      lat.classList.toggle("bad", !(a >= -90 && a <= 90)); lon.classList.toggle("bad", !(o >= -180 && o <= 180)); alt.classList.toggle("bad", isNaN(h));
      if (!(a >= -90 && a <= 90)) { msg.textContent = "Latitude must be a number between -90 and 90."; return; }
      if (!(o >= -180 && o <= 180)) { msg.textContent = "Longitude must be a number between -180 and 180."; return; }
      if (isNaN(h) || h < -500 || h > 9000) { msg.textContent = "Elevation must be a number of metres (−500…9000)."; return; }
      S.set({ lat: a, lon: o, alt: h }); passCache = {}; observer._o = null;
      msg.textContent = "Saved: " + obsLabel() + ".";
      toast("Location saved: " + G.toGrid(a, o, 6)); refreshNextBar();
      setTimeout(function () { install.show(); }, 1500);   // first useful moment to offer installation
      if (onSaved) onSaved();
    };
    $("#gpsBtn", el).onclick = function () {
      var m = $("#gpsMsg", el), button = this, desktop = isDesktop() && window.satpassDesktop;
      if (!desktop && !navigator.geolocation) { m.textContent = "Geolocation isn't available in this browser – enter your position manually."; return; }
      button.disabled = true;
      m.textContent = desktop ? "In your browser, choose Share location with SatPass and allow location. Return here when done." : "Asking for your location…";
      function success(pos) {
        button.disabled = false; if (!el.isConnected) return;
        var c = pos.coords; lat.value = c.latitude.toFixed(5); lon.value = c.longitude.toFixed(5); alt.value = c.altitude != null && isFinite(c.altitude) ? Math.round(c.altitude) : (alt.value || 0);
        fromLatLon(); m.textContent = "Location saved (accuracy ±" + Math.round(c.accuracy) + " m)."; $("#saveLoc", el).click();
      }
      function failure(err) {
        button.disabled = false; if (!el.isConnected) return;
        m.textContent = desktop ? (err.message || "Browser location is unavailable. Try again or enter coordinates manually.") : err.code === 1 ? "Location permission was denied. Allow it in your browser/site settings, or enter your position manually." : err.code === 3 ? "Timed out getting a location fix. Try again outdoors or enter it manually." : "Couldn't get your location (" + err.message + "). Enter it manually.";
      }
      if (desktop) desktop.requestLocation().then(function (result) { if (result.ok) success(result); else failure(result); }).catch(function () { failure({ message: "Could not request browser location. Try again or enter coordinates manually." }); });
      else navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
    };
    return el;
  }

  /* ---------- TLE status ---------- */
  function dataStatus() {
    var d = S.data, now = Date.now(), age = now - d.fetchedAt, stale = age > Tle.STALE_DAYS * DAY;
    var src = d.origin === "CelesTrak" ? "CelesTrak (live fetch)" : d.origin === "pasted" ? "your pasted TLEs" : d.origin === "imported file" ? "an imported file" : /^(Space-Track|SatNOGS|N2YO)/.test(d.origin) ? d.origin + " (live fetch)" : "bundled snapshot (CelesTrak)";
    return { text: "Element sets from " + src + ", fetched " + new Date(d.fetchedAt).toLocaleString() + " (" + F.age(age) + " ago).", stale: stale, age: age };
  }
  function staleList(ids) {
    var now = Date.now(); return ids.filter(function (n) { var e = entry(n); return e && !R.status(n) && Tle.isStale(e, now); });
  }

  /* ===================== PASSES ===================== */
  var SCOPES = { favs: "My favorites", curated: "All curated sats", visible: "ISS & Tiangong" };
  function scopeLabels() {
    var o = Object.assign({}, SCOPES);
    Cat.CATEGORIES.forEach(function (c) { var k = S.members(c.id).length; o["cat:" + c.id] = "All " + c.label + (k ? " (" + k + ")" : ""); });
    return o;
  }
  function scopeIds(scope) {
    if (scope === "curated") return R.CURATED.map(function (c) { return c.norad; });
    if (scope === "visible") return [25544, 48274];
    if (scope.indexOf("cat:") === 0 && Cat.BY_ID[scope.slice(4)]) return S.members(scope.slice(4));
    return S.settings.favs.slice();
  }
  ROUTES.passes = function (a) {
    setTitle("Passes");
    if (!S.hasLocation()) {
      main.innerHTML = '<div class="banner warn"><b>Set your location</b> to see passes. Use GPS or enter latitude/longitude or a Maidenhead grid square.</div>';
      main.appendChild(locationCard(function () { go("#/passes"); }));
      main.insertAdjacentHTML("beforeend", '<p class="disclaimer">Predictions use public TLEs and SGP4; verify before relying on them (see Setup → About).</p>');
      return;
    }
    var labels = scopeLabels(), single = a[0] ? Number(a[0]) : null, scope = single ? "single" : (S.load("scope", "favs")), visOnly = S.load("visOnly", false), s = S.settings;
    var token = view.token;
    if (scope.indexOf("cat:") === 0 && !S.allLoaded()) { main.innerHTML = '<div class="banner">Loading satellite data…</div>'; S.ensureAll().then(function () { if (token === view.token) rerender("passes", a); }); return; }
    main.innerHTML = '<div class="toolbar">' +
      (single ? '<b>' + esc(longName(single)) + '</b> <a class="link" href="#/passes">← all</a>' :
      '<select class="inp" id="scopeSel" aria-label="Satellites">' + Object.keys(labels).map(function (k) { return '<option value="' + k + '"' + (k === scope ? " selected" : "") + ">" + esc(labels[k]) + "</option>"; }).join("") + "</select>") +
      '<select class="inp" id="daysSel" aria-label="Days" style="flex:0 1 110px">' + [1, 2, 3, 5, 7, 10].map(function (d) { return '<option value="' + d + '"' + (d === s.days ? " selected" : "") + ">" + d + " day" + (d > 1 ? "s" : "") + "</option>"; }).join("") + "</select>" +
      '<select class="inp" id="elSel" aria-label="Minimum elevation" style="flex:0 1 110px">' + [0, 5, 10, 15, 20, 30, 45].map(function (d) { return '<option value="' + d + '"' + (d === s.minEl ? " selected" : "") + ">min " + d + "°</option>"; }).join("") + "</select>" +
      '<label class="muted" style="display:flex;align-items:center;gap:6px;min-height:40px"><input type="checkbox" id="visChk"' + (visOnly ? " checked" : "") + ' style="width:20px;height:20px"> visible only</label></div>' +
      '<div id="staleBox"></div><div class="passes-dashboard"><section class="pass-list-panel" aria-label="Upcoming passes"><div id="passList"><div class="banner">Computing passes…</div></div><div id="passFoot"></div></section><aside class="pass-preview" id="passPreview" aria-label="Selected pass preview"></aside></div>';
    $("#daysSel").onchange = function () { S.set({ days: Number(this.value) }); rerender("passes", a); };
    $("#elSel").onchange = function () { S.set({ minEl: Number(this.value) }); passCache = {}; refreshNextBar(); rerender("passes", a); };
    if ($("#scopeSel")) $("#scopeSel").onchange = function () { S.save("scope", this.value); rerender("passes", a); };
    $("#visChk").onchange = function () { S.save("visOnly", this.checked); rerender("passes", a); };
    var ids = single ? [single] : scopeIds(scope);
    ids = ids.filter(function (n) { return entry(n); });
    var stale = staleList(ids);
    if (stale.length) $("#staleBox").innerHTML = '<div class="banner warn">⚠️ Element sets older than ' + Tle.STALE_DAYS + ' days for: ' + stale.map(function (n) { return esc(nameOf(n)) + " (" + F.age(Date.now() - entry(n).epochMs) + ")"; }).join(", ") + '. Predictions may be off by minutes. Refresh on the <a class="link" href="#/sats">Sats</a> tab when online.</div>';
    var ds = dataStatus();
    if (ds.stale && !stale.length) $("#staleBox").innerHTML = '<div class="banner warn">⚠️ Your element-set data was fetched ' + F.age(ds.age) + ' ago. Refresh on the <a class="link" href="#/sats">Sats</a> tab when online.</div>';
    var preview = null, selectedKey = null;
    (async function () {
      for (var i = 0; i < ids.length; i++) { if (token !== view.token) return; computePasses(ids[i], s.days); if (i % 2) await nextFrame(); }
      if (token !== view.token) return;
      renderPassList(ids, single, visOnly);
      syncPreview();
    })();
    function syncPreview() {
      var host = $("#passPreview"); if (!host) return;
      var buttons = $$("#passList .pass"), chosen = buttons.filter(function (b) { return b.dataset.n + "/" + b.dataset.aos === selectedKey; })[0] || buttons[0];
      if (!chosen) { if (preview) preview.dispose(); preview = null; selectedKey = null; delete host.dataset.pass; host.innerHTML = '<div class="banner">Select a pass when predictions are available.</div>'; return; }
      selectedKey = chosen.dataset.n + "/" + chosen.dataset.aos;
      buttons.forEach(function (b) { var active = b === chosen; b.classList.toggle("selected", active && wide()); if (wide()) b.setAttribute("aria-pressed", String(active)); else b.removeAttribute("aria-pressed"); });
      if (!wide()) return;
      if (host.dataset.pass !== selectedKey) {
        if (preview) preview.dispose();
        host.dataset.pass = selectedKey; preview = renderPassDetail(host, [chosen.dataset.n, chosen.dataset.aos], true);
      }
      if (preview) preview.resize();
    }
    function wide() { return window.matchMedia("(min-width:900px)").matches; }
    $("#passList").onclick = function (event) {
      var button = event.target.closest(".pass"); if (!button) return;
      if (!wide()) return go("#/pass/" + button.dataset.n + "/" + button.dataset.aos);
      selectedKey = button.dataset.n + "/" + button.dataset.aos; syncPreview();
    };
    view.resize = syncPreview;
    view.tick = function () { if (wide() && preview) preview.tick(); };
    view.dispose = function () { if (preview) preview.dispose(); };
    every(1000, function () { if (wide() && preview) preview.tick(); });
    every(30000, function () { if (token === view.token && $("#passList")) { renderPassList(ids, single, visOnly); syncPreview(); } });
  };
  function renderPassList(ids, single, visOnly) {
    var s = S.settings, now = Date.now(), list = [];
    ids.forEach(function (n) { passesFor(n, s.days).forEach(function (p) { list.push(p); }); });
    list = list.filter(function (p) { return !visOnly || p.naked; }).sort(function (x, y) { return x.aos - y.aos; });
    var box = $("#passList"); if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="banner">No ' + (visOnly ? "visible " : "") + "passes above " + s.minEl + "° in the next " + s.days + " day" + (s.days > 1 ? "s" : "") + " for " + (single ? esc(longName(single)) : "these satellites") + ". Try more days, a lower minimum elevation" + (visOnly ? ", or untick “visible only”" : "") + ".</div>";
    } else {
      var html = "", lastKey = "", today = F.dateKey(now, utc()), tomorrow = F.dateKey(now + DAY, utc());
      list.forEach(function (p) {
        var k = F.dateKey(p.aos, utc());
        if (k !== lastKey) { lastKey = k; html += '<div class="dayh">' + (k === today ? "Today · " : k === tomorrow ? "Tomorrow · " : "") + F.date(p.aos, utc()) + "</div>"; }
        var live = p.aos <= now && p.los > now, e = entry(p.norad), old = e && Tle.isStale(e, now);
        html += '<button class="pass' + (live ? " live" : "") + '" data-n="' + p.norad + '" data-aos="' + Math.round(p.aos) + '" aria-label="' + esc(nameOf(p.norad)) + " pass at " + clk(p.aos) + '">' +
          '<div class="el">' + Math.round(p.maxEl) + '°<small>max el</small></div>' +
          '<div class="t1">' + esc(nameOf(p.norad)) + " · " + (p.aosTruncated ? "≥ " : "") + clk(p.aos, true) + " → " + (p.truncated ? "≥ " : "") + clk(p.los, true) + "</div>" +
          '<div class="tg">' + (live ? '<span class="tag good">NOW</span>' : "") + (p.truncated ? '<span class="tag warn" title="LOS not found within the search limit; shown time is a lower bound">LOS ≥</span>' : "") + (p.naked ? '<span class="tag vis">VISIBLE</span>' : "") + (old ? '<span class="tag warn">old TLE</span>' : "") + (R.status(p.norad) ? '<span class="tag bad" title="' + esc(R.status(p.norad).text) + '">NO SIGNAL · ' + esc(R.status(p.norad).state) + '</span>' : "") + "</div>" +
          '<div class="t2">' + F.compass(p.aosAz) + " " + Math.round(p.aosAz) + "° → " + F.compass(p.losAz) + " " + Math.round(p.losAz) + "° · " + (p.truncated ? "≥ " : "") + F.duration(p.durationSec) + (live ? " · ends in " + F.countdown(p.los - now) : " · in " + F.countdown(p.aos - now)) + "</div></button>";
      });
      box.innerHTML = html;
    }
    $("#passFoot").innerHTML = '<div class="actions"><button class="btn" id="icsAll">📅 Export these ' + list.length + ' passes (.ics)</button></div>' +
      '<p class="note">Times in ' + F.tzLabel(now, utc()) + ". Minimum elevation " + s.minEl + "° (AOS/LOS are when the satellite crosses it). " + (list.some(function (p) { return p.naked; }) ? "VISIBLE = bright satellite (ISS/Tiangong) sunlit while the sky is dark (sun below −6°) and above the horizon; brightness and weather are not modelled. " : "") + "Observer " + esc(obsLabel()) + ". Predictions are only as good as the element sets – see About.</p>";
    var ib = $("#icsAll"); if (ib) ib.onclick = function () { if (!list.length) return toast("No passes to export"); downloadIcs(list.slice(0, 60), "satpass-passes.ics"); };
  }

  /* ---------- .ics download ---------- */
  function downloadIcs(passes, fname, alarmMin) {
    var oldest = Math.max.apply(null, passes.map(function (p) { var e = entry(p.norad); return e ? Tle.ageDays(e, Date.now()) : 0; }));
    passes = passes.map(function (p) { return Object.assign({}, p, { visible: !!p.naked }); });
    var txt = I.build(passes, { observerLabel: obsLabel(), alarmMin: alarmMin === undefined ? S.settings.leadMin : alarmMin, tleAgeDays: oldest });
    var blob = new Blob([txt], { type: "text/calendar;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    toast("Calendar file created – open it to add the pass" + (passes.length > 1 ? "es" : "") + " to your calendar", 4000);
  }

  /* ===================== PASS DETAIL ===================== */
  function renderPassDetail(host, a, inline) {
    function q(sel) { return $(sel, host); }
    function qa(sel) { return $$(sel, host); }
    var token = view.token;
    var n = Number(a[0]), aos = Number(a[1]);
    if (!inline) setTitle("Pass detail");
    if (!S.hasLocation()) return go("#/passes");
    var e = entry(n), sat = satObj(n);
    if (!e || !sat) { host.innerHTML = '<div class="err">No element set for NORAD ' + esc(a[0]) + ' – open the <a class="link" href="#/sats">Sats</a> tab.</div>'; return; }
    var pass = null;
    (passCache[n] ? passCache[n].passes : []).forEach(function (p) { if (Math.abs(p.aos - aos) < 5000) pass = p; });
    if (!pass) {
      var cand = P.findPasses(sat, observer(), aos - 25 * 60000, aos + 25 * 60000, { minEl: S.settings.minEl }), best = Infinity;
      cand.forEach(function (p) { if (Math.abs(p.aos - aos) < best) { best = Math.abs(p.aos - aos); pass = p; } });
      if (pass) { pass.aosBeforeStart = pass.inProgressAtStart = pass.losAfterWindow = false; }   // the ±25 min window here is artificial
    }
    if (!pass) { host.innerHTML = '<div class="banner warn">That pass is no longer available (the element sets or minimum elevation changed). <a class="link" href="#/passes">Back to passes</a></div>'; return; }
    if (!inline) setTitle(nameOf(n) + " pass");
    if (pass.bright === undefined) { pass.bright = !!(R.curated(n) && R.curated(n).bright); pass.naked = pass.bright && pass.visible; }
    var step = S.load("step", 30), now0 = Date.now(), old = Tle.isStale(e, now0), tleAge = Tle.ageDays(e, now0);
    var visTxt = pass.visible && !pass.bright ? "Sunlit satellite and dark sky, but too small/faint to see without optics (radio satellite)" : pass.visible ? "Visible ✔ " + clk(pass.visStart) + "–" + clk(pass.visEnd) + " (sunlit sat, dark sky)" :
      (!pass.sunlitAtTca ? "Not visible – satellite is in Earth's shadow" : (pass.sunElAtTca >= P.VISIBLE_SUN_EL ? "Not visible – sky too bright (sun " + fmt(pass.sunElAtTca, 0) + "° elevation)" : "Not visible"));
    var hasRadio = R.radios(n).length > 0, remKey = n + "-" + Math.round(pass.aos);
    host.innerHTML = (inline ? '<div class="preview-heading"><h2>Selected pass</h2><a class="link" href="#/pass/' + n + '/' + Math.round(pass.aos) + '">Open pass detail →</a></div>' : '<a class="link" href="#/passes">← Passes</a>') + '<div class="detail-layout">' +
      '<section class="card detail-summary"><h2>' + esc(longName(n)) + ' <span class="muted">· ' + F.date(pass.aos, utc()) + "</span></h2>" + deadBanner(n) +
      (old ? '<div class="banner warn">⚠️ This element set is ' + fmt(tleAge, 1) + " days old (> " + Tle.STALE_DAYS + "). Timing/position may be off – refresh on the Sats tab.</div>" : "") +
      '<div class="kv"><div class="big"><small>Max elevation</small><b>' + fmt(pass.maxEl, 0) + "°</b></div><div><small>Duration</small><b>" + F.duration(pass.durationSec) + "</b></div><div><small>Range at max el</small><b>" + Math.round(pass.rangeAtTcaKm).toLocaleString("en-US") + " km</b></div></div>" +
      '<div class="kv"><div><small>AOS ' + F.tzLabel(pass.aos, utc()) + "</small><b>" + clk(pass.aos, true) + "</b><br>" + az(pass.aosAz) + "</div><div><small>Max el (TCA)</small><b>" + clk(pass.tca, true) + "</b><br>" + az(pass.tcaAz) + "</div><div><small>LOS</small><b>" + clk(pass.los, true) + "</b><br>" + az(pass.losAz) + "</div></div>" +
      '<p class="note">' + esc(visTxt) + (pass.inProgressAtStart ? " · already in progress when computed (AOS is the true start)" : "") + "</p>" +
      (pass.truncated ? '<div class="banner warn">⚠️ This pass is still going at the search limit (very long pass, e.g. a high-orbit satellite). <b>LOS and duration are lower bounds.</b></div>' : "") +
      (pass.aosTruncated ? '<div class="banner warn">⚠️ The satellite has been above the minimum elevation for more than 24 h; <b>AOS is a lower bound.</b></div>' : "") +
      '<details class="more"><summary>How AOS/LOS and “visible” are decided</summary><p class="note">AOS/LOS = the satellite crosses your minimum elevation (' + S.settings.minEl + '°), using geometric elevation (no atmospheric refraction, which would add roughly 0.5° at the horizon). “Visible” = the satellite is sunlit (simple cylindrical Earth-shadow model, no penumbra), the sun is below −6° at your location (civil twilight), and the satellite is above your horizon. Real visibility also depends on brightness, sky glow, weather and terrain.</p></details>' +
      '</section><section class="card detail-sky"><h2>Sky plot</h2><div class="canvaswrap"><canvas id="sky" role="img" aria-label="Sky plot of the pass"></canvas></div>' +
      '<p class="note">Sky plot: centre = overhead, rim = horizon, N up, E right. <span style="color:#22d3ee">━</span> track, <span style="color:#fbbf24">━</span> visible part (ISS/Tiangong), ticks = time ' + (utc() ? "(UTC)" : "(local)") + ", dashed ring = minimum elevation.</p>" +
      '</section><section class="card detail-tools"><div class="actions"><button class="btn primary" id="icsOne">📅 Add to calendar (.ics) – alerts even when the app is closed</button><button class="btn" id="remBtn"></button>' +
      (hasRadio ? '<a class="btn" href="#/doppler/' + n + "/" + Math.round(pass.aos) + '">📻 Doppler for this pass</a>' : "") + '<a class="btn" href="#/live/' + n + '">🌍 Live tracker</a></div>' +
      '<div class="note" id="remMsg">Tip: the calendar event carries its own alert and works with the app closed. The in-app reminder only fires while SatPass is open or still running in the background.</div><div id="n2box"></div></section>' +
      '<section class="card detail-series">' + (inline ? '<details class="more"><summary>Az / El / Range</summary>' : '<h2>Az / El / Range</h2>') + '<div class="toolbar"><span class="muted">Step</span><span class="seg" id="stepSeg">' + [10, 20, 30].map(function (v) { return '<button data-v="' + v + '" class="' + (v === step ? "on" : "") + '">' + v + " s</button>"; }).join("") + '</span></div>' +
      '<div class="note" id="stepNote"></div><div class="tblwrap"><table><thead><tr><th>Time</th><th>Az</th><th></th><th>El</th><th>Range km</th><th>Rate km/s</th></tr></thead><tbody id="tbody"></tbody></table></div>' + (inline ? '</details>' : '') + '</section>' +
      '<p class="disclaimer">Predicted from a TLE ' + F.age(Date.now() - e.epochMs) + " old (epoch " + new Date(e.epochMs).toISOString().slice(0, 16).replace("T", " ") + " UTC). Sat positions drift with TLE age (ISS: roughly 1–3 km/day along-track); treat times as ±several seconds when fresh, ±minutes when old.</p></div>";
    var info = document.createElement("div"), layout = q(".detail-layout"); info.className = "detail-info";
    info.appendChild(q(".detail-summary")); info.appendChild(q(".detail-tools")); layout.insertBefore(info, layout.firstChild);
    var canvas = q("#sky"), tableWide = null, longStep = Math.max(1, Math.ceil(pass.durationSec / 800)), track = P.trackPass(sat, observer(), pass.aos, pass.los, Math.max(5, longStep));
    function effStep() { return Math.max(step, Math.ceil(pass.durationSec / 300 / 10) * 10); }
    function drawSky() {
      if (inline) { var wideTable = host.clientWidth >= 1200; if (wideTable !== tableWide) { q(".detail-series details").open = wideTable; tableWide = wideTable; } }
      var width = canvas.parentElement.clientWidth;
      if (width < 80 || !canvas.isConnected) return;
      Dr.skyplot(canvas, Math.min(width, 600), track, { utc: utc(), minEl: S.settings.minEl, tca: pass.tca, now: Date.now(), bright: pass.bright, truncated: pass.truncated });
    }
    function fillTable() {
      var rows = P.trackPass(sat, observer(), pass.aos, pass.los, effStep()), html = "";
      rows.forEach(function (r) { html += '<tr data-t="' + Math.round(r.t) + '"><td>' + clk(r.t, true) + "</td><td>" + Math.round(r.az) + "°</td><td>" + F.compass(r.az) + "</td><td>" + fmt(r.el, 1) + "°</td><td>" + Math.round(r.rangeKm) + "</td><td>" + fmt(r.rrKmS, 2) + "</td></tr>"; });
      q("#tbody").innerHTML = html;
      q("#stepNote").textContent = effStep() > step ? "Long pass: step increased to " + effStep() + " s to keep the table readable." : "";
    }
    function markNow() {
      var rows = qa("#tbody tr"), now = Date.now(), cur = null;
      rows.forEach(function (r) { r.classList.remove("cur"); if (+r.dataset.t <= now && now <= pass.los) cur = r; });
      if (cur) cur.classList.add("cur");
    }
    drawSky(); fillTable(); markNow();
    var unwatch = watchSize(canvas.parentElement); accessibleTables(host);
    qa("#stepSeg button").forEach(function (b) { b.onclick = function () { step = Number(b.dataset.v); S.save("step", step); qa("#stepSeg button").forEach(function (x) { x.classList.toggle("on", x === b); }); fillTable(); markNow(); }; });
    q("#icsOne").onclick = function () { downloadIcs([pass], "satpass-" + nameOf(n).replace(/[^A-Za-z0-9]+/g, "-") + "-" + F.dateKey(pass.aos, true) + ".ics"); };
    n2yoCompareUi(n, pass, sat, host);
    var rb = q("#remBtn");
    function remState() {
      var r = reminders().filter(function (x) { return x.id === remKey; })[0];
      rb.textContent = r ? "🔔 In-app reminder set (" + r.lead + " min before) – cancel" : "🔔 In-app reminder (" + S.settings.leadMin + " min before, only while SatPass is open)";
      q("#remMsg").textContent = r ? "" : notifHelp();
    }
    rb.onclick = function () {
      var r = reminders().filter(function (x) { return x.id === remKey; })[0];
      if (r) { setReminders(reminders().filter(function (x) { return x.id !== remKey; })); remState(); toast("Reminder cancelled"); return; }
      if (pass.aos - S.settings.leadMin * 60000 < Date.now() && pass.los < Date.now()) return toast("That pass is over");
      ensureNotifPermission().then(function (perm) {
        if (token !== view.token || !host.isConnected || !host.contains(rb)) return;
        var list = reminders(); list.push({ id: remKey, norad: n, name: nameOf(n), aos: pass.aos, los: pass.los, lead: S.settings.leadMin, maxEl: pass.maxEl, fired: false }); setReminders(list);
        remState();
        toast(perm === "granted" ? "Reminder set – keep SatPass open (or in the background)" : "In-app reminder set (system notifications aren't enabled)", 3800);
      });
    };
    remState();
    return { resize: drawSky, tick: function () { drawSky(); markNow(); }, dispose: unwatch };
  }
  ROUTES.pass = function (a) {
    var detail = renderPassDetail(main, a, false);
    if (!detail) return;
    view.resize = detail.resize; view.tick = detail.tick; view.dispose = detail.dispose;
    every(1000, detail.tick);
  };

  /* ---------- reminders / notifications ---------- */
  function reminders() { return S.load("reminders", []); }
  function setReminders(l) { S.save("reminders", l); }
  function notifSupported() { return typeof Notification !== "undefined"; }
  function notifHelp() {
    if (!notifSupported()) return isIOS() && !isStandalone() ? "iPhone: system notifications only work after you add SatPass to your Home Screen (iOS 16.4+). Until then the in-app countdown and banner still work while the app is open." : "System notifications aren't available in this browser. The in-app banner/countdown still works while the app is open; use the calendar export for an alert.";
    if (Notification.permission === "denied") return "Notifications are blocked for this site – the reminder will show in-app only. Allow them in browser/site settings to get system alerts.";
    return "Reminders only fire while SatPass is open or still running in the background (browsers can't wake a closed web app without a push server). For a dependable alarm, use “Add to calendar” – it includes an alert.";
  }
  function ensureNotifPermission() {
    if (!notifSupported()) return Promise.resolve("unsupported");
    if (Notification.permission !== "default") return Promise.resolve(Notification.permission);
    try { var r = Notification.requestPermission(); return Promise.resolve(r).catch(function () { return "denied"; }); } catch (e) { return Promise.resolve("denied"); }
  }
  function notify(title, body, url) {
    toast(title + " – " + body, 8000);
    if (!notifSupported() || Notification.permission !== "granted") return;
    var opts = { body: body, icon: "icons/icon-192.png", tag: "satpass-pass", data: { url: url || "./" } };
    if (!isDesktop() && navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(function (r) { return r.showNotification(title, opts); }).catch(function () { try { new Notification(title, opts); } catch (e) {} });
    else try { new Notification(title, opts); } catch (e) {}
  }
  function checkReminders() {
    var now = Date.now(), list = reminders(), changed = false;
    list.forEach(function (r) {
      if (!r.fired && now >= r.aos - r.lead * 60000 && now < r.los) {
        r.fired = true; changed = true;
        var mins = Math.max(0, Math.round((r.aos - now) / 60000));
        notify(r.name + " pass " + (mins > 0 ? "in " + mins + " min" : "now"), "Max elevation " + Math.round(r.maxEl) + "°, AOS " + clk(r.aos), "./#/pass/" + r.norad + "/" + Math.round(r.aos));
      }
    });
    var keep = list.filter(function (r) { return r.los > now - 3600e3; });
    if (changed || keep.length !== list.length) setReminders(keep);
  }

  /* ---------- next-pass bar (in-app countdown) ---------- */
  var nextPass = null, lastNextCalc = 0;
  function refreshNextBar() {
    nextPass = null; lastNextCalc = Date.now();
    if (!S.hasLocation()) { $("#nextbar").hidden = true; return; }
    var ids = S.settings.favs.filter(function (n) { return entry(n) && satObj(n); }), i = 0;
    (function step() {
      var t0 = Date.now();
      while (i < ids.length && Date.now() - t0 < 25) { computePasses(ids[i], 2); i++; }
      if (i < ids.length) return setTimeout(step, 0);
      pickNext(); updateNextBar();
    })();
  }
  function pickNext() {
    var now = Date.now(), best = null;
    S.settings.favs.forEach(function (n) { passesFor(n, 2).forEach(function (p) { if (p.los > now && (!best || p.aos < best.aos)) best = p; }); });
    nextPass = best;
  }
  function updateNextBar() {
    var bar = $("#nextbar"), now = Date.now();
    if (!S.hasLocation()) { bar.hidden = true; return; }
    if (nextPass && nextPass.los <= now) { pickNext(); if (!nextPass && now - lastNextCalc > 60000) refreshNextBar(); }
    if (!nextPass) { bar.hidden = true; return; }
    var p = nextPass, live = p.aos <= now;
    bar.hidden = false; bar.className = "nextbar" + (live ? " now" : p.aos - now < 600000 ? " soon" : "");
    bar.innerHTML = live ? "🛰️ <b>" + esc(nameOf(p.norad)) + "</b> is overhead now · max " + Math.round(p.maxEl) + "° · LOS in <b>" + F.countdown(p.los - now) + "</b>" :
      "Next: <b>" + esc(nameOf(p.norad)) + "</b> in <b>" + F.countdown(p.aos - now) + "</b> · max " + Math.round(p.maxEl) + "° · " + F.compass(p.aosAz) + " → " + F.compass(p.losAz) + (p.naked ? " · visible" : "");
    bar.dataset.n = p.norad; bar.dataset.aos = Math.round(p.aos);
  }

  /* ===================== LIVE TRACKER ===================== */
  function satSelectHtml(selected, onlyIds) {
    var favs = S.settings.favs, seen = {}, html = "";
    function opt(n) { if (seen[n] || !entry(n) || (onlyIds && onlyIds.indexOf(n) < 0)) return ""; seen[n] = 1; return '<option value="' + n + '"' + (n === selected ? " selected" : "") + ">" + esc(longName(n)) + "</option>"; }
    function byName(x, y) { return entry(x).name < entry(y).name ? -1 : 1; }
    var g1 = favs.map(opt).join(""), g2 = R.CURATED.map(function (c) { return opt(c.norad); }).join("");
    if (g1) html += '<optgroup label="Favorites">' + g1 + "</optgroup>"; if (g2) html += '<optgroup label="Curated">' + g2 + "</optgroup>";
    Cat.CATEGORIES.forEach(function (c) { var g = S.members(c.id).sort(byName).map(opt).join(""); if (g) html += '<optgroup label="' + esc(c.label) + '">' + g + "</optgroup>"; });
    var rest = S.data.sats.map(function (e) { return e.norad; }).sort(byName).map(opt).join("");
    if (rest) html += '<optgroup label="Other satellites">' + rest + "</optgroup>";
    return html;
  }
  function celestialHtml(prefix) {
    return '<div class="celestial-layer"><label class="check"><input type="checkbox" id="' + prefix + 'Toggle"' + (S.load("skyCelestial", true) ? " checked" : "") + '> Show Moon, planets and Polaris</label>' +
      '<p class="note">White disc = Moon; orange diamonds = planets; lavender star = Polaris (North Star). Reference objects appear above the horizon, independently of satellite filters. Symbols are enlarged; daylight and brightness affect what you can see.</p><div class="celestial-readouts" id="' + prefix + 'List" aria-label="Moon, planets and Polaris above the horizon"></div></div>';
  }
  function celestialReadout(body) {
    return "Bearing " + az(body.az) + " · Elevation " + fmt(body.el, 1) + "°" + (body.kind === "moon" ? " · " + Math.round(body.illumination * 100) + "% illuminated" : "");
  }
  function renderCelestial(prefix, point, now, selected) {
    var enabled = $("#" + prefix + "Toggle").checked, box = $("#" + prefix + "List"); box.hidden = !enabled;
    if (!enabled) return [];
    var bodies;
    try {
      if (!point) { box.textContent = "Set an observing location to show sky reference objects."; box._key = null; return []; }
      bodies = window.SatCelestial.positions(point, now).filter(function (b) { return b.el >= 0; });
    } catch (err) { box.textContent = "Sky reference positions are unavailable right now."; box._key = null; return []; }
    if (!bodies.length) { box.textContent = "All sky reference objects are below this point’s horizon right now."; box._key = null; return []; }
    var key = bodies.map(function (b) { return b.id; }).join("|");
    if (key !== box._key) {
      box.innerHTML = bodies.map(function (b) { return '<button type="button" class="celestial-object" data-body="' + esc(b.id) + '" aria-pressed="false"><b>' + esc(b.name) + '</b><span class="celestial-position"></span></button>'; }).join("");
      box._key = key;
    }
    return bodies.map(function (b) {
      var button = $('[data-body="' + b.id + '"]', box); button.setAttribute("aria-pressed", String(b.id === selected));
      $(".celestial-position", button).textContent = celestialReadout(b);
      return Object.assign({}, b, { selected: b.id === selected });
    });
  }
  function groundHtml(prefix) {
    return '<div class="ground-view" id="' + prefix + '" role="group" aria-label="Sky seen from the observing point"></div><p class="note" id="' + prefix + 'Status" role="status"></p>' +
      '<div class="ground-controls" role="group" aria-label="Look around the sky">' + ["N", "E", "S", "W", "Up"].map(function (d) { return '<button class="btn sm" type="button" id="' + prefix + d + '" aria-label="Look ' + (d === "Up" ? "overhead" : {N:"north",E:"east",S:"south",W:"west"}[d]) + '">' + d + '</button>'; }).join("") +
      '<button class="btn sm" type="button" id="' + prefix + 'Find">Find selected</button><button class="btn sm" type="button" id="' + prefix + 'In" aria-label="Zoom sky in">+</button><button class="btn sm" type="button" id="' + prefix + 'Out" aria-label="Zoom sky out">−</button><button class="btn sm" type="button" id="' + prefix + 'Reset">Reset view</button></div>' +
      '<p class="note">Drag to look around · scroll or pinch to zoom · tap an object to identify it. Keyboard: arrows look, +/− zoom, Home faces north. Bearings use true north. Tree silhouettes and sky colors are decorative. Compass marks show the true, level horizon; actual terrain, clouds, other stars and constellations are not modeled. Symbols are enlarged and remain visible in daylight for identification.</p>';
  }
  function bindGround(prefix, get) {
    ["N", "E", "S", "W", "Up"].forEach(function (d, i) { $("#" + prefix + d).onclick = function () { var g = get(); if (g) g.look(i < 4 ? i * 90 : 0, i < 4 ? 20 : 90); }; });
    $("#" + prefix + "Find").onclick = function () { var g = get(); if (g) g.find(); };
    $("#" + prefix + "In").onclick = function () { var g = get(); if (g) g.zoom(1.2); };
    $("#" + prefix + "Out").onclick = function () { var g = get(); if (g) g.zoom(1 / 1.2); };
    $("#" + prefix + "Reset").onclick = function () { var g = get(); if (g) g.reset(); };
  }
  ROUTES.live = function (a) {
    setTitle("Live tracker");
    var n = a[0] ? Number(a[0]) : (S.load("liveSat", 25544));
    if (!entry(n)) n = entry(25544) ? 25544 : (S.data.sats[0] && S.data.sats[0].norad);
    S.save("liveSat", n);
    var sat = satObj(n);
    main.innerHTML = '<div class="toolbar"><select class="inp" id="liveSel" aria-label="Satellite">' + satSelectHtml(n) + '</select><button class="btn" id="liveFav" aria-label="Toggle favorite"></button></div>' +
      (sat ? "" : '<div class="err">Couldn\'t initialise this satellite\'s orbit (decayed or bad elements).</div>') +
      '<div class="live-dashboard"><section class="card live-telemetry"><h2>Position now</h2><div id="liveHead" class="note" style="margin-top:0"></div><div class="readout" id="liveRead"></div></section><section class="card tracker-visual"><h2>Orbit &amp; sky</h2>' +
      '<div class="live-view-tabs" role="tablist" aria-label="Tracker view"><button class="btn" type="button" role="tab" id="tab2d" aria-controls="panel2d" aria-selected="true">2D Map</button><button class="btn" type="button" role="tab" id="tab3d" aria-controls="panel3d" aria-selected="false" tabindex="-1">3D Globe</button><button class="btn" type="button" role="tab" id="tabsky" aria-controls="panelsky" aria-selected="false" tabindex="-1">Sky View</button><button class="btn" type="button" role="tab" id="tabground" aria-controls="panelground" aria-selected="false" tabindex="-1">3D Sky</button></div>' +
      '<div id="panel2d" role="tabpanel" aria-labelledby="tab2d"><div class="canvaswrap"><canvas id="map" role="img" aria-label="World map with satellite position and ground track"></canvas></div>' +
      '<p class="note">Map: <span style="color:#f472b6">●</span> satellite, solid line = next 100 min ground track, dashed = last 50 min, ring = radio horizon (0° elevation), amber ring = your minimum elevation, <span style="color:#4ade80">▲</span> you.</p></div>' +
      '<div id="panel3d" role="tabpanel" aria-labelledby="tab3d" hidden><div class="canvaswrap"><canvas id="globe" class="globe" role="img" tabindex="0" aria-label="Interactive 3D Earth with satellite and orbit. Use arrow keys to rotate, plus and minus to zoom, Home to center on satellite." aria-describedby="globeHelp"></canvas></div>' +
      '<div class="actions"><button class="btn sm" id="globeCenter" type="button">Center satellite</button><button class="btn sm" id="globeIn" type="button" aria-label="Zoom in">+</button><button class="btn sm" id="globeOut" type="button" aria-label="Zoom out">−</button></div>' +
      '<p class="note" id="globeHelp">Drag to rotate · scroll or pinch to zoom. Keyboard: arrows rotate, +/− zoom, Home centers.</p>' +
      '<p class="note">Pink = satellite at actual altitude (marker enlarged); green = you. Cyan path: next 100 min solid, last 50 min dashed, in Earth-fixed coordinates. Surface rings: radio horizon and minimum elevation (amber). Earth hides objects on its far side. Globe shading is decorative.</p></div>' +
      '<div id="panelsky" role="tabpanel" aria-labelledby="tabsky" hidden><p class="banner" id="liveSkyLocation" hidden>Sky View needs your observing location. <a class="link" href="#/settings">Set your location in Setup</a>.</p><p class="note" id="liveSkyStatus">' + (sat ? "Waiting for satellite position…" : "No valid orbital position is available for this satellite.") + '</p>' +
      '<div class="canvaswrap" id="liveSkyChart"><canvas id="liveSkyCanvas" class="sky-chart" role="img" aria-label="Selected satellite in the sky from your saved location. North at top, east on left, overhead at center, horizon at rim." aria-describedby="liveSkyHelp liveSkyReadout liveSkyStatus"></canvas></div><p class="note" id="liveSkyReadout"></p>' +
      '<p class="note" id="liveSkyHelp">Looking up: north at top, east on left. Center = overhead (90°); outer ring = horizon (0°). Hold the chart overhead with N toward true north. Pink = selected satellite. Dashed amber ring = your minimum elevation, when set. Other stars and constellations are not included.</p></div>' +
      '<div id="panelground" role="tabpanel" aria-labelledby="tabground" hidden>' + groundHtml("liveGround") + '<p class="note" id="liveGroundSelection"></p></div><div id="liveSkyReferences" hidden>' + celestialHtml("liveCelestial") + '</div>' +
      '</section><section class="card live-context"><h2>Next pass &amp; actions</h2><div id="liveNext"></div><div class="actions"><a class="btn" href="#/passes/' + n + '">Passes for this satellite</a>' + (R.radios(n).length ? '<a class="btn" href="#/doppler/' + n + '">📻 Doppler</a>' : radarInfoOf(n) ? '<a class="btn" href="#/doppler/' + n + '">📡 Radar</a>' : "") + "</div></section></div>" +
      '<p class="disclaimer">Position from SGP4 using a TLE ' + (entry(n) ? F.age(Date.now() - entry(n).epochMs) : "?") + ' old. Not for navigation.</p>';
    var visual = window.SatExpand.bind($(".tracker-visual", main), queueResize);
    $("#liveSel").onchange = function () { go("#/live/" + this.value); };
    var fb = $("#liveFav"); function favState() { fb.textContent = S.isFav(n) ? "★ Favorite" : "☆ Favorite"; }
    fb.onclick = function () { S.toggleFav(n); favState(); refreshNextBar(); }; favState();
    var modes = ["2d", "3d", "sky", "ground"], mode = S.load("liveView", "2d"), globe = null, ground = null, celestialSelected = null, liveSkyData = null;
    if (modes.indexOf(mode) < 0) mode = "2d";
    function selectView(next, focus) {
      mode = next; S.save("liveView", mode);
      modes.forEach(function (id) { var active = id === mode, tab = $("#tab" + id); tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1; $("#panel" + id).hidden = !active; });
      if (mode !== "3d" && globe) globe.suspend();
      if (mode !== "ground" && ground) ground.suspend();
      $("#liveSkyReferences").hidden = mode !== "sky" && mode !== "ground";
      $("#liveGround").hidden = !sat || !S.hasLocation();
      if (!sat || !S.hasLocation()) $("#liveGroundStatus").innerHTML = !sat ? "No valid orbital position is available for this satellite." : 'Set your observing location in <a class="link" href="#/settings">Setup</a> to use 3D Sky.';
      if (sat) tick();
      if (focus) $("#tab" + mode).focus();
    }
    modes.forEach(function (id) {
      var tab = $("#tab" + id); tab.onclick = function () { selectView(id); };
      tab.onkeydown = function (e) {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) < 0) return;
        e.preventDefault();
        var index = modes.indexOf(id), next = e.key === "Home" ? 0 : e.key === "End" ? modes.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length;
        selectView(modes[next], true);
      };
    });
    $("#globeCenter").onclick = function () { if (globe) globe.center(); };
    $("#globeIn").onclick = function () { if (globe) globe.zoom(1.2); };
    $("#globeOut").onclick = function () { if (globe) globe.zoom(1 / 1.2); };
    $("#liveCelestialToggle").onchange = function () { S.save("skyCelestial", this.checked); celestialSelected = null; if (sat) tick(); };
    $("#liveCelestialList").onclick = function (e) { var b = e.target.closest("[data-body]"); if (b) { celestialSelected = b.dataset.body; if (sat) tick(); } };
    $("#liveSkyCanvas").onclick = function (e) {
      if (!liveSkyData) return;
      var rect = this.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      var hit = window.SatSky.pick(liveSkyData.hits, (e.clientX - rect.left) * liveSkyData.size / rect.width, (e.clientY - rect.top) * liveSkyData.size / rect.height);
      if (hit) { celestialSelected = hit.kind === "satellite" ? null : hit.id; tick(); }
    };
    bindGround("liveGround", function () { return ground; });
    view.dispose = function () { visual.dispose(); if (globe) globe.dispose(); if (ground) ground.dispose(); };
    if (!sat) { view.resize = visual.resize; $("#liveSkyChart").hidden = true; selectView(mode); return; }
    var obs = S.hasLocation() ? observer() : null, canvas = $("#map"), trackAt = 0, tr = null, nextTxt = "";
    $("#liveSkyLocation").hidden = !!obs;
    $("#liveSkyChart").hidden = !obs;
    if (!obs) $("#liveSkyStatus").textContent = "";
    function loadTrack(now) {
      tr = { past: P.groundTrack(sat, obs || P.makeObserver(0, 0, 0), now - 50 * 60000, now, 30).map(function (p) { return [p.lon, p.lat, p.alt]; }),
             future: P.groundTrack(sat, obs || P.makeObserver(0, 0, 0), now, now + 100 * 60000, 30).map(function (p) { return [p.lon, p.lat, p.alt]; }) };
      trackAt = now;
    }
    var scene = null;
    function drawScene() {
      if (!scene) return;
      var s = scene.s, drawing = scene.drawing, now = scene.now;
      if (mode === "3d") { if (!globe) globe = window.SatGlobe.create($("#globe")); var area = window.SatExpand.dimensions($("#globe")); globe.update(drawing, area.width, area.height); }
      else if (mode === "sky" || mode === "ground") {
        $("#liveSkyChart").hidden = !obs;
        $("#liveGround").hidden = !obs;
        if (obs) {
          var bodies = renderCelestial("liveCelestial", { lat: S.settings.lat, lon: S.settings.lon, alt: S.settings.alt || 0 }, now, celestialSelected);
          var skyItems = [{ id: n, name: nameOf(n), az: s.az, el: s.el, selected: true }].concat(bodies);
          if (mode === "ground") {
            if (!ground) ground = window.SatGround.create($("#liveGround"), function (hit) { celestialSelected = hit.kind === "satellite" || !hit.kind ? null : hit.id; tick(); });
            ground.update(skyItems, { minEl: S.settings.minEl, sunEl: s.sunEl, labels: true, centerSelected: true });
          } else {
            var area = window.SatExpand.dimensions($("#liveSkyCanvas"), 1);
            liveSkyData = window.SatSky.draw($("#liveSkyCanvas"), area.width, skyItems, { minEl: S.settings.minEl, maxSize: area.expanded ? area.width : undefined });
          }
          $("#liveSkyStatus").textContent = s.el < 0 ? "Below your horizon (" + fmt(s.el, 1) + "°). The satellite will appear on the chart when it rises." : s.el < S.settings.minEl ? "Above the horizon, below your " + S.settings.minEl + "° minimum elevation setting." : "Above your horizon. Position updates every second.";
          $("#liveSkyReadout").textContent = nameOf(n) + " · Bearing " + az(s.az) + " · Elevation " + fmt(s.el, 1) + "° · Range " + Math.round(s.rangeKm).toLocaleString("en-US") + " km · " + window.SatVisible.conditions(s);
          $("#liveGroundStatus").textContent = $("#liveSkyStatus").textContent.replace("chart", "sky");
          var bodyPick = bodies.filter(function (b) { return b.id === celestialSelected; })[0];
          $("#liveGroundSelection").textContent = bodyPick ? bodyPick.name + " · " + celestialReadout(bodyPick) : $("#liveSkyReadout").textContent;
          $("#liveGroundFind").disabled = s.el < 0 && !bodyPick;
        } else { liveSkyData = null; renderCelestial("liveCelestial", null, now, celestialSelected); }
      }
      else Dr.worldmap(canvas, window.SatExpand.dimensions(canvas, 2).width, drawing);
    }
    function tick() {
      var now = Date.now(), o = obs || P.makeObserver(0, 0, 0), s = P.stateAt(sat, o, now, true);
      if (!s) {
        scene = null;
        $("#liveRead").innerHTML = '<div class="err">SGP4 could not propagate this satellite now.</div>';
        $("#liveSkyStatus").textContent = "No valid orbital position is available for this satellite now.";
        $("#liveSkyReadout").textContent = ""; $("#liveSkyChart").hidden = true;
        $("#liveGroundStatus").textContent = "No valid orbital position is available for this satellite now.";
        $("#liveGroundSelection").textContent = ""; $("#liveGround").hidden = true;
        if (ground) ground.suspend(); return;
      }
      if (now - trackAt > 60000 || !tr) loadTrack(now);
      var up = s.el > 0;
      function cell(l, v, cls) { return '<div class="' + (cls || "") + '"><small>' + l + "</small><b>" + v + "</b></div>"; }
      $("#liveRead").innerHTML = (obs ? cell("Azimuth", az(s.az), up ? "hot" : "") + cell("Elevation", fmt(s.el, 1) + "°", up ? "hot" : "") + cell("Range", Math.round(s.rangeKm).toLocaleString("en-US") + " km") + cell("Range rate", fmt(s.rrKmS, 3) + " km/s") : "") +
        cell("Latitude", fmt(s.latDeg, 2) + "°") + cell("Longitude", fmt(s.lonDeg, 2) + "°") + cell("Altitude", Math.round(s.altKm).toLocaleString("en-US") + " km") + cell("Speed", fmt(s.speedKmS, 2) + " km/s") + cell("Sunlit", s.sunlit ? "yes" : "eclipsed");
      $("#liveHead").innerHTML = (obs ? (up ? "<b style='color:var(--good)'>Above your horizon</b>" : "Below your horizon") : "<b>Set your location (Setup) for az/el</b>") + " · " + new Date(now).toISOString().slice(11, 19) + " UTC";
      var fp0 = P.footprintAngleDeg(s.altKm, 0), fpm = obs ? P.footprintAngleDeg(s.altKm, S.settings.minEl) : 0;
      var drawing = { sat: s, label: nameOf(n), track: tr, obs: obs ? { lat: S.settings.lat, lon: S.settings.lon } : null, footprint0: fp0, footprintMin: S.settings.minEl > 0 ? fpm : 0 };
      scene = { s: s, drawing: drawing, now: now }; drawScene();
      if (obs) {
        var c = passCache[n] && passesCurrent(n, 2) ? passesFor(n, 2)[0] : null;
        $("#liveNext").innerHTML = c ? '<p class="note"><b>' + (c.aos <= now ? "Pass in progress – LOS in " + F.countdown(c.los - now) : "Next pass in " + F.countdown(c.aos - now)) + "</b> (max " + Math.round(c.maxEl) + "°, " + clk(c.aos) + ') · <a class="link" href="#/pass/' + n + "/" + Math.round(c.aos) + '">details</a></p>' : '<p class="note">Computing next pass…</p>';
      }
    }
    view.resize = function () { visual.resize(); drawScene(); }; view.tick = tick; $$(".canvaswrap", main).forEach(watchSize); selectView(mode); every(1000, tick);
    if (obs) { var token = view.token; setTimeout(function () { if (token === view.token) { computePasses(n, 2); } }, 30); }
  };

  /* ===================== VISIBLE NOW ===================== */
  ROUTES.visible = function () {
    setTitle("Visible Now");
    var V = window.SatVisible, custom = S.load("visiblePoint", null);
    if (!V.validPoint(custom)) custom = null;
    var saved = S.hasLocation() ? { lat: S.settings.lat, lon: S.settings.lon, alt: S.settings.alt || 0 } : null;
    var point = custom || saved, initial = point || { lat: "", lon: "", alt: 0 };
    var modes = ["2d", "3d", "sky", "ground"], mode = S.load("visibleView", "2d"), globe = null, ground = null, selected = null, rowNodes = {}, skyChart = null, celestialSelected = null, token = view.token;
    if (modes.indexOf(mode) < 0) mode = "2d";
    var minEl = Number(S.load("visibleMinEl", 0)); if ([0, 10, 20, 30, 45, 60].indexOf(minEl) < 0) minEl = 0;
    var dir = S.load("visibleDirection", "all"); if (V.DIRECTIONS.indexOf(dir) < 0) dir = "all";
    main.innerHTML = '<section class="card"><h2>Look up from here</h2><p class="note" id="visibleObserver"></p>' +
      '<div class="actions"><button class="btn" id="visibleSaved" type="button"' + (saved ? "" : " disabled") + '>Use saved location</button><a class="btn" href="#/settings">Set my location</a></div>' +
      '<details id="visibleLocation"' + (point ? "" : " open") + '><summary>Use another point on Earth</summary><form id="visiblePointForm"><div class="fields f3">' +
      '<div class="field"><label for="visibleLat">Latitude (°, N+)</label><input class="inp" id="visibleLat" type="number" min="-90" max="90" step="any" required value="' + initial.lat + '"></div>' +
      '<div class="field"><label for="visibleLon">Longitude (°, E+)</label><input class="inp" id="visibleLon" type="number" min="-180" max="180" step="any" required value="' + initial.lon + '"></div>' +
      '<div class="field"><label for="visibleAlt">Elevation (m)</label><input class="inp" id="visibleAlt" type="number" min="-500" max="9000" step="any" value="' + initial.alt + '"></div></div>' +
      '<div class="actions"><button class="btn primary" type="submit">Use this point</button></div><p class="note" id="visiblePointMsg" role="status">This point applies to Visible Now; your saved location stays the same.</p></form></details></section>' +
      '<div id="visibleResults" class="visible-dashboard" hidden><section class="card tracker-visual"><div class="fields f3">' +
      '<div class="field"><label for="visibleMinEl">Minimum elevation</label><select class="inp" id="visibleMinEl">' + [0, 10, 20, 30, 45, 60].map(function (v) { return '<option value="' + v + '"' + (v === minEl ? " selected" : "") + '>' + (v ? v + "°" : "Horizon (0°)") + '</option>'; }).join("") + '</select></div>' +
      '<div class="field"><label for="visibleDirection">Look toward</label><select class="inp" id="visibleDirection">' + ["all"].concat(V.DIRECTIONS).map(function (v) { return '<option value="' + v + '"' + (v === dir ? " selected" : "") + '>' + (v === "all" ? "All directions" : v) + '</option>'; }).join("") + '</select></div>' +
      '<div class="field"><label for="visibleOptical">Viewing conditions</label><select class="inp" id="visibleOptical"><option value="all">All above horizon</option><option value="optical"' + (S.load("visibleOptical", false) ? " selected" : "") + '>Sunlit + dark sky</option></select></div></div>' +
      '<p class="note"><b id="visibleCount" role="status"></b> · <span id="visibleClock"></span></p><p class="note" id="visibleSky"></p>' +
      '<div class="live-view-tabs" role="tablist" aria-label="Visible satellite view"><button class="btn" type="button" role="tab" id="visibleTab2d" aria-controls="visiblePanel2d" aria-selected="true">2D Map</button><button class="btn" type="button" role="tab" id="visibleTab3d" aria-controls="visiblePanel3d" aria-selected="false" tabindex="-1">3D Globe</button><button class="btn" type="button" role="tab" id="visibleTabsky" aria-controls="visiblePanelsky" aria-selected="false" tabindex="-1">Sky View</button><button class="btn" type="button" role="tab" id="visibleTabground" aria-controls="visiblePanelground" aria-selected="false" tabindex="-1">3D Sky</button></div>' +
      '<div id="visiblePanel2d" role="tabpanel" aria-labelledby="visibleTab2d"><div class="canvaswrap"><canvas id="visibleMap" role="img" aria-label="World map of all satellites above the observing point"></canvas></div></div>' +
      '<div id="visiblePanel3d" role="tabpanel" aria-labelledby="visibleTab3d" hidden><div class="canvaswrap"><canvas id="visibleGlobe" class="globe" role="img" tabindex="0" aria-label="Globe of satellites above the observing point. Arrow keys rotate; plus and minus zoom; Home centers on You." aria-describedby="visibleGlobeHelp"></canvas></div>' +
      '<div class="actions"><button class="btn sm" type="button" id="visibleCenter">Center on You</button><button class="btn sm" type="button" id="visibleZoomIn" aria-label="Zoom in">+</button><button class="btn sm" type="button" id="visibleZoomOut" aria-label="Zoom out">−</button></div><label class="check"><input type="checkbox" id="visibleTrueScale"> Use actual altitude scale</label><p class="note" id="visibleGlobeHelp">Drag to rotate · scroll or pinch to zoom. Arrows rotate; +/− zoom; Home centers on You. Satellite heights are compressed by default to keep Earth readable; bearing, elevation and range use actual positions. Shading is decorative.</p></div>' +
      '<div id="visiblePanelsky" role="tabpanel" aria-labelledby="visibleTabsky" hidden><div class="canvaswrap"><canvas id="visibleSkyMap" class="sky-chart" role="img" aria-label="Whole sky from your observing point. North at top, east on left, overhead at center, horizon at rim. Satellite names and readouts are also available in the list below." aria-describedby="visibleSkyHelp visibleSkySelection"></canvas></div>' +
      '<p class="note" id="visibleSkyHelp">Looking up: north at top, east on left. Center = overhead (90°); outer ring = horizon (0°). Hold the chart overhead with N toward true north. Dashed amber ring = minimum elevation, when set. Other stars and constellations are not included.</p><p class="note" id="visibleSkySelection">Tap a marker or choose a satellite in the list below for its name and readouts.</p></div>' +
      '<div id="visiblePanelground" role="tabpanel" aria-labelledby="visibleTabground" hidden>' + groundHtml("visibleGround") + '<p class="note" id="visibleGroundSelection"></p></div><div id="visibleSkyReferences" hidden>' + celestialHtml("visibleCelestial") + '</div>' +
      '<label class="check"><input type="checkbox" id="visibleLabels"> Show satellite names in all views</label>' +
      '<p class="note" id="visibleLegend"></p></section>' +
      '<section class="card visible-list-panel"><h2>Above your horizon</h2><p class="note">Highest elevation first. Bearings are degrees clockwise from <b>true north</b>; a magnetic compass may differ. Elevation: 0° at the horizon, 90° directly overhead.</p>' +
      '<p class="banner" id="visibleEmpty" hidden></p><div id="visibleList"></div></section></div>' +
      '<p class="disclaimer" id="visibleCatalog"></p><p class="disclaimer">Above the horizon and sunlit does not guarantee naked-eye visibility. Brightness, cloud and terrain are not modeled. Predictions use SGP4 and public TLEs; old elements reduce accuracy. This page covers the app’s catalog and imported or looked-up satellites, not every object in orbit.</p>';
    var visual = window.SatExpand.bind($(".tracker-visual", main), queueResize);
    var obs = point ? P.makeObserver(point.lat, point.lon, point.alt) : null;
    var list = $("#visibleList");
    function updateObserver() {
      $("#visibleObserver").textContent = point ? (custom ? "Custom observing point" : "Saved location") + " · " + fmt(point.lat, 4) + "°, " + fmt(point.lon, 4) + "° · " + point.alt + " m · marked You" : "Set your location in Setup, or enter an observing point below.";
      $("#visibleResults").hidden = !point;
    }
    function newPoint(next, isCustom) {
      point = next; custom = isCustom ? next : null; S.save("visiblePoint", custom);
      obs = P.makeObserver(point.lat, point.lon, point.alt); selected = null; celestialSelected = null;
      if (globe) { globe.dispose(); globe = null; }
      if (ground) { ground.dispose(); ground = null; }
      updateObserver(); tick();
    }
    $("#visiblePointForm").onsubmit = function (e) {
      e.preventDefault();
      var a = $("#visibleLat").value.trim(), o = $("#visibleLon").value.trim(), h = $("#visibleAlt").value.trim();
      var p = { lat: a ? Number(a) : NaN, lon: o ? Number(o) : NaN, alt: h ? Number(h) : 0 };
      if (!V.validPoint(p)) { $("#visiblePointMsg").textContent = "Enter latitude −90…90°, longitude −180…180°, and elevation −500…9000 m."; return; }
      newPoint(p, true); $("#visibleLocation").open = false;
    };
    $("#visibleSaved").onclick = function () { if (saved) newPoint(saved, false); };
    function chooseMode(next, focus) {
      mode = next; S.save("visibleView", mode);
      modes.forEach(function (id) { var active = mode === id, tab = $("#visibleTab" + id); tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1; $("#visiblePanel" + id).hidden = !active; });
      if (mode !== "3d" && globe) globe.suspend();
      if (mode !== "ground" && ground) ground.suspend();
      $("#visibleSkyReferences").hidden = mode !== "sky" && mode !== "ground";
      $("#visibleLegend").textContent = (mode === "sky" || mode === "ground" ? "You are at the observing point, looking up. " : "▲ Green = You (the observing point). ") + "Gold = sunlit in a dark sky; cyan = other satellites; pink = selected. Choose a satellite below to label it in any view.";
      tick(); if (focus) $("#visibleTab" + mode).focus();
    }
    modes.forEach(function (id) {
      var tab = $("#visibleTab" + id); tab.onclick = function () { chooseMode(id); };
      tab.onkeydown = function (e) {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) < 0) return;
        e.preventDefault();
        var index = modes.indexOf(id), next = e.key === "Home" ? 0 : e.key === "End" ? modes.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length;
        chooseMode(modes[next], true);
      };
    });
    $("#visibleSkyMap").onclick = function (e) {
      if (!skyChart) return;
      var rect = this.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      var hit = window.SatSky.pick(skyChart.hits, (e.clientX - rect.left) * skyChart.size / rect.width, (e.clientY - rect.top) * skyChart.size / rect.height);
      if (hit) { if (hit.kind === "satellite") { selected = hit.id; celestialSelected = null; } else celestialSelected = hit.id; tick(); }
    };
    $("#visibleCelestialToggle").onchange = function () { S.save("skyCelestial", this.checked); celestialSelected = null; tick(); };
    $("#visibleCelestialList").onclick = function (e) { var b = e.target.closest("[data-body]"); if (b) { celestialSelected = b.dataset.body; tick(); } };
    $("#visibleCenter").onclick = function () { if (globe) globe.center(); };
    $("#visibleZoomIn").onclick = function () { if (globe) globe.zoom(1.2); };
    $("#visibleZoomOut").onclick = function () { if (globe) globe.zoom(1 / 1.2); };
    $("#visibleMinEl").onchange = function () { S.save("visibleMinEl", Number(this.value)); tick(); };
    $("#visibleDirection").onchange = function () { S.save("visibleDirection", this.value); tick(); };
    $("#visibleOptical").onchange = function () { S.save("visibleOptical", this.value === "optical"); tick(); };
    $("#visibleLabels").onchange = tick;
    $("#visibleTrueScale").onchange = tick;
    function syncRows(rows, now) {
      var keep = {}; rows.forEach(function (r) { keep[r.norad] = true; });
      Object.keys(rowNodes).forEach(function (n) { if (!keep[n]) { rowNodes[n].remove(); delete rowNodes[n]; } });
      rows.forEach(function (r, i) {
        var n = r.norad, s = r.state, el = rowNodes[n];
        if (!el) {
          el = document.createElement("article"); el.className = "visible-sat"; el.dataset.n = n;
          el.innerHTML = '<div class="visible-sat-head"><button class="visible-pick" type="button" aria-pressed="false">' + esc(nameOf(n)) + '</button><a class="link" href="#/live/' + n + '">Live →</a></div><div class="visible-metrics"><span class="visible-bearing"></span><span class="visible-el"></span><span class="visible-range"></span></div><div class="visible-meta"><span class="visible-conditions"></span><span class="visible-age"></span></div>';
          $(".visible-pick", el).onclick = function () { selected = n; celestialSelected = null; tick(); };
          rowNodes[n] = el;
        }
        // Keep nodes (and keyboard focus) while the 1 s readouts change.
        if (list.children[i] !== el) { var focused = document.activeElement; list.insertBefore(el, list.children[i] || null); if (el.contains(focused)) focused.focus(); }
        el.classList.toggle("selected", n === selected); $(".visible-pick", el).setAttribute("aria-pressed", String(n === selected));
        $(".visible-bearing", el).textContent = "Bearing " + az(s.az);
        $(".visible-el", el).textContent = "Elevation " + fmt(s.el, 1) + "°";
        $(".visible-range", el).textContent = "Range " + Math.round(s.rangeKm).toLocaleString("en-US") + " km";
        $(".visible-conditions", el).textContent = V.conditions(s);
        var e = entry(n), stale = e && Tle.isStale(e, now);
        $(".visible-age", el).textContent = (stale ? "Old TLE · " : "TLE ") + (e ? F.age(now - e.epochMs) : "unknown");
        $(".visible-age", el).classList.toggle("bad-txt", !!stale);
      });
    }
    var scene = null;
    function drawScene() {
      if (!scene || !obs) return;
      var rows = scene.rows, drawing = scene.drawing, now = scene.now, options = scene.options, sunEl = scene.sunEl, pick = scene.pick, showLabels = scene.showLabels;
      var canvas = mode === "ground" ? null : $(mode === "2d" ? "#visibleMap" : mode === "3d" ? "#visibleGlobe" : "#visibleSkyMap");
      var area = canvas ? window.SatExpand.dimensions(canvas, mode === "2d" ? 2 : mode === "sky" ? 1 : 0) : null, w = area && area.width;
      if (mode === "3d") { if (!globe) globe = window.SatGlobe.create($("#visibleGlobe")); globe.update(drawing, w, area.height); }
      else if (mode === "sky" || mode === "ground") {
        var bodies = renderCelestial("visibleCelestial", point, now, celestialSelected);
        var skyItems = rows.map(function (r) {
          return { id: r.norad, name: nameOf(r.norad), az: r.state.az, el: r.state.el, selected: r.norad === selected, color: r.state.sunlit && r.state.sunEl < P.VISIBLE_SUN_EL ? "#fbbf24" : "#22d3ee" };
        }).concat(bodies);
        if (mode === "ground") {
          if (!ground) ground = window.SatGround.create($("#visibleGround"), function (hit) { if (hit.kind === "satellite" || !hit.kind) { selected = hit.id; celestialSelected = null; } else celestialSelected = hit.id; tick(); });
          ground.update(skyItems, { minEl: options.minEl, labels: showLabels, sunEl: sunEl });
        } else skyChart = window.SatSky.draw($("#visibleSkyMap"), w, skyItems, { minEl: options.minEl, labels: showLabels, maxSize: area.expanded ? w : undefined });
        var bodyPick = bodies.filter(function (b) { return b.id === celestialSelected; })[0];
        $("#visibleSkySelection").textContent = bodyPick ? bodyPick.name + " · " + celestialReadout(bodyPick) : pick ? nameOf(pick.norad) + " · Bearing " + az(pick.state.az) + " · Elevation " + fmt(pick.state.el, 1) + "° · Range " + Math.round(pick.state.rangeKm).toLocaleString("en-US") + " km · " + V.conditions(pick.state) : "Tap a marker or choose a satellite in the list below for its name and readouts.";
        $("#visibleGroundSelection").textContent = $("#visibleSkySelection").textContent;
        $("#visibleGroundFind").disabled = !bodyPick && !pick;
        $("#visibleGroundStatus").textContent = rows.length + " satellites above the horizon match your filters. Turn to look in any direction.";
      }
      else Dr.worldmap($("#visibleMap"), w, drawing);
    }
    function tick() {
      var now = Date.now();
      if (!obs) { $("#visibleCatalog").textContent = (S.allLoaded() ? "Catalog ready." : "Loading catalog categories…"); return; }
      var options = { minEl: Number($("#visibleMinEl").value), direction: $("#visibleDirection").value, optical: $("#visibleOptical").value === "optical" };
      var result = V.scan(S.data.sats, obs, now, options, satObj), rows = result.rows;
      if (!rows.some(function (r) { return r.norad === selected; })) selected = null;
      var count = rows.length + " shown · " + result.above + " above horizon";
      if ($("#visibleCount").textContent !== count) $("#visibleCount").textContent = count;
      $("#visibleClock").textContent = new Date(now).toISOString().slice(11, 19) + " UTC";
      var sunEl = P.sunElevation(obs, now);
      $("#visibleSky").textContent = "Your sky: " + (sunEl < P.VISIBLE_SUN_EL ? "dark" : sunEl < 0 ? "twilight" : "daylight") + " · Sun elevation " + fmt(sunEl, 1) + "°. Updates every second.";
      $("#visibleEmpty").hidden = !!rows.length;
      $("#visibleEmpty").textContent = result.above ? "No satellites match these filters. Try all directions, a lower elevation, or all viewing conditions." : "No catalog satellites are above this point’s horizon right now. This view keeps updating.";
      syncRows(rows, now);
      var showLabels = $("#visibleLabels").checked, pick = rows.filter(function (r) { return r.norad === selected; })[0];
      var drawing = { obs: { lat: point.lat, lon: point.lon }, centerObs: true, compressAltitudes: !$("#visibleTrueScale").checked, sats: rows.filter(function (r) { return r.norad !== selected; }).map(function (r) {
        return { sat: r.state, label: showLabels ? nameOf(r.norad) : "", color: r.state.sunlit && r.state.sunEl < P.VISIBLE_SUN_EL ? "#fbbf24" : "#22d3ee" };
      }), sat: pick ? pick.state : null, label: pick ? nameOf(pick.norad) : "" };
      scene = { rows: rows, drawing: drawing, now: now, options: options, sunEl: sunEl, pick: pick, showLabels: showLabels }; drawScene();
      $("#visibleCatalog").textContent = result.total + " catalog satellites checked" + (result.skipped ? " · " + result.skipped + " with unusable orbital positions skipped" : "") + ". " + (S.allLoaded() ? "Includes all catalog categories and your imports/lookups." : "Some catalog categories are still loading or unavailable; results may be incomplete.");
    }
    bindGround("visibleGround", function () { return ground; });
    view.dispose = function () { visual.dispose(); if (globe) globe.dispose(); if (ground) ground.dispose(); };
    view.tick = tick; view.resize = function () { visual.resize(); drawScene(); }; $$(".canvaswrap", main).forEach(watchSize); updateObserver(); chooseMode(mode); every(1000, tick);
    if (!S.allLoaded()) S.ensureAll().then(function () { if (token === view.token) tick(); });
  };

  /* ===================== DOPPLER ===================== */
  /* ---------- SAR radar helpers (Doppler tab) ---------- */
  function radarInfoOf(n) { var e = entry(n); return Sar.forSat(n, e ? e.name : null); }
  function sarIds() {
    var order = {}; Sar.MISSIONS.forEach(function (m, i) { order[m.id] = i; });
    return S.members("sar").filter(radarInfoOf).sort(function (x, y) { return (order[radarInfoOf(x).mission.id] - order[radarInfoOf(y).mission.id]) || (x - y); });
  }
  // <option>s for the Doppler satellite select: amateur/weather radios (unchanged) + SAR radar satellites
  function dopplerSatOptions(n, radioSats) {
    var sar = sarIds(); if (radarInfoOf(n) && entry(n) && sar.indexOf(n) < 0) sar.push(n);
    function o(id, sfx) { return '<option value="' + id + '"' + (id === n ? " selected" : "") + ">" + esc(longName(id)) + (sfx || "") + "</option>"; }
    var h = radioSats.map(function (id) { return o(id, entry(id) ? "" : " (no TLE)"); }).join("");
    return sar.length ? '<optgroup label="Amateur &amp; weather radios">' + h + '</optgroup><optgroup label="SAR radar (informational)">' + sar.map(function (id) { return o(id); }).join("") + "</optgroup>" : h;
  }
  function mhzTxt(v) { return v >= 1000 ? v + " MHz (" + v / 1000 + " GHz)" : v + " MHz"; }
  function hhmm(h) { var m = Math.round(h * 60) % 1440; return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2); }
  function safeLink(u) { return /^https:\/\//.test(u) ? '<a class="link" href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 60)) + "</a>" : esc(u); }
  function radarPanelHtml(info) {
    var m = info.mission, fq = m.centerFreqMHz;
    function kv(k, v) { return "<tr><th scope='row'>" + k + "</th><td>" + v + "</td></tr>"; }
    var bw = m.bandwidthMHz != null ? "up to " + m.bandwidthMHz + " MHz" + (m.bandwidthNote ? " <span class='muted'>(" + esc(m.bandwidthNote) + ")</span>" : "") : "not verified" + (m.bandwidthNote ? " <span class='muted'>(" + esc(m.bandwidthNote) + ")</span>" : "");
    var rows = kv("Mission", esc(m.name)) + kv("Operator", esc(m.operator)) + kv("Band", m.band ? esc(m.band) + "-band" : "not verified") +
      kv("Centre frequency", fq != null ? "<b>" + mhzTxt(fq) + "</b>" + (m.approx ? ' <span class="tag warn">approximate</span>' : "") : '<b class="bad-txt">frequency not verified</b>') +
      kv("Bandwidth", bw) + kv("Polarizations", m.polarizations ? esc(m.polarizations) : "not verified") + kv("Imaging modes", m.modes ? esc(m.modes) : "not verified") +
      kv("Nominal swath", m.swathKm ? "≈ " + m.swathKm + " km <span class='muted'>(" + esc(m.swathMode || "") + ")</span>" : "not verified");
    (m.secondary || []).forEach(function (b) { rows += kv("Second radar band", esc(b.band) + "-band · " + mhzTxt(b.centerFreqMHz) + (b.bandwidthMHz ? " · up to " + b.bandwidthMHz + " MHz" : "")); });
    rows += kv("Sources", m.source.map(safeLink).join("<br>"));
    return '<table class="radar">' + rows + "</table>" + (m.notes ? '<p class="note">' + esc(m.notes) + "</p>" : "");
  }
  function dopplerRadar(a, n) {
    var info = radarInfoOf(n), m = info.mission, e = entry(n), sat = satObj(n), token = view.token, fHz = m.centerFreqMHz != null ? m.centerFreqMHz * 1e6 : null;
    main.innerHTML = '<div class="banner warn">⚠️ <b>Radar frequency – informational only.</b> The values below are the satellite’s <i>nominal radar carrier</i> from the cited sources; they are <b>not for reception</b> (SAR data is downlinked in other bands) and individual modes differ. Where a value could not be verified it says so.</div>' +
      '<div class="toolbar"><select class="inp" id="dSat" aria-label="Satellite">' + dopplerSatOptions(n, R.CURATED.filter(function (c) { return R.radios(c.norad).length; }).map(function (c) { return c.norad; })) + "</select></div>" +
      '<section class="card radar-info" id="radarCard"><h2>' + esc(longName(n)) + ' <span class="muted">· SAR radar</span></h2>' + radarPanelHtml(info) + "</section>" +
      '<section class="card"><h2>Now</h2><div id="rLive"></div>' + (fHz != null ? '<p class="note" id="rLabel">' + esc(D.RADAR_DOPPLER_LABEL) + "</p>" : "") + "</section>" +
      '<section class="card doppler-series"><h2>Across a pass</h2><div id="dPassSel"></div><div id="rGeo"></div><div class="tblwrap" id="dTbl"></div></section>';
    $("#dSat").onchange = function () { go("#/doppler/" + this.value); };
    function cell(l, v, cls) { return '<div class="' + (cls || "") + '"><small>' + l + "</small><b>" + v + "</b></div>"; }
    function liveTick() {
      var out = $("#rLive"); if (!out) return;
      if (!sat) { out.innerHTML = '<div class="banner">No element set for this satellite (Sats tab).</div>'; return; }
      var now = Date.now(), ni = P.nodeInfo(sat, now), html = "";
      if (!S.hasLocation()) html += '<div class="banner">Set your location (<a class="link" href="#/settings">Setup</a>) for the Doppler at your position.</div>';
      var s = S.hasLocation() ? P.stateAt(sat, observer(), now) : null;
      html += '<div class="readout" style="margin-bottom:8px">' + (s ? cell("Elevation", fmt(s.el, 1) + "°", s.el > 0 ? "hot" : "") + cell("Range rate", fmt(s.rrKmS, 3) + " km/s") + cell("Azimuth", az(s.az)) : "") +
        (ni ? cell("Direction", ni.ascending ? "Ascending ↑" : "Descending ↓") + cell("Local solar time", hhmm(ni.lstHours)) : "") + "</div>";
      if (fHz == null) html += '<div class="banner">Centre frequency not verified for this satellite – Doppler not computed.</div>';
      else if (s) { var r = D.radarOneWay(fHz, s.rrKmS); html += '<div class="dopp-big"><div><small>One-way carrier Doppler</small><b id="rShift">' + F.signedHz(r.shiftHz) + '</b><span>received ' + F.mhz(r.receivedHz, 6) + " MHz at nominal " + F.mhz(fHz, 3) + " MHz</span></div></div>"; }
      html += '<p class="note">Direction = sign of the satellite’s north–south velocity at the sub-satellite point; local solar time is the <i>mean</i> solar time at that point (no equation of time).</p>';
      out.innerHTML = html;
    }
    var passes = [], sel = null, passSel = $("#dPassSel");
    function geoText() {
      var box = $("#rGeo"); if (!box || !sel) return;
      var g = P.passGeometry(sat, observer(), sel); if (!g) { box.innerHTML = ""; return; }
      var line = "Pass direction <b>" + (g.ascending ? "ascending ↑" : "descending ↓") + "</b> · local solar time at closest approach <b>" + hhmm(g.lstHours) + "</b> (mean) · ground-track distance at closest approach <b>" + Math.round(g.groundTrackDistKm) + " km</b>";
      var sw = m.swathKm ? (g.groundTrackDistKm <= m.swathKm ? '<span class="tag good">within ≈ swath width</span> of the ground track' : '<span class="tag warn">farther than ≈ swath width</span> from the ground track') + " (nominal " + m.swathKm + " km, " + esc(m.swathMode || "") + ")" : '<span class="muted">nominal swath not verified – proximity check unavailable</span>';
      box.innerHTML = '<p class="note" style="margin-top:0">' + line + "<br>" + sw + '.</p><p class="note">Approximate: a SAR looks sideways (typically 20–50° incidence), so the imaged swath is offset from the ground track and its width depends on the mode. This only compares the observer’s distance from the ground track with a nominal swath width.</p>';
    }
    function fillTable() {
      var tbl = $("#dTbl"); if (!tbl) return;
      if (!sat || !S.hasLocation() || !sel || fHz == null) { tbl.innerHTML = ""; return; }
      var dstep = Math.max(S.load("dopStep", 30), Math.ceil(sel.durationSec / 300 / 10) * 10), tr = P.trackPass(sat, observer(), sel.aos, sel.los, dstep);
      var html = "<table><thead><tr><th>Time</th><th>El</th><th>Rate km/s</th><th>Carrier MHz</th><th>One-way Δ Hz</th></tr></thead><tbody>";
      tr.forEach(function (x) { var r = D.radarOneWay(fHz, x.rrKmS); html += "<tr><td>" + clk(x.t, true) + "</td><td>" + fmt(x.el, 0) + "°</td><td>" + fmt(x.rrKmS, 2) + "</td><td>" + F.mhz(r.receivedHz, 5) + "</td><td>" + Math.round(r.shiftHz).toLocaleString("en-US") + "</td></tr>"; });
      tbl.innerHTML = html + "</tbody></table>";
    }
    liveTick();
    if (sat && S.hasLocation()) {
      passSel.innerHTML = '<div class="note">Computing passes…</div>';
      setTimeout(function () {
        if (token !== view.token) return;
        computePasses(n, 5); passes = passesFor(n, 5).slice(0, 10);
        if (!passes.length) { passSel.innerHTML = '<div class="banner">No passes above ' + S.settings.minEl + "° in the next 5 days.</div>"; return; }
        var want = Number(a[1]); sel = passes.filter(function (p) { return Math.abs(p.aos - want) < 5000; })[0] || passes[0];
        passSel.innerHTML = '<div class="toolbar"><select class="inp" id="dPass" aria-label="Pass">' + passes.map(function (p) { var g = P.passGeometry(sat, observer(), p); return '<option value="' + Math.round(p.aos) + '"' + (p === sel ? " selected" : "") + ">" + F.date(p.aos, utc()) + " " + clk(p.aos) + " · max " + Math.round(p.maxEl) + "°" + (g ? (g.ascending ? " ↑" : " ↓") : "") + "</option>"; }).join("") + "</select></div>";
        $("#dPass").onchange = function () { var w = Number(this.value); sel = passes.filter(function (p) { return Math.round(p.aos) === w; })[0]; geoText(); fillTable(); };
        geoText(); fillTable();
      }, 20);
    } else passSel.innerHTML = "";
    view.tick = liveTick; every(1000, liveTick);
    if (e && Tle.isStale(e, Date.now())) main.insertAdjacentHTML("afterbegin", '<div class="banner warn">⚠️ TLE for ' + esc(nameOf(n)) + " is " + fmt(Tle.ageDays(e, Date.now()), 1) + " days old; Doppler/timing may be off.</div>");
  }
  ROUTES.doppler = function (a) {
    setTitle("Doppler");
    var radioSats = R.CURATED.filter(function (c) { return R.radios(c.norad).length; }).map(function (c) { return c.norad; });
    var n = a[0] ? Number(a[0]) : S.load("dopSat", 25544);
    if (radarInfoOf(n) && entry(n)) { S.save("dopSat", n); return dopplerRadar(a, n); }
    if (radioSats.indexOf(n) < 0) n = 25544;
    S.save("dopSat", n);
    var nominalRadios = R.radios(n), liveRadios = S.liveRadios(n), radios = nominalRadios.concat(liveRadios), ri = R.pickIndex(radios.length, S.load("dopRadio:" + n, 0)), frac = S.load("dopFrac", 0.5);
    var radio = radios[ri], e = entry(n), sat = satObj(n), token = view.token;
    main.innerHTML = deadBanner(n) + '<div class="banner warn">⚠️ <b>Approximate.</b> ' + esc(R.DISCLAIMER) + " Frequencies, tones and operating modes change; many satellites are off or in safe mode for long periods.</div>" +
      '<div class="toolbar"><select class="inp" id="dSat" aria-label="Satellite">' + dopplerSatOptions(n, radioSats) + "</select>" +
      (radios.length > 1 ? '<select class="inp" id="dRadio" aria-label="Transponder / mode">' + (liveRadios.length ? '<optgroup label="Bundled table (nominal, default)">' : "") + radios.map(function (r, i) { return (liveRadios.length && i === nominalRadios.length ? '</optgroup><optgroup label="SatNOGS DB – live, fetched ' + esc(new Date(liveRadios[0].fetchedAt).toLocaleDateString()) + '">' : "") + '<option value="' + i + '"' + (i === ri ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("") + (liveRadios.length ? "</optgroup>" : "") + "</select>" : "") + "</div>" +
      '<section class="card"><h2>' + esc(radio.label) + ' <span class="muted">· ' + esc(radio.mode) + "</span>" + (radio.live ? ' <span class="tag warn">SatNOGS live</span>' : "") + "</h2>" +
      (radio.kind === "linear" ? '<div class="field"><label for="dFrac">Position in the passband: <b id="dFracTxt"></b> <span class="muted">(0 % = lowest downlink frequency)</span></label><input type="range" id="dFrac" class="slider" min="0" max="1000" value="' + Math.round(frac * 1000) + '"></div>' : "") +
      '<div id="dNominal" class="note"></div><div id="dLive"></div>' +
      '<p class="note">' + esc(radio.note || "") + (radio.tone ? " · CTCSS tone " + radio.tone + " Hz" : "") + "</p>" + (liveRadios.length ? "" : (S.sources.readiness("satnogs").ready ? '<p class="note">Optional: <a class="link" href="#/settings">fetch live transmitters from SatNOGS</a> (Setup → Data sources); they are added below the bundled table, never replacing it.</p>' : "")) + "</section>" +
      '<section class="card doppler-series"><h2>Doppler across a pass</h2><div id="dPassSel"></div><div class="tblwrap" id="dTbl"></div>' +
      '<p class="note">First-order Doppler: Rx = f<sub>down</sub>·(1 − rr/c); to be heard on f<sub>up</sub> you transmit f<sub>up</sub>·(1 + rr/c). rr = range rate (+ receding). Positions use a TLE, so the shift is accurate to ~tens of Hz when the TLE is fresh. Times in ' + F.tzLabel(Date.now(), utc()) + ".</p></section>";
    $("#dSat").onchange = function () { go("#/doppler/" + this.value); };
    if ($("#dRadio")) $("#dRadio").onchange = function () { S.save("dopRadio:" + n, Number(this.value)); rerender("doppler", a); };
    function sats() { // satellite-frame frequencies (Hz)
      if (radio.kind === "linear") { var p = D.linearPair(radio, frac); return { up: p.upHz, down: p.downHz }; }
      return { up: radio.up, down: radio.down };
    }
    var fracEl = $("#dFrac");
    function updFrac() { frac = Number(fracEl.value) / 1000; S.save("dopFrac", frac); $("#dFracTxt").textContent = Math.round(frac * 100) + " %"; nominal(); liveTick(); fillTable(); }
    function nominal() {
      var f = sats(); $("#dNominal").innerHTML = "Satellite frame: " + (f.up != null ? "uplink <b>" + F.mhz(f.up, 4) + "</b> MHz · " : "") + (f.down != null ? "downlink <b>" + F.mhz(f.down, 4) + "</b> MHz" : "") + (radio.kind === "linear" ? (radio.inverting ? " · inverting (tune up → down moves opposite)" : " · non-inverting") : "");
    }
    function box(l, big, sub) { return "<div><small>" + l + "</small><b>" + big + "</b><span>" + sub + "</span></div>"; }
    function liveTick() {
      var out = $("#dLive"); if (!out) return;
      if (!sat || !S.hasLocation()) { out.innerHTML = '<div class="banner">' + (!sat ? "No element set for this satellite – Doppler table needs a TLE (Sats tab)." : 'Set your location (<a class="link" href="#/settings">Setup</a>) to compute live Doppler.') + "</div>"; return; }
      var s = P.stateAt(sat, observer(), Date.now()), f = sats(), c = D.corrected(f.up, f.down, s.rrKmS);
      out.innerHTML = '<div class="readout" style="margin-bottom:8px"><div class="' + (s.el > 0 ? "hot" : "") + '"><small>Elevation</small><b>' + fmt(s.el, 1) + "°</b></div><div><small>Range rate</small><b>" + fmt(s.rrKmS, 3) + " km/s</b></div><div><small>Azimuth</small><b>" + az(s.az) + "</b></div></div>" +
        '<div class="dopp-big">' + (c.rxHz != null ? box("Tune receiver to", F.mhz(c.rxHz, 5) + " MHz", "shift " + F.signedHz(c.rxShiftHz) + " vs " + F.mhz(f.down, 4)) : "") + (c.txHz != null ? box("Transmit on", F.mhz(c.txHz, 5) + " MHz", "shift " + F.signedHz(c.txShiftHz) + " vs " + F.mhz(f.up, 4)) : "") + "</div>" +
        (s.el <= 0 ? '<p class="note">Satellite is below your horizon right now – the numbers show the Doppler it <i>would</i> have at this geometry.</p>' : "");
    }
    var passes = [], sel = null, passSel = $("#dPassSel");
    function fillTable() {
      var tbl = $("#dTbl"); if (!tbl) return;
      if (!sat || !S.hasLocation()) { tbl.innerHTML = ""; return; }
      if (!sel) { tbl.innerHTML = ""; return; }
      var dstep = Math.max(S.load("dopStep", 30), Math.ceil(sel.durationSec / 300 / 10) * 10), f = sats(), tr = P.trackPass(sat, observer(), sel.aos, sel.los, dstep), rows = D.series(tr, f.up, f.down);
      var hasUp = f.up != null, hasDown = f.down != null, html = "<table><thead><tr><th>Time</th><th>El</th><th>Rate km/s</th>" + (hasDown ? "<th>Rx MHz</th><th>Rx Δ Hz</th>" : "") + (hasUp ? "<th>Tx MHz</th><th>Tx Δ Hz</th>" : "") + "</tr></thead><tbody>";
      rows.forEach(function (r, i) { html += '<tr data-t="' + Math.round(r.t) + '"><td>' + clk(r.t, true) + "</td><td>" + fmt(tr[i].el, 0) + "°</td><td>" + fmt(r.rrKmS, 2) + "</td>" + (hasDown ? "<td>" + F.mhz(r.rxHz, 5) + "</td><td>" + Math.round(r.rxShiftHz).toLocaleString("en-US") + "</td>" : "") + (hasUp ? "<td>" + F.mhz(r.txHz, 5) + "</td><td>" + Math.round(r.txShiftHz).toLocaleString("en-US") + "</td>" : "") + "</tr>"; });
      tbl.innerHTML = html + "</tbody></table>"; markNow();
    }
    function markNow() { var now = Date.now(), cur = null; $$("#dTbl tbody tr").forEach(function (r) { r.classList.remove("cur"); if (+r.dataset.t <= now && sel && now <= sel.los) cur = r; }); if (cur) cur.classList.add("cur"); }
    if (fracEl) { fracEl.oninput = updFrac; $("#dFracTxt").textContent = Math.round(frac * 100) + " %"; }
    nominal(); liveTick();
    if (sat && S.hasLocation()) {
      passSel.innerHTML = '<div class="note">Computing passes…</div>';
      setTimeout(function () {
        if (token !== view.token) return;
        computePasses(n, 5); passes = passesFor(n, 5).slice(0, 10);
        if (!passes.length) { passSel.innerHTML = '<div class="banner">No passes above ' + S.settings.minEl + "° in the next 5 days.</div>"; return; }
        var want = Number(a[1]); sel = passes.filter(function (p) { return Math.abs(p.aos - want) < 5000; })[0] || passes[0];
        passSel.innerHTML = '<div class="toolbar"><select class="inp" id="dPass" aria-label="Pass">' + passes.map(function (p) { return '<option value="' + Math.round(p.aos) + '"' + (p === sel ? " selected" : "") + ">" + F.date(p.aos, utc()) + " " + clk(p.aos) + " · max " + Math.round(p.maxEl) + "°</option>"; }).join("") + '</select><span class="seg" id="dStep">' + [10, 30, 60].map(function (v) { return '<button data-v="' + v + '" class="' + (v === S.load("dopStep", 30) ? "on" : "") + '">' + v + " s</button>"; }).join("") + "</span></div>";
        $("#dPass").onchange = function () { var w = Number(this.value); sel = passes.filter(function (p) { return Math.round(p.aos) === w; })[0]; fillTable(); };
        $$("#dStep button").forEach(function (b) { b.onclick = function () { S.save("dopStep", Number(b.dataset.v)); $$("#dStep button").forEach(function (x) { x.classList.toggle("on", x === b); }); fillTable(); }; });
        fillTable();
      }, 20);
    } else passSel.innerHTML = "";
    view.tick = function () { liveTick(); markNow(); }; every(1000, view.tick);
    if (e && Tle.isStale(e, Date.now())) main.insertAdjacentHTML("afterbegin", '<div class="banner warn">⚠️ TLE for ' + esc(nameOf(n)) + " is " + fmt(Tle.ageDays(e, Date.now()), 1) + " days old; Doppler/timing may be off.</div>");
  };

  /* ===================== SATELLITES ===================== */
  function satHaystack(n) { var e = entry(n); return Cat.haystack(n, e ? e.name : null); }
  function catLabel(id) { return Cat.BY_ID[id] ? Cat.BY_ID[id].label : id; }
  ROUTES.sats = function () {
    setTitle("Satellites");
    var q = "", mode = S.load("satMode", "curated"), token = view.token, st = dataStatus(), now = Date.now();
    if (!Cat.validMode(mode)) mode = "curated";
    main.innerHTML = '<section class="card catalog-tools"><h2>Orbital data (TLE)</h2><div class="note" style="margin-top:0" id="dsText"></div><div id="dsMsg"></div>' +
      '<div class="actions"><button class="btn primary" id="refBtn">⟳ Refresh element sets</button><button class="btn" id="refCatBtn" hidden></button></div><p class="note" id="refNote"></p><p class="note" id="catNote"></p>' +
      '<details class="more" id="importBox"><summary>Import a TLE / OMM file or paste TLEs</summary><div class="actions"><label class="btn" id="fileLbl" for="fileIn">📂 Import a TLE / OMM file…</label><input type="file" id="fileIn" accept=".txt,.tle,.3le,.json,.xml,.csv,text/plain,application/json" hidden></div><textarea class="inp" id="pasteTa" spellcheck="false" placeholder="ISS (ZARYA)\n1 25544U 98067A   ...\n2 25544  51.6400 ..."></textarea><div class="actions"><button class="btn" id="pasteBtn">Import pasted TLEs</button></div><p class="note">Works with no network and no data source: a TLE/3LE text file, or OMM JSON (e.g. downloaded from your own Space-Track account – SatPass keeps it only in this browser). Get TLEs from <a class="link" href="https://celestrak.org/NORAD/elements/" target="_blank" rel="noopener">celestrak.org</a> or <a class="link" href="https://www.amsat.org/tle/current/nasa.all" target="_blank" rel="noopener">AMSAT</a> on another device.</p></details></section>' +
      '<div class="catalog-browser"><div class="toolbar"><input class="inp" id="q" type="search" placeholder="Search name, operator or NORAD id" aria-label="Search satellites" autocomplete="off"></div><div class="chips" id="modeSeg" role="group" aria-label="Category"></div><div id="satList"></div></div>';
    function modeList() {
      var l = [["curated", "Curated", null], ["favs", "★ Favs", S.settings.favs.length]];
      Cat.CATEGORIES.forEach(function (c) { l.push([c.id, c.label, S.members(c.id).length]); });
      l.push(["all", "All", S.data.sats.length]); if (S.searched().length) l.push(["searched", "Searched", S.searched().length]);
      return l;
    }
    function chips() {
      $("#modeSeg").innerHTML = modeList().map(function (m) { return '<button class="chip' + (m[0] === mode ? " on" : "") + '" data-v="' + m[0] + '" aria-pressed="' + (m[0] === mode) + '">' + esc(m[1]) + (m[2] != null ? ' <span class="cnt">' + m[2] + "</span>" : "") + "</button>"; }).join("");
      $$("#modeSeg button").forEach(function (b) { b.onclick = function () { mode = b.dataset.v; S.save("satMode", mode); chips(); list(); status(); maybeAutoCat(); }; });
    }
    function curCat() { return Cat.BY_ID[mode] || null; }
    function status() {
      var d = dataStatus(), lo = S.lastOk(), le = S.lastError();
      $("#dsText").innerHTML = esc(d.text) + " <b>" + S.data.sats.length + "</b> satellites." + (d.stale ? ' <span class="tag warn">older than ' + Tle.STALE_DAYS + " d</span>" : "");
      $("#dsMsg").innerHTML = (d.stale ? '<div class="banner warn">⚠️ Element sets are older than ' + Tle.STALE_DAYS + " days. Predictions degrade quickly with age – refresh when online.</div>" : "") + (le && !refreshing ? '<div class="banner">Last refresh problem: ' + esc(le) + "</div>" : "");
      var allowed = S.manualAllowed(), nxt = lo ? new Date(lo + S.constants.MIN_MANUAL_MS) : null;
      $("#refBtn").disabled = refreshing || (!allowed && lo > 0);
      var chain = S.sources.chain().map(function (id) { var rd = S.sources.readiness(id); return S.sources.META[id].label + (rd.ready ? "" : " (not set up)"); });
      $("#refNote").textContent = "Sources, in order (Setup → Data sources): " + (chain.join(" → ") || "none enabled") + ". The first one that answers wins; if it fails the next is tried. CelesTrak is asked at most every " + S.constants.AUTO_REFRESH_MS / 3600e3 + " h automatically (core groups) and manually at most every " + S.constants.MIN_MANUAL_MS / 3600e3 + " h" + (!allowed && nxt ? " (next refresh available " + nxt.toLocaleTimeString() + ")" : "") + "; Space-Track at most hourly per query.";
      var c = curCat(), cb = $("#refCatBtn"), cn = $("#catNote");
      if (c && !c.core) {
        var cs = S.catStatus(c.id), co = S.lastOk(c.id), ok2 = S.manualAllowed(Date.now(), c.id), nx2 = co ? new Date(co + S.constants.MIN_MANUAL_MS) : null;
        cb.hidden = false; cb.disabled = refreshing || (!ok2 && co > 0); if (!refreshing) cb.textContent = "⟳ Refresh " + c.label + " (" + c.fetch.length + " quer" + (c.fetch.length > 1 ? "ies" : "y") + ")";
        cn.textContent = c.label + " data: " + (cs.origin === "bundled snapshot" || cs.origin === "none" ? "bundled snapshot" : cs.origin + " (live fetch)") + ", fetched " + (cs.fetchedAt ? new Date(cs.fetchedAt).toLocaleString() + " (" + F.age(Date.now() - cs.fetchedAt) + " ago)" : "—") + ". Fetched only when you open this category and it is older than " + S.constants.CAT_AUTO_MS / 3600e3 + " h (or when you tap refresh)" + (!ok2 && nx2 ? "; next manual refresh " + nx2.toLocaleTimeString() : "") + "." + (S.lastError(c.id) && !refreshing ? " Last problem: " + S.lastError(c.id) : "");
      } else { cb.hidden = true; cn.textContent = ""; }
    }
    var refreshing = false;
    function doRefresh(cats) {
      if (refreshing) return; refreshing = true; var btn = cats ? $("#refCatBtn") : $("#refBtn"); status(); btn.textContent = "Fetching…";
      S.refresh({ categories: cats, progress: function (i, n, id) { btn.textContent = "Fetching " + (i + 1) + "/" + n + "…"; } }).then(function (r) {
        refreshing = false; if (token !== view.token) { passCache = {}; return; }
        $("#refBtn").textContent = "⟳ Refresh element sets"; passCache = {}; chips(); status(); list(); refreshNextBar();
        $("#dsMsg").insertAdjacentHTML("afterbegin", '<div class="banner ' + (r.ok ? (r.fallbackFrom && r.fallbackFrom.length ? "warn" : "good") : "bad") + '" id="refResult">' + esc(r.message) + (!r.ok && !r.offline ? ' <button class="btn sm" id="goImport" type="button">📂 Import a TLE / OMM file</button> <a class="btn sm" href="#/settings">Data sources</a>' : "") + "</div>");
        var gi = $("#goImport"); if (gi) gi.onclick = function () { var d = $("#importBox"); d.open = true; d.scrollIntoView({ block: "center" }); };
      });
    }
    $("#refBtn").onclick = function () { doRefresh(null); };
    $("#refCatBtn").onclick = function () { var c = curCat(); if (c) doRefresh([c.id]); };
    // opening a non-core category refreshes it once if its data is older than a day (never while offline / backing off)
    function maybeAutoCat() {
      var c = curCat(); if (!c || c.core || refreshing || navigator.onLine === false) return;
      if (S.staleCategories(c.id).indexOf(c.id) >= 0 && S.manualAllowed(Date.now(), c.id)) doRefresh([c.id]);
    }
    $("#fileIn").onchange = function () {
      var f = this.files && this.files[0]; this.value = ""; if (!f) return;
      if (f.size > 8e6) { $("#dsMsg").insertAdjacentHTML("afterbegin", '<div class="banner bad">That file is larger than 8 MB – not a TLE/OMM list.</div>'); return; }
      f.text().then(function (t) { var r = S.importText(t, "file: " + f.name.slice(0, 60)); passCache = {}; status(); list(); refreshNextBar(); $("#dsMsg").insertAdjacentHTML("afterbegin", '<div class="banner ' + (r.ok ? "good" : "bad") + '">' + esc(r.message) + "</div>"); });
    };
    $("#pasteBtn").onclick = function () {
      var r = S.importText($("#pasteTa").value); passCache = {}; status(); list(); refreshNextBar();
      $("#dsMsg").insertAdjacentHTML("afterbegin", '<div class="banner ' + (r.ok ? "good" : "bad") + '">' + esc(r.message) + "</div>"); if (r.ok) $("#pasteTa").value = "";
    };
    function rowSub(n) {
      var c = R.curated(n), r = radarInfoOf(n), cats = S.categoriesOf(n).filter(function (x) { return !(mode === x); }).map(catLabel);
      var sub = c ? c.group : (cats.length ? cats.join(", ") : "");
      if (r) sub = (r.mission.band ? r.mission.band + "-band " : "") + (r.mission.centerFreqMHz != null ? (r.mission.centerFreqMHz / 1000) + " GHz" : "freq. not verified") + " · " + r.mission.name.replace(/ \(.*/, "");
      return sub;
    }
    function list() {
      var ql = q.trim().toLowerCase(), rows = [], seen = {}, now = Date.now(), cat = curCat(), extra = "";
      function add(n, label, sub, missing) { if (seen[n]) return; seen[n] = 1; rows.push({ n: n, label: label, sub: sub, missing: missing }); }
      var curIds = R.CURATED.map(function (c) { return c.norad; });
      function consider(n) { var c = R.curated(n), e = entry(n); if (!c && !e) return; add(n, c ? c.label : e.name, rowSub(n), !e); }
      function byName(x, y) { return (entry(x) ? entry(x).name : "") < (entry(y) ? entry(y).name : "") ? -1 : 1; }
      function everything() { R.CURATED.forEach(function (c) { consider(c.norad); }); S.data.sats.slice().sort(function (x, y) { return x.name < y.name ? -1 : 1; }).forEach(function (e) { consider(e.norad); }); }
      if (cat) S.members(cat.id).sort(byName).forEach(consider);
      else if (mode === "searched") S.searched().forEach(consider);
      else if (ql || mode === "all") everything();
      else if (mode === "favs") S.settings.favs.forEach(consider);
      else curIds.forEach(consider);
      if (ql) rows = rows.filter(function (r) { return satHaystack(r.n).indexOf(ql) >= 0; });
      var noTle = [];
      if (cat && cat.id === "sar") Sar.noPublicTle().forEach(function (x) { if (!ql || (x.name + " " + x.mission.operator).toLowerCase().indexOf(ql) >= 0) noTle.push(x); });
      $("#satList").innerHTML = '<section class="card catalog-results" style="padding:4px 10px">' + (rows.length || noTle.length ? rows.map(function (r) {
        var e = entry(r.n), age = e ? Tle.ageDays(e, now) : 0, fav = S.isFav(r.n);
        return '<div class="sat"><button class="star' + (fav ? " on" : "") + '" data-n="' + r.n + '" aria-label="' + (fav ? "Remove favorite " : "Add favorite ") + esc(r.label) + '" aria-pressed="' + fav + '">' + (fav ? "★" : "☆") + "</button>" +
          '<button class="nm" data-open="' + r.n + '"><b>' + esc(r.label) + "</b><span>NORAD " + r.n + (r.sub ? " · " + esc(r.sub) : "") + (R.radios(r.n).length ? " · radio" : radarInfoOf(r.n) ? " · radar" : "") + "</span></button>" +
          (r.missing ? '<span class="tag bad">no TLE</span>' : '<span class="tag ' + (age > Tle.STALE_DAYS ? "warn" : "acc") + '">' + F.age(age * DAY) + "</span>") + "</div>";
      }).join("") + noTle.map(function (x) {
        return '<div class="sat"><span class="star" aria-hidden="true">·</span><span class="nm"><b>' + esc(x.name) + "</b><span>" + esc((x.mission.band ? x.mission.band + "-band · " : "") + x.mission.operator) + '</span></span><span class="tag bad">no public TLE</span></div>';
      }).join("") : '<p class="note">No satellites match.</p>') + "</section>";
      if (mode === "curated" && !ql) extra += '<p class="note">Some curated satellites (e.g. AO-92, CAS-4A/4B) currently have no element set in CelesTrak\'s public data (retired, re-entered or not published); pick a category above, search, or paste TLEs.</p>';
      if (cat && cat.id === "sar" && !ql) extra += '<p class="note">SAR list = curated missions (data/sar.js). Tap a satellite for the live tracker; the Doppler tab shows its nominal <i>radar</i> frequency (informational, not for reception). Satellites with no public element set are listed but cannot be tracked.</p>';
      if (cat && cat.id === "sar" && !ql) extra += '<div class="actions" id="sarExport"><button type="button" class="btn sm" id="sarCsv">⬇ CSV</button><button type="button" class="btn sm" id="sarJson">⬇ JSON</button><button type="button" class="btn sm" id="sarCopy">⧉ Copy (spreadsheet)</button><button type="button" class="btn sm" id="sarCopyCsv">⧉ Copy CSV</button></div><p class="note" id="sarExportNote">Export the whole SAR list offline: one row per satellite (' + Sar.exportRows().length + ' rows, ' + Sar.MISSIONS.length + ' missions, including missions with no public TLE). Unverified values stay blank. Columns: ' + esc(Sar.EXPORT_COLUMNS.join(", ")) + '. CSV is UTF-8 with BOM (opens correctly in Excel).</p>';
      if (ql && ql.length >= 3 && rows.length === 0 && Cat.lookupCheck(q).ok) extra += '<div class="actions"><button class="btn" id="lookupBtn">🔎 Search CelesTrak for “' + esc(q.trim()) + '”</button></div><p class="note">Looks up this name or NORAD id on CelesTrak (one small request; mega-constellations such as Starlink need a number, e.g. “STARLINK-1234”).</p>';
      else if (ql && ql.length >= 3 && rows.length === 0) extra += '<p class="note">' + esc(Cat.lookupCheck(q).reason || "") + "</p>";
      $("#satList").insertAdjacentHTML("beforeend", extra);
      if ($("#sarCsv")) {
        function saveFile(name, text, type) { var blob = new Blob([text], { type: type }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 30000); }
        function copyText(text, label) {
          function fallback() { var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); toast(ok ? label + " copied" : "Couldn't copy – use the download buttons instead", 3000); }
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(label + " copied", 3000); }, fallback); else fallback();
        }
        $("#sarCsv").onclick = function () { saveFile("satpass-sar-list.csv", Sar.toCsv(), "text/csv;charset=utf-8"); toast("SAR list saved as CSV", 3000); };
        $("#sarJson").onclick = function () { saveFile("satpass-sar-list.json", Sar.toJson(), "application/json"); toast("SAR list saved as JSON", 3000); };
        $("#sarCopy").onclick = function () { copyText(Sar.toTsv(), "SAR list (tab-separated)"); };
        $("#sarCopyCsv").onclick = function () { copyText(Sar.toCsv().replace(/^\ufeff/, ""), "SAR list (CSV)"); };
      }
      var lb = $("#lookupBtn"); if (lb) lb.onclick = function () {
        lb.disabled = true; lb.textContent = "Searching…";
        S.lookup(q).then(function (r) { if (token !== view.token) return; if (r.ok) { mode = "searched"; S.save("satMode", mode); chips(); list(); status(); } else { lb.disabled = false; lb.textContent = "🔎 Search CelesTrak for “" + q.trim() + "”"; $("#dsMsg").insertAdjacentHTML("afterbegin", '<div class="banner bad">' + esc(r.message) + "</div>"); } });
      };
      $$("#satList .star[data-n]").forEach(function (b) { b.onclick = function () { var on = S.toggleFav(Number(b.dataset.n)); b.classList.toggle("on", on); b.textContent = on ? "★" : "☆"; b.setAttribute("aria-pressed", on); refreshNextBar(); var fc = $('#modeSeg [data-v="favs"] .cnt'); if (fc) fc.textContent = S.settings.favs.length; }; });
      $$("#satList .nm[data-open]").forEach(function (b) { b.onclick = function () { go("#/live/" + b.dataset.open); }; });
    }
    $("#q").oninput = function () { q = this.value; list(); };
    chips(); status(); list();
    S.ensureAll().then(function () { if (token !== view.token) return; chips(); list(); status(); maybeAutoCat(); });
  };

  /* ===================== SETTINGS ===================== */
  ROUTES.settings = function () {
    setTitle("Setup");
    main.innerHTML = "";
    main.appendChild(locationCard(function () {}));
    main.appendChild(dataSourcesCard());
    var s = S.settings, sec = document.createElement("div"); sec.className = "settings-extra";
    sec.innerHTML = '<section class="card settings-display"><h2>Time &amp; display</h2><div class="toolbar"><span>Show times in</span><span class="seg" id="tzSeg"><button data-v="local" class="' + (!s.utc ? "on" : "") + '">Local (' + F.tzLabel(Date.now(), false) + ')</button><button data-v="utc" class="' + (s.utc ? "on" : "") + '">UTC</button></span></div>' +
      '<div class="toolbar"><span>Default reminder / calendar alert</span><select class="inp" id="leadSel" style="flex:0 1 130px">' + [2, 5, 10, 15, 30].map(function (m) { return '<option value="' + m + '"' + (m === s.leadMin ? " selected" : "") + ">" + m + " min before</option>"; }).join("") + "</select></div></section>" +
      '<section class="card settings-alerts"><h2>Alerts</h2><p class="note" style="margin-top:0">The <b>Next pass</b> banner at the top counts down to your next favorite pass whenever the app is open. Set a per-pass reminder from a pass’s detail page.</p>' +
      '<div class="toolbar"><button class="btn" id="notifBtn"></button></div><p class="note" id="notifNote"></p><p class="note">Reminders: <span id="remCount"></span></p></section>' +
      '<section class="card" id="installCard"><h2>Install</h2><div id="installBody"></div></section>' +
      '<section class="card settings-about"><h2>About &amp; accuracy</h2><div class="note" style="margin-top:0"><p><b>SatPass ' + APP_VERSION + '</b> <span id="swVer" class="muted"></span></p>' +
      "<p><b>Accuracy:</b> orbits come from public two-line element sets (TLEs) propagated with SGP4/SDP4 (<a class='link' href='https://github.com/shashwatak/satellite-js' target='_blank' rel='noopener'>satellite.js</a>, MIT). A fresh LEO TLE is good to roughly a kilometre or two, which is a few seconds of timing; the error grows every day (ISS: up to ~10 km/day after reboosts or manoeuvres). Element sets older than " + Tle.STALE_DAYS + " days are flagged. Always confirm important passes with a live source.</p>" +
      "<p><b>Approximations:</b> (1) elevations are <i>geometric</i> – no atmospheric refraction (~0.5° at the horizon), so real AOS/LOS happen slightly earlier/later; (2) sunlit/eclipse uses a simple <i>cylindrical Earth shadow</i> (spherical Earth, no penumbra or atmosphere) – transitions are good to a few seconds; (3) a pass is flagged <i>visible</i> when the satellite is sunlit, above your horizon and the sun is below <b>−6°</b> (civil twilight) – a rule of thumb, since brightness, sky glow, weather and terrain also matter; only ISS/Tiangong get the tag. Sun position uses a low-precision formula (~0.01°).</p>" +
      "<p><b>Sky references:</b> Sky View uses locally bundled <a class='link' href='https://github.com/cosinekitty/astronomy' target='_blank' rel='noopener'>Astronomy Engine 2.1.19</a> by Don Cross (<a class='link' href='js/vendor/astronomy-LICENSE.md' target='_blank' rel='noopener'>MIT license</a>). Positions include the observing location and omit atmospheric refraction. Polaris uses bundled J2000 coordinates from SIMBAD with precession/nutation calculated locally. Above-horizon positions do not guarantee naked-eye visibility.</p>" +
      "<p><b>3D Sky:</b> locally bundled <a class='link' href='https://github.com/mrdoob/three.js/tree/r180' target='_blank' rel='noopener'>Three.js 0.180.0</a> (<a class='link' href='js/vendor/three-LICENSE.txt' target='_blank' rel='noopener'>MIT license</a>) renders the sky from your observing point. Compass bearings use true north; horizon, sky colors and enlarged symbols are illustrative. Requires WebGL 2. The Sky View chart is available when 3D graphics are unsupported.</p>" +
      "<p><b>Long passes:</b> if a pass is already under way when computed, its true AOS is found by looking back (up to 24 h). A pass still open at the end of the window is followed until it ends (up to 14 h further); if it never ends within that limit it is marked <i>LOS ≥</i> (lower bound).</p>" +
      "<p><b>Frequencies</b> in the Doppler tab are approximate and change; verify with <a class='link' href='https://www.amsat.org/status/' target='_blank' rel='noopener'>AMSAT status</a>.</p>" +
      "<p><b>Categories &amp; SAR:</b> the Sats tab groups satellites into Amateur, Stations, Weather, SAR, Earth observation, Navigation and Science (CelesTrak groups; the SAR list is curated). For SAR satellites the Doppler tab shows the <i>nominal radar carrier</i> (band, centre frequency, bandwidth, polarizations) instead of up/downlinks. <b>These radar frequencies are nominal, informational only and not for reception</b>; values that could not be verified are shown as “not verified”. Sources: agency/operator documents, <a class='link' href='https://eoportal.org' target='_blank' rel='noopener'>ESA eoPortal</a> and <a class='link' href='https://space.oscar.wmo.int' target='_blank' rel='noopener'>WMO OSCAR</a>. The Doppler shown for radar is the <i>one-way carrier Doppler at your position</i>; real SAR processing uses the two-way Doppler centroid with antenna pointing. Starlink and OneWeb are not listed (look up a single one by name in the search box).</p>" +
      "<p><b>Data sources:</b> CelesTrak is the default and is read straight from your browser. <a class='link' href='https://www.space-track.org' target='_blank' rel='noopener'>Space-Track</a>, <a class='link' href='https://db.satnogs.org' target='_blank' rel='noopener'>SatNOGS DB</a> and <a class='link' href='https://www.n2yo.com/api/' target='_blank' rel='noopener'>N2YO</a> do not allow browsers to read their API (no CORS), so they work only through a small proxy that <i>you</i> deploy (see <code>proxy/</code> in the repository). Credentials you enter are kept only in this browser (unencrypted unless you set a passphrase), sent only to your proxy, and forwarded only to the matching service. Space-Track data is for your own use – SatPass never bundles it; please cite Space-Track/USSPACECOM when you publish results. SatNOGS and N2YO data are credited to their services. SatPass is not affiliated with or endorsed by any of them.</p>" +
      "<p><b>Data:</b> TLEs from <a class='link' href='https://celestrak.org' target='_blank' rel='noopener'>CelesTrak</a> (Dr. T.S. Kelso). Coastlines: Natural Earth (public domain). Not affiliated with CelesTrak, AMSAT or NASA.</p>" +
      '<p>Everything runs on your device; your location is never uploaded.</p></div>' +
      '<div class="actions"><button class="btn" id="resetBtn">Reset favorites &amp; settings</button></div></section>';
    main.appendChild(sec);
    var personal = document.createElement("div"), basic = document.createElement("div");
    personal.className = "settings-personal"; basic.className = "panel-stack settings-basic";
    ["#locCard", ".settings-display", ".settings-alerts", "#installCard"].forEach(function (sel) { basic.appendChild($(sel)); });
    personal.appendChild(basic); personal.appendChild($(".settings-about"));
    main.insertBefore(personal, $("#srcCard")); sec.remove();
    $$("#tzSeg button").forEach(function (b) { b.onclick = function () { S.set({ utc: b.dataset.v === "utc" }); syncTz(); }; });
    $("#leadSel").onchange = function () { S.set({ leadMin: Number(this.value) }); };
    var nb = $("#notifBtn");
    function notifState() {
      $("#remCount").textContent = reminders().filter(function (r) { return r.los > Date.now(); }).length + " pending";
      $("#notifNote").textContent = notifHelp();
      nb.textContent = !notifSupported() ? "Notifications unavailable here" : Notification.permission === "granted" ? "✓ Notifications allowed – send a test" : Notification.permission === "denied" ? "Notifications blocked" : "Enable notifications";
      nb.disabled = !notifSupported() || Notification.permission === "denied";
    }
    nb.onclick = function () { ensureNotifPermission().then(function (p) { notifState(); if (p === "granted") notify("SatPass test", "Notifications work while the app is running.", "./#/settings"); }); };
    notifState();
    renderInstallCard();
    $("#resetBtn").onclick = function () { if (confirm("Reset location, favorites and preferences on this device? (Downloaded TLEs, data-source settings, stored credentials, the biometric unlock record and auto-lock settings are kept – use “Forget credentials” in Data sources to remove those.)")) { try { Object.keys(localStorage).filter(function (k) { return k.indexOf("satpass:") === 0 && ["satpass:tle", "satpass:tlemeta", "satpass:groups", "satpass:catmeta", "satpass:lookups", "satpass:lookupmeta", "satpass:sources", "satpass:creds", "satpass:srcstatus", "satpass:srclimit", "satpass:txlive", "satpass:n2yocache", "satpass:bio", "satpass:vault", "satpass:credhint"].indexOf(k) < 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} location.hash = "#/"; location.reload(); } };
    if (window.caches) caches.keys().then(function (ks) { var k = ks.filter(function (x) { return x.indexOf("satpass-") === 0; })[0]; if (k && $("#swVer")) $("#swVer").textContent = "· cache " + k; });
  };

  /* ---------- time zone toggle / theme ---------- */
  function syncTz() { $("#tzBtn").textContent = utc() ? "UTC" : "Local"; route(); }
  function applyTheme() {
    var t = S.settings.theme || "auto"; document.documentElement.setAttribute("data-theme", t);
    $("#themeBtn").textContent = t === "dark" ? "🌙" : t === "light" ? "☀️" : "🌓"; $("#themeBtn").setAttribute("aria-label", "Theme: " + t);
  }

  /* ---------- install ---------- */
  function renderInstallCard() {
    var b = $("#installBody"); if (!b) return;
    if (isDesktop()) { b.innerHTML = '<p class="note" style="margin-top:0">SatPass desktop app ✔ · All app files are included for offline use, including the first launch. Install a newer desktop package to update the app; use Data sources above to refresh satellite data while online.</p><p class="note">Desktop settings are stored separately from your browser. Enter your observing location here. Stored credentials can be moved with the encrypted backup export/import.</p>'; return; }
    if (isStandalone()) { b.innerHTML = '<p class="note" style="margin-top:0">Installed as an app ✔</p>'; return; }
    b.innerHTML = '<button class="btn primary block" id="aboutInstall">Install SatPass</button><p class="note">iPhone/iPad (Safari): Share → Add to Home Screen. Android (Chrome): ⋮ → Install app / Add to Home screen. Desktop Chrome/Edge: install icon in the address bar.</p>';
    $("#aboutInstall").onclick = install.prompt;
  }
  var install = {
    deferred: null,
    iosHelp: function () { alert("Install on iPhone/iPad:\n\n1. Open this page in Safari.\n2. Tap Share (square with arrow).\n3. Tap \"Add to Home Screen\", then Add.\n\nSatPass then opens full-screen and works offline."); },
    prompt: function () {
      if (install.deferred) { var d = install.deferred; d.prompt(); d.userChoice.then(function (c) { install.deferred = null; install.hide(); if (c.outcome === "accepted") toast("Installing…"); }); return; }
      if (isIOS()) { install.iosHelp(); return; }
      alert("Use your browser menu: ⋮ → Install app / Add to Home screen (Chrome, Edge, Samsung Internet), or Share → Add to Home Screen (Safari).");
    },
    hide: function () { $("#install-banner").hidden = true; document.body.classList.remove("has-banner"); },
    show: function () {
      if (isStandalone()) return;
      var dis = S.settings.installDismissed; if (dis && Date.now() - dis < 14 * DAY) return;
      if (!isIOS() && !install.deferred) return;
      // not on the very first screen: only once a location is saved (the user has started using the app) or from the 2nd visit on
      if (!S.hasLocation() && S.load("visits", 0) < 2) return;
      $("#install-sub").textContent = isIOS() ? "Tap Install for the Add to Home Screen steps." : "Add it to your home screen for quick offline use.";
      $("#install-banner").hidden = false; document.body.classList.add("has-banner");
    },
    init: function () {
      S.save("visits", S.load("visits", 0) + 1);
      window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); install.deferred = e; setTimeout(install.show, 1200); });
      window.addEventListener("appinstalled", function () { install.deferred = null; install.hide(); toast("SatPass installed"); });
      $("#install-btn").onclick = install.prompt;
      $("#install-dismiss").onclick = function () { S.set({ installDismissed: Date.now() }); install.hide(); };
      if (isIOS()) setTimeout(install.show, 2500);
    }
  };

  /* ---------- boot ---------- */
  function autoRefresh() {
    if (navigator.onLine === false) return;
    var core = S.nextAutoRefreshDue() ? S.refresh({ auto: true }).then(function (r) { if (r.ok) { passCache = {}; toast(r.fallbackFrom && r.fallbackFrom.length ? r.message.split(". ")[0] : "Orbital data updated from " + S.sources.META[r.source || "celestrak"].label); refreshNextBar(); if ((location.hash || "").indexOf("#/passes") === 0 || !location.hash) route(); } }) : Promise.resolve();
    // categories the user actually uses (a favourite in SAR, Earth observation, …) are refreshed at most once a day, one category at a time
    core.then(function () { return S.ensureAll(); }).then(function () {
      var st = S.staleCategories(); if (!st.length) return;
      return S.refresh({ categories: st, auto: true }).then(function (r) { if (r.ok) { passCache = {}; refreshNextBar(); } });
    }).catch(function () {});
  }
  document.addEventListener("DOMContentLoaded", function () {
    main = $("#app"); titleEl = $("#title");
    $(".skip-link").onclick = function (event) { event.preventDefault(); var target = $(".visual-expanded .live-view-tabs [aria-selected=true]") || main; target.focus({ preventScroll: true }); if (target === main) main.scrollIntoView({ block: "start" }); };
    S.init();
    $("#themeBtn").onclick = function () { var t = S.settings.theme || "auto"; S.set({ theme: t === "auto" ? "dark" : t === "dark" ? "light" : "auto" }); applyTheme(); if (view.tick) view.tick(); };
    $("#tzBtn").onclick = function () { S.set({ utc: !utc() }); syncTz(); };
    $("#nextbar").onclick = function () { var b = $("#nextbar"); if (b.dataset.n) go("#/pass/" + b.dataset.n + "/" + b.dataset.aos); };
    applyTheme(); $("#tzBtn").textContent = utc() ? "UTC" : "Local";
    window.addEventListener("hashchange", route);
    window.addEventListener("resize", queueResize);
    window.addEventListener("online", autoRefresh);
    route(); install.init(); refreshNextBar(); movedBar();
    // Auto-lock (1.3.0): an encrypted vault forgets its decrypted credentials after idle time / while the page is hidden.
    (function () {
      var lastActive = Date.now(), hiddenSince = document.hidden ? Date.now() : null;
      ["pointerdown", "keydown", "touchstart", "wheel", "scroll", "input"].forEach(function (ev) { window.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true, capture: true }); });
      function tick(now) {
        now = now || Date.now();
        var why = Src.lockDue(S.sources.vaultCfg(), { now: now, lastActive: lastActive, hiddenSince: hiddenSince });
        if (why && S.sources.lockNow()) {
          var c = document.getElementById("srcCard"); if (c && c.rerender) c.rerender();
          toast(why === "hidden" ? "🔒 Credentials locked (SatPass was in the background)." : "🔒 Credentials locked (no activity).", 5000);
        }
        return why;
      }
      document.addEventListener("visibilitychange", function () { if (document.hidden) hiddenSince = Date.now(); else { tick(); hiddenSince = null; lastActive = Date.now(); } });
      setInterval(tick, 10000);
      window.SatPassAutoLock = { tick: tick, touch: function (t) { lastActive = t; }, hide: function (t) { hiddenSince = t; } };   // small hook for the browser tests
    })();
    setInterval(function () { updateNextBar(); checkReminders(); }, 1000);
    setTimeout(function () { S.ensureAll(); }, 1200);   // lazy category snapshots: load in the background once the first view is up (precached, so this also works offline)
    setTimeout(autoRefresh, 2500);
    if (!isDesktop() && "serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        function offerUpdate(w) { $("#update-bar").hidden = false; $("#update-btn").onclick = function () { w.postMessage("skipWaiting"); }; }
        // a new version may already be installed and waiting (e.g. found during a previous visit that was closed before the bar was shown)
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener("updatefound", function () {
          var nw = reg.installing; if (!nw) return;
          nw.addEventListener("statechange", function () { if (nw.state === "installed" && navigator.serviceWorker.controller) offerUpdate(nw); });
        });
        // long-lived installed PWAs are rarely reloaded: look for a new version whenever the app returns to the foreground and about once an hour
        function check() { try { reg.update().catch(function () {}); } catch (e) {} }
        document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") check(); });
        setInterval(check, 3600e3);
      }).catch(function (e) { console.warn("SW registration failed", e); });
      var reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () { if (reloading || $("#update-bar").hidden) return; reloading = true; location.reload(); });
    }
  });
  window.SatApp = { route: route, passesFor: passesFor, computePasses: computePasses, _passCache: function () { return passCache; } };   // _passCache: test hook
})();
