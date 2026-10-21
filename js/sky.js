/* Whole-sky chart as seen looking up: north at top, east on the left.
   Azimuthal equidistant projection: horizon at the rim, zenith at the center. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatSky = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function project(az, el, size) {
    if (!Number.isFinite(az) || !Number.isFinite(el) || el < 0 || el > 90) return null;
    var a = az * Math.PI / 180, radius = size / 2 - 38, r = radius * (90 - el) / 90;
    return { x: size / 2 - r * Math.sin(a), y: size / 2 - r * Math.cos(a) };
  }
  function pick(hits, x, y, tolerance) {
    var closest = null, best = (tolerance === undefined ? 16 : tolerance) ** 2;
    hits.forEach(function (h) { var d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d <= best) { best = d; closest = h; } });
    return closest;
  }
  function draw(canvas, width, items, options) {
    options = options || {};
    var size = Math.max(80, Math.min(Number(width) || 320, options.maxSize || 640)), dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
    canvas.style.width = size + "px"; canvas.style.height = "auto";
    var ctx = canvas.getContext("2d"), center = size / 2, radius = center - 38, hits = [], labels = [];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#080f1e"; ctx.fillRect(0, 0, size, size);
    var sky = ctx.createRadialGradient(center, center, 0, center, center, radius);
    sky.addColorStop(0, "#122640"); sky.addColorStop(1, "#0c192b");
    ctx.fillStyle = sky; ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.fill();
    ctx.font = "11px system-ui,sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    [0, 30, 60].forEach(function (el) {
      var r = radius * (90 - el) / 90;
      ctx.strokeStyle = el === 0 ? "#6b93ad" : "#344d67"; ctx.lineWidth = el === 0 ? 1.5 : 1;
      ctx.beginPath(); ctx.arc(center, center, r, 0, Math.PI * 2); ctx.stroke();
      if (el) { ctx.fillStyle = "#9cb2c9"; ctx.fillText(el + "°", center + 5, center + r - 8); }
    });
    ctx.strokeStyle = "#263e57"; ctx.lineWidth = 1;
    for (var az = 0; az < 360; az += 45) { var edge = project(az, 0, size); ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(edge.x, edge.y); ctx.stroke(); }
    if (options.minEl > 0 && options.minEl < 90) {
      ctx.strokeStyle = "#fbbf24"; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.arc(center, center, radius * (90 - options.minEl) / 90, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    var directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    directions.forEach(function (name, i) {
      var a = i * Math.PI / 4, x = center - (radius + 22) * Math.sin(a), y = center - (radius + 22) * Math.cos(a);
      ctx.textAlign = "center"; ctx.fillStyle = "#e2e8f0"; ctx.font = (i % 2 ? "11px" : "bold 14px") + " system-ui,sans-serif"; ctx.fillText(name, x, y - 4);
      ctx.fillStyle = "#9cb2c9"; ctx.font = "10px system-ui,sans-serif"; ctx.fillText(i * 45 + "°", x, y + 10);
      labels.push({ x: x - 17, y: y - 13, w: 34, h: 30 });
    });
    ctx.strokeStyle = "#9cb2c9"; ctx.beginPath(); ctx.moveTo(center - 4, center); ctx.lineTo(center + 4, center); ctx.moveTo(center, center - 4); ctx.lineTo(center, center + 4); ctx.stroke();
    ctx.textAlign = "center"; ctx.font = "10px system-ui,sans-serif"; ctx.fillStyle = "#9cb2c9"; ctx.fillText("Overhead · 90°", center, center + 16);
    labels.push({ x: center - 39, y: center + 8, w: 78, h: 16 });
    items.forEach(function (item) {
      var p = project(item.az, item.el, size); if (!p) return;
      hits.push({ id: item.id, name: item.name, az: item.az, el: item.el, x: p.x, y: p.y, selected: !!item.selected, kind: item.kind || "satellite", color: item.color || "#22d3ee" });
    });
    // Draw selected markers last so they remain visible in crowded regions.
    hits.slice().sort(function (a, b) { return Number(a.selected) - Number(b.selected); }).forEach(function (h) {
      var celestial = h.kind !== "satellite";
      ctx.fillStyle = h.selected && !celestial ? "#f472b6" : h.color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
      ctx.beginPath();
      if (h.kind === "planet") { ctx.moveTo(h.x, h.y - 6); ctx.lineTo(h.x + 6, h.y); ctx.lineTo(h.x, h.y + 6); ctx.lineTo(h.x - 6, h.y); ctx.closePath(); }
      else if (h.kind === "star") {
        for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 3.5 : 8, x = h.x + r * Math.cos(a), y = h.y + r * Math.sin(a); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.closePath();
      }
      else ctx.arc(h.x, h.y, h.kind === "moon" ? 7 : h.selected ? 6 : 4, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (h.selected) { ctx.strokeStyle = celestial ? "#fff" : "#f472b6"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(h.x, h.y, 10, 0, Math.PI * 2); ctx.stroke(); }
    });
    hits.slice().sort(function (a, b) { return (Number(b.selected) * 2 + Number(b.kind !== "satellite")) - (Number(a.selected) * 2 + Number(a.kind !== "satellite")); }).forEach(function (h) {
      if (!h.selected && !options.labels && h.kind === "satellite") return;
      ctx.font = (h.selected ? "bold " : "") + "11px system-ui,sans-serif";
      var text = String(h.name || ""), maxWidth = Math.min(160, size * 0.42);
      while (text.length > 1 && ctx.measureText(text).width > maxWidth) text = text.slice(0, -2) + "…";
      var w = ctx.measureText(text).width, candidates = [
        { x: h.x + 12, y: h.y - 19 }, { x: h.x + 12, y: h.y + 8 },
        { x: h.x - w - 12, y: h.y - 19 }, { x: h.x - w - 12, y: h.y + 8 },
        { x: h.x - w / 2, y: h.y - 36 }, { x: h.x - w / 2, y: h.y + 26 }
      ];
      var box = candidates.filter(function (b) {
        return b.x >= 4 && b.y >= 4 && b.x + w + 4 <= size && b.y + 16 <= size && !labels.some(function (l) { return b.x < l.x + l.w && b.x + w + 4 > l.x && b.y < l.y + l.h && b.y + 16 > l.y; }) && !hits.some(function (p) { return p.x + 5 > b.x && p.x - 5 < b.x + w + 4 && p.y + 5 > b.y && p.y - 5 < b.y + 16; });
      })[0];
      if (!box) return;
      labels.push({ x: box.x, y: box.y, w: w + 4, h: 16 });
      ctx.fillStyle = "#080f1ee6"; ctx.fillRect(box.x - 2, box.y, w + 4, 16);
      ctx.textAlign = "left"; ctx.fillStyle = h.selected && h.kind === "satellite" ? "#f472b6" : "#e2e8f0"; ctx.fillText(text, box.x, box.y + 8);
    });
    return { size: size, hits: hits };
  }
  return { project: project, pick: pick, draw: draw };
});
