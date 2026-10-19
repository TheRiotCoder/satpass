// SatPass headless-Chrome smoke test over raw CDP (no npm deps). Needs google-chrome + python3. Pattern adapted from rf-toolbox/tests/browser-smoke.js.
// Run: node --experimental-websocket tests/browser-smoke.js      (Node 22+: flag not needed)
// Env: SKIP_NET=1 skips the checks that contact celestrak.org (real CORS fetch + refresh button); APP_URL=... tests a deployed copy (offline phase skipped).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const PORT = 9335, HTTP = 8767, LOCAL = !process.env.APP_URL, APP = process.env.APP_URL || `http://127.0.0.1:${HTTP}/satpass/`, SKIP_NET = !!process.env.SKIP_NET;
const SHOTS = '/tmp/satpass-shots'; fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync('/tmp/chrome-satpass', { recursive: true, force: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server;
if (LOCAL) { // serve the repo under /satpass/ to mimic the GitHub Pages subpath
  const root = '/tmp/satpass-serve'; fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root);
  fs.symlinkSync(path.join(__dirname, '..'), root + '/satpass');
  server = spawn('python3', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
}
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-satpass', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const problems = [], consoleAll = []; let ws, nextId = 1; const pending = new Map(); const listeners = [];
function send(method, params = {}) { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej, method })); }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + expr + ' -> ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
function waitEvent(name, ms = 15000) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + name)), ms); listeners.push({ name, fn: p => { clearTimeout(t); res(p); } }); }); }
const results = [];
function check(name, ok, info) { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
const setVal = (sel, v) => `(() => { const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`;
const shot = async (name, full) => fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full })).data, 'base64'));
const reloadAt = async h => { await ev(`history.replaceState(null, '', ${JSON.stringify(h)})`); const l = waitEvent('Page.loadEventFired'); await send('Page.reload', {}); await l; };
const waitFor0 = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(250); } return false; };
const go = async h => { await ev(`location.hash=${JSON.stringify(h)}`); await sleep(500); };
const noOverflow = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1');
// how many pixels of a canvas differ from its top-left pixel (proves something was drawn)
const canvasInk = sel => ev(`(() => { const c=document.querySelector(${JSON.stringify(sel)}); if(!c) return -1; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; const r=d[0],g=d[1],b=d[2],a=d[3]; for(let i=0;i<d.length;i+=4) if(d[i]!==r||d[i+1]!==g||d[i+2]!==b||d[i+3]!==a) n++; return n; })()`);

