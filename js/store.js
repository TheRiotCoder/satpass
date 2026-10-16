/* SatPass data layer (browser): settings, TLE cache, CelesTrak refresh. */
(function () {
  "use strict";
  var Tle = window.SatTle, Radio = window.SatRadio, Src = window.SatSources;
  var LS = "satpass:";
  function load(k, d) { try { var v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  var saveFailListeners = [], lastSaveFail = null;
  function save(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); return true; } catch (e) { lastSaveFail = { key: k, at: Date.now(), quota: !!(e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014)) }; saveFailListeners.forEach(function (f) { try { f(lastSaveFail); } catch (x) {} }); return false; } }
  function onSaveFail(fn) { saveFailListeners.push(fn); }
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
    var okTle = save("tle", Object.assign({ tle: Tle.serialize(data.sats), fetchedAt: data.fetchedAt, source: data.source, origin: data.origin }, extra || {}));
    var g = {}; Object.keys(data.groups).forEach(function (c) { if (data.catInfo[c] && data.catInfo[c].origin !== "bundled snapshot") g[c] = { ids: data.groups[c], fetchedAt: data.catInfo[c].fetchedAt, origin: data.catInfo[c].origin }; });
    return save("groups", g) && okTle;
  }
  var meta = load("tlemeta", { lastAttempt: 0, lastError: null, lastOk: 0 });
  var catMeta = load("catmeta", {});   // per non-core category: {lastAttempt, lastOk, lastError}
  function mOf(id) { return id && !Cat.BY_ID[id].core ? (catMeta[id] || (catMeta[id] = { lastAttempt: 0, lastOk: 0, lastError: null })) : meta; }
  function saveMeta(id) { if (id && !Cat.BY_ID[id].core) save("catmeta", catMeta); else save("tlemeta", meta); }
  function nextAutoRefreshDue(now) {
    now = now || Date.now();
    if (!(now - data.fetchedAt > AUTO_REFRESH_MS)) return false;
    return enabledChain().some(function (id) {
      if (id === "celestrak") return now - meta.lastAttempt > FAIL_BACKOFF_MS && now >= stOf(id).backoffUntil;
      var st = stOf(id); return readiness(id).ready && !inBackoff(id, now) && now - st.lastOk >= Src.AUTO_MIN_MS[id];
    });
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
  function refreshCelesTrak(opts) {
    opts = opts || {};
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve({ ok: false, offline: true, kind: "network", message: "You appear to be offline. Using TLEs from " + new Date(data.fetchedAt).toLocaleString() + "." });
    var cats = (opts.categories && opts.categories.length ? opts.categories : Cat.CORE).filter(function (id) { return Cat.BY_ID[id]; });
    var isCore = cats.some(function (id) { return Cat.BY_ID[id].core; });
    var jobs = []; cats.forEach(function (id) { Cat.BY_ID[id].fetch.forEach(function (f) { jobs.push({ cat: id, spec: f }); }); });
    cats.forEach(function (id) { var m = mOf(id); m.lastAttempt = Date.now(); saveMeta(id); });
    return (async function () {
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
        return { ok: false, kind: firstErr && /slow down/.test(firstErr.message) ? "rate" : firstErr && /HTTP \d+/.test(firstErr.message) ? "server" : "network", message: msg + " Using TLEs from " + new Date(data.fetchedAt).toLocaleString() + ". You can also paste TLEs manually (Satellites → Paste TLEs)." };
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
      return { ok: true, source: "celestrak", added: data.sats.length - before, failed: failed, failedCats: Object.keys(failCats), message: "Updated " + got.length + " element sets from CelesTrak" + (failed.length ? " (failed: " + failed.join(", ") + ")" : "") + "." };
    })();
  }

  /* =====================================================================================================================
     Data sources (v1.2): CelesTrak (direct) + Space-Track / SatNOGS DB / N2YO through the user's own proxy (proxy/worker.js).
     Order + enable flags + proxy URL live in satpass:sources; credentials ONLY in satpass:creds (this browser, optionally passphrase-encrypted);
     per-source status/back-off in satpass:srcstatus. Nothing here ever logs a credential and every message is passed through Src.redact().
     ===================================================================================================================== */
  var srcCfg = Src.normalizeConfig(load("sources", null));
  var srcStat = load("srcstatus", {});
  var limHist = load("srclimit", {});
  var CRED_KEYS = ["stIdentity", "stPassword", "satnogsToken", "n2yoKey", "proxyToken"];
  /* Credential storage policy (1.2.1): the origin (github.io/<user>) is shared with every other project of the same account, and any script of that origin
     can read localStorage. So secrets are NEVER written to localStorage in plaintext any more:
       - with a passphrase  -> AES-GCM blob in localStorage ("encrypted")
       - without            -> this tab's sessionStorage + memory only ("session"; gone when the tab is closed)
       - 1.2.0 plaintext copies are still read (so nothing is lost) but flagged "legacy-plain": the UI offers to encrypt or remove them. */
  var credVals = {}, credBlob = load("creds", null), credLocked = false, memKey = null, legacyPlain = false;   // memKey = {dek (random 256-bit data key, bytes), hdr (its passphrase wrapping)} while an encrypted vault is unlocked; the passphrase itself is never kept
  var SESS = null; try { SESS = typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch (e) { SESS = null; }
  function sessLoad() { try { var v = SESS && SESS.getItem(LS + "creds"); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function sessSave(o) { try { if (!SESS) return false; if (o && Object.keys(o).length) SESS.setItem(LS + "creds", JSON.stringify(o)); else SESS.removeItem(LS + "creds"); return true; } catch (e) { return false; } }
  function cleanCreds(o) { var r = {}; CRED_KEYS.forEach(function (k) { if (o && typeof o[k] === "string" && o[k]) r[k] = o[k]; }); return r; }
  if (credBlob && credBlob.enc) credLocked = true;
  else if (credBlob && Object.keys(cleanCreds(credBlob)).length) { credVals = cleanCreds(credBlob); legacyPlain = true; }
  else credVals = cleanCreds(sessLoad());
  var sessionHint = !!load("credhint", false);   // non-secret marker: credentials were entered as session-only (so an empty store after the tab closed can say so)
  function credMode() { return credLocked ? "locked" : memKey || (credBlob && credBlob.enc) ? "encrypted" : legacyPlain ? "legacy-plain" : Object.keys(credVals).length ? "session" : sessionHint ? "session-lost" : "none"; }
  function secretList() { return CRED_KEYS.map(function (k) { return credVals[k]; }); }
  function red(t) { return Src.redact(t, secretList()); }
  function saveCfg() { save("sources", srcCfg); }
  function lockedErr() { return Src.SourceError("locked", "Credentials are locked – unlock them with your passphrase first. Nothing was changed."); }
  /* Every operation that touches the vault (save, passphrase change/removal, unlock, biometric enrol/unlock, lock) runs through ONE queue, so a lock can never zero the
     data key while a seal/wrap that uses it is in flight (1.3.2 race: lock during a passphrase change sealed under an all-zero key; setCreds+lock in one tick corrupted the vault).
     lockNow() waits behind the pending operations; `gen` is bumped by forgetCreds so an operation that finishes after it cannot resurrect anything. */
  var vq = Promise.resolve(), vqPending = 0, lockPending = false, gen = 0;
  function enqueue(fn) {
    vqPending++;
    var p = vq.then(fn).then(function (r) { vqPending--; return r; }, function (e) { vqPending--; throw e; });   // (counter drops BEFORE the caller's promise settles)
    vq = p.then(function () {}, function () {});
    return p;
  }
  function cancelledErr() { return Src.SourceError("cancelled", "Cancelled – the credentials were cleared while this was in progress. Nothing was saved."); }
  function isLockedNow() { return credLocked || lockPending; }
  function persistNow(g) {   // g = generation at the time the caller asked (a Forget in between cancels it)
    if (credLocked) return Promise.reject(lockedErr());   // never overwrite (or delete) the encrypted blob while it cannot be decrypted
    if (g === undefined) g = gen; if (g !== gen) return Promise.reject(cancelledErr());
    if (memKey) return Src.sealVault(Object.assign({}, credVals), memKey.dek, memKey.hdr).then(function (blob) {
      if (g !== gen) throw cancelledErr();
      if (!save("creds", blob)) throw Src.SourceError("storage", "Browser storage is full or blocked – the encrypted credentials could not be saved.");
      credBlob = blob; legacyPlain = false; sessSave(null); sessionHint = false; del("credhint");
    });
    del("creds"); credBlob = null; legacyPlain = false;   // no passphrase: nothing readable is kept in localStorage
    if (Object.keys(credVals).length) { sessionHint = true; save("credhint", true); } else if (sessionHint) { sessionHint = false; del("credhint"); }
    sessSave(credVals);   // (without sessionStorage the credentials simply stay in memory)
    return Promise.resolve();
  }
  function persistCreds() { var g = gen; return enqueue(function () { return persistNow(g); }); }
  function getCreds() { return Object.assign({}, credVals); }
  function clearBlocks(id) { (id ? [id] : Src.IDS).forEach(function (x) { var st = srcStat[x]; if (st) { st.blocked = null; st.fails = 0; st.backoffUntil = 0; } }); save("srcstatus", srcStat); }
  function setCreds(patch) {
    if (isLockedNow()) return Promise.reject(lockedErr());
    CRED_KEYS.forEach(function (k) { if (patch && k in patch) { var v = String(patch[k] == null ? "" : patch[k]).trim(); if (v) credVals[k] = v; else delete credVals[k]; } });
    clearBlocks(); return persistCreds();
  }
  function forgetCreds() { gen++; lockPending = false; del("bio"); credVals = {}; credBlob = null; credLocked = false; wipeKey(); legacyPlain = false; sessionHint = false; del("creds"); del("credhint"); sessSave(null); clearBlocks(); emit(); }
  function wipeKey() { if (memKey && memKey.dek) { try { memKey.dek.fill(0); } catch (e) {} } memKey = null; }
  function b64of(u8) { var t = ""; for (var i = 0; i < u8.length; i++) t += String.fromCharCode(u8[i]); return btoa(t); }
  function bytesOf(b64) { var t = atob(b64), u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
  // First encryption, or a passphrase change. 1.3.3: a passphrase change ROTATES the data key (new random key, credentials re-encrypted, wrapped by the new passphrase) so an old
  // copy of the vault plus the old passphrase no longer opens anything saved afterwards. The biometric record wrapped the OLD key (and the PRF output is not kept), so it is deleted
  // in the same step and the user re-enrols (one tap) - the passphrase keeps working throughout, nothing is lost. Resolves {rotated, bioRemoved}.
  function lockWithPassphrase(pass) {
    if (isLockedNow()) return Promise.reject(lockedErr());
    if (!pass || pass.length < Src.MIN_PASSPHRASE) return Promise.reject(Src.SourceError("config", "Use a passphrase of at least " + Src.MIN_PASSPHRASE + " characters."));
    var g = gen;
    return enqueue(function () {
      if (credLocked) throw lockedErr();
      if (g !== gen) throw cancelledErr();
      var rotated = !!memKey;
      return Src.createVault(Object.assign({}, credVals), pass).then(function (v) {
        if (g !== gen) throw cancelledErr();
        if (!save("creds", v.blob)) throw Src.SourceError("storage", "Browser storage is full or blocked – the encrypted credentials could not be saved.");
        var hadBio = !!load("bio", null), old = memKey;
        credBlob = v.blob; memKey = { dek: v.dek, hdr: Src.vaultHeader(v.blob) }; legacyPlain = false; sessSave(null); sessionHint = false; del("credhint");
        if (old && old.dek) { try { old.dek.fill(0); } catch (e) {} }
        if (hadBio) del("bio");
        emit(); return { rotated: rotated, bioRemoved: hadBio };
      });
    });
  }
  function unlock(pass) {
    if (!credBlob || !credBlob.enc) return Promise.resolve(true);
    var g = gen;
    return enqueue(function () {
      if (!credLocked && memKey) return true;
      if (g !== gen) throw cancelledErr();
      return Src.openVault(credBlob, pass).then(function (r) {
        if (g !== gen) throw cancelledErr();
        credVals = cleanCreds(r.creds);
        if (!r.legacy) { memKey = { dek: r.dek, hdr: r.hdr }; credLocked = false; emit(); return true; }
        // 1.2.x / 1.3.x blob (the passphrase key encrypted the credentials directly): migrate to the data-key format now that the passphrase is known
        return Src.createVault(credVals, pass).then(function (v) {
          if (g !== gen) throw cancelledErr();
          memKey = { dek: v.dek, hdr: Src.vaultHeader(v.blob) }; if (save("creds", v.blob)) credBlob = v.blob;   // (if storage is full the old blob stays and the next successful save upgrades it)
          credLocked = false; emit(); return true;
        });
      });
    });
  }
  function removePassphrase() { if (isLockedNow()) return Promise.reject(lockedErr()); return enqueue(function () { if (credLocked) throw lockedErr(); wipeKey(); del("bio"); return persistNow().then(emit); }); }   // -> session-only; the encrypted copy and the biometric record are deleted
  function dropPlaintextCopy() { if (!legacyPlain) return Promise.resolve(); return enqueue(function () { return persistNow().then(emit); }); }       // 1.2.0 plaintext copy -> session-only
  /* ---- 1.3.0: auto-lock, biometric (WebAuthn PRF) second door, encrypted backup ---- */
  var vaultCfg = Src.normalizeVaultCfg(load("vault", null));
  function setVaultCfg(patch) { vaultCfg = Src.normalizeVaultCfg(Object.assign({}, vaultCfg, patch)); save("vault", vaultCfg); emit(); return Object.assign({}, vaultCfg); }
  // Lock: forget every decrypted secret held in memory (credentials + data key). Only meaningful for a passphrase vault; session-only credentials
  // have no way back, so they are left alone (the UI says so). JS strings cannot be overwritten in place: they are dropped and become garbage; the key bytes are zeroed.
  function lockEligible() { return !credLocked && !!(memKey && credBlob && credBlob.enc); }
  function doLock() { lockPending = false; if (!lockEligible()) return false; credVals = {}; wipeKey(); credLocked = true; emit(); return true; }
  function lockNow() {
    if (!vqPending) return doLock();
    // an operation is in flight: the lock is queued behind it (the key is never zeroed under a running seal/wrap). Until it runs, edits are refused.
    lockPending = true; enqueue(doLock); return true;
  }
  function whenIdle() { return vq.then(function () {}); }
  function pageHost() { return typeof location !== "undefined" && location && location.hostname ? location.hostname : ""; }
  function bioAllowed() { return !Src.sharedOrigin(pageHost()); }   // github.io is one origin shared by every Pages app of the account: no biometric there
  // records from 1.3.0/1.3.1 (they wrapped the passphrase) and any record on a shared origin are deleted on load
  (function purgeBio() { var raw = load("bio", null); if (raw && (!bioAllowed() || !Src.validBioRecord(raw))) del("bio"); })();
  function bioRecord() { if (!bioAllowed()) return null; var r = load("bio", null); return Src.validBioRecord(r) ? r : null; }
  function bioInfo() { var r = bioRecord(); return r ? { created: r.created, rpId: r.rpId } : null; }
  // enroll: meta {credId, prfSalt, rpId}, prf = PRF output. Needs the unlocked vault: what gets wrapped is the random data key, never the passphrase.
  function bioSave(meta, prf) {
    if (isLockedNow()) return Promise.reject(lockedErr());
    if (!bioAllowed()) return Promise.reject(Src.SourceError("config", "Biometric unlock is not offered on a shared origin (" + pageHost() + ") – see the README for hosting SatPass on its own origin."));
    var g = gen;
    return enqueue(function () {
      if (credLocked) throw lockedErr();
      if (g !== gen) throw cancelledErr();
      if (!memKey || !(credBlob && credBlob.enc)) throw Src.SourceError("config", "Set a passphrase and encrypt your credentials first – biometric unlock opens that encrypted copy.");
      var secret = b64of(memKey.dek);   // (copied now, before any await)
      return Src.wrapSecret(secret, prf, meta).then(function (rec) {
        if (g !== gen) throw cancelledErr();
        if (!save("bio", rec)) throw Src.SourceError("storage", "Browser storage is full or blocked – biometric unlock was not saved."); emit(); return bioInfo();
      });
    }).then(function (x) { try { if (prf && prf.fill) prf.fill(0); } catch (e) {} return x; }, function (e) { try { if (prf && prf.fill) prf.fill(0); } catch (e2) {} throw e; });
  }
  function bioRemove() { del("bio"); emit(); }
  // getPrf(record) -> Promise<ArrayBuffer|Uint8Array>: asks the authenticator (user verification) for the PRF output; it unwraps the data key, which opens the vault.
  function bioUnlock(getPrf) {
    var rec = bioRecord(); if (!rec) return Promise.reject(Src.SourceError("config", "Biometric unlock is not set up on this device."));
    if (!credLocked) return Promise.resolve(true);
    // the authenticator prompt (can take as long as the user needs) runs OUTSIDE the vault queue; only the unwrap/open step is queued
    var g = gen;
    return Promise.resolve(getPrf(rec)).then(function (prf) {
      return enqueue(function () {
        if (!credLocked) { try { if (prf && prf.fill) prf.fill(0); } catch (e) {} return true; }
        if (g !== gen) throw cancelledErr();
        var cur = bioRecord();
        if (!cur || cur.created !== rec.created) throw Src.SourceError("config", "The biometric record changed while waiting – try again.");
        return Src.unwrapSecret(rec, prf).then(function (dekB64) {
          try { if (prf && prf.fill) prf.fill(0); } catch (e) {}
          var dek = bytesOf(dekB64);
          return Src.openWithDek(credBlob, dek).then(function (creds) { if (g !== gen) throw cancelledErr(); credVals = cleanCreds(creds); memKey = { dek: dek, hdr: Src.vaultHeader(credBlob) }; credLocked = false; emit(); return true; });
        });
      });
    });
  }
  function exportBackup(pass) {
    if (credLocked) return Promise.reject(lockedErr());
    return Src.exportBackup(getCreds(), srcCfg.proxy, pass);
  }
  // confirm(info) is asked before anything is overwritten or the proxy URL changes (a crafted backup could repoint the proxy); without it such an import is refused.
  function importBackup(text, pass, confirm) {
    if (credLocked) return Promise.reject(lockedErr());
    return Src.importBackup(text, pass).then(function (r) {
      var patch = {}; CRED_KEYS.forEach(function (k) { if (typeof r.creds[k] === "string" && r.creds[k]) patch[k] = r.creds[k]; });
      if (!Object.keys(patch).length) throw Src.SourceError("parse", "The backup contains no credentials.");
      var proxyOk = !!(r.proxy && Src.validateProxyUrl(r.proxy).ok), host = ""; try { host = proxyOk ? new URL(r.proxy).host : ""; } catch (e) {}
      var info = { keys: Object.keys(patch), overwrites: Object.keys(patch).filter(function (k) { return credVals[k] && credVals[k] !== patch[k]; }), proxy: proxyOk ? r.proxy : "", proxyHost: host, currentProxy: srcCfg.proxy || "", proxyChanged: proxyOk && r.proxy !== srcCfg.proxy };
      var needs = info.overwrites.length > 0 || info.proxyChanged;
      var ask = !needs ? Promise.resolve(true) : typeof confirm === "function" ? Promise.resolve(confirm(info)) : Promise.resolve(false);
      return ask.then(function (yes) {
        if (!yes) throw Src.SourceError("cancelled", "Import cancelled – nothing was changed.");
        return setCreds(patch).then(function () { if (proxyOk) setConfig({ proxy: r.proxy }); return { imported: Object.keys(patch).length, proxy: proxyOk, overwrote: info.overwrites.length }; });
      });
    });
  }
  function setConfig(patch) {
    var before = JSON.stringify(srcCfg);
    srcCfg = Src.normalizeConfig(Object.assign({}, srcCfg, patch || {}, patch && patch.enabled ? { enabled: Object.assign({}, srcCfg.enabled, patch.enabled) } : {}));
    if (JSON.stringify(srcCfg) !== before) { saveCfg(); if (patch && "proxy" in patch) clearBlocks(); }
    return srcCfg;
  }
  function stOf(id) { return srcStat[id] || (srcStat[id] = { lastOk: 0, lastAttempt: 0, lastError: null, lastKind: null, fails: 0, backoffUntil: 0, blocked: null, lastNote: null }); }
  function noteOk(id, note, at) { var st = stOf(id), now = at || Date.now(); st.lastOk = now; st.lastAttempt = now; st.lastError = null; st.lastKind = null; st.fails = 0; st.backoffUntil = 0; st.blocked = null; st.lastNote = note || null; save("srcstatus", srcStat); }
  function noteFail(id, kind, msg) {
    var st = stOf(id), now = Date.now(); st.lastAttempt = now; st.lastError = red(msg).slice(0, 240); st.lastKind = kind; st.fails = (st.fails || 0) + 1;
    st.backoffUntil = now + Src.backoffMs(st.fails, kind);
    if (kind === "auth" && id !== "celestrak") st.blocked = "auth";   // wrong credentials: never retry automatically until they are changed (Space-Track may lock accounts)
    save("srcstatus", srcStat);
  }
  function inBackoff(id, now) { var st = stOf(id); now = now || Date.now(); return !!st.blocked || now < st.backoffUntil; }
  function readiness(id) { return Src.readiness(id, srcCfg, credVals, { locked: credLocked }); }
  function enabledChain() { return srcCfg.order.filter(function (id) { return srcCfg.enabled[id]; }); }

  // one HTTP request to the proxy (or direct for health), with local rate limiting, timeout and error classification
  function srcFetch(id, op, args, parse, opts) {
    opts = opts || {};
    var rd = readiness(id); if (!rd.ready) return Promise.reject(Src.SourceError(rd.kind || "config", rd.reason));
    var now = Date.now(), lim = Src.limitCheck(limHist, id, op, now);
    if (!lim.ok) return Promise.reject(Src.SourceError("rate", "Local rate limit for " + Src.META[id].label + ": wait " + Math.ceil(lim.waitMs / 60000) + " min (SatPass stays below the published limits)."));
    var req; try { req = Src.buildRequest(id, op, args, srcCfg, credVals); } catch (e) { return Promise.reject(e); }
    limHist = Src.limitRecord(limHist, id, op, now); save("srclimit", limHist);
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null, timer = ctrl && setTimeout(function () { ctrl.abort(); }, 30000);
    var init = Object.assign({}, req.init, ctrl ? { signal: ctrl.signal } : {});
    return fetch(req.url, init).then(function (r) {
      if (timer) clearTimeout(timer);
      var hk = r.headers && r.headers.get ? r.headers.get("X-SatPass-Error") : null;
      if (!r.ok) {
        return r.text().then(function (t) {
          var m = ""; try { m = JSON.parse(t).error || ""; } catch (e) {}
          throw Src.SourceError(Src.classifyHttp(r.status, hk), red(m || ("HTTP " + r.status + " from the proxy")), r.status);
        });
      }
      return r.text().then(function (t) { return { text: t, cache: r.headers && r.headers.get ? r.headers.get("X-SatPass-Cache") : null }; });
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw Src.SourceError("network", e && e.name === "AbortError" ? Src.META[id].label + " (via your proxy) took too long to answer." : "Could not reach your proxy at " + red(srcCfg.proxy) + " (offline, wrong URL, or blocked).");
    }).then(function (res) {
      if (opts.raw) return res; try { return parse(res.text, res); } catch (e) { if (e && e.name === "SourceError") throw e; throw Src.SourceError("parse", red(e && e.message)); }
    });
  }

  // element sets for `ids` from a proxied source -> {sats, note}
  async function pullFromSource(id, ids, progress) {
    var got = [], errs = [], note = null, n;
    if (id === "spacetrack") {
      var chunks = Src.chunk(ids, Src.ST_CHUNK);
      for (var i = 0; i < chunks.length; i++) {
        if (progress) progress(i, chunks.length, id);
        var r = await srcFetch(id, "gp", { ids: chunks[i] }, function (t) { return Src.parseSpaceTrackGp(t); }); got = got.concat(r.sats); errs = errs.concat(r.errors);
        if (i < chunks.length - 1) await sleep(2000);
      }
    } else if (id === "satnogs") {
      var want = ids.filter(function (x) { return x < 100000; });
      if (progress) progress(0, 1, id);
      var rs = await srcFetch(id, "tle", { ids: want.length <= 400 ? want : null }, function (t) { return Src.parseSatnogsTle(t, want); }); got = rs.sats; errs = rs.errors;
    } else if (id === "n2yo") {
      var favs = settings.favs, curated = Radio.CURATED.map(function (c) { return c.norad; }), order = [], seen = {};
      favs.concat(curated).concat(ids).forEach(function (x) { if (ids.indexOf(x) >= 0 && !seen[x]) { seen[x] = 1; order.push(x); } });
      var take = order.slice(0, Src.N2YO_MAX_SATS); note = take.length < ids.length ? "N2YO is per-satellite: updated " + take.length + " of " + ids.length + " (favourites first)." : null;
      for (n = 0; n < take.length; n++) {
        if (progress) progress(n, take.length, id);
        try { var one = await srcFetch(id, "tle", { id: take[n] }, function (t) { return Src.parseN2yoTle(t); }); got = got.concat(one.sats); if (one.transactions != null) stOf(id).quota = { transactions: one.transactions, at: Date.now() }; }
        catch (e) { if (e.kind !== "parse") { if (!got.length) throw e; note = (note ? note + " " : "") + "Stopped after " + got.length + " (" + e.message + ")"; break; } errs.push(e.message); }
        if (n < take.length - 1) await sleep(1200);
      }
    }
    if (!got.length) throw Src.SourceError("parse", errs[0] ? red(errs[0]) : "no element sets in the answer");
    return { sats: got, note: note };
  }
  async function refreshFromSource(id, cats, opts) {
    var idset = {}; cats.forEach(function (c) { members(c).forEach(function (x) { idset[x] = 1; }); }); settings.favs.forEach(function (x) { if (data.byId[x]) idset[x] = 1; });
    var ids = Object.keys(idset).map(Number).sort(function (a, b) { return a - b; });
    if (!ids.length) throw Src.SourceError("config", "No satellites to refresh.");
    var r = await pullFromSource(id, ids, opts.progress), before = data.sats.length, now = Date.now(), prevEpoch = {};
    data.sats.forEach(function (x) { prevEpoch[x.norad] = x.epochMs; });
    var newer = r.sats.filter(function (x) { return !(prevEpoch[x.norad] >= x.epochMs); }).length;
    var merged = Tle.merge(data.sats, r.sats); data.sats = merged; data.byId = {}; merged.forEach(function (x) { data.byId[x.norad] = x; });
    var label = Src.META[id].label + " (via proxy)";
    // a pull that delivered nothing newer than what we had is not "fresh data": age follows the newest epoch received (never later than now)
    var stamp = newer > 0 ? now : Math.max(0, Math.min(now, r.sats.reduce(function (m, x) { return Math.max(m, x.epochMs || 0); }, 0)));
    if (cats.some(function (c) { return Cat.BY_ID[c].core; })) { data.fetchedAt = newer > 0 ? now : Math.max(data.fetchedAt, stamp); data.source = label; data.origin = label; }
    cats.forEach(function (c) { data.catInfo[c] = { fetchedAt: newer > 0 ? now : Math.max((data.catInfo[c] && data.catInfo[c].fetchedAt) || 0, stamp), origin: label }; var m = mOf(c); m.lastOk = now; m.lastError = null; saveMeta(c); });
    persist(); emit();
    return { ok: true, source: id, at: now, added: data.sats.length - before, updated: newer, message: "Updated " + r.sats.length + " element sets from " + Src.META[id].label + " (" + newer + " newer than what you had)." + (r.note ? " " + r.note : "") };
  }
  /* The public refresh: try the enabled sources in the configured order; the first that delivers wins. Failures are recorded per source
     (exponential back-off, credential errors block until the credentials change) and summarised, e.g. "CelesTrak unreachable — using Space-Track". */
  function refresh(opts) {
    opts = opts || {};
    if (inflight) return inflight;
    var cats = (opts.categories && opts.categories.length ? opts.categories : Cat.CORE).filter(function (id) { return Cat.BY_ID[id]; });
    inflight = (async function () {
      var failed = [], first = null, now = Date.now();
      if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, offline: true, message: "You appear to be offline. Using TLEs from " + new Date(data.fetchedAt).toLocaleString() + "." };
      cats.forEach(function (c) { var m = mOf(c); m.lastAttempt = now; saveMeta(c); });
      var chain = enabledChain(), tried = 0, partial = null, pullCats = cats;
      for (var i = 0; i < chain.length; i++) {
        var id = chain[i], st = stOf(id), rd = readiness(id);
        if (!rd.ready) { failed.push({ id: id, kind: rd.kind || "config", skipped: true, reason: rd.reason }); continue; }
        if (opts.auto && inBackoff(id, now)) { failed.push({ id: id, kind: st.lastKind || "network", skipped: true, reason: "backing off" }); continue; }
        if (id !== "celestrak" && st.blocked === "auth") { failed.push({ id: id, kind: "auth", skipped: true, reason: "credentials were rejected – fix them in Setup → Data sources" }); continue; }
        if (id !== "celestrak" && opts.auto && now - st.lastOk < Src.AUTO_MIN_MS[id]) { failed.push({ id: id, kind: "rate", skipped: true, reason: "refreshed recently" }); continue; }
        if (id === "spacetrack" && opts.auto && Src.avoidBusyMinute(now)) { failed.push({ id: id, kind: "rate", skipped: true, reason: "waiting for a quiet minute (Space-Track asks scripts to avoid :00 and :30)" }); continue; }
        if (id !== "celestrak" && !opts.auto && now - st.lastOk < Src.MIN_PULL_MS[id] && st.lastOk && !opts.force && pullCats.every(function (c) { return (st.lastCats || []).indexOf(c) >= 0; })) { failed.push({ id: id, kind: "rate", skipped: true, reason: "pulled less than " + Src.MIN_PULL_MS[id] / 3600e3 + " h ago (" + Src.META[id].label + " asks for no more)" }); continue; }
        tried++;
        try {
          var r;
          if (id === "celestrak") {
            r = await refreshCelesTrak(opts); if (!r.ok) { var ce = Src.SourceError(r.kind || "network", r.message); ce.offline = !!r.offline; throw ce; }
            // some CelesTrak queries failed: keep what arrived and ask the next source for the categories that are still missing
            if (r.failedCats && r.failedCats.length && i < chain.length - 1) { partial = r; pullCats = r.failedCats.filter(function (c) { return Cat.BY_ID[c]; }); noteOk(id, r.message); continue; }
          } else r = await refreshFromSource(id, pullCats, opts);
          if (id !== "celestrak") stOf(id).lastCats = pullCats.slice();   // which categories the last successful pull covered (the hourly rule must not depend on the data age, which a 0-newer pull leaves alone)
          noteOk(id, r.message, r.at);   // r.at = the very timestamp stored as the category fetchedAt (no ms skew between the two)
          if (partial) return Object.assign({}, r, { source: id, partialFrom: "celestrak", message: partial.message + " Missing " + pullCats.join(", ") + " filled from " + Src.META[id].label + ": " + r.message });
          var failedReal = failed.filter(function (f) { return !f.skipped || f.kind !== "config"; });
          return Object.assign({}, r, { source: id, fallbackFrom: failedReal.map(function (f) { return f.id; }), message: (failedReal.length ? Src.fallbackMessage(failedReal, id) + ". " : "") + r.message });
        } catch (e) {
          var kind = e && e.kind || "network"; if (!first) first = e;
          if (e && e.offline) return { ok: false, offline: true, message: e.message };
          noteFail(id, kind, e.message || ""); failed.push({ id: id, kind: kind, message: red(e.message || "") });
        }
      }
      if (partial) return Object.assign({}, partial, { message: partial.message + " No other enabled source could fill in: " + pullCats.join(", ") + "." });
      var real = failed.filter(function (f) { return !f.skipped; }), hint = "";
      var unconfigured = Src.IDS.filter(function (x) { return !srcCfg.enabled[x] || !readiness(x).ready; }).filter(function (x) { return x !== "celestrak"; });
      var skips = failed.filter(function (f) { return f.skipped && f.kind !== "config"; });
      if (tried && skips.length) hint = " Skipped: " + skips.map(function (f) { return Src.META[f.id].label + " – " + f.reason; }).join("; ") + ".";
      if (!tried) hint = chain.length ? " Nothing was tried: " + failed.map(function (f) { return Src.META[f.id].label + " – " + f.reason; }).join("; ") + "." : " No data source is enabled (Setup → Data sources).";
      var base = first ? first.message : "";
      return { ok: false, allFailed: true, kind: first && first.kind, failed: failed.map(function (f) { return f.id; }),
        message: (real.length > 1 ? Src.fallbackMessage(real, null) + ". " : "") + base + hint + (unconfigured.length ? " Other sources (" + unconfigured.map(function (x) { return Src.META[x].label; }).join(", ") + ") are not set up – see Setup → Data sources, or import a TLE/OMM file." : " You can import a TLE/OMM file or paste TLEs on the Sats tab.") };
    })().then(function (r) { inflight = null; return r; }, function (e) { inflight = null; throw e; });
    return inflight;
  }
  // "Test connection": one real request per source (CelesTrak: tiny GP query), result also recorded in the status line
  function testSource(id) {
    var iss = 25544;
    function done(ok, msg, kind) { if (ok) noteOk(id, msg); else noteFail(id, kind || "network", msg); emit(); return { ok: ok, message: red(msg), kind: kind }; }
    if (id === "celestrak") {
      return fetchText(Cat.BASE + "CATNR=" + iss + "&FORMAT=json").then(function (t) { var p; try { p = parseResponse(t, "json"); } catch (e) { return done(false, "CelesTrak answered, but not with element-set data (a login/captive-portal page or a block page?).", "parse"); } return p.sats.length ? done(true, "CelesTrak reachable – ISS element set epoch " + new Date(p.sats[0].epochMs).toISOString().slice(0, 16).replace("T", " ") + " UTC.") : done(false, "CelesTrak answered but sent no element set.", "parse"); },
        function (e) { return done(false, /slow down/.test(e.message) ? e.message : "Couldn't reach CelesTrak (" + (e.name === "AbortError" ? "timeout" : "network, blocked or HTTP error") + ").", /slow down/.test(e.message) ? "rate" : "network"); });
    }
    var rd = readiness(id); if (!rd.ready) return Promise.resolve(done(false, rd.reason, rd.kind || "config"));
    return srcFetch(id, "health", {}, function (t) { var o = JSON.parse(t); if (!o || !o.ok) throw Src.SourceError("parse", "Not a SatPass proxy (answer to /health was unexpected)."); return o; })
      .then(function (h) {
        if (id === "spacetrack") return srcFetch(id, "gp", { ids: [iss] }, function (t) { return Src.parseSpaceTrackGp(t); });
        if (id === "satnogs") return srcFetch(id, "tle", { ids: [iss] }, function (t) { return Src.parseSatnogsTle(t, [iss]); });
        return srcFetch(id, "tle", { id: iss }, function (t) { return Src.parseN2yoTle(t); });
      })
      .then(function (r) {
        if (!r.sats.length) return done(false, Src.META[id].label + " answered but had no element set for the ISS.", "parse");
        var q = r.transactions != null ? " N2YO reports " + r.transactions + " transaction(s) in the last 60 min (free tier: 1000 TLE/h)." : "";
        if (r.transactions != null) stOf(id).quota = { transactions: r.transactions, at: Date.now() };
        return done(true, Src.META[id].label + " OK via your proxy – ISS element set, epoch " + new Date(r.sats[0].epochMs).toISOString().slice(0, 16).replace("T", " ") + " UTC." + q);
      }, function (e) { return done(false, e.message, e.kind || "network"); });
  }

  /* ---------- SatNOGS live transmitters (optional; never replaces the bundled table, only adds labelled entries) ---------- */
  var txLive = load("txlive", null);
  function fetchTransmitters(opts) {
    opts = opts || {};
    var st = stOf("satnogs");
    if (!opts.force && txLive && Date.now() - txLive.fetchedAt < 3600e3) return Promise.resolve({ ok: false, message: "Transmitters were fetched " + Math.round((Date.now() - txLive.fetchedAt) / 60000) + " min ago; SatNOGS data changes slowly – try again in an hour." });
    var ids = Object.keys(Radio.RADIO).map(Number).filter(function (n) { return Radio.RADIO[n].length; });
    return srcFetch("satnogs", "transmitters", { ids: ids.slice(0, 30) }, function (t) { return Src.parseSatnogsTransmitters(t); }).then(function (by) {
      var extra = ids.slice(30), chain = Promise.resolve(by);
      if (extra.length) chain = srcFetch("satnogs", "transmitters", { ids: extra.slice(0, 30) }, function (t) { return Src.parseSatnogsTransmitters(t); }).then(function (b2) { return Object.assign(by, b2); });
      return chain;
    }).then(function (by) {
      txLive = { fetchedAt: Date.now(), source: "SatNOGS DB", bySat: by }; save("txlive", txLive); noteOk("satnogs", "transmitters fetched"); emit();
      var n = 0; Object.keys(by).forEach(function (k) { n += by[k].length; });
      return { ok: true, satellites: Object.keys(by).length, transmitters: n, message: "Fetched " + n + " active transmitters for " + Object.keys(by).length + " satellites from SatNOGS DB." };
    }, function (e) { noteFail("satnogs", e.kind || "network", e.message); return { ok: false, message: red(e.message), kind: e.kind }; });
  }
  function liveTx(norad) { return txLive && txLive.bySat && txLive.bySat[norad] ? txLive.bySat[norad] : []; }
  function liveRadios(norad) { return liveTx(norad).map(function (t) { return Src.txToRadio(t, txLive.fetchedAt); }); }
  function txInfo() { return txLive ? { fetchedAt: txLive.fetchedAt, satellites: Object.keys(txLive.bySat || {}).length } : null; }
  function clearLiveTx() { txLive = null; del("txlive"); emit(); }
  function txCompare() {   // bundled nominal table vs live SatNOGS list, per satellite
    var out = {}; if (!txLive) return out;
    Object.keys(Radio.RADIO).forEach(function (k) { out[k] = Src.compareNominal(Radio.RADIO[k], liveTx(Number(k))); });
    return out;
  }

  /* ---------- N2YO radio passes for the validation view (cached 30 min, quota-aware) ---------- */
  var n2cache = load("n2yocache", {});
  function n2yoPasses(norad, obs, opts) {
    opts = opts || {};
    var days = opts.days || 2, key = [norad, Number(obs.lat).toFixed(2), Number(obs.lon).toFixed(2), Math.round(obs.alt || 0), days, opts.minEl || 0].join("|"), now = Date.now(), c = n2cache[key];
    if (c && now - c.t < 30 * 60e3 && !opts.force) return Promise.resolve({ ok: true, cached: true, ageMs: now - c.t, passes: c.passes, transactions: c.transactions, satname: c.satname });
    return srcFetch("n2yo", "radiopasses", { id: norad, lat: obs.lat, lng: obs.lon, alt: obs.alt || 0, days: days, minEl: opts.minEl || 0 }, function (t) { return Src.parseN2yoPasses(t); }).then(function (r) {
      var keys = Object.keys(n2cache); if (keys.length > 12) delete n2cache[keys.sort(function (a, b) { return n2cache[a].t - n2cache[b].t; })[0]];
      n2cache[key] = { t: now, passes: r.passes, transactions: r.transactions, satname: r.satname }; save("n2yocache", n2cache);
      if (r.transactions != null) stOf("n2yo").quota = { transactions: r.transactions, at: now };
      noteOk("n2yo", "radiopasses"); return { ok: true, cached: false, passes: r.passes, transactions: r.transactions, satname: r.satname };
    }, function (e) { if (e.kind === "auth" || e.kind === "network") noteFail("n2yo", e.kind, e.message); return { ok: false, kind: e.kind, message: red(e.message) }; });
  }
  function n2yoUsage() { return Src.limitUsed(limHist, "n2yo", "radiopasses", Date.now()); }

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
  function importText(text, label) {
    text = String(text || ""); var t = text.trim(), p;
    if (/^[\[{]/.test(t)) { try { p = Src.parseSpaceTrackGp(t); } catch (e) { return { ok: false, message: red(e.message) }; } }   // OMM/GP JSON (Space-Track, CelesTrak, SatNOGS-converted)
    else p = Tle.parse(text);
    if (!p.sats.length) return { ok: false, message: p.errors[0] || "No valid TLEs found" };
    // Imported element sets must not make the whole data set look freshly downloaded: the "fetched N days ago" age follows the NEWEST EPOCH
    // among the imported sets (never later than now, never older than what we already had).
    var now = Date.now(), newest = p.sats.reduce(function (m, x) { return Math.max(m, x.epochMs || 0); }, 0);
    setSats(Tle.merge(data.sats, p.sats), Math.max(data.fetchedAt, Math.min(now, newest)), label || "Pasted by user", label ? "imported file" : "pasted");
    var saved = persist(); emit();
    return { ok: true, saved: saved, message: "Imported " + p.sats.length + " element set(s)" + (p.errors.length ? "; " + p.errors.length + " skipped" : "") + "." + (saved ? "" : " ⚠ Not saved: browser storage is full or blocked – the data is kept only until the app is closed.") };
  }
  function lastError(id) { return mOf(id).lastError; }
  function lastOk(id) { return mOf(id).lastOk; }

  window.SatStore = {
    settings: settings, set: setSettings, hasLocation: hasLocation, isFav: isFav, toggleFav: toggleFav,
    data: data, init: init, refresh: refresh, importText: importText, onChange: onChange, nextAutoRefreshDue: nextAutoRefreshDue, manualAllowed: manualAllowed,
    ensure: ensure, ensureAll: ensureAll, allLoaded: allLoaded, members: members, categoriesOf: categoriesOf, catStatus: catStatus, staleCategories: staleCategories,
    lookup: lookup, searched: searched,
    sources: { META: Src.META, config: function () { return JSON.parse(JSON.stringify(srcCfg)); }, setConfig: setConfig, chain: enabledChain, readiness: readiness, status: function (id) { return Object.assign({}, stOf(id)); },
      inBackoff: inBackoff, getCreds: getCreds, setCreds: setCreds, forgetCreds: forgetCreds, isLocked: function () { return credLocked; }, hasPassphrase: function () { return !!(credBlob && credBlob.enc) || !!memKey; }, credMode: credMode, dropPlaintextCopy: dropPlaintextCopy, minPassphrase: Src.MIN_PASSPHRASE,
      lock: lockWithPassphrase, unlock: unlock, lockNow: lockNow, whenIdle: whenIdle, vaultCfg: function () { return Object.assign({}, vaultCfg); }, setVaultCfg: setVaultCfg, bioInfo: bioInfo, bioAllowed: bioAllowed, bioSave: bioSave, bioRemove: bioRemove, bioUnlock: bioUnlock, exportBackup: exportBackup, importBackup: importBackup, removePassphrase: removePassphrase, test: testSource, usage: function (id, op) { return Src.limitUsed(limHist, id, op, Date.now()); }, n2yoUsage: n2yoUsage },
    fetchTransmitters: fetchTransmitters, liveTx: liveTx, liveRadios: liveRadios, txInfo: txInfo, clearLiveTx: clearLiveTx, txCompare: txCompare, n2yoPasses: n2yoPasses,
    onSaveFail: onSaveFail, lastSaveFail: function () { return lastSaveFail; },
    lastError: lastError, lastOk: lastOk, load: load, save: save, del: del,
    constants: { AUTO_REFRESH_MS: AUTO_REFRESH_MS, CAT_AUTO_MS: CAT_AUTO_MS, MIN_MANUAL_MS: MIN_MANUAL_MS, FAIL_BACKOFF_MS: FAIL_BACKOFF_MS }, SOURCES: SOURCES
  };
})();
