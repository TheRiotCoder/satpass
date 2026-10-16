/* SatPass data layer (browser): settings, TLE cache, CelesTrak refresh. */
(function () {
  "use strict";
  var Tle = window.SatTle, Radio = window.SatRadio;
  var LS = "satpass:";
  function load(k, d) { try { var v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function del(k) { try { localStorage.removeItem(LS + k); } catch (e) {} }

  /* ---------- settings ---------- */
  var Cat = window.SatCatalog;
  var DEFAULTS = { lat: null, lon: null, alt: 0, utc: false, minEl: 10, days: 3, favs: Radio.CURATED.filter(function (c) { return c.fav; }).map(function (c) { return c.norad; }), theme: "auto", leadMin: 10, installDismissed: 0, schema: 2 };
  // v1.0.1 → v1.1.0: keep favourites / location / view choices; just normalise them (see SatCatalog.migrate) and stamp the schema.
  var mig = Cat.migrate(load("settings", {}), load("satMode", "curated"));
  var settings = Object.assign({}, DEFAULTS, mig.settings);
  if (!Array.isArray(settings.favs)) settings.favs = DEFAULTS.favs.slice();
  save("settings", settings); save("satMode", mig.satMode);
  function setSettings(patch) { Object.assign(settings, patch); save("settings", settings); }
  function hasLocation() { return typeof settings.lat === "number" && typeof settings.lon === "number"; }
  function isFav(n) { return settings.favs.indexOf(n) >= 0; }
  function toggleFav(n) { var f = settings.favs.slice(), i = f.indexOf(n); if (i >= 0) f.splice(i, 1); else f.push(n); setSettings({ favs: f }); return i < 0; }

  /* ---------- TLE data ---------- */
  var SOURCES = [];   // flat list of the core CelesTrak queries (kept for the About text / tests)
  Cat.CORE.forEach(function (id) { Cat.BY_ID[id].fetch.forEach(function (f) { SOURCES.push({ id: f.id, url: Cat.queryUrl(f) }); }); });
  var AUTO_REFRESH_MS = 6 * 3600e3;   // CelesTrak updates GP data every few hours; don't ask more often than this automatically
  var CAT_AUTO_MS = 24 * 3600e3;      // non-core categories (SAR, EO, navigation, science) refresh themselves at most once a day, and only when in use
  var MIN_MANUAL_MS = 2 * 3600e3;     // manual "refresh" blocked until the data is at least this old (CelesTrak asks for ≤ 1 request per 2 h per query)
  var FAIL_BACKOFF_MS = 30 * 60e3;    // after a failure wait this long before retrying automatically
  var data = { sats: [], byId: {}, fetchedAt: 0, source: "", origin: "bundled", groups: {}, catInfo: {} };
  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  function setSats(list, fetchedAt, source, origin) {
    data.sats = list; data.byId = {}; list.forEach(function (s) { data.byId[s.norad] = s; });
    data.fetchedAt = fetchedAt; data.source = source; data.origin = origin;
  }
  // category membership: groups[cat] = [norad ids]; catInfo[cat] = {fetchedAt, origin} (when that membership list / its TLEs were obtained)
  function setGroup(cat, ids, fetchedAt, origin) {
    var cur = data.catInfo[cat];
    if (cur && cur.fetchedAt > fetchedAt) return false;
    data.groups[cat] = ids.slice(); data.catInfo[cat] = { fetchedAt: fetchedAt, origin: origin }; return true;
  }
  var loadedSnaps = {}, cachedGroups = load("groups", {});
  function applySnapshot(id, snap) {
    var t = Date.parse(snap.fetchedAt) || 0, sats = Tle.parse(snap.tle).sats;
    loadedSnaps[id] = true;
    var merged = Tle.merge(data.sats, sats);
    data.sats = merged; data.byId = {}; merged.forEach(function (s) { data.byId[s.norad] = s; });
    Object.keys(snap.groups || {}).forEach(function (c) { setGroup(c, snap.groups[c], t, "bundled snapshot"); });
    return t;
  }
  function init() {
    var snap = window.SATPASS_SNAPSHOT || { tle: "", fetchedAt: "1970-01-01T00:00:00Z" };
    var snapT = Date.parse(snap.fetchedAt) || 0, snapSats = Tle.parse(snap.tle).sats;
    var cached = load("tle", null), cachedSats = cached ? Tle.parse(cached.tle).sats : [];
    // merge both (newest epoch wins per satellite); label by whichever fetch is newer
    var merged = Tle.merge(snapSats, cachedSats);
    if (cached && cached.fetchedAt > snapT) setSats(merged, cached.fetchedAt, cached.source || "CelesTrak", cached.origin || "CelesTrak");
    else setSats(merged, snapT, snap.source || "bundled snapshot", "bundled snapshot");
    data.groups = {}; data.catInfo = {};
    Object.keys(cachedGroups || {}).forEach(function (c) { var g = cachedGroups[c]; if (g && Array.isArray(g.ids)) setGroup(c, g.ids, g.fetchedAt || 0, g.origin || "CelesTrak"); });
    loadedSnaps.core = true;
    Object.keys(snap.groups || {}).forEach(function (c) { setGroup(c, snap.groups[c], snapT, "bundled snapshot"); });
    // v1.0.1 caches have TLEs but no membership lists: core categories fall back to the snapshot's lists above
    var pre = window.SATPASS_SNAPSHOTS || {};
    Object.keys(pre).forEach(function (id) { if (!loadedSnaps[id]) applySnapshot(id, pre[id]); });
  }
  /* Lazy per-category bundled snapshots: data/snap/<id>.js registers window.SATPASS_SNAPSHOTS[id]. ensure(id) loads it on demand
     (it is precached by the service worker so it also works offline) and resolves when its satellites are in the store. */
  var snapLoading = {};
  function ensure(id) {
    if (loadedSnaps[id] || id === "core") return Promise.resolve(false);
    var pre = window.SATPASS_SNAPSHOTS && window.SATPASS_SNAPSHOTS[id];
    if (pre) { applySnapshot(id, pre); emit(); return Promise.resolve(true); }
    if (snapLoading[id]) return snapLoading[id];
    snapLoading[id] = new Promise(function (resolve) {
      var el = document.createElement("script"); el.src = "data/snap/" + id + ".js"; el.async = true;
      el.onload = function () { var sn = window.SATPASS_SNAPSHOTS && window.SATPASS_SNAPSHOTS[id]; if (sn && !loadedSnaps[id]) applySnapshot(id, sn); delete snapLoading[id]; emit(); resolve(!!sn); };
      el.onerror = function () { delete snapLoading[id]; resolve(false); };
      document.head.appendChild(el);
    });
    return snapLoading[id];
  }
  function ensureAll() { return Promise.all(Cat.CATEGORIES.filter(function (c) { return !c.core; }).map(function (c) { return ensure(c.id); })); }
  function allLoaded() { return Cat.CATEGORIES.every(function (c) { return c.core || loadedSnaps[c.id]; }); }
  function members(id) { return (data.groups[id] || []).filter(function (n) { return data.byId[n]; }); }
  function categoriesOf(n) { return Cat.CATEGORIES.filter(function (c) { return (data.groups[c.id] || []).indexOf(n) >= 0; }).map(function (c) { return c.id; }); }
  function catStatus(id) { var i = data.catInfo[id]; return i ? { fetchedAt: i.fetchedAt, origin: i.origin } : { fetchedAt: 0, origin: "none" }; }
  function persist(extra) {
    save("tle", Object.assign({ tle: Tle.serialize(data.sats), fetchedAt: data.fetchedAt, source: data.source, origin: data.origin }, extra || {}));
    var g = {}; Object.keys(data.groups).forEach(function (c) { if (data.catInfo[c] && data.catInfo[c].origin !== "bundled snapshot") g[c] = { ids: data.groups[c], fetchedAt: data.catInfo[c].fetchedAt, origin: data.catInfo[c].origin }; });
    save("groups", g);
  }
  var meta = load("tlemeta", { lastAttempt: 0, lastError: null, lastOk: 0 });
  var catMeta = load("catmeta", {});   // per non-core category: {lastAttempt, lastOk, lastError}
  function mOf(id) { return id && !Cat.BY_ID[id].core ? (catMeta[id] || (catMeta[id] = { lastAttempt: 0, lastOk: 0, lastError: null })) : meta; }
  function saveMeta(id) { if (id && !Cat.BY_ID[id].core) save("catmeta", catMeta); else save("tlemeta", meta); }
  function nextAutoRefreshDue(now) {
    now = now || Date.now();
    return now - data.fetchedAt > AUTO_REFRESH_MS && now - meta.lastAttempt > FAIL_BACKOFF_MS;
  }
  // Non-core categories worth refreshing automatically right now: ones the user is using (contain a favourite, or `also`), data older than 24 h, not in back-off.
  function staleCategories(also, now) {
    now = now || Date.now(); var want = {};
    Cat.CATEGORIES.forEach(function (c) { if (!c.core && (also === c.id || settings.favs.some(function (n) { return (data.groups[c.id] || []).indexOf(n) >= 0; }))) want[c.id] = 1; });
    return Object.keys(want).filter(function (id) { var m = mOf(id), t = catStatus(id).fetchedAt; return now - t > CAT_AUTO_MS && now - m.lastAttempt > FAIL_BACKOFF_MS; });
  }
  function manualAllowed(now, id) { now = now || Date.now(); var m = mOf(id); return now - m.lastOk >= MIN_MANUAL_MS && now - m.lastAttempt >= 60e3; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var MAX_BYTES = 2.5e6;
  function fetchText(url) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null, timer = ctrl && setTimeout(function () { ctrl.abort(); }, 20000);
    return fetch(url, { mode: "cors", cache: "no-store", credentials: "omit", signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (r.status === 403 || r.status === 429) throw new Error("CelesTrak asked us to slow down (HTTP " + r.status + "). Try again in a couple of hours.");
      if (!r.ok) throw new Error("CelesTrak returned HTTP " + r.status);
      return r.text();
    }).then(function (t) { if (t.length > MAX_BYTES) throw new Error("Unexpectedly large response from CelesTrak – ignored."); return t; });
  }
  function parseResponse(txt, fmt) {
    if (fmt === "json") { if (/^\s*No GP data found/i.test(txt)) return { sats: [], errors: [] }; return Tle.parseOmm(txt); }
    return Tle.parse(txt);
  }
  // Fetch the queries of the given categories sequentially (polite, 1.2 s apart). opts: {categories:[ids] (default: core), progress(i, n, id)}.
  // Resolves {ok, added, failed:[ids], message}
  var inflight = null;
  function refresh(opts) {
    opts = opts || {};
    if (inflight) return inflight;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve({ ok: false, message: "You appear to be offline. Using TLEs from " + new Date(data.fetchedAt).toLocaleString() + "." });
    var cats = (opts.categories && opts.categories.length ? opts.categories : Cat.CORE).filter(function (id) { return Cat.BY_ID[id]; });
    var isCore = cats.some(function (id) { return Cat.BY_ID[id].core; });
    var jobs = []; cats.forEach(function (id) { Cat.BY_ID[id].fetch.forEach(function (f) { jobs.push({ cat: id, spec: f }); }); });
    cats.forEach(function (id) { var m = mOf(id); m.lastAttempt = Date.now(); saveMeta(id); });
    inflight = (async function () {
      var got = [], failed = [], firstErr = null, ids = {}, okCats = {}, failCats = {};
      for (var i = 0; i < jobs.length; i++) {
        var j = jobs[i], spec = j.spec, c = Cat.BY_ID[j.cat];
        if (opts.progress) opts.progress(i, jobs.length, spec.id, j.cat);
        try {
          var txt = await fetchText(Cat.queryUrl(spec)), p = parseResponse(txt, spec.fmt), list = c.accept ? p.sats.filter(c.accept) : p.sats;
          if (!p.sats.length && !(spec.fmt === "json" && /^\s*No GP data found/i.test(txt))) throw new Error("No element sets in the response");
          got = got.concat(list); (ids[j.cat] = ids[j.cat] || []).push.apply(ids[j.cat], list.map(function (s) { return s.norad; }));
        } catch (e) { failed.push(spec.id); failCats[j.cat] = 1; if (!firstErr) firstErr = e; if (/slow down/.test(e.message) || e.name === "TypeError" || e.name === "AbortError") break; /* rate-limited or network down: stop, don't hammer */ }
        if (i < jobs.length - 1) await sleep(1200);
      }
      cats.forEach(function (id) { if (ids[id] && !failCats[id]) okCats[id] = 1; });
      if (!got.length) {
        var msg = firstErr && firstErr.name === "AbortError" ? "CelesTrak took too long to answer." : (firstErr && /Failed to fetch|NetworkError|Load failed/i.test(firstErr.message) ? "Couldn't reach CelesTrak (offline, blocked by a network/ad-blocker, or CORS)." : (firstErr ? firstErr.message : "No data received."));
        cats.forEach(function (id) { mOf(id).lastError = msg; saveMeta(id); });
        return { ok: false, message: msg + " Using TLEs from " + new Date(data.fetchedAt).toLocaleString() + ". You can also paste TLEs manually (Satellites → Paste TLEs)." };
      }
      var before = data.sats.length, now = Date.now(), merged = Tle.merge(data.sats, got);
      data.sats = merged; data.byId = {}; merged.forEach(function (s) { data.byId[s.norad] = s; });
      if (isCore) { data.fetchedAt = now; data.source = "CelesTrak GP (celestrak.org)"; data.origin = "CelesTrak"; }
      cats.forEach(function (id) {
        var uniq = {}; (ids[id] || []).forEach(function (n) { uniq[n] = 1; });
        var prev = (data.groups[id] || []);
        if (ids[id]) { var all = Object.keys(uniq).map(Number); if (failCats[id]) prev.forEach(function (n) { if (!uniq[n]) all.push(n); }); data.groups[id] = all; data.catInfo[id] = { fetchedAt: now, origin: "CelesTrak" }; }
        var m = mOf(id); if (okCats[id] || ids[id]) m.lastOk = now; m.lastError = failCats[id] ? "Some queries failed: " + failed.join(", ") : null; saveMeta(id);
      });
      persist(); emit();
      return { ok: true, added: data.sats.length - before, failed: failed, message: "Updated " + got.length + " element sets from CelesTrak" + (failed.length ? " (failed: " + failed.join(", ") + ")" : "") + "." };
    })().then(function (r) { inflight = null; return r; }, function (e) { inflight = null; throw e; });
    return inflight;
  }
  /* On-demand lookup of one name / NORAD id (e.g. a single Starlink). Guarded by SatCatalog.lookupCheck and capped at MAX_LOOKUP_RESULTS. */
  var lookupMeta = load("lookupmeta", { last: 0 }), lookups = load("lookups", []);
  function lookup(text) {
    var chk = Cat.lookupCheck(text);
    if (!chk.ok) return Promise.resolve({ ok: false, message: chk.reason });
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve({ ok: false, message: "You appear to be offline." });
    var wait = 5000 - (Date.now() - lookupMeta.last);
    if (wait > 0) return Promise.resolve({ ok: false, message: "Please wait a few seconds between searches (CelesTrak asks for polite use)." });
    lookupMeta.last = Date.now(); save("lookupmeta", lookupMeta);
    return fetchText(chk.url).then(function (txt) {
      var p = parseResponse(txt, "json"), list = p.sats;
      if (!list.length) return { ok: false, message: "CelesTrak has no satellite matching “" + text + "”." };
      if (list.length > Cat.MAX_LOOKUP_RESULTS) return { ok: false, message: list.length + " satellites match “" + text + "” – be more specific (limit " + Cat.MAX_LOOKUP_RESULTS + ")." };
      var merged = Tle.merge(data.sats, list); data.sats = merged; data.byId = {}; merged.forEach(function (s) { data.byId[s.norad] = s; });
      var ids = list.map(function (s) { return s.norad; }); lookups = lookups.filter(function (n) { return ids.indexOf(n) < 0; }).concat(ids).slice(-200); save("lookups", lookups);
      persist(); emit();
      return { ok: true, ids: ids, message: "Added " + list.length + " satellite" + (list.length > 1 ? "s" : "") + " from CelesTrak." };
    }, function (e) { return { ok: false, message: e.message }; });
  }
  function searched() { return lookups.filter(function (n) { return data.byId[n]; }); }
  // manual paste fallback
  function importText(text) {
    var p = Tle.parse(text);
    if (!p.sats.length) return { ok: false, message: p.errors[0] || "No valid TLEs found" };
    setSats(Tle.merge(data.sats, p.sats), Math.max(data.fetchedAt, Date.now()), "Pasted by user", "pasted");
    persist(); emit();
    return { ok: true, message: "Imported " + p.sats.length + " element set(s)" + (p.errors.length ? "; " + p.errors.length + " skipped" : "") + "." };
  }
  function lastError(id) { return mOf(id).lastError; }
  function lastOk(id) { return mOf(id).lastOk; }

  window.SatStore = {
    settings: settings, set: setSettings, hasLocation: hasLocation, isFav: isFav, toggleFav: toggleFav,
    data: data, init: init, refresh: refresh, importText: importText, onChange: onChange, nextAutoRefreshDue: nextAutoRefreshDue, manualAllowed: manualAllowed,
    ensure: ensure, ensureAll: ensureAll, allLoaded: allLoaded, members: members, categoriesOf: categoriesOf, catStatus: catStatus, staleCategories: staleCategories,
    lookup: lookup, searched: searched,
    lastError: lastError, lastOk: lastOk, load: load, save: save, del: del,
    constants: { AUTO_REFRESH_MS: AUTO_REFRESH_MS, CAT_AUTO_MS: CAT_AUTO_MS, MIN_MANUAL_MS: MIN_MANUAL_MS, FAIL_BACKOFF_MS: FAIL_BACKOFF_MS }, SOURCES: SOURCES
  };
})();
