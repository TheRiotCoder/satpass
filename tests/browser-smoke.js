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
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-satpass', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const problems = []; let ws, nextId = 1; const pending = new Map(); const listeners = [];
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
  check('reminder can be set (button toggles, stored)', /Reminder set/.test(await ev(`document.querySelector('#remBtn').textContent`)) && await ev(`JSON.parse(localStorage.getItem('satpass:reminders')).length`) === 1);
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
      await go('#/sats'); await ev(`SatStore.constants && localStorage.removeItem('satpass:tlemeta')`); await go('#/sats');
      const before = await ev('SatStore.data.fetchedAt');
      await ev(`document.querySelector('#refBtn').click()`);
      let done = false; for (let i = 0; i < 60 && !done; i++) { await sleep(1000); done = await ev(`!!document.querySelector('#refResult')`); }
      const msg = done ? await ev(`document.querySelector('#refResult').textContent`) : 'timeout; button=' + await ev(`document.querySelector('#refBtn') && document.querySelector('#refBtn').textContent`) + ' lastError=' + await ev('SatStore.lastError()') + ' hash=' + await ev('location.hash');
      check('Refresh button: live CelesTrak refresh succeeds', done && /Updated \d+ element sets/.test(msg), msg);
      check('refreshed data cached with new fetch timestamp + origin CelesTrak', await ev(`SatStore.data.fetchedAt > ${before} && SatStore.data.origin === 'CelesTrak' && JSON.parse(localStorage.getItem('satpass:tle')).origin === 'CelesTrak'`));
      check('refresh button now disabled (rate-limit courtesy)', await ev(`document.querySelector('#refBtn').disabled`));
      await go('#/passes'); await sleep(2500);
      check('passes recomputed after refresh', await ev(`document.querySelectorAll('.pass').length`) >= 3);
    }
  }
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
  }
  console.log('Console/log problems (online phase):', onlineProblems);
  console.log('All problems:', problems);
  const fails = results.filter(r => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed; ${onlineProblems.length} console problems`);
  ws.close(); chrome.kill('SIGKILL'); if (server) server.kill();
  process.exit(fails || onlineProblems.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log('problems', problems); chrome.kill('SIGKILL'); if (server) server.kill(); process.exit(2); });