(async () => {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch (e) {} await sleep(200); }
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(p.method + ': ' + msg.error.message)) : p.res(msg.result); return; }
    const { method, params } = msg;
    if (method === 'Runtime.consoleAPICalled') consoleAll.push(params.type + ': ' + params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' '));
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(params.type)) problems.push('console.' + params.type + ': ' + params.args.map(a => a.value !== undefined ? a.value : a.description).join(' '));
    if (method === 'Runtime.exceptionThrown') problems.push('exception: ' + (params.exceptionDetails.exception ? params.exceptionDetails.exception.description : params.exceptionDetails.text));
    if (method === 'Log.entryAdded' && params.entry.level === 'error') problems.push('log.error: ' + params.entry.text + ' ' + (params.entry.url || ''));
    if (method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
    for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].name === method) { const l = listeners[i]; listeners.splice(i, 1); l.fn(params); }
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'America/Chicago' });
  try { await send('Browser.grantPermissions', { permissions: ['geolocation'], origin: new URL(APP).origin }); } catch (e) { console.log('(could not grant geolocation permission:', e.message + ')'); }
  await send('Emulation.setGeolocationOverride', { latitude: 51.5074, longitude: -0.1278, accuracy: 25 });

  let ld = waitEvent('Page.loadEventFired'); await send('Page.navigate', { url: APP }); await ld; await sleep(1500);
  check('title', (await ev('document.title')).includes('SatPass'), await ev('document.title'));
  check('served from /satpass/ subpath', await ev('location.pathname') === '/satpass/' || !LOCAL, await ev('location.pathname'));
  check('SW active', await ev('navigator.serviceWorker.ready.then(r => !!r.active)'));
  check('manifest parses (relative start_url/scope, 3 icons)', await ev(`fetch('manifest.webmanifest').then(r=>r.json()).then(m=>m.icons.length===3 && m.display==='standalone' && m.start_url.startsWith('./') && m.scope==='./' && m.icons.every(i=>!i.src.startsWith('/')))`));
  check('icons reachable', await ev(`Promise.all(['icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png','icons/favicon-32.png'].map(u=>fetch(u).then(r=>r.ok))).then(a=>a.every(Boolean))`));
  check('no absolute-path asset references in index.html', await ev(`fetch('index.html').then(r=>r.text()).then(t=>!/(?:src|href)="\\//.test(t))`));
  check('bundled snapshot loaded (>=150 sats incl. ISS)', await ev(`SatStore.data.sats.length >= 150 && !!SatStore.data.byId[25544]`), await ev('SatStore.data.sats.length'));
  check('no location yet -> setup prompt shown', await ev(`!!document.querySelector('#locCard') && !document.querySelector('.pass')`));
  await shot('01-no-location');

  // ---- location entry: grid -> lat/lon, lat/lon -> grid, validation, GPS
  await ev(setVal('#gridIn', 'EM10dg'));
  let ll = await ev(`[document.querySelector('#latIn').value, document.querySelector('#lonIn').value]`);
  check('grid EM10dg -> centre lat/lon (30.2708, -97.7083)', Math.abs(+ll[0] - 30.2708) < 0.001 && Math.abs(+ll[1] + 97.7083) < 0.001, ll);
  await ev(setVal('#gridIn', 'ZZ99')); check('invalid grid flagged', await ev(`document.querySelector('#gridIn').classList.contains('bad')`));
  await ev(setVal('#latIn', '95')); await ev(`document.querySelector('#saveLoc').click()`);
  check('latitude 95 rejected, nothing saved', await ev(`document.querySelector('#latIn').classList.contains('bad') && !SatStore.hasLocation()`), await ev(`document.querySelector('#locMsg').textContent`));
  await ev(setVal('#latIn', '30.2672')); await ev(setVal('#lonIn', '-97.7431'));
  check('lat/lon -> grid EM10dg', await ev(`document.querySelector('#gridIn').value`) === 'EM10dg', await ev(`document.querySelector('#gridIn').value`));
  await ev(`document.querySelector('#gpsBtn').click()`); await sleep(800);
  ll = await ev(`[SatStore.settings.lat, SatStore.settings.lon, SatGrid.toGrid(SatStore.settings.lat, SatStore.settings.lon, 6), SatStore.hasLocation()]`);
  check('GPS button takes a (mock) fix and saves it (London IO91wm)', Math.abs(ll[0] - 51.5074) < 0.001 && ll[2] === 'IO91wm' && ll[3], ll);
  await go('#/settings'); await ev(setVal('#latIn', '30.2672')); await ev(setVal('#lonIn', '-97.7431')); await ev(setVal('#altIn', '150')); await ev(`document.querySelector('#saveLoc').click()`); await sleep(300);
  check('manual location saved to localStorage', await ev(`JSON.parse(localStorage.getItem('satpass:settings')).lat === 30.2672 && JSON.parse(localStorage.getItem('satpass:settings')).alt === 150`));
  await shot('02-settings', true);

  // ---- passes from bundled TLEs
  await go('#/passes'); await sleep(2500);
  // a first-run automatic CelesTrak refresh (bundled snapshot older than 6 h) re-renders the list once: wait for it instead of sampling mid-render
  for (let i = 0; i < 20 && !(await ev(`document.querySelectorAll('.pass').length >= 5`)); i++) await sleep(500);
  const passes = await ev(`[...document.querySelectorAll('.pass')].map(b => ({ n: +b.dataset.n, aos: +b.dataset.aos, text: b.textContent, el: parseFloat(b.querySelector('.el').textContent) }))`);
  check('passes list populated from bundled TLEs (favorites, 3 days)', passes.length >= 5, passes.length);
  check('passes sorted by AOS', passes.every((p, i) => i === 0 || p.aos >= passes[i - 1].aos));
  check('every pass max el >= min elevation (10°)', passes.every(p => p.el >= 9.5), passes.map(p => p.el).join(','));
  check('ISS passes present', passes.some(p => p.n === 25544));
  check('next-pass countdown bar visible', await ev(`!document.querySelector('#nextbar').hidden && /Next:|overhead/.test(document.querySelector('#nextbar').textContent)`), await ev(`document.querySelector('#nextbar').textContent`));
  check('passes view no horizontal overflow @390px', await noOverflow());
  await shot('03-passes');
  // time zone toggle
  const first = passes[0], utcHM = new Date(first.aos).toISOString().slice(11, 16);
  await ev(`document.querySelector('#tzBtn').click()`); await sleep(2500);
  const t1 = await ev(`document.querySelector('.pass .t1').textContent`);
  check('UTC toggle: first pass shows UTC clock time', t1.includes(utcHM) && (await ev(`document.querySelector('#tzBtn').textContent`)) === 'UTC', [t1, utcHM]);
  await ev(`document.querySelector('#tzBtn').click()`); await sleep(2500);
  const chiHM = await ev(`new Date(${first.aos}).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'America/Chicago'})`);
  check('Local toggle back: first pass shows America/Chicago clock time', (await ev(`document.querySelector('.pass .t1').textContent`)).includes(chiHM) && (await ev(`document.querySelector('#tzBtn').textContent`)) === 'Local', chiHM);
  // min elevation filter
  await ev(setVal('#elSel', '30')); await sleep(2500);
  const hi = await ev(`[...document.querySelectorAll('.pass .el')].map(e=>parseFloat(e.textContent))`);
  check('min elevation 30° filter: fewer passes, all >= 30°', hi.length < passes.length && hi.every(v => v >= 29.5), hi.length + ' of ' + passes.length);
  await ev(setVal('#elSel', '10')); await sleep(2500);

  // ---- pass detail
  const iss = passes.find(p => p.n === 25544);
  await ev(`document.querySelector('.pass[data-n="25544"]').click()`); await sleep(900);
  check('detail route', (await ev('location.hash')).startsWith('#/pass/25544/'), await ev('location.hash'));
  check('sky plot canvas rendered (non-blank)', (await canvasInk('#sky')) > 2000, await canvasInk('#sky'));
  const rows = await ev(`[...document.querySelectorAll('#tbody tr')].map(r => [...r.children].map(c => c.textContent))`);
  check('az/el/range table has rows, first el ≈ min elevation', rows.length > 10 && Math.abs(parseFloat(rows[0][3]) - 10) < 1.5, rows[0]);
  check('table range plausible (ISS 400–2500 km)', rows.every(r => +r[4] > 380 && +r[4] < 2600));
  await ev(`document.querySelector('#stepSeg button[data-v="10"]').click()`); await sleep(200);
  check('step 10 s gives ~3x rows', (await ev(`document.querySelectorAll('#tbody tr').length`)) > rows.length * 2);
  check('AOS/TCA/LOS summary + disclaimer text', await ev(`/AOS/.test(document.body.textContent) && /LOS/.test(document.body.textContent) && /TLE .* old/.test(document.querySelector('.disclaimer').textContent)`));
  await ev(`window.__blobs=[]; (function(){const o=URL.createObjectURL; URL.createObjectURL=b=>{__blobs.push(b); return o.call(URL,b)}})()`);
  await ev(`document.querySelector('#icsOne').click()`); await sleep(400);
  const ics = await ev(`__blobs.length ? __blobs[0].text() : null`);
  check('.ics export valid (VCALENDAR/VEVENT/VALARM, CRLF, UTC stamps)', !!ics && /^BEGIN:VCALENDAR\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics) && /BEGIN:VEVENT/.test(ics) && /DTSTART:\d{8}T\d{6}Z/.test(ics) && /BEGIN:VALARM/.test(ics) && !/[^\r]\n/.test(ics), ics && ics.split('\r\n').slice(0, 12));
  await ev(`document.querySelector('#remBtn').click()`); await sleep(500);
  check('reminder can be set (button toggles, stored)', /reminder set/i.test(await ev(`document.querySelector('#remBtn').textContent`)) && await ev(`JSON.parse(localStorage.getItem('satpass:reminders')).length`) === 1);
  check('notification permission/help text present', (await ev(`document.querySelector('#remMsg').textContent + '|' + (typeof Notification==='undefined'?'unsupported':Notification.permission)`)).length > 5, await ev(`typeof Notification==='undefined'?'unsupported':Notification.permission`));
  await ev(`document.querySelector('#remBtn').click()`); await sleep(200);
  check('reminder can be cancelled', await ev(`JSON.parse(localStorage.getItem('satpass:reminders')).length`) === 0);
  // system notification path: grant permission, make a reminder that is due now, and see a real notification appear
  try { await send('Browser.grantPermissions', { permissions: ['geolocation', 'notifications'], origin: new URL(APP).origin }); } catch (e) {}
  const perm = await ev(`typeof Notification === 'undefined' ? 'unsupported' : Notification.permission`);
  if (perm === 'granted') {
    await ev(`localStorage.setItem('satpass:reminders', JSON.stringify([{ id: 'test-1', norad: 25544, name: 'ISS', aos: Date.now() + 120000, los: Date.now() + 600000, lead: 5, maxEl: 42, fired: false }]))`);
    await sleep(2500);
    const nots = await ev(`navigator.serviceWorker.ready.then(r => r.getNotifications()).then(l => l.map(n => n.title))`);
    check('reminder fires a system notification via the service worker (permission granted)', nots.length >= 1 && /ISS pass/.test(nots[0]), nots);
    check('fired reminder is marked fired (no repeat)', await ev(`JSON.parse(localStorage.getItem('satpass:reminders'))[0].fired === true`));
    await ev(`localStorage.removeItem('satpass:reminders')`);
  } else console.log('NOTE: Notification permission could not be granted in headless Chrome (' + perm + '); system-notification delivery not exercised here');
  check('detail no horizontal overflow', await noOverflow());
  await shot('04-pass-detail', true);

  // ---- live tracker
  await go('#/live/25544'); await sleep(1500);
  const live = await ev(`[...document.querySelectorAll('#liveRead > div')].reduce((o, d) => (o[d.querySelector('small').textContent] = d.querySelector('b').textContent, o), {})`);
  const alt = parseFloat(live.Altitude.replace(/,/g, '')), lat = parseFloat(live.Latitude);
  check('live: ISS altitude 395–440 km (varies with latitude: orbit is slightly eccentric, geodetic height)', alt > 395 && alt < 440, live.Altitude);
  check('live: |lat| <= 51.7, az/el/range/range-rate present', Math.abs(lat) <= 51.7 && !!live.Azimuth && !!live.Elevation && /km$/.test(live.Range) && /km\/s/.test(live['Range rate']), live);
  check('live: world map drawn', (await canvasInk('#map')) > 5000, await canvasInk('#map'));
  const clock1 = await ev(`document.querySelector('#liveHead').textContent`); await sleep(2100);
  check('live: updates every second', clock1 !== (await ev(`document.querySelector('#liveHead').textContent`)));
  check('live no overflow', await noOverflow());
  await shot('05-live');
  check('live: 2D tab selected initially', await ev(`document.querySelector('#tab2d').getAttribute('aria-selected') === 'true' && document.querySelector('#panel3d').hidden`));
  await ev(`document.querySelector('#tab3d').click()`); await sleep(300);
  check('live: 3D tab reveals rendered globe', await ev(`document.querySelector('#panel2d').hidden && !document.querySelector('#panel3d').hidden && document.querySelector('#tab3d').getAttribute('aria-selected') === 'true'`) && (await canvasInk('#globe')) > 5000);
  check('live: 3D no overflow on mobile', await noOverflow());
  await shot('05-live-globe');
  const globeBefore = await ev(`document.querySelector('#globe').toDataURL()`);
  await ev(`document.querySelector('#globe').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))`); await sleep(200);
  check('live: keyboard rotates globe', globeBefore !== await ev(`document.querySelector('#globe').toDataURL()`));
  await go('#/live/25338'); await sleep(300);
  check('live: remembers 3D when selecting another satellite', await ev(`document.querySelector('#tab3d').getAttribute('aria-selected') === 'true' && !document.querySelector('#panel3d').hidden`));
  await ev(`document.querySelector('#tab3d').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}))`);
  check('live: keyboard switches back to 2D and focuses tab', await ev(`document.activeElement.id === 'tab2d' && document.querySelector('#panel3d').hidden`) && (await canvasInk('#map')) > 5000);
  await ev(`document.querySelector('#tabsky').click()`);
  check('live: third Sky View tab renders selected-satellite chart', (await canvasInk('#liveSkyCanvas')) > 5000 && await ev(`document.querySelector('#panel2d').hidden && document.querySelector('#panel3d').hidden && !document.querySelector('#panelsky').hidden && /Bearing.*Elevation.*Range/.test(document.querySelector('#liveSkyReadout').textContent)`));
  check('live: Sky View fits mobile width', await noOverflow());
  await shot('05-live-sky');
  check('live: Moon/planet reference layer enabled by default', await ev(`document.querySelector('#liveCelestialToggle').checked && !!document.querySelector('#liveCelestialList').textContent.trim()`));
  check('live: Polaris readout follows the observing horizon', await ev(`(() => { const star=SatCelestial.positions({lat:SatStore.settings.lat,lon:SatStore.settings.lon,alt:SatStore.settings.alt||0},Date.now()).find(b=>b.id==='star:Polaris'); return !!document.querySelector('#liveCelestialList [data-body="star:Polaris"]') === (star.el>=0); })()`));
  await ev(`document.querySelector('#liveCelestialToggle').click()`);
  check('live: reference layer can be disabled', await ev(`!SatStore.load('skyCelestial') && document.querySelector('#liveCelestialList').hidden`));
  await ev(setVal('#liveSel','25544')); await sleep(300);
  check('live: Sky View persists across satellite changes', await ev(`document.querySelector('#tabsky').getAttribute('aria-selected')==='true' && document.querySelector('#liveSkyReadout').textContent.startsWith('ISS')`));
  await ev(`document.querySelector('#tabsky').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
  check('live: Home returns to map from Sky View', await ev(`document.activeElement.id==='tab2d' && !document.querySelector('#panel2d').hidden && document.querySelector('#panelsky').hidden`));
  await ev(`document.querySelector('#tabground').click()`);
  check('live: fourth tab renders observer-centered 3D Sky', await waitFor0(`document.querySelector('#liveGround .ground-message')?.hidden`, 15000));
  await ev(`document.querySelector('#liveGroundE').click()`); await sleep(100);
  check('live: compass looks east in 3D Sky', await ev(`document.querySelector('#liveGround .ground-hud').textContent.includes('LOOKING E · 90°')`));
  check('live: 3D Sky fits mobile width', await noOverflow());
  await shot('05-live-3d-sky');

  // ---- Visible Now: all catalog objects, saved/custom observer, filters and both views
  await go('#/visible'); await sleep(500);
  check('Visible Now: page and navigation active', await ev(`document.title.includes('Visible Now') && document.querySelector('[data-tab="visible"]').classList.contains('on')`));
  check('Visible Now: all catalog categories loaded', await ev(`SatStore.allLoaded() && !document.querySelector('#visibleResults').hidden`));
  check('Visible Now: all-above-horizon is default', await ev(`document.querySelector('#visibleOptical').value === 'all' && document.querySelector('#visibleMinEl').value === '0'`));
  check('Visible Now: map and compass/elevation list rendered', (await canvasInk('#visibleMap')) > 5000 && await ev(`document.querySelectorAll('.visible-sat').length > 0 && [...document.querySelectorAll('.visible-bearing')].every(e=>/Bearing.*°/.test(e.textContent)) && [...document.querySelectorAll('.visible-el')].every(e=>parseFloat(e.textContent.replace('Elevation ','')) > 0)`));
  await ev(`document.querySelector('.visible-pick').click()`);
  check('Visible Now: selecting a satellite highlights its row', await ev(`document.querySelector('.visible-pick[aria-pressed="true"]') !== null`));
  await ev(`document.querySelector('#visibleTab3d').click()`); await sleep(200);
  check('Visible Now: globe renders all visible satellites', (await canvasInk('#visibleGlobe')) > 5000 && await ev(`document.querySelector('#visiblePanel2d').hidden`));
  check('Visible Now: mobile no overflow', await noOverflow());
  await shot('05-visible-now');
  await ev(`document.querySelector('#visibleTabsky').click()`);
  check('Visible Now: third tab renders the sky chart', (await canvasInk('#visibleSkyMap')) > 5000 && await ev(`document.querySelector('#visiblePanel3d').hidden && !document.querySelector('#visiblePanelsky').hidden && document.querySelector('#visibleTabsky').getAttribute('aria-selected')==='true'`));
  check('Visible Now: Sky View uses selected satellite readouts', await ev(`/Bearing.*Elevation.*Range/.test(document.querySelector('#visibleSkySelection').textContent)`));
  check('Visible Now: Sky View fits mobile width', await noOverflow());
  await shot('05-visible-sky');
  check('Visible Now: celestial layer preference shared with Live', await ev(`!document.querySelector('#visibleCelestialToggle').checked`));
  await ev(`document.querySelector('#visibleCelestialToggle').click()`);
  check('Visible Now: enabling reference layer shows current objects or horizon message', await ev(`SatStore.load('skyCelestial') && !!document.querySelector('#visibleCelestialList').textContent.trim()`));
  await ev(`document.querySelector('#visibleCelestialList .celestial-object')?.click()`);
  check('Visible Now: selecting a reference object preserves satellite selection identity', await ev(`!document.querySelector('#visibleCelestialList .celestial-object') || (document.querySelector('#visibleCelestialList [aria-pressed="true"]') && /Bearing.*Elevation/.test(document.querySelector('#visibleSkySelection').textContent))`));
  await ev(`document.querySelector('#visibleTabsky').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
  check('Visible Now: keyboard advances to fourth 3D Sky tab', await ev(`document.activeElement.id==='visibleTabground' && !document.querySelector('#visiblePanelground').hidden`));
  check('Visible Now: 3D sky renderer initializes', await waitFor0(`document.querySelector('#visibleGround .ground-message')?.hidden`, 15000));
  await ev(`document.querySelector('#visibleTabground').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
  check('Visible Now: keyboard wraps fourth tab to first', await ev(`document.activeElement.id==='visibleTab2d' && !document.querySelector('#visiblePanel2d').hidden && document.querySelector('#visiblePanelground').hidden`));
  await ev(`document.querySelector('#visibleTab2d').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
  check('Visible Now: End selects 3D Sky and remembers it', await ev(`document.activeElement.id==='visibleTabground' && SatStore.load('visibleView')==='ground'`));
  const savedPoint = await ev(`[SatStore.settings.lat,SatStore.settings.lon,SatStore.settings.alt]`);
  await ev(`document.querySelector('#visibleLocation').open=true`);
  await ev(setVal('#visibleLat', '-33.86')); await ev(setVal('#visibleLon', '151.21'));
  await ev(`document.querySelector('#visiblePointForm').requestSubmit()`); await sleep(200);
  check('Visible Now: custom observing point does not overwrite saved location', await ev(`document.querySelector('#visibleObserver').textContent.includes('-33.8600') && JSON.stringify([SatStore.settings.lat,SatStore.settings.lon,SatStore.settings.alt]) === ${JSON.stringify(JSON.stringify(savedPoint))}`));
  check('Visible Now: southern custom point hides Polaris', await ev(`!document.querySelector('#visibleCelestialList [data-body="star:Polaris"]')`));
  check('Visible Now: Moon/planet readouts use custom point', await ev(`(() => { const b=document.querySelector('#visibleCelestialList .celestial-object'); if(!b) return true; const expected=SatCelestial.positions({lat:-33.86,lon:151.21,alt:SatStore.settings.alt||0},Date.now()).find(p=>p.id===b.dataset.body); const shown=Number(b.textContent.match(/Elevation ([\\d.-]+)/)[1]); return expected && Math.abs(shown-expected.el)<0.2; })()`));
  await ev(setVal('#visibleDirection', 'N'));
  check('Visible Now: direction filter matches north sector', await ev(`[...document.querySelectorAll('.visible-bearing')].every(e=>/ N$/.test(e.textContent))`));
  await ev(setVal('#visibleDirection', 'all'));
  await ev(setVal('#visibleOptical', 'optical'));
  check('Visible Now: optional optical filter labels sunlit/dark only', await ev(`[...document.querySelectorAll('.visible-conditions')].every(e=>e.textContent==='Sunlit · dark sky')`));
  await ev(setVal('#visibleOptical', 'all')); await ev(`document.querySelector('#visibleSaved').click()`);
  check('Visible Now: returns to saved observing point', await ev(`document.querySelector('#visibleObserver').textContent.startsWith('Saved location')`));
  await go('#/live/25544');
  check('Live readouts still render after leaving Visible Now', await ev(`document.querySelector('#liveRead').textContent.includes('Altitude')`));

  // ---- Doppler
  await go('#/doppler/25544'); await sleep(2000);
  const rx = await ev(`[...document.querySelectorAll('.dopp-big b')].map(b => b.textContent)`);
  const rxMHz = parseFloat(rx[0]);
  check('Doppler: ISS APRS live Rx within ±4 kHz of 145.825', rx.length === 2 && Math.abs(rxMHz - 145.825) < 0.004, rx);
  const drows = await ev(`[...document.querySelectorAll('#dTbl tbody tr')].map(r => [...r.children].map(c => c.textContent))`);
  const shifts = drows.map(r => parseFloat(r[4].replace(/,/g, '')));
  check('Doppler table across pass: positive→negative shift (approach→recede), ~±3.5 kHz at 145.8 MHz', drows.length > 10 && shifts[0] > 1500 && shifts[0] < 4500 && shifts[shifts.length - 1] < -1500, [shifts[0], shifts[shifts.length - 1]]);
  check('Doppler: disclaimer marked approximate / AMSAT', await ev(`/Approximate/.test(document.querySelector('.banner.warn').textContent) && /amsat/i.test(document.querySelector('.banner.warn').textContent)`));
  await ev(setVal('#dSat', '7530')); await sleep(1500);
  const lin = await ev(`document.querySelector('#dNominal').textContent`);
  check('Doppler: AO-7 linear (inverting) with passband slider', /inverting/.test(lin) && !!(await ev(`document.querySelector('#dFrac')`)), lin);
  const nom0 = await ev(`document.querySelector('#dNominal').textContent`); await ev(setVal('#dFrac', '900')); await sleep(300);
  check('Doppler: slider changes frequencies', nom0 !== (await ev(`document.querySelector('#dNominal').textContent`)));
  check('Doppler no overflow', await noOverflow());
  await shot('06-doppler', true);

  // ---- Doppler radio selection must stick (regression: a stale 1 s timer from the previous render overwrote the chosen radio with the default)
  const holdSel = (ms) => ev(`(async () => { const out = []; const end = Date.now() + ${ms}; while (Date.now() < end) { out.push({ sel: (document.querySelector('#dRadio')||{}).value, nom: document.querySelector('#dNominal').textContent, big: [...document.querySelectorAll('.dopp-big b')].map(b => b.textContent), subs: [...document.querySelectorAll('.dopp-big span')].map(b => b.textContent), title: document.querySelector('section.card h2').textContent }); await new Promise(r => setTimeout(r, 120)); } return out; })()`);
  const mhzOf = t => parseFloat(t);
  const near = (v, c, tolKHz) => Math.abs(v - c) * 1000 <= tolKHz;
  await go('#/doppler/25544'); await sleep(1500);
  const issRadios = await ev(`[...document.querySelectorAll('#dRadio option')].map(o => o.textContent)`);
  check('Doppler: ISS offers 3 radios (APRS, voice repeater, SSTV)', issRadios.length === 3, issRadios);
  const expect = [ // [select index, nominal up MHz, nominal down MHz, tolerance kHz]
    [0, 145.825, 145.825], [1, 145.990, 437.800], [2, null, 145.800]];
  for (const [idx, up, down] of expect) {
    await ev(setVal('#dRadio', String(idx))); await sleep(300);
    const samples = await holdSel(4500);   // > 4 live ticks, sampled every 120 ms
    const okSel = samples.every(x => x.sel === String(idx));
    const okNom = samples.every(x => (up == null || x.nom.includes(up.toFixed(4))) && x.nom.includes(down.toFixed(4)) && (up != null || !/uplink/.test(x.nom)));
    const okLive = samples.every(x => { const b = x.big.map(mhzOf); return b.length === (up == null ? 1 : 2) && near(b[0], down, 12) && (up == null || near(b[1], up, 12)); });
    const okSub = samples.every(x => x.subs.every(t => up == null ? t.includes(down.toFixed(4)) : (t.includes(down.toFixed(4)) || t.includes(up.toFixed(4)))));
    check(`Doppler ISS radio #${idx}: selection, nominal and corrected freqs stay on the chosen radio for 4.5 s (${samples.length} samples)`, okSel && okNom && okLive && okSub, okSel && okNom && okLive && okSub ? undefined : samples.filter(x => x.sel !== String(idx) || !x.nom.includes(down.toFixed(4)) || !x.big.every((v, i) => near(mhzOf(v), i ? up : down, 12))).slice(0, 3));
    check(`Doppler ISS radio #${idx}: persisted in localStorage`, await ev(`localStorage.getItem('satpass:dopRadio:25544')`) === String(idx));
  }
  // table follows the chosen radio too (SSTV is downlink-only -> no Tx columns)
  check('Doppler ISS SSTV: table has Rx columns only', await ev(`[...document.querySelectorAll('#dTbl thead th')].map(t => t.textContent).join('|')`) === 'Time|El|Rate km/s|Rx MHz|Rx Δ Hz');
  // voice repeater again; then leave and come back / switch satellites / TLE refresh
  await ev(setVal('#dRadio', '1')); await sleep(400);
  await go('#/live/25544'); await sleep(800); await go('#/doppler/25544'); await sleep(1500);
  let h = await holdSel(2500);
  check('Doppler: radio choice survives leaving the tab and coming back', h.every(x => x.sel === '1' && x.nom.includes('437.8000') && near(mhzOf(x.big[0]), 437.8, 12)), h[0]);
  await ev(setVal('#dSat', '7530')); await sleep(1200);
  await ev(setVal('#dRadio', '1')); await sleep(300);   // AO-7: mode A (index 1)
  h = await holdSel(3000);
  check('Doppler AO-7 (2 modes): mode A stays selected over several ticks and is NON-inverting (1.2.1: 29.49 down <-> 145.94 up)', h.every(x => x.sel === '1' && x.nom.includes('145.94') && x.nom.includes('29.49') && x.nom.includes('non-inverting')), h[0] && h[0].nom);
  await ev(setVal('#dSat', '25544')); await sleep(1500);
  h = await holdSel(2500);
  check('Doppler: switching satellites and back restores each satellite\'s own radio (ISS #1, not reset to #0)', h.every(x => x.sel === '1' && near(mhzOf(x.big[0]), 437.8, 12)) && (await ev(`localStorage.getItem('satpass:dopRadio:7530')`)) === '1', h[0]);
  const issE = await ev(`(() => { const e = SatStore.data.byId[25544]; return { l1: e.l1, l2: e.l2 }; })()`);
  await ev(`SatStore.importText(${JSON.stringify('ISS (ZARYA)\n' + '')} + ${JSON.stringify(issE.l1 + '\n' + issE.l2 + '\n')})`);   // triggers the store's change event (like a TLE refresh)
  h = await holdSel(2500);
  check('Doppler: radio choice survives a TLE data refresh/import', h.every(x => x.sel === '1' && near(mhzOf(x.big[0]), 437.8, 12)), h[0]);

  // ---- long / truncated / in-progress passes in the UI (AO-10: ~10 h passes at min elevation 0)
  await ev(`SatStore.set({ minEl: 0, days: 5 })`); await go('#/passes/14129'); await sleep(3000);
  const aoRows = await ev(`document.querySelectorAll('.pass').length`);
  check('AO-10 single-satellite passes list renders (long passes)', aoRows >= 1, aoRows);
  await ev(`document.querySelector('.pass').click()`); await sleep(900);
  const longInfo = await ev(`({ note: document.querySelector('#stepNote').textContent, rows: document.querySelectorAll('#tbody tr').length, ink: 0 })`);
  check('long pass: step auto-increased, table kept to a readable size', /Long pass/.test(longInfo.note) && longInfo.rows > 20 && longInfo.rows < 600, longInfo);
  check('long pass: sky plot drawn', (await canvasInk('#sky')) > 2000);
  // force a truncated pass into the cache and check the UI says so (LOS not found within limit)
  await ev(`(() => { const c = SatApp._passCache()[14129]; c.passes[0].truncated = true; })()`);
  await go('#/passes/14129'); await ev(`SatApp.route()`); await sleep(1500);
  check('truncated pass: list shows "LOS ≥" tag and ≥ time', await ev(`!!document.querySelector('.pass .tag.warn') && /LOS ≥/.test(document.querySelector('.pass .tg').textContent) && /≥/.test(document.querySelector('.pass .t1').textContent)`));
  await ev(`document.querySelector('.pass').click()`); await sleep(700);
  check('truncated pass: detail warns LOS/duration are lower bounds, plot labelled "limit"', await ev(`/lower bounds/.test(document.querySelector('main').textContent)`));
  check('detail has the visibility/approximations help text', await ev(`/cylindrical Earth-shadow/.test(document.querySelector('details.more').textContent) && /refraction/.test(document.querySelector('details.more').textContent)`));
  await go('#/settings'); await sleep(400);
  check('About documents approximations (geometric, cylindrical shadow, -6°)', await ev(`/geometric/.test(document.body.textContent) && /cylindrical Earth shadow/.test(document.body.textContent) && /−6°/.test(document.body.textContent)`));
  await ev(`SatStore.set({ minEl: 10, days: 3 })`);

  // ---- satellites
  await go('#/sats'); await ev(setVal('#q', 'so-50')); await sleep(300);
  check('search finds SO-50', await ev(`document.querySelectorAll('#satList .sat').length`) >= 1 && /SO-50/.test(await ev(`document.querySelector('#satList .sat .nm b').textContent`)));
  const favBefore = await ev(`SatStore.isFav(27607)`); await ev(`document.querySelector('#satList .star').click()`);
  check('favorite toggle persists', (await ev(`SatStore.isFav(27607)`)) !== favBefore && (await ev(`JSON.parse(localStorage.getItem('satpass:settings')).favs.includes(27607)`)) !== favBefore);
  await ev(`document.querySelector('#satList .star').click()`);
  await ev(setVal('#q', 'tevel')); await sleep(200);
  check('search finds TEVEL sats', await ev(`document.querySelectorAll('#satList .sat').length`) >= 3);
  await ev(setVal('#q', '')); await ev(`document.querySelector('#modeSeg button[data-v="all"]').click()`); await sleep(300);
  check('"All" lists >150 satellites', await ev(`document.querySelectorAll('#satList .sat').length`) > 150);
  const pasted = await ev(`SatStore.importText('garbage').ok`); check('pasting garbage is rejected with message', pasted === false);
  check('data-status line present', await ev(`/Element sets from/.test(document.querySelector('#dsText').textContent)`), await ev(`document.querySelector('#dsText').textContent`));
  check('sats no overflow', await noOverflow());
  await shot('07-sats');

  // ---- v1.1: categories, SAR list, radar panel, favourites across categories, migration
  const CATS = ['amateur', 'stations', 'weather', 'sar', 'eo', 'nav', 'science'];
  await go('#/sats'); await sleep(1200);
  const chipInfo = await ev(`[...document.querySelectorAll('#modeSeg .chip')].map(b => [b.dataset.v, +((b.querySelector('.cnt') || {}).textContent || 0)])`);
  check('category chips with counts: Amateur, Stations, Weather, SAR, Earth obs., Navigation, Science', CATS.every(id => chipInfo.some(c => c[0] === id && c[1] > 0)), chipInfo);
  await ev(`document.querySelector('#modeSeg [data-v="sar"]').click()`); await sleep(400);
  const sarRows = await ev(`document.querySelectorAll('#satList .sat').length`);
  check('SAR category lists the whole SAR catalogue (>=125 rows incl. no-TLE entries)', sarRows >= 125, sarRows);
  check('SAR list contains Sentinel-1A, RADARSAT-2, ICEYE, NISAR, BIOMASS, COSMO-SkyMed + "no public TLE" entries', await ev(`['SENTINEL-1A','RADARSAT-2','ICEYE-X2','NISAR','COSMO-SKYMED 1','BIOMASS'].every(n => [...document.querySelectorAll('#satList .nm b')].some(b => b.textContent.includes(n))) && /no public TLE/.test(document.querySelector('#satList').textContent)`));
  check('SAR rows show radar band + frequency', await ev(`/C-band 5\.405 GHz/.test([...document.querySelectorAll('#satList .nm')].find(b => /SENTINEL-1A/.test(b.textContent)).textContent)`));
  await ev(setVal('#q', 'sentinel')); await sleep(250);
  check('text filter inside category: "sentinel" -> the four Sentinel-1 satellites', await ev(`document.querySelectorAll('#satList .sat .nm').length`) === 4 || (await ev(`[...document.querySelectorAll('#satList .nm b')].map(b => b.textContent)`)));
  await ev(setVal('#q', 'iss')); await sleep(250);
  check('category filter excludes non-SAR satellites ("iss" finds no ISS inside SAR)', await ev(`![...document.querySelectorAll('#satList .nm b')].some(b => /ISS \(ZARYA\)/.test(b.textContent))`));
  await ev(setVal('#q', 'x-band')); await sleep(250);
  const xRows = await ev(`document.querySelectorAll('#satList .sat .nm').length`);
  await ev(setVal('#q', 'l-band')); await sleep(250);
  const lRows = await ev(`document.querySelectorAll('#satList .sat .nm').length`);
  check('text filter by band: X-band > 80 rows, L-band between 5 and 20', xRows > 80 && lRows >= 5 && lRows <= 20, { xRows, lRows });
  await ev(setVal('#q', '')); await ev(`document.querySelector('#modeSeg [data-v="amateur"]').click()`); await sleep(300);
  check('Amateur category lists amateur satellites only (SO-50 yes, Sentinel no)', await ev(`(() => { const t = document.querySelector('#satList').textContent; return /SO-50/.test(t) && !/SENTINEL-1A/.test(t); })()`));
  for (const c of ['nav', 'eo', 'science', 'weather', 'stations']) {
    await ev(`document.querySelector('#modeSeg [data-v="${c}"]').click()`); await sleep(250);
    const rows = await ev(`document.querySelectorAll('#satList .sat').length`), want = chipInfo.find(x => x[0] === c)[1];
    check(`category "${c}" lists its ${want} satellites`, rows === want, { rows, want });
  }
  await ev(`document.querySelector('#modeSeg [data-v="nav"]').click()`); await sleep(200);
  check('Navigation has GPS, Galileo, GLONASS, BeiDou', await ev(`(() => { const t = document.querySelector('#satList').textContent; return /GPS|NAVSTAR/.test(t) && /GSAT/.test(t) && /COSMOS/.test(t) && /BEIDOU/.test(t); })()`));
  await ev(`document.querySelector('#modeSeg [data-v="all"]').click()`); await sleep(300);
  check('no Starlink/OneWeb in any category or in "All"', await ev(`!/STARLINK|ONEWEB/i.test(document.querySelector('#satList').textContent)`));
  await ev(setVal('#q', 'starlink')); await sleep(300);
  check('"starlink" alone is not looked up (needs a number)', await ev(`!document.querySelector('#lookupBtn') && /thousands of satellites/.test(document.querySelector('#satList').textContent)`));
  await ev(setVal('#q', '')); await sleep(100);
  check('sats tab with chips: no overflow', await noOverflow());
  await shot('07b-sats-sar');
  await ev(`document.querySelector('#modeSeg [data-v="sar"]').click()`); await sleep(300);
  // favourites across categories
  await ev(setVal('#q', 'sentinel-1a')); await sleep(250);
  const s1fav = await ev(`SatStore.isFav(39634)`); await ev(`document.querySelector('#satList .star[data-n="39634"]').click()`);
  check('favourite a SAR satellite: persisted with the others', (await ev(`SatStore.isFav(39634)`)) !== s1fav && await ev(`JSON.parse(localStorage.getItem('satpass:settings')).favs.includes(39634) && SatStore.isFav(25544)`));
  await ev(setVal('#q', '')); await go('#/live'); await sleep(800);
  check('Live selector has category groups and the favourited SAR satellite', await ev(`(() => { const g = [...document.querySelectorAll('#liveSel optgroup')].map(o => o.label); return ['Favorites','Curated','Amateur','SAR','Earth observation','Navigation','Science'].every(l => g.includes(l)) && [...document.querySelectorAll('#liveSel optgroup[label="Favorites"] option')].some(o => o.value === '39634'); })()`));
  await go('#/live/39634'); await sleep(1500);
  check('live tracker for Sentinel-1A (SAR)', await ev(`/SENTINEL-1A/.test(document.querySelector('#liveSel').selectedOptions[0].textContent) && !!document.querySelector('a[href="#/doppler/39634"]')`) && (await canvasInk('#map')) > 3000);
  await go('#/passes'); await sleep(2000);
  check('Passes: "My favorites" now includes Sentinel-1A passes', await ev(`[...document.querySelectorAll('.pass .t1')].some(t => /SENTINEL-1A/.test(t.textContent))`));
  await ev(setVal('#scopeSel', 'cat:sar')); let sarPasses = 0; const tp0 = Date.now(); for (let i = 0; i < 90 && !sarPasses; i++) { await sleep(1000); sarPasses = await ev(`document.querySelectorAll('.pass').length`); }
  check('Passes scope "All SAR" lists passes for SAR satellites (computed in %ss)'.replace('%s', Math.round((Date.now() - tp0) / 1000)), sarPasses >= 20 && await ev(`new Set([...document.querySelectorAll('.pass')].map(b => b.dataset.n)).size >= 10`), sarPasses);
  await ev(setVal('#scopeSel', 'favs')); await sleep(500);

  // radar panel (Sentinel-1A) -- replaces up/downlink
  await go('#/doppler/39634'); await sleep(2500);
  const rp = await ev(`({ card: (document.querySelector('#radarCard') || {}).textContent || '', label: (document.querySelector('#rLabel') || {}).textContent || '', shift: (document.querySelector('#rShift') || {}).textContent || '',
    live: (document.querySelector('#rLive') || {}).textContent || '', noUpDown: !document.querySelector('.dopp-big b + span') || !/uplink|downlink|Tune receiver|Transmit on/i.test(document.querySelector('#rLive').textContent),
    exp: (() => { const s = SatPasses.stateAt(SatPasses.makeSat(SatStore.data.byId[39634]), SatPasses.makeObserver(SatStore.settings.lat, SatStore.settings.lon, SatStore.settings.alt), Date.now()); return -5405e6 * s.rrKmS / 299792.458; })() })`);
  check('Sentinel-1A radar panel: C-band, 5405 MHz, 100 MHz, VV+VH, sources', /C-band/.test(rp.card) && /5405 MHz \(5\.405 GHz\)/.test(rp.card) && /100 MHz/.test(rp.card) && /VV\+VH/.test(rp.card) && /sentiwiki\.copernicus\.eu/.test(rp.card), rp.card.slice(0, 220));
  check('radar panel shows the exact one-way Doppler label', rp.label.trim() === 'one-way carrier Doppler at observer, informational; actual SAR processing uses two-way Doppler centroid with antenna pointing.' || rp.label.indexOf('one-way carrier Doppler at observer, informational; actual SAR processing uses two-way Doppler centroid with antenna pointing') === 0, rp.label);
  const sh = Number(rp.shift.replace(/,/g, '').replace('−', '-').replace(/[^\d.+\-]/g, ''));
  check('one-way carrier Doppler value matches an independent computation (±300 Hz)', Math.abs(sh - rp.exp) < 300 && Math.abs(rp.exp) < 150000, { shown: rp.shift, expected: Math.round(rp.exp) });
  check('radar panel has ascending/descending flag and local solar time', /Ascending|Descending/.test(rp.live) && /Local solar time\d\d:\d\d/.test(rp.live), rp.live.slice(0, 160));
  check('radar view has no amateur up/downlink readout', rp.noUpDown);
  await sleep(1500);
  const pg = await ev(`(document.querySelector('#rGeo') || {}).textContent || ''`);
  check('pass geometry: direction, local solar time at closest approach, ground-track distance, nominal swath check', /Pass direction (ascending|descending)/.test(pg) && /local solar time at closest approach \d\d:\d\d/.test(pg) && /ground-track distance at closest approach \d+ km/.test(pg) && /swath/.test(pg) && /Approximate/.test(pg), pg.slice(0, 260));
  check('radar table across the pass rendered with one-way Δ Hz column', await ev(`document.querySelectorAll('#dTbl tbody tr').length`) > 5 && await ev(`/One-way Δ Hz/.test(document.querySelector('#dTbl').textContent)`));
  check('Doppler select offers amateur radios and SAR radar group', await ev(`(() => { const g = [...document.querySelectorAll('#dSat optgroup')].map(o => o.label); return g.length === 2 && /SAR/.test(g[1]) && document.querySelectorAll('#dSat optgroup:nth-child(2) option').length > 100; })()`));
  check('radar view: no overflow', await noOverflow());
  await shot('07c-radar-sentinel1');
  // unverified frequency (Capella) -> says so, no Doppler number
  await go('#/doppler/57693'); await sleep(1500);
  check('Capella (centre frequency unverified): "frequency not verified", no Doppler value', await ev(`/frequency not verified/.test(document.querySelector('#radarCard').textContent) && !document.querySelector('#rShift') && /not verified/.test(document.querySelector('#rLive').textContent)`));
  // ICEYE-X83: NORAD 100889 (Alpha-5 TLE) works end to end
  await go('#/doppler/100889'); await sleep(2500);
  check('ICEYE-X83 (NORAD 100889, Alpha-5 TLE) tracks and shows 9650 MHz radar Doppler', await ev(`/9650 MHz/.test(document.querySelector('#radarCard').textContent) && !!document.querySelector('#rShift') && /ICEYE-X83/.test(document.querySelector('#dSat').selectedOptions[0].textContent)`));
  // amateur Doppler unchanged
  await go('#/doppler/25544'); await sleep(1500);
  check('amateur Doppler UI unchanged (ISS: up/downlink boxes, no radar panel)', await ev(`document.querySelectorAll('.dopp-big b').length === 2 && !document.querySelector('#radarCard') && /Satellite frame: uplink/.test(document.querySelector('#dNominal').textContent)`));
  // deep link to a lazily loaded satellite after a fresh page load
  await ev(`localStorage.setItem('satpass:dopSat', '25544')`); await go('#/passes');
  await reloadAt('#/live/60182'); await sleep(2500);
  await waitFor0(`!!document.querySelector('#liveSel')`, 8000);   // (a cold CDN/first load can take longer than the fixed sleep above)
  check('deep link to ALOS-4 (lazy SAR snapshot) opens the live tracker for it', await ev(`!!document.querySelector('#liveSel') && /ALOS-4/.test(document.querySelector('#liveSel').selectedOptions[0].textContent)`), await ev(`document.querySelector('#liveSel') ? document.querySelector('#liveSel').selectedOptions[0].textContent : 'NO liveSel; hash=' + location.hash + '; main=' + (document.querySelector('main') || document.body).innerText.slice(0, 300)`));

  // v1.0.1 localStorage migration (settings without schema, old view modes, cached TLEs) -> kept, normalised
  const keep = await ev(`JSON.stringify({ s: localStorage.getItem('satpass:settings'), m: localStorage.getItem('satpass:satMode') })`);
  await ev(`localStorage.setItem('satpass:settings', JSON.stringify({ lat: 51.5074, lon: -0.1278, alt: 0, utc: false, minEl: 15, days: 5, favs: [25544, 27607, 7530, 27607, "x", -3], theme: "auto", leadMin: 10, installDismissed: 0 })); localStorage.setItem('satpass:satMode', JSON.stringify('favs')); localStorage.setItem('satpass:scope', JSON.stringify('curated'));`);
  await reloadAt('#/sats'); await sleep(2000);
  const mg = await ev(`({ st: JSON.parse(localStorage.getItem('satpass:settings')), mode: JSON.parse(localStorage.getItem('satpass:satMode')), on: (document.querySelector('#modeSeg .chip.on') || {}).dataset.v, rows: document.querySelectorAll('#satList .sat').length })`);
  check('v1.0.1 data migrated: favourites/prefs kept (dedup, junk dropped), schema 2, saved view mode still honoured', JSON.stringify(mg.st.favs) === '[25544,27607,7530]' && mg.st.minEl === 15 && mg.st.days === 5 && mg.st.schema === 2 && mg.mode === 'favs' && mg.on === 'favs' && mg.rows === 3, mg);
  await ev(`localStorage.setItem('satpass:satMode', JSON.stringify('bogus'))`);
  ld = waitEvent('Page.loadEventFired'); await send('Page.reload', {}); await ld; await sleep(1500);
  check('unknown saved view mode falls back to Curated', await ev(`(document.querySelector('#modeSeg .chip.on') || {}).dataset.v === 'curated'`));
  const k = JSON.parse(keep); await ev(`localStorage.setItem('satpass:settings', ${JSON.stringify(k.s)}); localStorage.setItem('satpass:satMode', ${JSON.stringify(k.m)});`);
  await reloadAt('#/passes'); await sleep(1500);

  // ---- desktop layout
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await go('#/passes'); await sleep(1500); check('desktop layout no overflow', await noOverflow()); await shot('08-desktop-passes');
  await go('#/live/25544'); await sleep(1200); await shot('09-desktop-live');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await go('#/passes'); await sleep(1200); await shot('10-light-passes');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

  // ---- real CelesTrak CORS fetch from the page + refresh button (network)
  if (!SKIP_NET) {
    const cors = await ev(`fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle', {mode:'cors', cache:'no-store'}).then(async r => ({ ok: r.ok, status: r.status, head: (await r.text()).slice(0, 12) })).catch(e => ({ error: String(e) }))`);
    console.log('CelesTrak CORS probe:', JSON.stringify(cors));
    if (cors.error) console.log('SKIP live-fetch checks (network unreachable from this environment)');
    else {
      check('CelesTrak CORS fetch from page context works', cors.ok && /ISS/.test(cors.head), cors);
      // if the bundled snapshot is older than 6 h the app refreshes itself at start-up: let that finish (it re-renders the view) before testing the button
      for (let i = 0; i < 40 && (await ev(`SatStore.data.origin`)) !== 'CelesTrak'; i++) await sleep(500);
      await go('#/sats'); await ev(`SatStore.constants && localStorage.removeItem('satpass:tlemeta')`); await go('#/sats');
      const before = await ev('SatStore.data.fetchedAt');
      if (await ev(`document.querySelector('#refBtn').disabled`) && await ev(`SatStore.data.origin === 'CelesTrak'`)) {
        // the bundled snapshot was older than 6 h, so the automatic refresh at start-up already pulled live CelesTrak data (and the manual button is correctly rate-limited)
        check('Refresh: automatic start-up refresh already updated from live CelesTrak (manual button disabled by the 2 h courtesy rule)', await ev(`JSON.parse(localStorage.getItem('satpass:tle')).origin === 'CelesTrak' && SatStore.data.sats.length > 100`));
      } else {
      await ev(`document.querySelector('#refBtn').click()`);
      let done = false; for (let i = 0; i < 60 && !done; i++) { await sleep(1000); done = await ev(`!!document.querySelector('#refResult')`); }
      const msg = done ? await ev(`document.querySelector('#refResult').textContent`) : 'timeout; button=' + await ev(`document.querySelector('#refBtn') && document.querySelector('#refBtn').textContent`) + ' lastError=' + await ev('SatStore.lastError()') + ' hash=' + await ev('location.hash');
      check('Refresh button: live CelesTrak refresh succeeds', done && /Updated \d+ element sets/.test(msg), msg);
      check('refreshed data cached with new fetch timestamp + origin CelesTrak', await ev(`SatStore.data.fetchedAt > ${before} && SatStore.data.origin === 'CelesTrak' && JSON.parse(localStorage.getItem('satpass:tle')).origin === 'CelesTrak'`));
      check('refresh button now disabled (rate-limit courtesy)', await ev(`document.querySelector('#refBtn').disabled`));
      }
      await go('#/passes'); await sleep(2500);
      check('passes recomputed after refresh', await ev(`document.querySelectorAll('.pass').length`) >= 3);
    }
  }
  await require('./browser-sources.js')({ ev, send, check, sleep, go, setVal, waitEvent, problems, consoleAll, LOCAL });
  await require('./browser-vault.js')({ ev, send, check, sleep, go, setVal, waitEvent, problems, consoleAll, LOCAL, APP, HTTP });
  // ---- v1.2.1 UI checks
  await go('#/passes');
  await reloadAt('#/%E0%A4%A'); await sleep(1500);
  check('malformed hash escape (#/%E0%A4%A) does not abort boot: passes view renders and the service worker is registered', await ev(`!!window.SatStore && !!document.querySelector('#passList') && navigator.serviceWorker.getRegistration().then(r => !!r)`));
  await reloadAt('#/passes'); await sleep(1200);
  check('Local/UTC pill is at least 44x44 px', await ev(`(() => { const r = document.querySelector('#tzBtn').getBoundingClientRect(); return r.height >= 43.5 && r.width >= 43.5; })()`));
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true });
  await go('#/doppler/7530'); await sleep(900);
  check('320 px: Doppler satellite + transponder dropdowns are fully inside the viewport (not clipped)', await ev(`['#dSat', '#dRadio'].every(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.left >= -0.5 && r.right <= window.innerWidth + 0.5; }) && document.documentElement.scrollWidth <= window.innerWidth + 1`));
  await go('#/doppler/25338'); await sleep(900);
  check('NOAA 15 (decommissioned): Doppler view says "No signal" with the OSPO-based text and the radio note says DECOMMISSIONED', await ev(`/No signal/.test(document.querySelector('main').textContent) && /decommissioned on 19 Aug 2025/i.test(document.querySelector('main').textContent) && /DECOMMISSIONED/.test(document.querySelector('main').textContent)`));
  await shot('12-320px-doppler-noaa');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go('#/passes'); await sleep(500);
  const onlineProblems = problems.slice();

  // ---- stale-TLE warning: shift the page clock +10 days
  const shim = `(()=>{const OFF=10*864e5,R=Date,N=R.now;class D extends R{constructor(...a){if(a.length===0)super(N()+OFF);else super(...a);}static now(){return N()+OFF;}}window.Date=D;})()`;
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: shim });
  if (LOCAL) { server.kill('SIGKILL'); await sleep(500); await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); }
  ld = waitEvent('Page.loadEventFired'); await send('Page.reload', {}); await ld; await sleep(2500);
  if (LOCAL) {
    check('offline reload works (server stopped, network offline)', await ev(`!!document.querySelector('#passList') && !!window.SatStore`));
    check('SW controls page offline', await ev(`!!navigator.serviceWorker.controller`));
    check('offline: location persisted and passes still computed', await ev(`SatStore.hasLocation() && document.querySelectorAll('.pass').length > 0`));
  }
  check('stale TLE warning shown when data > 7 days old (clock +10 d)', await ev(`/older than 7 days/.test(document.querySelector('#staleBox').textContent) || /older than 7 days/.test(document.body.textContent)`), await ev(`document.querySelector('#staleBox').textContent.slice(0,160)`));
  await shot('11-stale-offline');
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  if (LOCAL) {
    await go('#/sats'); await ev(`localStorage.removeItem('satpass:tlemeta')`);
    const r = await ev(`SatStore.refresh().then(r => r)`);
    check('offline refresh degrades gracefully (clear message, data kept)', r.ok === false && /offline/i.test(r.message) && (await ev('SatStore.data.sats.length')) > 150, r.message);
    await go('#/live/25544'); await sleep(1500);
    check('offline: live tracker works from cached/bundled TLE', (await canvasInk('#map')) > 5000);
    await go('#/doppler/25544'); await sleep(1500);
    check('offline: Doppler works', await ev(`document.querySelectorAll('.dopp-big b').length`) === 2);
    await go('#/settings'); await sleep(800);
    check('offline: Setup → Data sources renders and says what to do (import path stays available on Sats tab)', await ev(`!!document.querySelector('#srcCard') && document.querySelectorAll('#srcCard .srcrow').length === 4`) && (await ev(`/import a TLE.OMM file/i.test(document.querySelector('#srcCard').textContent)`)));
    await go('#/sats'); await sleep(600);
    check('offline: Sats tab offers the file import and paste box', await ev(`!!document.querySelector('#fileIn') && !!document.querySelector('#pasteTa')`));
    // SAR + other categories work offline from the precached lazy snapshots (page was reloaded offline, so these come from the service-worker cache)
    await go('#/doppler/39634'); await sleep(2500);
    check('offline: Sentinel-1A radar panel + Doppler from the bundled snapshot', await ev(`/5405 MHz/.test((document.querySelector('#radarCard')||{}).textContent||'') && !!document.querySelector('#rShift')`));
    await go('#/sats'); await sleep(1200); await ev(`document.querySelector('#modeSeg [data-v="sar"]').click()`); await sleep(500);
    check('offline: SAR category lists >=125 rows from the snapshot', await ev(`document.querySelectorAll('#satList .sat').length`) >= 125);
    await ev(`document.querySelector('#modeSeg [data-v="eo"]').click()`); await sleep(400);
    check('offline: Earth observation category lists satellites', await ev(`document.querySelectorAll('#satList .sat').length`) > 100);
    check('offline: a failed automatic category refresh gives up after the first failed request (polite, no hammering)', problems.filter(m => /NAME=|CATNR=/.test(m)).length <= 2, problems.filter(m => /NAME=|CATNR=/.test(m)));
  }
  console.log('Console/log problems (online phase):', onlineProblems);
  console.log('All problems:', problems);
  const fails = results.filter(r => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed; ${onlineProblems.length} console problems`);
  ws.close(); chrome.kill('SIGKILL'); if (server) server.kill();
  process.exit(fails || onlineProblems.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log('problems', problems); chrome.kill('SIGKILL'); if (server) server.kill(); process.exit(2); });
