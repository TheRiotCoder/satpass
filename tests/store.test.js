// Categories, lazy snapshots, category/text filtering, v1.0.1 -> v1.1.0 migration, polite CelesTrak refresh/lookup (mocked fetch), in a vm sandbox
// that runs the real browser modules (js/store.js etc.) against a fake localStorage.
const { ok, done } = require("./harness");
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, ".."), rd = f => fs.readFileSync(path.join(root, f), "utf8"), fx = f => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const Cat = require("../js/catalog.js"), Sar = require("../data/sar.js"), T = require("../js/tle.js");

function load(opts = {}) {
  const ls = Object.assign({}, opts.ls || {}), requests = [];
  const ctx = {
    console, Promise, Date, JSON, Object, Math, Array, Number, String, RegExp, Error, TypeError, parseInt, parseFloat, isFinite, isNaN,
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    navigator: { onLine: true }, AbortController, clearTimeout,
    setTimeout: (fn, ms) => (ms === 1200 ? (Promise.resolve().then(fn), 0) : setTimeout(fn, ms)),   // skip the 1.2 s politeness sleeps (their number is asserted instead)
    fetch: (url) => { requests.push(url); const r = (opts.fetch || (() => ({ status: 200, body: "No GP data found" })))(url, requests.length); if (r instanceof Error) return Promise.reject(r); return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, text: () => Promise.resolve(r.body) }); }
  };
  ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  const run = f => vm.runInContext(rd(f), ctx, { filename: f });
  ["js/tle.js", "js/radio.js", "data/sar.js", "js/catalog.js", "js/sources.js", "data/tle-snapshot.js"].forEach(run);
  const lazy = {}; // data/snap/<id>.js loaded on demand through a fake <script> element
  ctx.document = { createElement: () => ({}), head: { appendChild(el) { const m = /snap\/(\w+)\.js/.exec(el.src); lazy[m[1]] = (lazy[m[1]] || 0) + 1; setImmediate(() => { run("data/snap/" + m[1] + ".js"); el.onload(); }); } } };
  (opts.preload || []).forEach(id => run("data/snap/" + id + ".js"));
  run("js/store.js");
  const S = ctx.SatStore; S.init(); return { S, ls, requests, lazy, ctx };
}
const ids = a => a.slice().sort((x, y) => x - y);

