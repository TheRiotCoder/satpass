/* Offline, orthographic 3D globe. Canvas renders a textured sphere and depth-clips
   Earth-fixed trajectories against it. Distances use a spherical Earth in km. */
(function () {
  "use strict";
  var RAD = Math.PI / 180, EARTH = 6378.137;
  function point(lon, lat, alt) {
    var a = lon * RAD, b = lat * RAD, r = 1 + (alt || 0) / EARTH;
    return [r * Math.cos(b) * Math.sin(a), r * Math.sin(b), r * Math.cos(b) * Math.cos(a)];
  }
  function rotate(p, lon, lat) {
    var a = lon * RAD, b = lat * RAD, z = p[0] * Math.sin(a) + p[2] * Math.cos(a);
    return [p[0] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.cos(b) - z * Math.sin(b), p[1] * Math.sin(b) + z * Math.cos(b)];
  }
  function visible(p) { return p[2] >= 0 || p[0] * p[0] + p[1] * p[1] > 1.00001; }
  var texture;
  function earthTexture() {
    if (texture) return texture;
    var c = document.createElement("canvas"); c.width = 1024; c.height = 512;
    var ctx = c.getContext("2d"); ctx.fillStyle = "#163c59"; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = "#729483"; ctx.strokeStyle = "#a6bd9c"; ctx.lineWidth = 0.7;
    (window.SATPASS_WORLD || []).forEach(function (ring) {
      ctx.beginPath(); ring.forEach(function (p, i) { var x = (p[0] / 10 + 180) / 360 * 1024, y = (90 - p[1] / 10) / 180 * 512; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });
    texture = ctx.getImageData(0, 0, 1024, 512).data; return texture;
  }
  function create(canvas) {
    var ctx = canvas.getContext("2d"), buffer = document.createElement("canvas"), bctx = buffer.getContext("2d");
    var lon = 0, lat = 20, zoom = 1, extent = 1.5, width = 0, height = 0, state = null, frame = 0, disposed = false, sphereKey = "";
    var pointers = new Map(), drag = null, pinch = 0;
    function displayAltitude(alt) { return state.compressAltitudes ? EARTH * 0.35 * Math.log1p(Math.max(0, alt || 0) / EARTH) : alt; }
    function requestDraw() { if (!frame && !disposed) frame = requestAnimationFrame(function () { frame = 0; draw(); }); }
    function center() {
      if (state && state.centerObs && state.obs) { lon = state.obs.lon; lat = state.obs.lat; }
      else if (state && state.sat) { lon = state.sat.lonDeg; lat = state.sat.latDeg; }
      zoom = 1; requestDraw();
    }
    function changeZoom(factor) { zoom = Math.max(0.55, Math.min(5, zoom * factor)); requestDraw(); }
    function sphere(radius) {
      // Cap raster work independently of screen density. Camera changes rebuild
      // the texture; 1 s satellite updates reuse the cached globe image.
      var size = Math.min(440, Math.max(80, Math.ceil(radius * 2))), key = [size, lon, lat].join("|");
      if (key === sphereKey) return; sphereKey = key;
      buffer.width = size; buffer.height = size;
      var img = bctx.createImageData(size, size), dst = img.data, tex = earthTexture(), a = lon * RAD, b = lat * RAD, cb = Math.cos(b), sb = Math.sin(b);
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var nx = (x + 0.5) / size * 2 - 1, ny = 1 - (y + 0.5) / size * 2, rr = nx * nx + ny * ny;
        if (rr > 1) continue;
        var nz = Math.sqrt(1 - rr), la = Math.asin(Math.max(-1, Math.min(1, ny * cb + nz * sb))), lo = Math.atan2(nx, nz * cb - ny * sb) + a;
        var tx = ((Math.floor((lo / RAD + 180) / 360 * 1024) % 1024) + 1024) % 1024, ty = Math.max(0, Math.min(511, Math.floor((90 - la / RAD) / 180 * 512)));
        var ti = (ty * 1024 + tx) * 4, di = (y * size + x) * 4, light = 0.48 + 0.52 * Math.max(0, -nx * 0.4 + ny * 0.5 + nz * 0.76);
        dst[di] = tex[ti] * light; dst[di + 1] = tex[ti + 1] * light; dst[di + 2] = tex[ti + 2] * light; dst[di + 3] = 255;
      }
      bctx.putImageData(img, 0, 0);
    }
    function draw() {
      if (!state || !width || disposed) return;
      var w = width, h = height, dpr = Math.min(window.devicePixelRatio || 1, 2), radius = Math.min(w, h) * 0.43 / extent * zoom, cx = w / 2, cy = h / 2;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      canvas.style.width = "100%"; canvas.style.height = "auto";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#080f1e"; ctx.fillRect(0, 0, w, h);
      // Deterministic, quiet star field.
      ctx.fillStyle = "#63758f";
      for (var i = 0; i < 90; i++) ctx.fillRect((i * 137.51 % 997) / 997 * w, (i * i * 17.3 % 991) / 991 * h, 1, 1);
      sphere(radius); ctx.drawImage(buffer, cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.strokeStyle = "#427b9f"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
      function viewPoint(p) { return rotate(point(p[0], p[1], displayAltitude(p[2])), lon, lat); }
      function screen(p) { return [cx + p[0] * radius, cy - p[1] * radius]; }
      function line(points, color, dashed) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.setLineDash(dashed ? [4, 5] : []); ctx.beginPath();
        var prev = null;
        points.forEach(function (p) {
          var q = viewPoint(p), v = visible(q), s = screen(q);
          if (prev) {
            if (v && prev.v) { ctx.moveTo(prev.s[0], prev.s[1]); ctx.lineTo(s[0], s[1]); }
            else if (v !== prev.v) {
              var low = prev.q, high = q;
              for (var j = 0; j < 12; j++) { var mid = low.map(function (n, k) { return (n + high[k]) / 2; }); if (visible(mid) === prev.v) low = mid; else high = mid; }
              var edge = screen(low); ctx.moveTo(v ? edge[0] : prev.s[0], v ? edge[1] : prev.s[1]); ctx.lineTo(v ? s[0] : edge[0], v ? s[1] : edge[1]);
            }
          }
          prev = { q: q, v: v, s: s };
        }); ctx.stroke(); ctx.setLineDash([]);
      }
      for (var la = -60; la <= 60; la += 30) { var parallel = []; for (var lo = -180; lo <= 180; lo += 3) parallel.push([lo, la, 1]); line(parallel, "#52788a66"); }
      for (var mer = -180; mer < 180; mer += 30) { var meridian = []; for (var l = -90; l <= 90; l += 3) meridian.push([mer, l, 1]); line(meridian, "#52788a66"); }
      if (state.track) { line(state.track.past, "#22d3ee", true); line(state.track.future, "#22d3ee", false); }
      if (state.sat) {
        [[state.footprint0, "#22d3ee"], [state.footprintMin, "#fbbf24"]].forEach(function (fp) {
          if (!(fp[0] > 0)) return;
          var ring = [], cl = state.sat.latDeg * RAD, co = state.sat.lonDeg * RAD, ang = fp[0] * RAD;
          for (var b = 0; b <= 360; b += 3) { var br = b * RAD, la = Math.asin(Math.sin(cl) * Math.cos(ang) + Math.cos(cl) * Math.sin(ang) * Math.cos(br)); var lo = co + Math.atan2(Math.sin(br) * Math.sin(ang) * Math.cos(cl), Math.cos(ang) - Math.sin(cl) * Math.sin(la)); ring.push([lo / RAD, la / RAD, 1]); }
          line(ring, fp[1]);
        });
      }
      function marker(p, color, label, triangle) {
        var q = viewPoint(p); if (!visible(q)) return;
        var s = screen(q); ctx.fillStyle = color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath();
        if (triangle) { ctx.moveTo(s[0], s[1] - 7); ctx.lineTo(s[0] + 6, s[1] + 5); ctx.lineTo(s[0] - 6, s[1] + 5); ctx.closePath(); } else ctx.arc(s[0], s[1], 5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke(); ctx.font = "bold 12px system-ui,sans-serif"; ctx.textAlign = s[0] > w / 2 ? "right" : "left";
        var text = String(label || ""); while (text.length > 1 && ctx.measureText(text).width > w / 2 - 20) text = text.slice(0, -2) + "…";
        var tx = Math.max(10, Math.min(w - 10, s[0] + (s[0] > w / 2 ? -10 : 10))), ty = Math.max(18, Math.min(h - 10, s[1] - 10));
        ctx.strokeStyle = "#080f1e"; ctx.lineWidth = 4; ctx.strokeText(text, tx, ty); ctx.fillText(text, tx, ty);
      }
      (state.sats || []).forEach(function (item) { var s = item.sat; marker([s.lonDeg, s.latDeg, s.altKm], item.color || "#22d3ee", item.label); });
      if (state.obs) marker([state.obs.lon, state.obs.lat, 2], "#4ade80", "You", true);
      if (state.sat) marker([state.sat.lonDeg, state.sat.latDeg, state.sat.altKm], "#f472b6", state.label);
    }
    function pointerDown(e) { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); drag = [e.clientX, e.clientY]; pinch = 0; }
    function pointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) { var ps = Array.from(pointers.values()), d = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]); if (pinch && d) changeZoom(d / pinch); pinch = d; drag = null; }
      else if (drag) { lon -= (e.clientX - drag[0]) * 0.4 / zoom; lat = Math.max(-89, Math.min(89, lat + (e.clientY - drag[1]) * 0.4 / zoom)); lon = ((lon + 180) % 360 + 360) % 360 - 180; drag = [e.clientX, e.clientY]; requestDraw(); }
    }
    function pointerUp(e) { pointers.delete(e.pointerId); drag = pointers.size === 1 ? Array.from(pointers.values())[0] : null; pinch = 0; }
    function wheel(e) { e.preventDefault(); changeZoom(Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.002)); }
    function key(e) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Home"].indexOf(e.key) < 0) return;
      e.preventDefault();
      if (e.key === "Home") center(); else if (e.key === "+" || e.key === "=") changeZoom(1.2); else if (e.key === "-") changeZoom(1 / 1.2);
      else { lon += e.key === "ArrowLeft" ? -10 : e.key === "ArrowRight" ? 10 : 0; lat = Math.max(-89, Math.min(89, lat + (e.key === "ArrowUp" ? 10 : e.key === "ArrowDown" ? -10 : 0))); requestDraw(); }
    }
    var events = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp, pointercancel: pointerUp, lostpointercapture: pointerUp, wheel: wheel, keydown: key };
    Object.keys(events).forEach(function (name) { canvas.addEventListener(name, events[name], { passive: false }); });
    return {
      update: function (st, w, availableHeight) {
        var first = !state; state = st; width = w; height = Math.round(availableHeight > 0 ? availableHeight : Math.max(300, Math.min(520, w * 0.72)));
        var maxAlt = st.sat ? st.sat.altKm : 0;
        (st.sats || []).forEach(function (item) { maxAlt = Math.max(maxAlt, item.sat.altKm); });
        if (first || st.centerObs) extent = Math.max(1.5, 1.18 * (1 + displayAltitude(maxAlt) / EARTH));
        if (first) center(); requestDraw();
      },
      center: center, zoom: changeZoom,
      suspend: function () { if (frame) cancelAnimationFrame(frame); frame = 0; pointers.clear(); drag = null; pinch = 0; },
      dispose: function () { disposed = true; if (frame) cancelAnimationFrame(frame); Object.keys(events).forEach(function (name) { canvas.removeEventListener(name, events[name]); }); }
    };
  }
  window.SatGlobe = { create: create, point: point, rotate: rotate, visible: visible };
})();
