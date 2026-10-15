/* SatPass data layer (browser): settings, TLE cache, CelesTrak refresh. */
(function () {
  "use strict";
  var Tle = window.SatTle, Radio = window.SatRadio;
  var LS = "satpass:";
  function load(k, d) { try { var v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function del(k) { try { localStorage.removeItem(LS + k); } catch (e) {} }

  /* ---------- settings ---------- */
  var DEFAULTS = { lat: null, lon: null, alt: 0, utc: false, minEl: 10, days: 3, favs: Radio.CURATED.filter(function (c) { return c.fav; }).map(function (c) { return c.norad; }), theme: "auto", leadMin: 10, installDismissed: 0 };
  var settings = Object.assign({}, DEFAULTS, load("settings", {}));
  function setSettings(patch) { Object.assign(settings, patch); save("settings", settings); }
  function hasLocation() { return typeof settings.lat === "number" && typeof settings.lon === "number"; }
  function isFav(n) { return settings.favs.indexOf(n) >= 0; }
  function toggleFav(n) { var f = settings.favs.slice(), i = f.indexOf(n); if (i >= 0) f.splice(i, 1); else f.push(n); setSettings({ favs: f }); return i < 0; }

  /* ---------- TLE data ---------- */
  var SOURCES = [
    { id: "stations", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle" },
    { id: "amateur", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle" },
    { id: "weather", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle" },
    { id: "noaa15", url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25338&FORMAT=tle" },   // NOAA 15/18/19 are not in GROUP=weather
    { id: "noaa18", url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=28654&FORMAT=tle" },
    { id: "noaa19", url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=33591&FORMAT=tle" }
  ];
  var AUTO_REFRESH_MS = 6 * 3600e3;   // CelesTrak updates GP data every few hours; don't ask more often than this automatically
  var MIN_MANUAL_MS = 2 * 3600e3;     // manual "refresh" blocked until the data is at least this old (CelesTrak asks for ≤ 1 request per 2 h per query)
  var FAIL_BACKOFF_MS = 30 * 60e3;    // after a failure wait this long before retrying automatically
  var data = { sats: [], byId: {}, fetchedAt: 0, source: "", origin: "bundled" };
  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  function setSats(list, fetchedAt, source, origin) {
    data.sats = list; data.byId = {}; list.forEach(function (s) { data.byId[s.norad] = s; });
    data.fetchedAt = fetchedAt; data.source = source; data.origin = origin;
  }
  function init() {
    var snap = window.SATPASS_SNAPSHOT || { tle: "", fetchedAt: "1970-01-01T00:00:00Z" };
    var snapT = Date.parse(snap.fetchedAt) || 0, snapSats = Tle.parse(snap.tle).sats;
    var cached = load("tle", null), cachedSats = cached ? Tle.parse(cached.tle).sats : [];
    // merge both (newest epoch wins per satellite); label by whichever fetch is newer
    var merged = Tle.merge(snapSats, cachedSats);
    if (cached && cached.fetchedAt > snapT) setSats(merged, cached.fetchedAt, cached.source || "CelesTrak", cached.origin || "CelesTrak");
    else setSats(merged, snapT, snap.source || "bundled snapshot", "bundled snapshot");
  }
  function persist(extra) {
    save("tle", Object.assign({ tle: Tle.serialize(data.sats), fetchedAt: data.fetchedAt, source: data.source, origin: data.origin }, extra || {}));
  }
  var meta = load("tlemeta", { lastAttempt: 0, lastError: null, lastOk: 0 });
  function nextAutoRefreshDue(now) {
    now = now || Date.now();
    return now - data.fetchedAt > AUTO_REFRESH_MS && now - meta.lastAttempt > FAIL_BACKOFF_MS;
  }
  function manualAllowed(now) { now = now || Date.now(); return now - meta.lastOk >= MIN_MANUAL_MS && now - meta.lastAttempt >= 60e3; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fetchText(url) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null, timer = ctrl && setTimeout(function () { ctrl.abort(); }, 20000);
    return fetch(url, { mode: "cors", cache: "no-store", credentials: "omit", signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (r.status === 403 || r.status === 429) throw new Error("CelesTrak asked us to slow down (HTTP " + r.status + "). Try again in a couple of hours.");
      if (!r.ok) throw new Error("CelesTrak returned HTTP " + r.status);
      return r.text();
    });
  }
  // Fetch all sources sequentially (polite, 1.2 s apart). progress(i, n, id). Resolves {ok, added, failed:[ids], message}
  var inflight = null;
  function refresh(opts) {
    opts = opts || {};
    if (inflight) return inflight;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve({ ok: false, message: "You appear to be offline. Using TLEs from " + new Date(data.fetchedAt).toLocaleString() + "." });
    meta.lastAttempt = Date.now(); save("tlemeta", meta);
    inflight = (async function () {
      var got = [], failed = [], firstErr = null;
      for (var i = 0; i < SOURCES.length; i++) {
        if (opts.progress) opts.progress(i, SOURCES.length, SOURCES[i].id);
        try {
          var txt = await fetchText(SOURCES[i].url), p = Tle.parse(txt);
          if (!p.sats.length) throw new Error("No element sets in the response");
          got = got.concat(p.sats);
        } catch (e) { failed.push(SOURCES[i].id); if (!firstErr) firstErr = e; if (/slow down/.test(e.message) || e.name === "TypeError" || e.name === "AbortError") break; /* rate-limited or network down: stop, don't hammer */ }
        if (i < SOURCES.length - 1) await sleep(1200);
      }
      if (!got.length) {
        var msg = firstErr && firstErr.name === "AbortError" ? "CelesTrak took too long to answer." : (firstErr && /Failed to fetch|NetworkError|Load failed/i.test(firstErr.message) ? "Couldn't reach CelesTrak (offline, blocked by a network/ad-blocker, or CORS)." : (firstErr ? firstErr.message : "No data received."));
        meta.lastError = msg; save("tlemeta", meta);
        return { ok: false, message: msg + " Using TLEs from " + new Date(data.fetchedAt).toLocaleString() + ". You can also paste TLEs manually (Satellites → Paste TLEs)." };
      }
      var before = data.sats.length;
      setSats(Tle.merge(data.sats, got), Date.now(), "CelesTrak GP (celestrak.org)", "CelesTrak");
      persist(); meta.lastOk = Date.now(); meta.lastError = failed.length ? "Some groups failed: " + failed.join(", ") : null; save("tlemeta", meta);
      emit();
      return { ok: true, added: data.sats.length - before, failed: failed, message: "Updated " + got.length + " element sets from CelesTrak" + (failed.length ? " (failed: " + failed.join(", ") + ")" : "") + "." };
    })().then(function (r) { inflight = null; return r; }, function (e) { inflight = null; throw e; });
    return inflight;
  }
  // manual paste fallback
  function importText(text) {
    var p = Tle.parse(text);
    if (!p.sats.length) return { ok: false, message: p.errors[0] || "No valid TLEs found" };
    setSats(Tle.merge(data.sats, p.sats), Math.max(data.fetchedAt, Date.now()), "Pasted by user", "pasted");
    persist(); emit();
    return { ok: true, message: "Imported " + p.sats.length + " element set(s)" + (p.errors.length ? "; " + p.errors.length + " skipped" : "") + "." };
  }
  function lastError() { return meta.lastError; }
  function lastOk() { return meta.lastOk; }

  window.SatStore = {
    settings: settings, set: setSettings, hasLocation: hasLocation, isFav: isFav, toggleFav: toggleFav,
    data: data, init: init, refresh: refresh, importText: importText, onChange: onChange, nextAutoRefreshDue: nextAutoRefreshDue, manualAllowed: manualAllowed,
    lastError: lastError, lastOk: lastOk, load: load, save: save, del: del,
    constants: { AUTO_REFRESH_MS: AUTO_REFRESH_MS, MIN_MANUAL_MS: MIN_MANUAL_MS, FAIL_BACKOFF_MS: FAIL_BACKOFF_MS }, SOURCES: SOURCES
  };
})();