(async () => {
  // ---------- fresh start: core categories only, others lazy
  {
    const { S, lazy } = load();
    ok("fresh install: favourites default to the curated favourites (incl. ISS)", S.isFav(25544));
    ok("core categories come from the bundled snapshot at start: amateur 95, stations 17, weather 75", S.members("amateur").length === 95 && S.members("stations").length === 17 && S.members("weather").length === 75, ["amateur", "stations", "weather"].map(c => S.members(c).length));
    ok("SAR / EO / navigation / science are NOT loaded until used (no satellites, no script requests yet)", ["sar", "eo", "nav", "science"].every(c => S.members(c).length === 0) && !S.data.byId[39634] && Object.keys(lazy).length === 0 && !S.allLoaded());
    ok("Sentinel-1A is unknown before the SAR snapshot is loaded", !S.data.byId[39634]);
    await S.ensure("sar");
    ok("ensure('sar') lazily loads data/snap/sar.js once: 131 SAR satellites incl. Sentinel-1A and ICEYE-X83 (Alpha-5)", S.members("sar").length === 131 && !!S.data.byId[39634] && !!S.data.byId[100889] && lazy.sar === 1, [S.members("sar").length, lazy]);
    await S.ensure("sar"); ok("ensure() twice does not load twice", lazy.sar === 1);
    ok("other categories still not loaded", S.members("nav").length === 0 && S.members("eo").length === 0);
    await S.ensureAll();
    ok("after ensureAll: eo 167, nav 142, science 46, sar 131", S.members("eo").length === 167 && S.members("nav").length === 142 && S.members("science").length === 46 && S.members("sar").length === 131 && S.allLoaded(), ["eo", "nav", "science", "sar"].map(c => S.members(c).length));
    ok("snapshot origin is reported per category", S.catStatus("sar").origin === "bundled snapshot" && S.catStatus("sar").fetchedAt > 0 && S.catStatus("nonexistent").origin === "none");
    // a satellite can belong to several categories
    const multi = S.data.sats.filter(s => S.categoriesOf(s.norad).length >= 2);
    ok("some satellites are in more than one category (e.g. a SAR satellite that is also Earth observation)", multi.length >= 3, multi.slice(0, 4).map(s => [s.name, S.categoriesOf(s.norad)]));
    ok("ISS is in 'stations' and Sentinel-1A in 'sar'", S.categoriesOf(25544).includes("stations") && S.categoriesOf(39634).includes("sar"));
    // category filtering
    const items = c => S.members(c).map(n => ({ norad: n, name: S.data.byId[n].name }));
    const sentinel = Cat.filterText(items("sar"), "sentinel");
    ok("category + text: 'sentinel' within SAR -> only Sentinel-1 satellites (4)", sentinel.length === 4 && sentinel.every(x => /SENTINEL-1/.test(x.name)), sentinel.map(x => x.name));
    const iceye = Cat.filterText(items("sar"), "iceye");
    ok("category + text: 'iceye' within SAR = every ICEYE satellite", iceye.length === S.members("sar").filter(n => /^ICEYE/.test(S.data.byId[n].name)).length && iceye.length >= 25, iceye.length);
    ok("text matches NORAD ids and band words ('x-band' finds ICEYE / TerraSAR, not Sentinel-1; 'l-band' finds ALOS)", (() => { const x = Cat.filterText(items("sar"), "x-band").map(i => i.name).join(), l = Cat.filterText(items("sar"), "l-band").map(i => i.name).join(); return /ICEYE/.test(x) && /TERRASAR/.test(x) && !/SENTINEL-1A/.test(x) && /ALOS/.test(l) && /SAOCOM/.test(l); })());
    ok("text 39634 finds Sentinel-1A; every word must match ('sentinel 1d' -> one)", Cat.filterText(items("sar"), "39634").length === 1 && Cat.filterText(items("sar"), "sentinel 1d").length === 1);
    ok("empty text keeps the category untouched; no match gives an empty list", Cat.filterText(items("sar"), "  ").length === 131 && Cat.filterText(items("sar"), "zzzz").length === 0);
    ok("text matches SAR mission/operator names ('canadian' -> RCM, 'MDA' -> RADARSAT-2)", Cat.filterText(items("sar"), "canadian").some(x => /RCM|RADARSAT/.test(x.name)) && Cat.filterText(items("sar"), "mda").some(x => /RADARSAT-2/.test(x.name)));
    // mega-constellations are not offered anywhere
    ok("no Starlink / OneWeb in any category", S.data.sats.every(s => !/STARLINK|ONEWEB/.test(s.name)));
    // the categories' fetch lists
    const q = id => Cat.BY_ID[id].fetch.map(f => Cat.queryUrl(f));
    ok("core categories use GROUP=amateur|stations|weather (+ NOAA CATNR); nothing queries geostationary / starlink / oneweb / NAME=COSMO", q("amateur")[0].endsWith("GROUP=amateur&FORMAT=tle") && q("weather").length === 4 && Object.keys(Cat.BY_ID).every(id => q(id).every(u => !/starlink|oneweb|geo\b|NAME=COSMO&/i.test(u))));
    ok("EO / navigation / science use CelesTrak groups resource | gps-ops, galileo, glo-ops, beidou | science", q("eo").join().includes("GROUP=resource") && ["gps-ops", "galileo", "glo-ops", "beidou"].every(g => q("nav").join().includes("GROUP=" + g)) && q("science").join().includes("GROUP=science"));
    ok("SAR queries are NAME=/CATNR= (no CelesTrak SAR group) and never GROUP=radar (calibration spheres)", q("sar").every(u => /(NAME|CATNR)=/.test(u) && !/GROUP=radar/.test(u)) && q("sar").length === Sar.QUERIES.length);
    ok("SAR-only filter: satellites of a SAR query that are not on the curated list are dropped (accept)", Cat.BY_ID.sar.accept({ norad: 39634, name: "SENTINEL-1A" }) === true && Cat.BY_ID.sar.accept({ norad: 25544, name: "ISS (ZARYA)" }) === false);
    ok("view modes: v1.0.1 modes plus one per category", ["curated", "favs", "all", "amateur", "stations", "weather", "sar", "eo", "nav", "science", "searched"].every(Cat.validMode) && !Cat.validMode("bogus"));
    // stale categories (lazy auto-refresh only for categories in use, at most daily)
    const later = Date.now() + 25 * 3600e3;
    ok("no automatic refresh of an unused category even when old", S.staleCategories(null, later).length === 0 || S.settings.favs.some(n => S.categoriesOf(n).some(c => !Cat.BY_ID[c].core)));
    S.toggleFav(39634);
    ok("a favourite in SAR makes SAR (and only SAR) eligible once its data is > 24 h old; not before", S.staleCategories(null, Date.now()).length === 0 && S.staleCategories(null, later).includes("sar") && !S.staleCategories(null, later).includes("nav"), S.staleCategories(null, later));
    ok("opening a category makes it eligible too (also=)", S.staleCategories("nav", later).includes("nav"));
    ok("favourites span categories", S.isFav(39634) && S.isFav(25544));
  }
  // ---------- v1.0.1 migration
  {
    const cached = T.serialize(T.parse(require("./harness").snapshot().tle).sats.slice(0, 40));
    const ls = {
      "satpass:settings": JSON.stringify({ lat: 30.27, lon: -97.74, alt: 150, utc: true, minEl: 15, days: 5, favs: [25544, "27607", 7530, 25544, -4, "x", 0], theme: "dark", leadMin: 10 }),
      "satpass:satMode": JSON.stringify("all"), "satpass:tle": JSON.stringify({ tle: cached, fetchedAt: Math.max(Date.parse(require("./harness").snapshot().fetchedAt) + 3600e3, Date.now() - 3600e3), source: "CelesTrak GP (celestrak.org)", origin: "CelesTrak" }),
      "satpass:tlemeta": JSON.stringify({ lastAttempt: Date.now() - 3600e3, lastError: null, lastOk: Date.now() - 3600e3 })
    };
    const { S, ls: out } = load({ ls });
    ok("v1.0.1 → v1.1.0: location, units, theme, minimum elevation and days survive", S.settings.lat === 30.27 && S.settings.lon === -97.74 && S.settings.alt === 150 && S.settings.utc === true && S.settings.minEl === 15 && S.settings.days === 5 && S.settings.theme === "dark" && S.settings.leadMin === 10, S.settings);
    ok("favourites are kept, de-duplicated and cleaned (numbers only)", JSON.stringify(S.settings.favs) === JSON.stringify([25544, 27607, 7530]), S.settings.favs);
    ok("the Sats-tab mode 'all' (a v1.0.1 value) is still valid and kept", JSON.parse(out["satpass:satMode"]) === "all");
    ok("schema is stamped (2) and the settings are written back", JSON.parse(out["satpass:settings"]).schema === 2);
    ok("the v1.0.1 TLE cache is still used (newer than the snapshot -> origin CelesTrak) and merged with the snapshot", S.data.origin === "CelesTrak" && S.data.sats.length >= 185 && !!S.data.byId[25544]);
    ok("core categories still list their satellites after migration (no group lists existed in v1.0.1)", S.members("amateur").length === 95 && S.members("stations").length === 17);
    ok("refresh timing metadata kept (no immediate re-download after upgrade)", !S.nextAutoRefreshDue(Date.now()) && S.manualAllowed(Date.now(), "amateur") === false);
    const again = load({ ls: out }); ok("migrating twice changes nothing (idempotent)", JSON.stringify(again.S.settings.favs) === JSON.stringify([25544, 27607, 7530]) && again.S.settings.theme === "dark");
  }
  {
    const m = Cat.migrate(null, "weird");
    ok("migrate(): null/garbage inputs -> empty settings, mode 'curated'", m.settings.schema === 2 && m.satMode === "curated" && !("favs" in m.settings));
    ok("migrate(): old mode 'curated' / 'favs' stay, unknown falls back", Cat.migrate({}, "favs").satMode === "favs" && Cat.migrate({}, "curated").satMode === "curated" && Cat.migrate({}, "searched").satMode === "searched" && Cat.migrate({}, undefined).satMode === "curated");
    ok("migrate(): non-array favs are dropped (defaults apply)", !("favs" in Cat.migrate({ favs: "25544" }, "all").settings));
  }
  // ---------- polite refresh (mock CelesTrak)
  {
    const alpha = fx("omm-alpha5.json");
    const mock = u => /NAME=ICEYE/.test(u) ? { status: 200, body: alpha } : { status: 200, body: "No GP data found" };
    const { S, ls, requests } = load({ fetch: mock });
    await S.ensure("sar");
    const r = await S.refresh({ categories: ["sar"] });
    ok("SAR refresh: one request per curated query, all to celestrak.org gp.php as JSON, no duplicates", requests.length === Sar.QUERIES.length && new Set(requests).size === requests.length && requests.every(u => u.startsWith("https://celestrak.org/NORAD/elements/gp.php?") && /FORMAT=json$/.test(u)), [requests.length, Sar.QUERIES.length]);
    ok("… no query touches the Starlink / OneWeb / COSMOS mega groups", requests.every(u => !/starlink|oneweb|NAME=COSMO&|NAME=COSMOS|GROUP=radar/i.test(u)));
    ok("… membership is replaced by what CelesTrak returned, filtered by the curated list (the 2 ICEYE records)", r.ok && JSON.stringify(ids(S.members("sar"))) === JSON.stringify([100889, 100914]), [r, S.members("sar")]);
    ok("… origin becomes CelesTrak, stored in localStorage, manual refresh blocked for the next 2 h", S.catStatus("sar").origin === "CelesTrak" && !!ls["satpass:groups"] && JSON.parse(ls["satpass:groups"]).sar.ids.length === 2 && S.manualAllowed(Date.now(), "sar") === false && S.manualAllowed(Date.now() + 3 * 3600e3, "sar") === true);
    ok("… other categories untouched", S.members("amateur").length === 95);
    ok("… previously known TLEs of the old snapshot stay available (merge keeps satellites, e.g. Sentinel-1A TLE)", !!S.data.byId[39634]);
  }
  {
    const { S, requests } = load({ fetch: () => ({ status: 429, body: "" }) });
    const r = await S.refresh({ categories: ["sar"] });
    ok("HTTP 429 stops the batch after the first request and says to slow down", requests.length === 1 && !r.ok && /slow down|couple of hours/i.test(r.message), [requests.length, r.message]);
    ok("… the failure is recorded (back-off) and no automatic retry is due for 30 min", /slow down/.test(S.lastError("sar") || "") && S.staleCategories("sar", Date.now() + 25 * 3600e3).length === 1 && S.staleCategories("sar", Date.now() + 60e3).length === 0);
  }
  {
    const { S, requests } = load({ fetch: () => new TypeError("Failed to fetch") });
    const r = await S.refresh({ categories: ["eo"] });
    ok("network error: one request, polite failure message, snapshot data kept", requests.length === 1 && !r.ok && /reach CelesTrak/.test(r.message));
  }
  {
    const { S, requests } = load({ fetch: () => ({ status: 200, body: fx("tle-25544.txt") }) });
    await S.refresh();
    ok("core refresh asks for exactly GROUP=amateur, stations, weather and CATNR=25338, 28654, 33591 (6 requests) and nothing from the lazy categories", requests.length === 6 && ["GROUP=amateur", "GROUP=stations", "GROUP=weather", "CATNR=25338", "CATNR=28654", "CATNR=33591"].every(k => requests.some(u => u.includes(k))) && requests.every(u => /FORMAT=tle$/.test(u)), requests);
  }
  // ---------- on-demand lookup guard
  {
    const many = JSON.stringify(Array.from({ length: 41 }, (_, i) => Object.assign({}, JSON.parse(fx("omm-alpha5.json"))[0], { NORAD_CAT_ID: 100100 + i, OBJECT_NAME: "TESTSAT-" + i })));
    let L = load(); let r = await L.S.lookup("starlink");
    ok("lookup 'starlink' (no number) is refused locally: no request, tells you to add a number", !r.ok && /number|thousands/i.test(r.message) && L.requests.length === 0, r.message);
    r = await L.S.lookup("ab"); ok("lookup shorter than 3 characters refused", !r.ok && L.requests.length === 0);
    r = await L.S.lookup("bad;name"); ok("lookup with odd characters refused", !r.ok && L.requests.length === 0);
    L = load({ fetch: () => ({ status: 200, body: fx("omm-alpha5.json") }) }); r = await L.S.lookup("STARLINK-1234");
    ok("lookup 'STARLINK-1234' -> one NAME= JSON request; results are added and listed under 'searched'", r.ok && L.requests.length === 1 && /NAME=STARLINK-1234&FORMAT=json$/.test(L.requests[0]) && L.S.searched().length === 2 && !!L.S.data.byId[100889], [r, L.requests]);
    const r2 = await L.S.lookup("STARLINK-1235"); ok("a second lookup within 5 s is refused without a request", !r2.ok && L.requests.length === 1, r2.message);
    L = load({ fetch: () => ({ status: 200, body: many }) }); r = await L.S.lookup("TESTSAT");
    ok("lookup returning more than 40 satellites is rejected and nothing is added", !r.ok && /more specific/.test(r.message) && !L.S.data.byId[100100]);
    L = load({ fetch: () => ({ status: 200, body: "No GP data found" }) }); r = await L.S.lookup("12345");
    ok("lookup by NORAD id uses CATNR=; 'No GP data found' is reported, nothing added", !r.ok && /CATNR=12345&FORMAT=json$/.test(L.requests[0]) && /no satellite/i.test(r.message));
  }
  done();
})().catch(e => { console.error(e); process.exit(1); });
