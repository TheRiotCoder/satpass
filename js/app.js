/* SatPass UI. Plain vanilla JS, hash-routed. Pure computation lives in the other modules (grid, doppler, passes, tle, ics, radio, format). */
(function () {
  "use strict";
  var S = window.SatStore, P = window.SatPasses, G = window.SatGrid, D = window.SatDoppler, F = window.SatFmt, Tle = window.SatTle, R = window.SatRadio, I = window.SatIcs, Dr = window.SatDraw;
  var DAY = 86400000, APP_VERSION = "1.0.2";
  var main, titleEl;

  /* ---------- tiny helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(msg, ms) {
    var t = $("#toast"); t.textContent = msg; t.hidden = false; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); t.hidden = true; }, ms || 2600);
  }
  function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
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

  /* ---------- views infrastructure ---------- */
  var view = { token: 0, timers: [], tick: null, resize: null };
  function clearView() { view.token++; view.timers.forEach(clearInterval); view.timers = []; view.tick = null; view.resize = null; }
  // Timers are bound to the view that created them: a callback that fires after its view was replaced is ignored.
  function every(ms, fn) { var tok = view.token; view.timers.push(setInterval(function () { if (tok === view.token) fn(); }, ms)); }
  function setTitle(t) { titleEl.textContent = t; document.title = t === "SatPass" ? "SatPass – Satellite & ISS Pass Predictor" : t + " – SatPass"; }
  function contentWidth() { return Math.max(240, (main.clientWidth || 360) - 28); }

  var ROUTES = {};
  // Re-render the current view in place (e.g. after a select changed). Must go through here, never invoke a view function directly:
  // that would leave the previous render's 1 s / 30 s timers running and they would keep overwriting the new DOM with stale state.
  function rerender(name, a) { clearView(); ROUTES[name](a); }
  function route() {
    clearView();
    var h = (location.hash || "#/").replace(/^#\/?/, ""), parts = h.split("?")[0].split("/").map(decodeURIComponent), name = parts[0] || (S.hasLocation() ? "passes" : "passes");
    var fn = ROUTES[name] || ROUTES.passes;
    $$("#tabs a").forEach(function (a) { a.classList.toggle("on", a.dataset.tab === (name === "pass" ? "passes" : ROUTES[name] ? name : "passes")); });
    window.scrollTo(0, 0);
    try { fn(parts.slice(1)); } catch (e) { console.error(e); main.innerHTML = '<div class="err">Something went wrong: ' + esc(e.message) + "</div>"; }
  }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }

  /* ---------- location card (shared by Passes-empty-state and Setup) ---------- */
  function locationCard(onSaved) {
    var s = S.settings, el = document.createElement("section"); el.className = "card"; el.id = "locCard";
    el.innerHTML = '<h2>Your location</h2>' +
      '<button class="btn primary block" id="gpsBtn" type="button">📍 Use my current location</button>' +
      '<p class="note" id="gpsMsg">Location stays on your device (it is only stored in this browser). It is never sent anywhere.</p>' +
      '<div class="fields">' +
      '<div class="field"><label for="latIn">Latitude (°, N+)</label><input class="inp" id="latIn" inputmode="decimal" autocomplete="off" placeholder="30.2672" value="' + (S.hasLocation() ? s.lat : "") + '"></div>' +
      '<div class="field"><label for="lonIn">Longitude (°, E+)</label><input class="inp" id="lonIn" inputmode="decimal" autocomplete="off" placeholder="-97.7431" value="' + (S.hasLocation() ? s.lon : "") + '"></div>' +
      '<div class="field"><label for="altIn">Elevation (m)</label><input class="inp" id="altIn" inputmode="decimal" autocomplete="off" placeholder="0" value="' + (s.alt || 0) + '"></div>' +
      '<div class="field"><label for="gridIn">Maidenhead grid</label><input class="inp" id="gridIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="EM10dg" value="' + (S.hasLocation() ? G.toGrid(s.lat, s.lon, 6) : "") + '"></div>' +
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
      if (onSaved) onSaved();
    };
    $("#gpsBtn", el).onclick = function () {
      var m = $("#gpsMsg", el);
      if (!navigator.geolocation) { m.textContent = "Geolocation isn't available in this browser – enter your position manually."; return; }
      m.textContent = "Asking for your location…";
      navigator.geolocation.getCurrentPosition(function (pos) {
        var c = pos.coords; lat.value = c.latitude.toFixed(5); lon.value = c.longitude.toFixed(5); alt.value = c.altitude != null && isFinite(c.altitude) ? Math.round(c.altitude) : (alt.value || 0);
        fromLatLon(); m.textContent = "Got a fix (±" + Math.round(c.accuracy) + " m). Tap “Save location”."; $("#saveLoc", el).click();
      }, function (err) {
        m.textContent = err.code === 1 ? "Location permission was denied. Allow it in your browser/site settings, or enter your position manually." : err.code === 3 ? "Timed out getting a location fix. Try again outdoors or enter it manually." : "Couldn't get your location (" + err.message + "). Enter it manually.";
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
    };
    return el;
  }

  /* ---------- TLE status ---------- */
  function dataStatus() {
    var d = S.data, now = Date.now(), age = now - d.fetchedAt, stale = age > Tle.STALE_DAYS * DAY;
    var src = d.origin === "CelesTrak" ? "CelesTrak (live fetch)" : d.origin === "pasted" ? "your pasted TLEs" : "bundled snapshot (CelesTrak)";
    return { text: "Element sets from " + src + ", fetched " + new Date(d.fetchedAt).toLocaleString() + " (" + F.age(age) + " ago).", stale: stale, age: age };
  }
  function staleList(ids) {
    var now = Date.now(); return ids.filter(function (n) { var e = entry(n); return e && Tle.isStale(e, now); });
  }

  /* ===================== PASSES ===================== */
  var SCOPES = { favs: "My favorites", curated: "All curated sats", visible: "ISS & Tiangong" };
  ROUTES.passes = function (a) {
    setTitle("Passes");
    if (!S.hasLocation()) {
      main.innerHTML = '<div class="banner warn"><b>Set your location</b> to see passes. Use GPS or enter latitude/longitude or a Maidenhead grid square.</div>';
      main.appendChild(locationCard(function () { go("#/passes"); }));
      main.insertAdjacentHTML("beforeend", '<p class="disclaimer">Predictions use public TLEs and SGP4; verify before relying on them (see Setup → About).</p>');
      return;
    }
    var single = a[0] ? Number(a[0]) : null, scope = single ? "single" : (S.load("scope", "favs")), visOnly = S.load("visOnly", false), s = S.settings;
    var token = view.token;
    main.innerHTML = '<div class="toolbar">' +
      (single ? '<b>' + esc(longName(single)) + '</b> <a class="link" href="#/passes">← all</a>' :
      '<select class="inp" id="scopeSel" aria-label="Satellites">' + Object.keys(SCOPES).map(function (k) { return '<option value="' + k + '"' + (k === scope ? " selected" : "") + ">" + SCOPES[k] + "</option>"; }).join("") + "</select>") +
      '<select class="inp" id="daysSel" aria-label="Days" style="flex:0 1 110px">' + [1, 2, 3, 5, 7, 10].map(function (d) { return '<option value="' + d + '"' + (d === s.days ? " selected" : "") + ">" + d + " day" + (d > 1 ? "s" : "") + "</option>"; }).join("") + "</select>" +
      '<select class="inp" id="elSel" aria-label="Minimum elevation" style="flex:0 1 110px">' + [0, 5, 10, 15, 20, 30, 45].map(function (d) { return '<option value="' + d + '"' + (d === s.minEl ? " selected" : "") + ">min " + d + "°</option>"; }).join("") + "</select>" +
      '<label class="muted" style="display:flex;align-items:center;gap:6px;min-height:40px"><input type="checkbox" id="visChk"' + (visOnly ? " checked" : "") + ' style="width:20px;height:20px"> visible only</label></div>' +
      '<div id="staleBox"></div><div id="passList"><div class="banner">Computing passes…</div></div><div id="passFoot"></div>';
    $("#daysSel").onchange = function () { S.set({ days: Number(this.value) }); rerender("passes", a); };
    $("#elSel").onchange = function () { S.set({ minEl: Number(this.value) }); passCache = {}; refreshNextBar(); rerender("passes", a); };
    if ($("#scopeSel")) $("#scopeSel").onchange = function () { S.save("scope", this.value); rerender("passes", a); };
    $("#visChk").onchange = function () { S.save("visOnly", this.checked); rerender("passes", a); };
    var ids = single ? [single] : scope === "curated" ? R.CURATED.map(function (c) { return c.norad; }) : scope === "visible" ? [25544, 48274] : s.favs.slice();
    ids = ids.filter(function (n) { return entry(n); });
    var stale = staleList(ids);
    if (stale.length) $("#staleBox").innerHTML = '<div class="banner warn">⚠️ Element sets older than ' + Tle.STALE_DAYS + ' days for: ' + stale.map(function (n) { return esc(nameOf(n)) + " (" + F.age(Date.now() - entry(n).epochMs) + ")"; }).join(", ") + '. Predictions may be off by minutes. Refresh on the <a class="link" href="#/sats">Sats</a> tab when online.</div>';
    var ds = dataStatus();
    if (ds.stale && !stale.length) $("#staleBox").innerHTML = '<div class="banner warn">⚠️ Your element-set data was fetched ' + F.age(ds.age) + ' ago. Refresh on the <a class="link" href="#/sats">Sats</a> tab when online.</div>';
    (async function () {
      for (var i = 0; i < ids.length; i++) { if (token !== view.token) return; computePasses(ids[i], s.days); if (i % 2) await nextFrame(); }
      if (token !== view.token) return;
      renderPassList(ids, single, visOnly);
    })();
    every(30000, function () { if (token === view.token && $("#passList") && $$(".pass").length + 1) renderPassList(ids, single, visOnly); });
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
          '<div class="tg">' + (live ? '<span class="tag good">NOW</span>' : "") + (p.truncated ? '<span class="tag warn" title="LOS not found within the search limit; shown time is a lower bound">LOS ≥</span>' : "") + (p.naked ? '<span class="tag vis">VISIBLE</span>' : "") + (old ? '<span class="tag warn">old TLE</span>' : "") + "</div>" +
          '<div class="t2">' + F.compass(p.aosAz) + " " + Math.round(p.aosAz) + "° → " + F.compass(p.losAz) + " " + Math.round(p.losAz) + "° · " + (p.truncated ? "≥ " : "") + F.duration(p.durationSec) + (live ? " · ends in " + F.countdown(p.los - now) : " · in " + F.countdown(p.aos - now)) + "</div></button>";
      });
      box.innerHTML = html;
      $$(".pass", box).forEach(function (b) { b.onclick = function () { go("#/pass/" + b.dataset.n + "/" + b.dataset.aos); }; });
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
  ROUTES.pass = function (a) {
    var n = Number(a[0]), aos = Number(a[1]);
    setTitle("Pass detail");
    if (!S.hasLocation()) return go("#/passes");
    var e = entry(n), sat = satObj(n);
    if (!e || !sat) { main.innerHTML = '<div class="err">No element set for NORAD ' + esc(a[0]) + ' – open the <a class="link" href="#/sats">Sats</a> tab.</div>'; return; }
    var pass = null;
    (passCache[n] ? passCache[n].passes : []).forEach(function (p) { if (Math.abs(p.aos - aos) < 5000) pass = p; });
    if (!pass) {
      var cand = P.findPasses(sat, observer(), aos - 25 * 60000, aos + 25 * 60000, { minEl: S.settings.minEl }), best = Infinity;
      cand.forEach(function (p) { if (Math.abs(p.aos - aos) < best) { best = Math.abs(p.aos - aos); pass = p; } });
      if (pass) { pass.aosBeforeStart = pass.inProgressAtStart = pass.losAfterWindow = false; }   // the ±25 min window here is artificial
    }
    if (!pass) { main.innerHTML = '<div class="banner warn">That pass is no longer available (the element sets or minimum elevation changed). <a class="link" href="#/passes">Back to passes</a></div>'; return; }
    setTitle(nameOf(n) + " pass");
    if (pass.bright === undefined) { pass.bright = !!(R.curated(n) && R.curated(n).bright); pass.naked = pass.bright && pass.visible; }
    var step = S.load("step", 30), now0 = Date.now(), old = Tle.isStale(e, now0), tleAge = Tle.ageDays(e, now0);
    var visTxt = pass.visible && !pass.bright ? "Sunlit satellite and dark sky, but too small/faint to see without optics (radio satellite)" : pass.visible ? "Visible ✔ " + clk(pass.visStart) + "–" + clk(pass.visEnd) + " (sunlit sat, dark sky)" :
      (!pass.sunlitAtTca ? "Not visible – satellite is in Earth's shadow" : (pass.sunElAtTca >= P.VISIBLE_SUN_EL ? "Not visible – sky too bright (sun " + fmt(pass.sunElAtTca, 0) + "° elevation)" : "Not visible"));
    var hasRadio = R.radios(n).length > 0, remKey = n + "-" + Math.round(pass.aos);
    main.innerHTML = '<a class="link" href="#/passes">← Passes</a>' +
      '<section class="card"><h2>' + esc(longName(n)) + ' <span class="muted">· ' + F.date(pass.aos, utc()) + "</span></h2>" +
      (old ? '<div class="banner warn">⚠️ This element set is ' + fmt(tleAge, 1) + " days old (> " + Tle.STALE_DAYS + "). Timing/position may be off – refresh on the Sats tab.</div>" : "") +
      '<div class="kv"><div class="big"><small>Max elevation</small><b>' + fmt(pass.maxEl, 0) + "°</b></div><div><small>Duration</small><b>" + F.duration(pass.durationSec) + "</b></div><div><small>Range at max el</small><b>" + Math.round(pass.rangeAtTcaKm).toLocaleString("en-US") + " km</b></div></div>" +
      '<div class="kv"><div><small>AOS ' + F.tzLabel(pass.aos, utc()) + "</small><b>" + clk(pass.aos, true) + "</b><br>" + az(pass.aosAz) + "</div><div><small>Max el (TCA)</small><b>" + clk(pass.tca, true) + "</b><br>" + az(pass.tcaAz) + "</div><div><small>LOS</small><b>" + clk(pass.los, true) + "</b><br>" + az(pass.losAz) + "</div></div>" +
      '<p class="note">' + esc(visTxt) + (pass.inProgressAtStart ? " · already in progress when computed (AOS is the true start)" : "") + "</p>" +
      (pass.truncated ? '<div class="banner warn">⚠️ This pass is still going at the search limit (very long pass, e.g. a high-orbit satellite). <b>LOS and duration are lower bounds.</b></div>' : "") +
      (pass.aosTruncated ? '<div class="banner warn">⚠️ The satellite has been above the minimum elevation for more than 24 h; <b>AOS is a lower bound.</b></div>' : "") +
      '<details class="more"><summary>How AOS/LOS and “visible” are decided</summary><p class="note">AOS/LOS = the satellite crosses your minimum elevation (' + S.settings.minEl + '°), using geometric elevation (no atmospheric refraction, which would add roughly 0.5° at the horizon). “Visible” = the satellite is sunlit (simple cylindrical Earth-shadow model, no penumbra), the sun is below −6° at your location (civil twilight), and the satellite is above your horizon. Real visibility also depends on brightness, sky glow, weather and terrain.</p></details>' +
      '<div class="canvaswrap"><canvas id="sky" role="img" aria-label="Sky plot of the pass"></canvas></div>' +
      '<p class="note">Sky plot: centre = overhead, rim = horizon, N up, E right. <span style="color:#22d3ee">━</span> track, <span style="color:#fbbf24">━</span> visible part (ISS/Tiangong), ticks = time ' + (utc() ? "(UTC)" : "(local)") + ", dashed ring = minimum elevation.</p>" +
      '<div class="actions"><button class="btn" id="icsOne">📅 Add to calendar (.ics)</button><button class="btn" id="remBtn"></button>' +
      (hasRadio ? '<a class="btn" href="#/doppler/' + n + "/" + Math.round(pass.aos) + '">📻 Doppler for this pass</a>' : "") + '<a class="btn" href="#/live/' + n + '">🌍 Live tracker</a></div>' +
      '<div class="note" id="remMsg"></div></section>' +
      '<section class="card"><h2>Az / El / Range</h2><div class="toolbar"><span class="muted">Step</span><span class="seg" id="stepSeg">' + [10, 20, 30].map(function (v) { return '<button data-v="' + v + '" class="' + (v === step ? "on" : "") + '">' + v + " s</button>"; }).join("") + '</span></div>' +
      '<div class="note" id="stepNote"></div><div class="tblwrap"><table><thead><tr><th>Time</th><th>Az</th><th></th><th>El</th><th>Range km</th><th>Rate km/s</th></tr></thead><tbody id="tbody"></tbody></table></div></section>' +
      '<p class="disclaimer">Predicted from a TLE ' + F.age(Date.now() - e.epochMs) + " old (epoch " + new Date(e.epochMs).toISOString().slice(0, 16).replace("T", " ") + " UTC). Sat positions drift with TLE age (ISS: roughly 1–3 km/day along-track); treat times as ±several seconds when fresh, ±minutes when old.</p>";
    var canvas = $("#sky"), longStep = Math.max(1, Math.ceil(pass.durationSec / 800)), track = P.trackPass(sat, observer(), pass.aos, pass.los, Math.max(5, longStep));
    function effStep() { return Math.max(step, Math.ceil(pass.durationSec / 300 / 10) * 10); }
    function drawSky() { var sz = Math.min(contentWidth(), 440); Dr.skyplot(canvas, sz, track, { utc: utc(), minEl: S.settings.minEl, tca: pass.tca, now: Date.now(), bright: pass.bright, truncated: pass.truncated }); }
    function fillTable() {
      var rows = P.trackPass(sat, observer(), pass.aos, pass.los, effStep()), html = "";
      rows.forEach(function (r) { html += '<tr data-t="' + Math.round(r.t) + '"><td>' + clk(r.t, true) + "</td><td>" + Math.round(r.az) + "°</td><td>" + F.compass(r.az) + "</td><td>" + fmt(r.el, 1) + "°</td><td>" + Math.round(r.rangeKm) + "</td><td>" + fmt(r.rrKmS, 2) + "</td></tr>"; });
      $("#tbody").innerHTML = html;
      $("#stepNote").textContent = effStep() > step ? "Long pass: step increased to " + effStep() + " s to keep the table readable." : "";
    }
    function markNow() {
      var rows = $$("#tbody tr"), now = Date.now(), cur = null;
      rows.forEach(function (r) { r.classList.remove("cur"); if (+r.dataset.t <= now && now <= pass.los) cur = r; });
      if (cur) cur.classList.add("cur");
    }
    drawSky(); fillTable(); markNow();
    view.resize = drawSky; view.tick = function () { drawSky(); markNow(); };
    if (pass.aos <= Date.now() && pass.los > Date.now() - 1000) every(1000, view.tick);
    else every(15000, view.tick);
    $$("#stepSeg button").forEach(function (b) { b.onclick = function () { step = Number(b.dataset.v); S.save("step", step); $$("#stepSeg button").forEach(function (x) { x.classList.toggle("on", x === b); }); fillTable(); markNow(); }; });
    $("#icsOne").onclick = function () { downloadIcs([pass], "satpass-" + nameOf(n).replace(/[^A-Za-z0-9]+/g, "-") + "-" + F.dateKey(pass.aos, true) + ".ics"); };
    var rb = $("#remBtn");
    function remState() {
      var r = reminders().filter(function (x) { return x.id === remKey; })[0];
      rb.textContent = r ? "🔔 Reminder set (" + r.lead + " min before) – cancel" : "🔔 Remind me (" + S.settings.leadMin + " min before)";
      $("#remMsg").textContent = r ? "" : notifHelp();
    }
    rb.onclick = function () {
      var r = reminders().filter(function (x) { return x.id === remKey; })[0];
      if (r) { setReminders(reminders().filter(function (x) { return x.id !== remKey; })); remState(); toast("Reminder cancelled"); return; }
      if (pass.aos - S.settings.leadMin * 60000 < Date.now() && pass.los < Date.now()) return toast("That pass is over");
      ensureNotifPermission().then(function (perm) {
        var list = reminders(); list.push({ id: remKey, norad: n, name: nameOf(n), aos: pass.aos, los: pass.los, lead: S.settings.leadMin, maxEl: pass.maxEl, fired: false }); setReminders(list);
        remState();
        toast(perm === "granted" ? "Reminder set – keep SatPass open (or in the background)" : "In-app reminder set (system notifications aren't enabled)", 3800);
      });
    };
    remState();
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
    if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(function (r) { return r.showNotification(title, opts); }).catch(function () { try { new Notification(title, opts); } catch (e) {} });
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
    var g1 = favs.map(opt).join(""), g2 = R.CURATED.map(function (c) { return opt(c.norad); }).join(""), g3 = S.data.sats.slice().sort(function (x, y) { return x.name < y.name ? -1 : 1; }).map(function (e) { return opt(e.norad); }).join("");
    if (g1) html += '<optgroup label="Favorites">' + g1 + "</optgroup>"; if (g2) html += '<optgroup label="Curated">' + g2 + "</optgroup>"; if (g3) html += '<optgroup label="All satellites">' + g3 + "</optgroup>";
    return html;
  }
  ROUTES.live = function (a) {
    setTitle("Live tracker");
    var n = a[0] ? Number(a[0]) : (S.load("liveSat", 25544));
    if (!entry(n)) n = entry(25544) ? 25544 : (S.data.sats[0] && S.data.sats[0].norad);
    S.save("liveSat", n);
    var sat = satObj(n);
    main.innerHTML = '<div class="toolbar"><select class="inp" id="liveSel" aria-label="Satellite">' + satSelectHtml(n) + '</select><button class="btn" id="liveFav" aria-label="Toggle favorite"></button></div>' +
      (sat ? "" : '<div class="err">Couldn\'t initialise this satellite\'s orbit (decayed or bad elements).</div>') +
      '<section class="card"><div id="liveHead" class="note" style="margin-top:0"></div><div class="readout" id="liveRead"></div>' +
      '<div class="canvaswrap"><canvas id="map" role="img" aria-label="World map with satellite position and ground track"></canvas></div>' +
      '<p class="note">Map: <span style="color:#f472b6">●</span> satellite, solid line = next 100 min ground track, dashed = last 50 min, ring = radio horizon (0° elevation), amber ring = your minimum elevation, <span style="color:#4ade80">▲</span> you.</p>' +
      '<div id="liveNext"></div><div class="actions"><a class="btn" href="#/passes/' + n + '">Passes for this satellite</a>' + (R.radios(n).length ? '<a class="btn" href="#/doppler/' + n + '">📻 Doppler</a>' : "") + "</div></section>" +
      '<p class="disclaimer">Position from SGP4 using a TLE ' + (entry(n) ? F.age(Date.now() - entry(n).epochMs) : "?") + ' old. Not for navigation.</p>';
    $("#liveSel").onchange = function () { go("#/live/" + this.value); };
    var fb = $("#liveFav"); function favState() { fb.textContent = S.isFav(n) ? "★ Favorite" : "☆ Favorite"; }
    fb.onclick = function () { S.toggleFav(n); favState(); refreshNextBar(); }; favState();
    if (!sat) return;
    var obs = S.hasLocation() ? observer() : null, canvas = $("#map"), trackAt = 0, tr = null, nextTxt = "";
    function loadTrack(now) {
      tr = { past: P.groundTrack(sat, obs || P.makeObserver(0, 0, 0), now - 50 * 60000, now, 30).map(function (p) { return [p.lon, p.lat]; }),
             future: P.groundTrack(sat, obs || P.makeObserver(0, 0, 0), now, now + 100 * 60000, 30).map(function (p) { return [p.lon, p.lat]; }) };
      trackAt = now;
    }
    function tick() {
      var now = Date.now(), o = obs || P.makeObserver(0, 0, 0), s = P.stateAt(sat, o, now, true);
      if (!s) { $("#liveRead").innerHTML = '<div class="err">SGP4 could not propagate this satellite now.</div>'; return; }
      if (now - trackAt > 60000 || !tr) loadTrack(now);
      var up = s.el > 0;
      function cell(l, v, cls) { return '<div class="' + (cls || "") + '"><small>' + l + "</small><b>" + v + "</b></div>"; }
      $("#liveRead").innerHTML = (obs ? cell("Azimuth", az(s.az), up ? "hot" : "") + cell("Elevation", fmt(s.el, 1) + "°", up ? "hot" : "") + cell("Range", Math.round(s.rangeKm).toLocaleString("en-US") + " km") + cell("Range rate", fmt(s.rrKmS, 3) + " km/s") : "") +
        cell("Latitude", fmt(s.latDeg, 2) + "°") + cell("Longitude", fmt(s.lonDeg, 2) + "°") + cell("Altitude", Math.round(s.altKm).toLocaleString("en-US") + " km") + cell("Speed", fmt(s.speedKmS, 2) + " km/s") + cell("Sunlit", s.sunlit ? "yes" : "eclipsed");
      $("#liveHead").innerHTML = (obs ? (up ? "<b style='color:var(--good)'>Above your horizon</b>" : "Below your horizon") : "<b>Set your location (Setup) for az/el</b>") + " · " + new Date(now).toISOString().slice(11, 19) + " UTC";
      var fp0 = P.footprintAngleDeg(s.altKm, 0), fpm = obs ? P.footprintAngleDeg(s.altKm, S.settings.minEl) : 0;
      Dr.worldmap(canvas, contentWidth(), { sat: s, label: nameOf(n), track: tr, obs: obs ? { lat: S.settings.lat, lon: S.settings.lon } : null, footprint0: fp0, footprintMin: S.settings.minEl > 0 ? fpm : 0 });
      if (obs) {
        var c = passCache[n] && passesCurrent(n, 2) ? passesFor(n, 2)[0] : null;
        $("#liveNext").innerHTML = c ? '<p class="note"><b>' + (c.aos <= now ? "Pass in progress – LOS in " + F.countdown(c.los - now) : "Next pass in " + F.countdown(c.aos - now)) + "</b> (max " + Math.round(c.maxEl) + "°, " + clk(c.aos) + ') · <a class="link" href="#/pass/' + n + "/" + Math.round(c.aos) + '">details</a></p>' : '<p class="note">Computing next pass…</p>';
      }
    }
    view.resize = tick; view.tick = tick; tick(); every(1000, tick);
    if (obs) { var token = view.token; setTimeout(function () { if (token === view.token) { computePasses(n, 2); } }, 30); }
  };

  /* ===================== DOPPLER ===================== */
  ROUTES.doppler = function (a) {
    setTitle("Doppler");
    var radioSats = R.CURATED.filter(function (c) { return R.radios(c.norad).length; }).map(function (c) { return c.norad; });
    var n = a[0] ? Number(a[0]) : S.load("dopSat", 25544); if (radioSats.indexOf(n) < 0) n = 25544;
    S.save("dopSat", n);
    var radios = R.radios(n), ri = R.pickRadio(n, S.load("dopRadio:" + n, 0)), frac = S.load("dopFrac", 0.5);
    var radio = radios[ri], e = entry(n), sat = satObj(n), token = view.token;
    main.innerHTML = '<div class="banner warn">⚠️ <b>Approximate.</b> ' + esc(R.DISCLAIMER) + " Frequencies, tones and operating modes change; many satellites are off or in safe mode for long periods.</div>" +
      '<div class="toolbar"><select class="inp" id="dSat" aria-label="Satellite">' + radioSats.map(function (id) { return '<option value="' + id + '"' + (id === n ? " selected" : "") + ">" + esc(longName(id)) + (entry(id) ? "" : " (no TLE)") + "</option>"; }).join("") + "</select>" +
      (radios.length > 1 ? '<select class="inp" id="dRadio" aria-label="Transponder / mode">' + radios.map(function (r, i) { return '<option value="' + i + '"' + (i === ri ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("") + "</select>" : "") + "</div>" +
      '<section class="card"><h2>' + esc(radio.label) + ' <span class="muted">· ' + esc(radio.mode) + "</span></h2>" +
      (radio.kind === "linear" ? '<div class="field"><label for="dFrac">Position in the passband: <b id="dFracTxt"></b> <span class="muted">(0 % = lowest downlink frequency)</span></label><input type="range" id="dFrac" class="slider" min="0" max="1000" value="' + Math.round(frac * 1000) + '"></div>' : "") +
      '<div id="dNominal" class="note"></div><div id="dLive"></div>' +
      '<p class="note">' + esc(radio.note || "") + (radio.tone ? " · CTCSS tone " + radio.tone + " Hz" : "") + "</p></section>" +
      '<section class="card"><h2>Doppler across a pass</h2><div id="dPassSel"></div><div class="tblwrap" id="dTbl"></div>' +
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
  ROUTES.sats = function () {
    setTitle("Satellites");
    var q = "", mode = S.load("satMode", "curated"), st = dataStatus(), now = Date.now();
    main.innerHTML = '<section class="card"><h2>Orbital data (TLE)</h2><div class="note" style="margin-top:0" id="dsText"></div><div id="dsMsg"></div>' +
      '<div class="actions"><button class="btn primary" id="refBtn">⟳ Refresh from CelesTrak</button></div><p class="note" id="refNote"></p>' +
      '<details class="more"><summary>Paste TLEs manually</summary><textarea class="inp" id="pasteTa" spellcheck="false" placeholder="ISS (ZARYA)\n1 25544U 98067A   ...\n2 25544  51.6400 ..."></textarea><div class="actions"><button class="btn" id="pasteBtn">Import pasted TLEs</button></div><p class="note">Use this if CelesTrak can\'t be reached from your network. Get TLEs from <a class="link" href="https://celestrak.org/NORAD/elements/" target="_blank" rel="noopener">celestrak.org</a> or <a class="link" href="https://www.amsat.org/tle/current/nasa.all" target="_blank" rel="noopener">AMSAT</a> on another device.</p></details></section>' +
      '<div class="toolbar"><input class="inp" id="q" type="search" placeholder="Search name or NORAD id" aria-label="Search satellites" autocomplete="off"><span class="seg" id="modeSeg">' + [["curated", "Curated"], ["favs", "★ Favs"], ["all", "All"]].map(function (m) { return '<button data-v="' + m[0] + '" class="' + (m[0] === mode ? "on" : "") + '">' + m[1] + "</button>"; }).join("") + '</span></div><div id="satList"></div>';
    function status() {
      var d = dataStatus(), lo = S.lastOk(), le = S.lastError();
      $("#dsText").innerHTML = esc(d.text) + " <b>" + S.data.sats.length + "</b> satellites." + (d.stale ? ' <span class="tag warn">older than ' + Tle.STALE_DAYS + " d</span>" : "");
      $("#dsMsg").innerHTML = (d.stale ? '<div class="banner warn">⚠️ Element sets are older than ' + Tle.STALE_DAYS + " days. Predictions degrade quickly with age – refresh when online.</div>" : "") + (le && !refreshing ? '<div class="banner">Last refresh problem: ' + esc(le) + "</div>" : "");
      var allowed = S.manualAllowed(), nxt = lo ? new Date(lo + S.constants.MIN_MANUAL_MS) : null;
      $("#refBtn").disabled = refreshing || (!allowed && lo > 0);
      $("#refNote").textContent = "Source: CelesTrak GP data (celestrak.org). To respect CelesTrak's rate guidance, SatPass refreshes automatically at most every " + S.constants.AUTO_REFRESH_MS / 3600e3 + " h and manually at most every " + S.constants.MIN_MANUAL_MS / 3600e3 + " h" + (!allowed && nxt ? " (next refresh available " + nxt.toLocaleTimeString() + ")" : "") + ".";
    }
    var refreshing = false;
    $("#refBtn").onclick = function () {
      refreshing = true; status(); $("#refBtn").textContent = "Fetching…";
      S.refresh({ progress: function (i, n, id) { $("#refBtn").textContent = "Fetching " + (i + 1) + "/" + n + " (" + id + ")…"; } }).then(function (r) {
        refreshing = false; $("#refBtn").textContent = "⟳ Refresh from CelesTrak"; passCache = {}; status(); list(); refreshNextBar();
        $("#dsMsg").insertAdjacentHTML("afterbegin", '<div class="banner ' + (r.ok ? "good" : "bad") + '" id="refResult">' + esc(r.message) + "</div>");
      });
    };
    $("#pasteBtn").onclick = function () {
      var r = S.importText($("#pasteTa").value); passCache = {}; status(); list(); refreshNextBar();
      $("#dsMsg").insertAdjacentHTML("afterbegin", '<div class="banner ' + (r.ok ? "good" : "bad") + '">' + esc(r.message) + "</div>"); if (r.ok) $("#pasteTa").value = "";
    };
    function list() {
      var ql = q.trim().toLowerCase(), rows = [], seen = {}, now = Date.now();
      function add(n, label, sub, missing) { if (seen[n]) return; seen[n] = 1; rows.push({ n: n, label: label, sub: sub, missing: missing }); }
      var curIds = R.CURATED.map(function (c) { return c.norad; });
      function consider(n) { var c = R.curated(n), e = entry(n); add(n, c ? c.label : e.name, c ? c.group : "", !e); }
      if (ql || mode === "all") {
        R.CURATED.forEach(function (c) { consider(c.norad); });
        S.data.sats.slice().sort(function (x, y) { return x.name < y.name ? -1 : 1; }).forEach(function (e) { consider(e.norad); });
      } else if (mode === "favs") S.settings.favs.forEach(consider);
      else curIds.forEach(consider);
      if (ql) rows = rows.filter(function (r) { var c = R.curated(r.n); return r.label.toLowerCase().indexOf(ql) >= 0 || String(r.n).indexOf(ql) >= 0 || (c && c.short.toLowerCase().indexOf(ql) >= 0); });
      $("#satList").innerHTML = '<section class="card" style="padding:4px 10px">' + (rows.length ? rows.map(function (r) {
        var e = entry(r.n), age = e ? Tle.ageDays(e, now) : 0, fav = S.isFav(r.n);
        return '<div class="sat"><button class="star' + (fav ? " on" : "") + '" data-n="' + r.n + '" aria-label="' + (fav ? "Remove favorite " : "Add favorite ") + esc(r.label) + '" aria-pressed="' + fav + '">' + (fav ? "★" : "☆") + "</button>" +
          '<button class="nm" data-open="' + r.n + '"><b>' + esc(r.label) + "</b><span>NORAD " + r.n + (r.sub ? " · " + esc(r.sub) : "") + (R.radios(r.n).length ? " · radio" : "") + "</span></button>" +
          (r.missing ? '<span class="tag bad">no TLE</span>' : '<span class="tag ' + (age > Tle.STALE_DAYS ? "warn" : "acc") + '">' + F.age(age * DAY) + "</span>") + "</div>";
      }).join("") : '<p class="note">No satellites match.</p>') + "</section>" + (mode === "curated" && !ql ? '<p class="note">Some curated satellites (e.g. AO-92, CAS-4A/4B) currently have no element set in CelesTrak\'s public data (retired, re-entered or not published); search “All” for others, or paste TLEs above.</p>' : "");
      $$("#satList .star").forEach(function (b) { b.onclick = function () { var on = S.toggleFav(Number(b.dataset.n)); b.classList.toggle("on", on); b.textContent = on ? "★" : "☆"; b.setAttribute("aria-pressed", on); refreshNextBar(); }; });
      $$("#satList .nm").forEach(function (b) { b.onclick = function () { go("#/live/" + b.dataset.open); }; });
    }
    $("#q").oninput = function () { q = this.value; list(); };
    $$("#modeSeg button").forEach(function (b) { b.onclick = function () { mode = b.dataset.v; S.save("satMode", mode); $$("#modeSeg button").forEach(function (x) { x.classList.toggle("on", x === b); }); list(); }; });
    status(); list();
  };

  /* ===================== SETTINGS ===================== */
  ROUTES.settings = function () {
    setTitle("Setup");
    main.innerHTML = "";
    main.appendChild(locationCard(function () {}));
    var s = S.settings, sec = document.createElement("div");
    sec.innerHTML = '<section class="card"><h2>Time &amp; display</h2><div class="toolbar"><span>Show times in</span><span class="seg" id="tzSeg"><button data-v="local" class="' + (!s.utc ? "on" : "") + '">Local (' + F.tzLabel(Date.now(), false) + ')</button><button data-v="utc" class="' + (s.utc ? "on" : "") + '">UTC</button></span></div>' +
      '<div class="toolbar"><span>Default reminder / calendar alert</span><select class="inp" id="leadSel" style="flex:0 1 130px">' + [2, 5, 10, 15, 30].map(function (m) { return '<option value="' + m + '"' + (m === s.leadMin ? " selected" : "") + ">" + m + " min before</option>"; }).join("") + "</select></div></section>" +
      '<section class="card"><h2>Alerts</h2><p class="note" style="margin-top:0">The <b>Next pass</b> banner at the top counts down to your next favorite pass whenever the app is open. Set a per-pass reminder from a pass’s detail page.</p>' +
      '<div class="toolbar"><button class="btn" id="notifBtn"></button></div><p class="note" id="notifNote"></p><p class="note">Reminders: <span id="remCount"></span></p></section>' +
      '<section class="card" id="installCard"><h2>Install</h2><div id="installBody"></div></section>' +
      '<section class="card"><h2>About &amp; accuracy</h2><div class="note" style="margin-top:0"><p><b>SatPass ' + APP_VERSION + '</b> <span id="swVer" class="muted"></span></p>' +
      "<p><b>Accuracy:</b> orbits come from public two-line element sets (TLEs) propagated with SGP4/SDP4 (<a class='link' href='https://github.com/shashwatak/satellite-js' target='_blank' rel='noopener'>satellite.js</a>, MIT). A fresh LEO TLE is good to roughly a kilometre or two, which is a few seconds of timing; the error grows every day (ISS: up to ~10 km/day after reboosts or manoeuvres). Element sets older than " + Tle.STALE_DAYS + " days are flagged. Always confirm important passes with a live source.</p>" +
      "<p><b>Approximations:</b> (1) elevations are <i>geometric</i> – no atmospheric refraction (~0.5° at the horizon), so real AOS/LOS happen slightly earlier/later; (2) sunlit/eclipse uses a simple <i>cylindrical Earth shadow</i> (spherical Earth, no penumbra or atmosphere) – transitions are good to a few seconds; (3) a pass is flagged <i>visible</i> when the satellite is sunlit, above your horizon and the sun is below <b>−6°</b> (civil twilight) – a rule of thumb, since brightness, sky glow, weather and terrain also matter; only ISS/Tiangong get the tag. Sun position uses a low-precision formula (~0.01°).</p>" +
      "<p><b>Long passes:</b> if a pass is already under way when computed, its true AOS is found by looking back (up to 24 h). A pass still open at the end of the window is followed until it ends (up to 14 h further); if it never ends within that limit it is marked <i>LOS ≥</i> (lower bound).</p>" +
      "<p><b>Frequencies</b> in the Doppler tab are approximate and change; verify with <a class='link' href='https://www.amsat.org/status/' target='_blank' rel='noopener'>AMSAT status</a>.</p>" +
      "<p><b>Data:</b> TLEs from <a class='link' href='https://celestrak.org' target='_blank' rel='noopener'>CelesTrak</a> (Dr. T.S. Kelso). Coastlines: Natural Earth (public domain). Not affiliated with CelesTrak, AMSAT or NASA.</p>" +
      '<p>Everything runs on your device; your location is never uploaded.</p></div>' +
      '<div class="actions"><button class="btn" id="resetBtn">Reset favorites &amp; settings</button></div></section>';
    main.appendChild(sec);
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
    $("#resetBtn").onclick = function () { if (confirm("Reset location, favorites and preferences on this device? (Downloaded TLEs are kept.)")) { try { Object.keys(localStorage).filter(function (k) { return k.indexOf("satpass:") === 0 && k !== "satpass:tle" && k !== "satpass:tlemeta"; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} location.hash = "#/"; location.reload(); } };
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
      $("#install-sub").textContent = isIOS() ? "Tap Install for the Add to Home Screen steps." : "Add it to your home screen for quick offline use.";
      $("#install-banner").hidden = false; document.body.classList.add("has-banner");
    },
    init: function () {
      window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); install.deferred = e; setTimeout(install.show, 1200); });
      window.addEventListener("appinstalled", function () { install.deferred = null; install.hide(); toast("SatPass installed"); });
      $("#install-btn").onclick = install.prompt;
      $("#install-dismiss").onclick = function () { S.set({ installDismissed: Date.now() }); install.hide(); };
      if (isIOS()) setTimeout(install.show, 2500);
    }
  };

  /* ---------- boot ---------- */
  function autoRefresh() {
    if (!S.nextAutoRefreshDue() || navigator.onLine === false) return;
    S.refresh().then(function (r) { if (r.ok) { passCache = {}; toast("Orbital data updated from CelesTrak"); refreshNextBar(); if ((location.hash || "").indexOf("#/passes") === 0 || !location.hash) route(); } }).catch(function () {});
  }
  document.addEventListener("DOMContentLoaded", function () {
    main = $("#app"); titleEl = $("#title");
    S.init();
    $("#themeBtn").onclick = function () { var t = S.settings.theme || "auto"; S.set({ theme: t === "auto" ? "dark" : t === "dark" ? "light" : "auto" }); applyTheme(); if (view.tick) view.tick(); };
    $("#tzBtn").onclick = function () { S.set({ utc: !utc() }); syncTz(); };
    $("#nextbar").onclick = function () { var b = $("#nextbar"); if (b.dataset.n) go("#/pass/" + b.dataset.n + "/" + b.dataset.aos); };
    applyTheme(); $("#tzBtn").textContent = utc() ? "UTC" : "Local";
    window.addEventListener("hashchange", route);
    window.addEventListener("resize", function () { if (view.resize) view.resize(); });
    window.addEventListener("online", autoRefresh);
    route(); install.init(); refreshNextBar();
    setInterval(function () { updateNextBar(); checkReminders(); }, 1000);
    setTimeout(autoRefresh, 2500);
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        reg.addEventListener("updatefound", function () {
          var nw = reg.installing; if (!nw) return;
          nw.addEventListener("statechange", function () {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              $("#update-bar").hidden = false;
              $("#update-btn").onclick = function () { nw.postMessage("skipWaiting"); };
            }
          });
        });
      }).catch(function (e) { console.warn("SW registration failed", e); });
      var reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () { if (reloading || $("#update-bar").hidden) return; reloading = true; location.reload(); });
    }
  });
  window.SatApp = { route: route, passesFor: passesFor, computePasses: computePasses, _passCache: function () { return passCache; } };   // _passCache: test hook
})();
