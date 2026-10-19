/* Observer-centered perspective sky. Three.js is loaded locally only on demand.
   Directions use east=+X, up=+Y, north=-Z; all markers lie on a unit sky,
   so distances and symbol sizes are illustrative, not physical scale. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatGround = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var RAD = Math.PI / 180, engine;
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function wrap(v) { return ((v % 360) + 360) % 360; }
  function direction(az, el) {
    var a = az * RAD, e = el * RAD, c = Math.cos(e);
    return { x: c * Math.sin(a), y: Math.sin(e), z: -c * Math.cos(a) };
  }
  function valid(item) { return Number.isFinite(item.az) && Number.isFinite(item.el) && item.el >= 0 && item.el <= 90; }
  function bearing(a) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(wrap(a) / 45) % 8]; }
  // Smooth across north (359 -> 1), rather than sending objects around the dome.
  function interpolate(a, b, t) {
    return { az: wrap(a.az + (wrap(b.az - a.az + 180) - 180) * t), el: a.el + (b.el - a.el) * t };
  }
  function create(host, onPick) {
    var disposed = false, active = false, failed = false, renderer, scene, camera, THREE, dome, groundSurface, grid, minRing, trees = [];
    var width = 1, height = 1, pixelRatio = 0, az = 0, el = 25, fov = 80, initial = true, hits = [], records = new Map(), textures = new Map();
    var latest = { items: [], options: {} }, lastSun = null, lastMin = null, sampleAt = 0, pointers = new Map(), gesture = null;
    var resources = [], removers = [], observer;
    host.innerHTML = '<canvas class="ground-scene" tabindex="0" role="img" aria-label="Interactive sky from your observing point. Drag to look around; arrows turn; plus and minus zoom; Home faces north."></canvas><canvas class="ground-overlay" aria-hidden="true"></canvas><div class="ground-hud" aria-hidden="true"></div><p class="ground-message" role="status">Loading 3D sky…</p>';
    var canvas = host.querySelector(".ground-scene"), overlay = host.querySelector(".ground-overlay"), hud = host.querySelector(".ground-hud"), message = host.querySelector(".ground-message");
    var ctx = overlay.getContext("2d");
    function listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); removers.push(function () { target.removeEventListener(type, fn, opts); }); }
    function own(obj) { resources.push(obj); return obj; }
    function size() {
      if (!renderer || disposed || !active) return;
      var w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight), dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (width === w && height === h && pixelRatio === dpr) return;
      width = w; height = h; pixelRatio = dpr;
      renderer.setPixelRatio(dpr); renderer.setSize(width, height, false);
      overlay.width = Math.round(width * dpr); overlay.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      camera.aspect = width / height; camera.updateProjectionMatrix();
    }
    function aim(a, e) { az = wrap(a); el = clamp(e, -15, 90); }
    function zoom(factor) { fov = clamp(fov / factor, 25, 100); }
    function circle(elevation, color, dashed) {
      var points = [];
      for (var i = 0; i <= 180; i++) { var d = direction(i * 2, elevation); points.push(new THREE.Vector3(d.x * 105, d.y * 105, d.z * 105)); }
      var material = own(dashed ? new THREE.LineDashedMaterial({ color: color, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.7 }) : new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: elevation === 0 ? 0.75 : 0.24 }));
      var line = new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(points)), material);
      if (dashed) line.computeLineDistances();
      return line;
    }
    function treeline(seed, distant) {
      // A repeatable, seamless panorama drawn locally: scenery, not real terrain.
      var c = document.createElement("canvas"); c.width = 4096; c.height = 256;
      var p = c.getContext("2d"), w = c.width, base = 228;
      function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
      p.fillStyle = "#fff"; p.beginPath(); p.moveTo(0, base);
      for (var x = 0; x <= w; x += 8) p.lineTo(x, base + Math.sin(x / w * Math.PI * 18) * 2 + Math.sin(x / w * Math.PI * 42));
      p.lineTo(w, 256); p.lineTo(0, 256); p.closePath(); p.fill();
      function tree(x, h, breadth, pine) {
        p.fillRect(x - breadth * 0.045, base - h * 0.66, breadth * 0.09, h * 0.69);
        if (pine) {
          for (var tier = 0; tier < 3; tier++) {
            var y = base - h + tier * h * 0.23, half = breadth * (0.27 + tier * 0.12);
            p.beginPath(); p.moveTo(x, y); p.lineTo(x + half, y + h * 0.48); p.lineTo(x - half, y + h * 0.48); p.closePath(); p.fill();
          }
        } else {
          [[0, 0.30, 0.35], [-0.25, 0.44, 0.31], [0.24, 0.43, 0.32], [-0.12, 0.17, 0.28], [0.16, 0.23, 0.28]].forEach(function (b) {
            p.beginPath(); p.ellipse(x + b[0] * breadth, base - h + b[1] * h, breadth * b[2], h * 0.23, 0, 0, Math.PI * 2); p.fill();
          });
        }
      }
      for (var i = 0; i < (distant ? 110 : 72); i++) {
        var x = random() * w, h = (distant ? 35 : 65) + random() * (distant ? 65 : 115), breadth = h * (0.22 + random() * 0.21), pine = random() > 0.45;
        // Wrapping edge trees preserves the panorama seam when facing any bearing.
        [x - w, x, x + w].forEach(function (at) { tree(at, h, breadth, pine); });
      }
      var map = own(new THREE.CanvasTexture(c)); map.colorSpace = THREE.SRGBColorSpace;
      var material = own(new THREE.MeshBasicMaterial({ map: map, color: distant ? "#162a30" : "#0c1a1d", side: THREE.BackSide, transparent: true, depthWrite: false }));
      var mesh = new THREE.Mesh(own(new THREE.CylinderGeometry(distant ? 150 : 140, distant ? 150 : 140, 18, 256, 1, true)), material);
      mesh.position.y = 7; mesh.renderOrder = distant ? -2 : -1; scene.add(mesh); trees.push(mesh);
    }
    function palette(sunEl) {
      var sun = Number.isFinite(sunEl) ? sunEl : -20;
      if (lastSun !== null && Math.abs(lastSun - sun) < 0.5) return;
      lastSun = sun;
      var daylight = clamp((sun + 6) / 12, 0, 1), twilight = clamp(1 - Math.abs(sun + 5) / 8, 0, 1);
      trees.forEach(function (tree, i) { tree.material.color.set(i ? "#080f15" : "#12222b").lerp(new THREE.Color(i ? "#142b28" : "#34504a"), daylight); });
      var top = new THREE.Color("#071322").lerp(new THREE.Color("#24659c"), daylight);
      var horizon = new THREE.Color("#254456").lerp(new THREE.Color("#986f82"), twilight * 0.55).lerp(new THREE.Color("#b1d0d8"), daylight);
      var ground = new THREE.Color("#101f23").lerp(new THREE.Color("#354d43"), daylight), geometry = dome.geometry, positions = geometry.attributes.position, colors = [];
      groundSurface.material.color.copy(ground);
      for (var i = 0; i < positions.count; i++) {
        var y = positions.getY(i) / 180;
        var c = y < 0 ? ground.clone().lerp(new THREE.Color("#071014"), clamp(-y, 0, 1) * 0.7) : horizon.clone().lerp(top, Math.pow(y, 0.45));
        colors.push(c.r, c.g, c.b);
      }
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    }
    function texture(item) {
      var kind = item.kind || "satellite", color = item.selected && kind === "satellite" ? "#f472b6" : item.color || "#22d3ee";
      var key = [kind, color, !!item.selected].join("|");
      if (textures.has(key)) return textures.get(key);
      var c = document.createElement("canvas"); c.width = c.height = 64;
      var p = c.getContext("2d"); p.fillStyle = color; p.strokeStyle = "#fff"; p.lineWidth = 2;
      p.shadowColor = color; p.shadowBlur = 10; p.beginPath();
      if (kind === "planet") { p.moveTo(32, 18); p.lineTo(46, 32); p.lineTo(32, 46); p.lineTo(18, 32); p.closePath(); }
      else if (kind === "star") {
        for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 7 : 17; if (i) p.lineTo(32 + r * Math.cos(a), 32 + r * Math.sin(a)); else p.moveTo(32, 15); } p.closePath();
      } else p.arc(32, 32, kind === "moon" ? 15 : 9, 0, Math.PI * 2);
      p.fill(); p.shadowBlur = 0; p.stroke();
      if (item.selected) { p.strokeStyle = kind === "satellite" ? "#f472b6" : "#fff"; p.lineWidth = 2.5; p.beginPath(); p.arc(32, 32, 24, 0, Math.PI * 2); p.stroke(); }
      var result = own(new THREE.CanvasTexture(c)); result.colorSpace = THREE.SRGBColorSpace;
      textures.set(key, result); return result;
    }
    function sync() {
      if (!renderer || failed || disposed) return;
      var now = performance.now(), keep = new Set();
      latest.items.filter(valid).forEach(function (item) {
        keep.add(item.id);
        var rec = records.get(item.id);
        if (!rec) {
          var material = new THREE.SpriteMaterial({ map: texture(item), transparent: true, depthTest: false, depthWrite: false });
          var sprite = new THREE.Sprite(material); scene.add(sprite);
          rec = { sprite: sprite, from: item, to: item }; records.set(item.id, rec);
        } else {
          rec.from = interpolate(rec.from, rec.to, clamp((now - sampleAt) / 1000, 0, 1));
          rec.sprite.material.map = texture(item);
        }
        rec.to = item;
      });
      records.forEach(function (rec, id) { if (!keep.has(id)) { scene.remove(rec.sprite); rec.sprite.material.dispose(); records.delete(id); } });
      sampleAt = now;
      palette(latest.options.sunEl);
      var min = Number(latest.options.minEl) || 0;
      if (min !== lastMin) {
        if (minRing) { scene.remove(minRing); minRing.geometry.dispose(); minRing.material.dispose(); resources = resources.filter(function (r) { return r !== minRing.geometry && r !== minRing.material; }); minRing = null; }
        if (min > 0 && min < 90) { minRing = circle(min, "#fbbf24", true); scene.add(minRing); }
        lastMin = min;
      }
      if (initial) {
        var first = latest.options.centerSelected && latest.items.find(function (item) { return item.selected && valid(item); });
        if (first) aim(first.az, first.el);
        initial = false;
      }
    }
    function project(a, e) {
      var d = direction(a, e), v = new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(100);
      v.project(camera);
      return v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.08 && Math.abs(v.y) <= 1.08 ? { x: (v.x + 1) * width / 2, y: (1 - v.y) * height / 2 } : null;
    }
    function draw(now) {
      if (!active || disposed || failed) return;
      camera.rotation.set(el * RAD, -az * RAD, 0, "YXZ"); camera.fov = fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      var t = clamp((now - sampleAt) / 1000, 0, 1), scale = 2 * 100 * Math.tan(fov * RAD / 2) / height;
      hits = [];
      records.forEach(function (rec) {
        var p = interpolate(rec.from, rec.to, t), d = direction(p.az, p.el), item = rec.to;
        rec.sprite.position.set(d.x * 100, d.y * 100, d.z * 100);
        rec.sprite.scale.setScalar(40 * scale); rec.sprite.renderOrder = item.selected ? 3 : 2;
        var pos = project(p.az, p.el);
        if (pos) hits.push(Object.assign({}, item, pos));
      });
      renderer.render(scene, camera);
      ctx.clearRect(0, 0, width, height); ctx.textBaseline = "middle";
      var boxes = [];
      function label(text, x, y, color, strong) {
        ctx.font = (strong ? "bold " : "") + "12px system-ui,sans-serif";
        var w = ctx.measureText(text).width + 12, h = 22, box = { x: x - w / 2, y: y - h / 2, w: w, h: h };
        if (box.x < 4 || box.x + w > width - 4 || box.y < 75 || box.y + h > height - 25 || boxes.some(function (b) { return box.x < b.x + b.w && box.x + w > b.x && box.y < b.y + b.h && box.y + h > b.y; }) || hits.some(function (p) { return p.x + 13 > box.x && p.x - 13 < box.x + w && p.y + 13 > box.y && p.y - 13 < box.y + h; })) return;
        boxes.push(box); ctx.fillStyle = "#071322cf"; ctx.fillRect(box.x, box.y, w, h);
        ctx.textAlign = "center"; ctx.fillStyle = color; ctx.fillText(text, x, y);
        return true;
      }
      // Reserve the selected object's label first, then compass/reference labels.
      var sorted = hits.slice().sort(function (a, b) { return Number(b.selected) - Number(a.selected); });
      sorted.filter(function (h) { return h.selected; }).forEach(function (h) { var color = h.kind && h.kind !== "satellite" ? "#fff" : "#f9a8d4"; if (!label(h.name, h.x, h.y - 27, color, true)) label(h.name, h.x, h.y + 27, color, true); });
      for (var a = 0; a < 360; a += 15) {
        var p = project(a, 0);
        if (!p) continue;
        ctx.strokeStyle = a % 45 === 0 ? "#bdd8d4" : "#6e9096"; ctx.beginPath(); ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x, p.y + 6); ctx.stroke();
        if (a % 45 === 0) label(bearing(a) + " · " + a + "°", p.x, p.y + 22, "#d4e8df", true);
      }
      [30, 60].forEach(function (e) { for (var a = 0; a < 360; a += 90) { var p = project(a, e); if (p) label(e + "°", p.x, p.y, "#9ab2c5", false); } });
      sorted.filter(function (h) { return !h.selected && (latest.options.labels || h.kind && h.kind !== "satellite"); }).forEach(function (h) { label(h.name, h.x, h.y - 25, "#e2e8f0", false); });
      ctx.strokeStyle = "#bfd3df77"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(width / 2 - 6, height / 2); ctx.lineTo(width / 2 + 6, height / 2); ctx.moveTo(width / 2, height / 2 - 6); ctx.lineTo(width / 2, height / 2 + 6); ctx.stroke();
      hud.textContent = "LOOKING " + bearing(az) + " · " + Math.round(wrap(az)) % 360 + "°\nElevation " + Math.round(el) + "° · Field of view " + Math.round(fov) + "°";
    }
    function run() { if (renderer) renderer.setAnimationLoop(active && !document.hidden && !failed ? draw : null); }
    function stopGesture() { pointers.clear(); gesture = null; canvas.classList.remove("dragging"); }
    function unavailable(text) { failed = true; message.hidden = false; message.textContent = text; canvas.hidden = overlay.hidden = hud.hidden = true; run(); }
    function start(T) {
      if (disposed) return;
      THREE = T;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
        scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 250);
        dome = new THREE.Mesh(own(new THREE.SphereGeometry(180, 64, 48)), own(new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true, depthWrite: false })));
        scene.add(dome);
        // A separate lower hemisphere keeps the sky gradient from bleeding
        // below the level horizon and making the tree line appear to float.
        groundSurface = new THREE.Mesh(own(new THREE.SphereGeometry(165, 64, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), own(new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false })));
        scene.add(groundSurface); treeline(64129, true); treeline(98231, false);
        grid = new THREE.Group(); scene.add(grid);
        [0, 30, 60].forEach(function (e) { grid.add(circle(e, e ? "#7899b2" : "#a0c4bd", false)); });
        for (var a = 0; a < 360; a += 45) {
          var points = [];
          for (var e = 0; e <= 90; e += 2) { var d = direction(a, e); points.push(new THREE.Vector3(d.x * 105, d.y * 105, d.z * 105)); }
          grid.add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(points)), own(new THREE.LineBasicMaterial({ color: "#7899b2", transparent: true, opacity: 0.15 }))));
        }
        message.hidden = true; sync(); size(); run();
      } catch (err) {
        unavailable("3D Sky needs WebGL 2, which is unavailable in this browser. You can use the Sky View tab instead.");
        if (renderer) renderer.dispose();
      }
    }
    listen(canvas, "pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) gesture = { x: e.clientX, y: e.clientY, az: az, el: el, moved: false };
      else { var p = Array.from(pointers.values()); gesture = { pinch: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), fov: fov, moved: true }; }
      canvas.classList.add("dragging");
    });
    listen(canvas, "pointermove", function (e) {
      if (!pointers.has(e.pointerId) || !gesture) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture.pinch !== undefined && pointers.size >= 2) {
        var p = Array.from(pointers.values()), distance = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        fov = clamp(gesture.fov * gesture.pinch / Math.max(1, distance), 25, 100);
      } else if (!gesture.moved || gesture.pinch === undefined) {
        var dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
        if (Math.hypot(dx, dy) > 5) gesture.moved = true;
        if (gesture.moved) aim(gesture.az - dx * fov / height, gesture.el + dy * fov / height);
      }
    });
    listen(canvas, "pointerup", function (e) {
      if (!pointers.has(e.pointerId)) return;
      if (gesture && !gesture.moved) {
        var rect = canvas.getBoundingClientRect(), x = (e.clientX - rect.left) * width / rect.width, y = (e.clientY - rect.top) * height / rect.height;
        var pick = null, best = 22 * 22;
        hits.forEach(function (h) { var d = (x - h.x) ** 2 + (y - h.y) ** 2; if (d < best) { best = d; pick = h; } });
        if (pick && onPick) onPick(pick);
      }
      stopGesture();
    });
    listen(canvas, "pointercancel", stopGesture); listen(canvas, "lostpointercapture", stopGesture);
    listen(canvas, "wheel", function (e) { e.preventDefault(); zoom(Math.exp(-clamp(e.deltaY, -100, 100) * 0.002)); }, { passive: false });
    listen(canvas, "keydown", function (e) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Home"].indexOf(e.key) < 0) return;
      e.preventDefault();
      if (e.key === "Home") { aim(0, 25); fov = 80; }
      else if (e.key === "+" || e.key === "=") zoom(1.2);
      else if (e.key === "-") zoom(1 / 1.2);
      else aim(az + (e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0), el + (e.key === "ArrowUp" ? 5 : e.key === "ArrowDown" ? -5 : 0));
    });
    listen(canvas, "webglcontextlost", function (e) { e.preventDefault(); unavailable("The 3D graphics context was lost. Switch to Sky View, or reopen this page to try again."); });
    listen(document, "visibilitychange", function () { if (document.hidden) stopGesture(); run(); });
    if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(size); observer.observe(host); }
    // The two pinned ESM files import only each other; no CDN/import map needed.
    if (!engine) engine = import("./vendor/three.module.min.js");
    engine.then(start).catch(function () { if (!disposed) unavailable("The 3D sky library could not load. Use Sky View, or reload the app to try again."); });
    return {
      update: function (items, options) { latest = { items: items, options: options || {} }; active = true; sync(); size(); run(); },
      look: aim, zoom: zoom,
      find: function () { var selected = latest.items.find(function (item) { return item.selected && item.kind && item.kind !== "satellite" && valid(item); }) || latest.items.find(function (item) { return item.selected && valid(item); }); if (selected) aim(selected.az, selected.el); },
      reset: function () { aim(0, 25); fov = 80; },
      suspend: function () { active = false; hits = []; stopGesture(); run(); },
      dispose: function () {
        disposed = true; active = false; stopGesture(); run();
        if (observer) observer.disconnect(); removers.forEach(function (remove) { remove(); });
        records.forEach(function (r) { r.sprite.material.dispose(); }); records.clear();
        resources.forEach(function (r) { r.dispose(); }); resources = []; textures.clear();
        if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
        host.innerHTML = "";
      }
    };
  }
  return { create: create, direction: direction, interpolate: interpolate, valid: valid };
});
