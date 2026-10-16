// Browser part of the v1.2.0 data-source tests (called from browser-smoke.js). Everything is mocked in the page: a fake "proxy" at
// https://mock-proxy.workers.dev answers from the fixtures; CelesTrak can be switched off. No real credentials, no network to the services.
const fs = require("fs"), path = require("path");
const fx = f => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const CRED = { id: "smoke.user@example.com", pw: "Smoke-Test-Password-98765", sn: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", n2: "SMOKE-N2YO-KEY-55555", px: "SMOKE-PROXY-TOKEN-77777", pass: "smoke-passphrase-1" };
const SECRETS = [CRED.pw, CRED.sn, CRED.n2, CRED.px, CRED.pass, encodeURIComponent(CRED.id), CRED.id];

module.exports = async function run(h) {
  const { ev, send, check, sleep, go, setVal, waitEvent, problems, consoleAll, LOCAL } = h;
  const qs = s => `document.querySelector(${JSON.stringify(s)})`;
  const click = async s => ev(`${qs(s)}.click()`);
  const waitFor = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expr)) return true; await sleep(250); } return false; };
  const reload = async () => { const l = waitEvent("Page.loadEventFired"); await send("Page.reload", {}); await l; await sleep(1500); };

  // ---- mock proxy + CelesTrak switch, installed before every page script
  const shim = `(() => {
    const FX = ${JSON.stringify({ st: fx("spacetrack-gp.json"), snTle: fx("satnogs-tle.json"), snTx: fx("satnogs-tx-25544.json"), n2tle: fx("n2yo-tle-doc.json") })};
    window.__reqs = []; window.__mock = "ok"; window.__csp = [];
    document.addEventListener("securitypolicyviolation", e => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
    const real = window.fetch.bind(window);
    const R = (status, body, headers) => new Response(body, { status, headers: headers || {} });
    window.fetch = function (url, init) {
      const u = typeof url === "string" ? url : url.url;
      if (u.indexOf("https://mock-proxy.workers.dev") === 0) {
        window.__reqs.push({ url: u, headers: Object.assign({}, init && init.headers) });
        const p = u.replace("https://mock-proxy.workers.dev", "");
        if (window.__mock === "down") return Promise.reject(new TypeError("Failed to fetch"));
        if (window.__mock === "502") return Promise.resolve(R(502, JSON.stringify({ error: "upstream down" }), { "X-SatPass-Error": "upstream" }));
        if (p === "/health") return Promise.resolve(R(200, JSON.stringify({ ok: true, name: "satpass-proxy", version: "1.2.0" })));
        if (p.indexOf("/spacetrack/gp") === 0) return Promise.resolve(R(200, FX.st, { "X-SatPass-Cache": "MISS" }));
        if (p.indexOf("/satnogs/tle") === 0) return Promise.resolve(R(200, FX.snTle));
        if (p.indexOf("/satnogs/transmitters") === 0) return Promise.resolve(R(200, FX.snTx));
        if (p.indexOf("/n2yo/tle") === 0) return Promise.resolve(R(200, FX.n2tle));
        if (p.indexOf("/n2yo/radiopasses") === 0) {   // N2YO answer derived from SatPass's own passes: AOS -7 s, TCA -3 s, LOS +9 s, max el -0.2°
          const id = Number(/id=(\\d+)/.exec(p)[1]), S = SatStore, sat = SatPasses.makeSat(S.data.byId[id]), o = SatPasses.makeObserver(S.settings.lat, S.settings.lon, S.settings.alt || 0);
          const ours = SatPasses.findPasses(sat, o, Date.now(), Date.now() + 2 * 864e5, { minEl: 0 });
          const sec = ms => Math.round(ms / 1000);
          return Promise.resolve(R(200, JSON.stringify({ info: { satid: id, satname: "SPACE STATION", transactionscount: 7, passescount: ours.length }, passes: ours.map(q => ({ startAz: 10, startAzCompass: "N", startUTC: sec(q.aos) - 7, maxAz: 90, maxAzCompass: "E", maxEl: Math.max(0.1, q.maxEl - 0.2), maxUTC: sec(q.tca) - 3, endAz: 170, endAzCompass: "S", endUTC: sec(q.los) + 9 })) })));
        }
        return Promise.resolve(R(404, "{}"));
      }
      if (/celestrak\\.org/.test(u) && localStorage.getItem("__ctdown")) return Promise.reject(new TypeError("Failed to fetch"));
      return real(url, init);
    };
  })()`;
  const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", { source: shim });
  await ev(`localStorage.setItem('__ctdown','1')`);
  // keep the boot-time automatic refresh quiet (every source "backing off"), so the manual refresh button is usable by the test
  const quiet = () => ev(`(() => { const s = { lastOk: 0, lastAttempt: 0, lastError: null, lastKind: null, fails: 0, backoffUntil: Date.now() + 36e5, blocked: null, lastNote: null }; localStorage.setItem('satpass:srcstatus', JSON.stringify({ celestrak: s, spacetrack: s, satnogs: s, n2yo: s })); localStorage.removeItem('satpass:tlemeta'); localStorage.removeItem('satpass:catmeta'); })()`);
  await quiet();
  const problemMark = problems.length;
  await reload();

  // ---- Setup → Data sources UI
  await go("#/settings"); await sleep(600);
  check("Setup has a Data sources card with the four sources in default order", await ev(`[...document.querySelectorAll('#srcCard .srcrow')].map(r => r.dataset.id).join() === 'celestrak,spacetrack,satnogs,n2yo'`));
  check("each source has an enable toggle, a status line, a Test connection button; CelesTrak enabled by default, others off", await ev(`[...document.querySelectorAll('#srcCard .srcrow')].every(r => r.querySelector('.srcEn') && r.querySelector('.srcStatus') && r.querySelector('.srcTest')) && document.querySelector('.srcEn[data-id=celestrak]').checked && !document.querySelector('.srcEn[data-id=spacetrack]').checked`));
  check("credential fields are password-type and hidden by default; Show toggles them", await ev(`['#stPw','#snToken','#n2Key','#srcProxyToken','#passIn'].every(s => document.querySelector(s).type === 'password')`) && await (async () => { await click('.showpw[data-for=stPw]'); const shown = await ev(`${qs("#stPw")}.type`) === "text"; await click('.showpw[data-for=stPw]'); return shown && await ev(`${qs("#stPw")}.type`) === "password"; })());
  check("privacy note + rate-limit text + terms are visible in the card (local-storage policy stated)", await ev(`(() => { const t = document.querySelector('#srcCard').textContent; return /not saved to local storage unless encrypted/.test(t) && /only in this browser|only in this browser's/.test(t) && /30 requests\\/minute|30 requests/.test(t) && /once an hour|once an hour/.test(t) && /user agreement/.test(t) && /CORS/.test(t); })()`));
  check("the card explains Space-Track/SatNOGS/N2YO need the user's own proxy and links to proxy/README", await ev(`/proxy/.test(document.querySelector('#srcCard').textContent) && !![...document.querySelectorAll('#srcCard a')].find(a => /satpass\\/tree\\/main\\/proxy/.test(a.href))`));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  check("Data sources card does not overflow a 390 px phone", await ev("document.documentElement.scrollWidth <= window.innerWidth + 1"));

  // enter proxy + credentials
  await ev(setVal("#srcProxy", "https://mock-proxy.workers.dev"));
  await ev(setVal("#stId", CRED.id)); await ev(setVal("#stPw", CRED.pw)); await ev(setVal("#snToken", CRED.sn)); await ev(setVal("#n2Key", CRED.n2)); await ev(setVal("#srcProxyToken", CRED.px));
  for (const id of ["spacetrack", "satnogs", "n2yo"]) await ev(`(() => { const c = document.querySelector('.srcEn[data-id=${id}]'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  check("1.2.1: credentials are kept in sessionStorage only (NOT in localStorage, no secret anywhere in localStorage), proxy URL in the config, note says tab-only", await ev(`(() => { const c = JSON.parse(sessionStorage.getItem('satpass:creds')); const all = Object.keys(localStorage).map(k => localStorage.getItem(k)).join('\\n'); return localStorage.getItem('satpass:creds') === null && c.stIdentity === ${JSON.stringify(CRED.id)} && c.n2yoKey === ${JSON.stringify(CRED.n2)} && ![${JSON.stringify(CRED.pw)}, ${JSON.stringify(CRED.n2)}, ${JSON.stringify(CRED.sn)}, ${JSON.stringify(CRED.px)}].some(v => all.indexOf(v) >= 0) && JSON.parse(localStorage.getItem('satpass:sources')).proxy === 'https://mock-proxy.workers.dev' && /tab only/i.test(document.querySelector('#credNote').textContent); })()`));
  check("Space-Track password field has the plaintext/proxy-token warning; the three paid/token sources are labelled 'untested live'", await ev(`!!document.querySelector('#stWarn') && /does not save it to local storage in plaintext/.test(document.querySelector('#stWarn').textContent) && document.querySelectorAll('#srcCard .tag.warn').length >= 3 && [...document.querySelectorAll('#srcCard .tag.warn')].every(t => /untested live/.test(t.textContent))`));
  check("enabled sources are now ready (status lines no longer say 'Not set up')", await ev(`SatStore.sources.chain().join() === 'celestrak,spacetrack,satnogs,n2yo' && ['spacetrack','satnogs','n2yo'].every(i => SatStore.sources.readiness(i).ready)`));

  // Test connection
  await click(".srcTest[data-id=spacetrack]");
  check("Test connection (Space-Track) through the mock proxy: success text + status line updated", await waitFor(`/Space-Track OK via your proxy/.test(${qs(".srcTestMsg[data-id=spacetrack]")}.textContent)`) && await ev(`/Last success/.test(${qs(".srcStatus[data-id=spacetrack]")}.textContent)`));
  await click(".srcTest[data-id=n2yo]"); await waitFor(`/N2YO OK/.test(${qs(".srcTestMsg[data-id=n2yo]")}.textContent)`);
  check("Test connection (N2YO): OK and quota (transactions reported by N2YO) appears in the status line", await ev(`/N2YO reports \\d+ API transactions/.test(${qs(".srcStatus[data-id=n2yo]")}.textContent)`), await ev(`${qs(".srcStatus[data-id=n2yo]")}.textContent`));
  await click(".srcTest[data-id=satnogs]"); check("Test connection (SatNOGS) OK", await waitFor(`/SatNOGS DB OK/.test(${qs(".srcTestMsg[data-id=satnogs]")}.textContent)`));
  const reqs = JSON.parse(await ev(`JSON.stringify(window.__reqs)`));
  check("requests went to the proxy with credentials only in headers (never in URLs)", reqs.length >= 6 && reqs.every(r => SECRETS.every(s => r.url.indexOf(s) < 0)) && reqs.some(r => r.headers["X-N2YO-Key"] === encodeURIComponent(CRED.n2)) && reqs.some(r => r.headers["X-SpaceTrack-Password"]) && reqs.some(r => r.headers["X-SatNOGS-Token"] === CRED.sn), reqs.map(r => r.url));

  // reorder
  await click(".srcUp[data-id=spacetrack]");
  check("↑ moves Space-Track above CelesTrak (order persisted)", await ev(`SatStore.sources.chain()[0] === 'spacetrack' && JSON.parse(localStorage.getItem('satpass:sources')).order[0] === 'spacetrack'`));
  await click(".srcDn[data-id=spacetrack]");
  check("↓ moves it back", await ev(`SatStore.sources.chain()[0] === 'celestrak'`));

  // ---- fallback with CelesTrak down
  await ev(`localStorage.removeItem('satpass:srcstatus')`); await quiet(); await reload(); await go("#/sats"); await sleep(400);
  check("Sats tab: generic 'Refresh element sets' button and a sources-in-order note", await ev(`/Refresh element sets/.test(${qs("#refBtn")}.textContent) && /CelesTrak → Space-Track → SatNOGS DB → N2YO/.test(${qs("#refNote")}.textContent)`), await ev(`${qs("#refNote")}.textContent`));
  await ev(`window.__reqs.length = 0`); await click("#refBtn");
  const gotRes = await waitFor(`!!${qs("#refResult")}`, 30000);
  const resText = gotRes ? await ev(`${qs("#refResult")}.textContent`) : "timeout";
  check("CelesTrak unreachable -> automatic fallback; message: 'CelesTrak unreachable — using Space-Track.'", gotRes && /^CelesTrak unreachable — using Space-Track\./.test(resText), resText);
  check("fallback banner is a warning (not green) and the data origin reads Space-Track (via proxy)", await ev(`${qs("#refResult")}.classList.contains('warn') && SatStore.data.origin === 'Space-Track (via proxy)' && /Space-Track/.test(document.body.textContent)`));
  check("fallback used the proxy exactly once per ≤150-id batch (no hammering) and never touched SatNOGS/N2YO", await ev(`window.__reqs.filter(r => /spacetrack\\/gp/.test(r.url)).length <= 3 && window.__reqs.filter(r => /satnogs|n2yo/.test(r.url)).length === 0`));

  // ---- all sources fail -> manual import path
  await ev(`window.__mock = '502'`); await quiet(); await reload(); await go("#/sats"); await sleep(400);
  await ev(`window.__mock = '502'`); await click("#refBtn");
  const failed = await waitFor(`!!${qs("#refResult")}`, 30000);
  check("all sources failing: red banner naming the sources, with an 'Import a TLE / OMM file' button and a Data sources link", failed && await ev(`${qs("#refResult")}.classList.contains('bad') && /CelesTrak unreachable/.test(${qs("#refResult")}.textContent) && !!${qs("#goImport")} && !![...document.querySelectorAll('#refResult a')].find(a => /settings/.test(a.href))`), await ev(`(${qs("#refResult")} || {}).textContent`));
  await click("#goImport");
  check("the import button opens the import box with the file chooser and paste area", await ev(`${qs("#importBox")}.open && !!${qs("#fileIn")} && !!${qs("#pasteTa")}`));
  // file import through the real <input type=file>
  const { root } = await send("DOM.getDocument", { depth: 1 }); const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#fileIn" });
  await send("DOM.setFileInputFiles", { nodeId, files: [path.join(__dirname, "fixtures", "spacetrack-gp.json")] });
  check("importing an OMM JSON file works (origin 'imported file', Alpha-5 object present)", await waitFor(`SatStore.data.origin === 'imported file' && !!SatStore.data.byId[100889]`) && await ev(`/Imported 3 element set/.test(document.querySelector('#dsMsg').textContent)`), await ev(`document.querySelector('#dsMsg').textContent`));
  await ev(`window.__mock = 'ok'`);

  // ---- SatNOGS live transmitters -> Doppler tab
  await go("#/settings"); await sleep(400); await click("#txFetch");
  check("Fetch live transmitters from SatNOGS: success message and a comparison table", await waitFor(`/Fetched \\d+ active transmitters/.test(${qs("#txMsg")}.textContent)`) && await ev(`!!document.querySelector('#txReport table') && /bundled nominal values are still the default/.test(document.querySelector('#txReport').textContent)`));
  await go("#/doppler/25544"); await sleep(800);
  check("Doppler: the selected entry is a bundled one (never auto-switched to live); live entries listed separately under a 'SatNOGS DB – live, fetched <date>' group", await ev(`(() => { const s = document.querySelector('#dRadio'); const g = [...s.querySelectorAll('optgroup')].map(x => x.label); return s.selectedIndex < s.options.length - 1 && !/^SatNOGS:/.test(s.options[s.selectedIndex].textContent) && g.length === 2 && /Bundled table/.test(g[0]) && /SatNOGS DB – live, fetched/.test(g[1]) && /^SatNOGS:/.test(s.options[s.options.length - 1].textContent); })()`), await ev(`document.querySelector('#dRadio') && document.querySelector('#dRadio').outerHTML.slice(0, 400)`));
  await ev(`(() => { const s = document.querySelector('#dRadio'); s.selectedIndex = s.options.length - 1; s.dispatchEvent(new Event('change', {bubbles:true})); })()`); await sleep(600);
  check("selecting a live entry works: tagged 'SatNOGS live', Doppler still computes", await ev(`/SatNOGS live/.test(document.querySelector('#app').textContent) && /Crowd-sourced/.test(document.querySelector('#app').textContent) && document.querySelectorAll('.dopp-big b').length >= 1`));
  await ev(`(() => { const s = document.querySelector('#dRadio'); s.selectedIndex = 0; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);

  // ---- Compare with N2YO on a pass page
  const aos = await ev(`(() => { const S = SatStore, sat = SatPasses.makeSat(S.data.byId[25544]), o = SatPasses.makeObserver(S.settings.lat, S.settings.lon, S.settings.alt || 0); const p = SatPasses.findPasses(sat, o, Date.now(), Date.now() + 2 * 864e5, { minEl: S.settings.minEl })[0]; return p ? Math.round(p.aos) : null; })()`);
  await go("#/pass/25544/" + aos); await sleep(800);
  check("pass detail shows a 'Compare with N2YO' button when N2YO is set up", await ev(`!!${qs("#n2cmp")}`));
  await ev(`window.__reqs.length = 0`); await click("#n2cmp");
  check("Compare with N2YO: table with SatPass vs N2YO AOS/max/LOS and the deltas (≈ +7 s / +3 s / −9 s)", await waitFor(`!!document.querySelector('#n2out table.cmp')`) && await ev(`(() => { const t = document.querySelector('#n2out').textContent; return /Δ SatPass − N2YO/.test(t) && /\\+[6-8] s/.test(t) && /-(8|9|10) s/.test(t); })()`), await ev(`document.querySelector('#n2out').textContent.slice(0, 300)`));
  check("remaining quota from N2YO's transactionscount is shown (7) with the free-tier limit", await ev(`/transactions in the last 60 min: 7/.test(document.querySelector('#n2out').textContent) && /100\\/h/.test(document.querySelector('#n2out').textContent)`));
  await click("#n2cmp"); await sleep(700);
  check("pressing it again is served from the 30-min cache (no second radiopasses request)", await ev(`window.__reqs.filter(r => /radiopasses/.test(r.url)).length === 1 && /cache/i.test(document.querySelector('#n2msg').textContent + document.querySelector('#n2out').textContent)`));

  // ---- service worker never caches credentialed / API requests
  await ev(`fetch('css/style.css?apiKey=${CRED.n2}', { headers: { 'X-N2YO-Key': '${CRED.n2}' } }).then(r => r.status)`);
  await ev(`fetch('css/style.css', { headers: { 'Authorization': 'Token ${CRED.sn}' } }).then(r => r.status)`);
  await sleep(500);
  const cached = JSON.parse(await ev(`caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys()).then(rs => rs.map(r => r.url))))).then(a => JSON.stringify([].concat(...a)))`));
  check("service worker: nothing credentialed in any cache (no apiKey/token URLs, no proxy/API hosts)", cached.length > 20 && cached.every(u => !/apikey|SMOKE-|mock-proxy|space-track|satnogs\.org|n2yo\.com|celestrak/i.test(u)), cached.filter(u => /apikey|SMOKE-|mock-proxy|space-track|satnogs|n2yo|celestrak/i.test(u)));
  check("service worker is controlling this page (so the check above exercised it)", await ev(`!!navigator.serviceWorker.controller`));

  // ---- CSP blocks anything outside the allow-list (expected console error is removed from the problem list afterwards)
  const cspBefore = problems.length;
  const blocked = await ev(`fetch('https://example.org/leak?x=1').then(() => 'allowed', () => 'blocked')`); await sleep(300);
  check("CSP connect-src blocks requests to hosts outside the allow-list", blocked === "blocked" && (await ev(`window.__csp.length`)) >= 1, await ev(`window.__csp`));
  problems.splice(cspBefore, problems.length - cspBefore, ...problems.slice(cspBefore).filter(m => !/Content Security Policy|Refused to connect|example\.org/i.test(m)));

  // ---- passphrase lock / reload / unlock
  await go("#/settings"); await sleep(400);
  await ev(setVal("#passIn", CRED.pass)); await click("#passLock"); await waitFor(`/encrypted with your passphrase/i.test(${qs("#credNote")}.textContent)`);
  check("passphrase: stored credentials become an AES-GCM blob (no plaintext secret in localStorage)", await ev(`(() => { const raw = localStorage.getItem('satpass:creds'); return /"enc":1/.test(raw) && ![${SECRETS.map(s => JSON.stringify(s)).join(",")}].some(s => raw.indexOf(s) >= 0); })()`));
  await reload(); await go("#/settings"); await sleep(500);
  check("after reload the credentials are locked (sources not ready) and the UI says so", await ev(`SatStore.sources.isLocked() && !SatStore.sources.readiness('spacetrack').ready && /locked|encrypted/i.test(document.querySelector('#credNote').textContent) && document.querySelector('#passLock').textContent === 'Unlock'`));
  await ev(setVal("#passIn", "wrong-passphrase")); await click("#passLock"); await sleep(1200);
  check("wrong passphrase: still locked, friendly message", await ev(`SatStore.sources.isLocked() && /Wrong passphrase/i.test(document.querySelector('#passMsg').textContent)`));
  await ev(setVal("#passIn", CRED.pass)); await click("#passLock");
  check("right passphrase: unlocked, Space-Track ready again", await waitFor(`!SatStore.sources.isLocked() && SatStore.sources.readiness('spacetrack').ready`));

  // ---- Forget credentials
  await go("#/settings"); await sleep(400);
  const beforeForget = await ev(`localStorage.getItem('satpass:creds') !== null`);
  await click("#forgetCreds"); await sleep(400);
  check("Forget credentials: key removed (local + session), fields empty, sources not ready, settings (proxy/order) kept", beforeForget && await ev(`localStorage.getItem('satpass:creds') === null && sessionStorage.getItem('satpass:creds') === null && ['#stId','#stPw','#snToken','#n2Key','#srcProxyToken'].every(s => document.querySelector(s).value === '') && !SatStore.sources.readiness('spacetrack').ready && JSON.parse(localStorage.getItem('satpass:sources')).proxy === 'https://mock-proxy.workers.dev'`));
  check("after Forget no secret exists anywhere in localStorage / sessionStorage / the DOM / the URL", await ev(`(() => { const all = JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.documentElement.outerHTML + location.href; return ![${SECRETS.map(s => JSON.stringify(s)).join(",")}].some(s => all.indexOf(s) >= 0); })()`));
  check("proxy-only (no credentials) means Space-Track/N2YO report 'not set up' while CelesTrak stays usable", await ev(`/Not set up/.test(document.querySelector('.srcStatus[data-id=spacetrack]').textContent) && SatStore.sources.readiness('celestrak').ready`));

  // ---- console output never contains a secret (all console types, not only errors)
  check("no credential value appeared in ANY console message during the whole data-source session", consoleAll.length >= 0 && consoleAll.every(m => SECRETS.every(s => m.indexOf(s) < 0)), consoleAll.filter(m => SECRETS.some(s => m.indexOf(s) >= 0)));
  check("no console errors/warnings during the data-source session (excluding the deliberate CSP probe)", problems.length === problemMark, problems.slice(problemMark));

  // ---- restore a clean state for the remaining phases
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  await ev(`['__ctdown','satpass:sources','satpass:srcstatus','satpass:srclimit','satpass:txlive','satpass:n2yocache','satpass:creds','satpass:tle','satpass:tlemeta','satpass:groups','satpass:catmeta'].forEach(k => localStorage.removeItem(k))`);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await reload(); await go("#/passes"); await sleep(800);
};
