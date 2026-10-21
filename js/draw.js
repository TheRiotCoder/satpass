/* SatPass canvas drawing: polar sky plot and equirectangular world map. */
(function () {
  "use strict";
  var F = window.SatFmt;
  function css(name, fallback) { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
  function setup(canvas, w, h) {
    w = Math.max(1, Number(w) || canvas.parentElement.clientWidth || 1);
    h = Math.max(1, Number(h) || w);
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = w + "px"; canvas.style.height = "auto";
    var ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
  }
  /* ---------- sky plot ----------
     N at top, E to the right (azimuth increases clockwise, like a compass); zenith at the centre, horizon at the rim. */
  function skyplot(canvas, size, track, o) {
    o = o || {};
    var ctx = setup(canvas, size, size), cx = size / 2, cy = size / 2, R = size / 2 - 26, minEl = o.minEl || 0;
    var fg = css("--fg", "#e2e8f0"), mu = css("--muted", "#93a0b8"), line = css("--line", "#26334d"), acc = css("--acc", "#22d3ee"), good = css("--good", "#4ade80"), bad = css("--bad", "#f87171");
    ctx.clearRect(0, 0, size, size);
    function pt(az, el) { var r = R * (90 - Math.max(0, el)) / 90, a = az * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }
    ctx.lineWidth = 1; ctx.strokeStyle = line; ctx.fillStyle = css("--card", "#141d2f");
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    [30, 60].forEach(function (el) { ctx.beginPath(); ctx.arc(cx, cy, R * (90 - el) / 90, 0, 2 * Math.PI); ctx.stroke(); });
    if (minEl > 0) { ctx.setLineDash([4, 4]); ctx.strokeStyle = mu; ctx.beginPath(); ctx.arc(cx, cy, R * (90 - minEl) / 90, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = line; }
    for (var a = 0; a < 360; a += 45) { var p = pt(a, 0); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p[0], p[1]); ctx.stroke(); }
    ctx.fillStyle = mu; ctx.font = "11px system-ui,sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    [30, 60].forEach(function (el) { ctx.fillText(el + "°", cx + 3, cy - R * (90 - el) / 90 - 7); });
    ctx.font = "bold 13px system-ui,sans-serif"; ctx.fillStyle = fg; ctx.textAlign = "center";
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(function (d) { var q = pt(d[1], -12); var r2 = R + 14, aa = d[1] * Math.PI / 180; ctx.fillText(d[0], cx + r2 * Math.sin(aa), cy - r2 * Math.cos(aa)); });
    if (!track || !track.length) return;
    // track polyline (colour: visible parts highlighted)
    ctx.lineWidth = 3; ctx.lineCap = "round";
    for (var i = 1; i < track.length; i++) {
      var p0 = pt(track[i - 1].az, track[i - 1].el), p1 = pt(track[i].az, track[i].el);
      ctx.strokeStyle = (track[i].visible && o.bright) ? "#fbbf24" : acc; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
    // time ticks every minute (or 30 s for short passes), labelled
    var durMs = track[track.length - 1].t - track[0].t, tickMs = durMs > 40 * 60000 ? Math.ceil(durMs / 10 / 600000) * 600000 : durMs > 6 * 60000 ? 60000 : 30000;
    var firstTick = Math.ceil(track[0].t / tickMs) * tickMs;
    ctx.font = "10px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = mu; ctx.strokeStyle = mu; ctx.lineWidth = 1;
    for (var t = firstTick; t < track[track.length - 1].t; t += tickMs) {
      var s = interp(track, t); if (!s) continue; var q = pt(s.az, s.el);
      ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, 2 * Math.PI); ctx.fillStyle = css("--bg", "#0b1220"); ctx.fill(); ctx.stroke(); ctx.fillStyle = mu;
      var dx = q[0] - cx, dy = q[1] - cy, d = Math.hypot(dx, dy) || 1;
      ctx.fillText(F.clock(t, !!o.utc), q[0] + dx / d * 17, q[1] + dy / d * 11);
    }
    // AOS / TCA / LOS markers
    function mark(s, color, label, dx) { var q = pt(s.az, s.el); ctx.beginPath(); ctx.arc(q[0], q[1], 6, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = css("--bg", "#0b1220"); ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = fg; ctx.font = "bold 11px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.fillText(label, q[0] + (dx || 0), q[1] - 13); }
    mark(track[0], good, "AOS"); mark(track[track.length - 1], bad, o.truncated ? "limit" : "LOS");
    if (o.tca) { var tc = interp(track, o.tca); if (tc) { var q2 = pt(tc.az, tc.el); ctx.beginPath(); ctx.arc(q2[0], q2[1], 4, 0, 2 * Math.PI); ctx.fillStyle = fg; ctx.fill(); ctx.font = "11px system-ui,sans-serif"; ctx.fillText("max " + Math.round(tc.el) + "°", q2[0], q2[1] + 14); } }
    if (o.now && o.now >= track[0].t && o.now <= track[track.length - 1].t) {
      var n = interp(track, o.now); if (n) { var qn = pt(n.az, n.el); ctx.beginPath(); ctx.arc(qn[0], qn[1], 9, 0, 2 * Math.PI); ctx.strokeStyle = "#f472b6"; ctx.lineWidth = 3; ctx.stroke(); ctx.beginPath(); ctx.arc(qn[0], qn[1], 4, 0, 2 * Math.PI); ctx.fillStyle = "#f472b6"; ctx.fill(); ctx.fillStyle = "#f472b6"; ctx.font = "bold 11px system-ui,sans-serif"; ctx.fillText("NOW", qn[0], qn[1] + 22); }
    }
  }
  function interp(track, t) {
    for (var i = 1; i < track.length; i++) if (t <= track[i].t) {
      var a = track[i - 1], b = track[i], f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t), da = ((b.az - a.az + 540) % 360) - 180;
      return { az: (a.az + da * f + 360) % 360, el: a.el + (b.el - a.el) * f };
    }
    return null;
  }
  /* ---------- world map (equirectangular) ---------- */
  var landCache = null;
  function landPaths() {
    if (landCache) return landCache;
    landCache = (window.SATPASS_WORLD || []).map(function (r) { return r.map(function (p) { return [p[0] / 10, p[1] / 10]; }); });
    return landCache;
  }
  function worldmap(canvas, width, st) {
    var w = width, h = Math.round(width / 2), ctx = setup(canvas, w, h);
    function X(lon) { return (lon + 180) / 360 * w; } function Y(lat) { return (90 - lat) / 180 * h; }
    var fg = css("--fg", "#e2e8f0"), mu = css("--muted", "#93a0b8"), line = css("--line", "#26334d"), acc = css("--acc", "#22d3ee");
    ctx.fillStyle = css("--map-sea", "#0e1a2e"); ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = line; ctx.lineWidth = 0.5;
    for (var lo = -150; lo <= 150; lo += 30) { ctx.beginPath(); ctx.moveTo(X(lo), 0); ctx.lineTo(X(lo), h); ctx.stroke(); }
    for (var la = -60; la <= 60; la += 30) { ctx.beginPath(); ctx.moveTo(0, Y(la)); ctx.lineTo(w, Y(la)); ctx.stroke(); }
    ctx.fillStyle = css("--map-land", "#1f2e47"); ctx.strokeStyle = css("--map-coast", "#3b5075"); ctx.lineWidth = 0.8;
    landPaths().forEach(function (ring) { ctx.beginPath(); ring.forEach(function (p, i) { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); }); ctx.closePath(); ctx.fill(); ctx.stroke(); });
    // footprint (circle on the sphere), split at the date line
    if (st.sat) {
      var cl = st.sat.latDeg * Math.PI / 180, co = st.sat.lonDeg * Math.PI / 180;
      [[st.footprint0, acc, 0.12], [st.footprintMin, "#fbbf24", 0]].forEach(function (fp) {
        if (!(fp[0] > 0)) return;
        var ang = fp[0] * Math.PI / 180, pts = [];
        for (var b = 0; b <= 360; b += 3) {
          var br = b * Math.PI / 180, la2 = Math.asin(Math.sin(cl) * Math.cos(ang) + Math.cos(cl) * Math.sin(ang) * Math.cos(br));
          var lo2 = co + Math.atan2(Math.sin(br) * Math.sin(ang) * Math.cos(cl), Math.cos(ang) - Math.sin(cl) * Math.sin(la2));
          pts.push([((lo2 * 180 / Math.PI + 540) % 360) - 180, la2 * 180 / Math.PI]);
        }
        ctx.strokeStyle = fp[1]; ctx.lineWidth = 1.5; segs(pts).forEach(function (s) { ctx.beginPath(); s.forEach(function (p, i) { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); }); ctx.stroke(); });
        if (fp[2]) { // light fill when the circle doesn't wrap the date line / poles
          var wrap = pts.some(function (p, i) { return i && Math.abs(p[0] - pts[i - 1][0]) > 180; });
          if (!wrap) { ctx.fillStyle = "rgba(34,211,238," + fp[2] + ")"; ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); }); ctx.fill(); }
        }
      });
    }
    // ground track: past dashed, future solid
    if (st.track) {
      [[st.track.past, true], [st.track.future, false]].forEach(function (g) {
        ctx.strokeStyle = acc; ctx.lineWidth = 1.6; ctx.setLineDash(g[1] ? [3, 4] : []);
        segs(g[0]).forEach(function (s) { ctx.beginPath(); s.forEach(function (p, i) { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); }); ctx.stroke(); });
      });
      ctx.setLineDash([]);
    }
    (st.sats || []).forEach(function (item) {
      var s = item.sat, x = X(s.lonDeg), y = Y(s.latDeg);
      ctx.fillStyle = item.color || acc; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      if (item.label) { ctx.fillStyle = fg; ctx.font = "11px system-ui,sans-serif"; ctx.textAlign = x > w / 2 ? "right" : "left"; ctx.fillText(item.label, x + (x > w / 2 ? -7 : 7), y - 7); }
    });
    if (st.obs) { var ox = X(st.obs.lon), oy = Y(st.obs.lat); ctx.fillStyle = "#4ade80"; ctx.strokeStyle = "#052e1a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ox, oy - 7); ctx.lineTo(ox + 6, oy + 5); ctx.lineTo(ox - 6, oy + 5); ctx.closePath(); ctx.fill(); ctx.stroke(); if (st.sats) { ctx.fillStyle = fg; ctx.font = "bold 12px system-ui,sans-serif"; ctx.textAlign = ox > w / 2 ? "right" : "left"; ctx.fillText("You", ox + (ox > w / 2 ? -10 : 10), oy + 17); } }
    if (st.sat) {
      var sx = X(st.sat.lonDeg), sy = Y(st.sat.latDeg); ctx.fillStyle = "#f472b6"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.fillStyle = fg; ctx.font = "bold 12px system-ui,sans-serif"; ctx.textAlign = sx > w - 70 ? "right" : "left"; ctx.fillText(st.label || "", sx + (sx > w - 70 ? -10 : 10), sy - 8);
    }
  }
  // split a [lon,lat] polyline wherever it crosses the date line
  function segs(pts) {
    var out = [], cur = [];
    pts.forEach(function (p, i) { if (i && Math.abs(p[0] - pts[i - 1][0]) > 180) { out.push(cur); cur = []; } cur.push(p); });
    if (cur.length) out.push(cur); return out;
  }
  window.SatDraw = { skyplot: skyplot, worldmap: worldmap, segs: segs };
})();
