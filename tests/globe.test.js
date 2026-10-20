// Coordinate/depth checks and renderer lifecycle without a GPU.
const { ok, near, done } = require('./harness');
const fs = require('fs'), vm = require('vm');
const win = {}, frames = new Map(); let nextFrame = 1, draws = 0;
function context() {
  return new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(100) }),
    measureText: t => ({ width: t.length * 7 }), drawImage: () => { draws++; }
  }, { get: (o, k) => k in o ? o[k] : () => {} });
}
const events = {};
function canvas() { const ctx = context(); return { style: {}, getContext: () => ctx, addEventListener: (n, f) => { events[n] = f; }, removeEventListener: n => { delete events[n]; }, setPointerCapture: () => {} }; }
vm.runInNewContext(fs.readFileSync(require.resolve('../js/globe.js'), 'utf8'), {
  window: win, document: { createElement: canvas }, Map,
  requestAnimationFrame: fn => { const n = nextFrame++; frames.set(n, fn); return n; }, cancelAnimationFrame: n => frames.delete(n)
});
const G = win.SatGlobe;
function flush() { const tasks = [...frames.values()]; frames.clear(); tasks.forEach(fn => fn()); }
near('Greenwich is +z', G.point(0, 0, 0)[2], 1, 1e-12);
near('North pole is +y', G.point(80, 90, 0)[1], 1, 1e-12);
near('East longitude is +x', G.point(90, 0, 0)[0], 1, 1e-12);
near('altitude scales in Earth radii', Math.hypot(...G.point(-97, 30, 500)), 1 + 500 / 6378.137, 1e-12);
for (const [lon, lat] of [[0, 0], [179, -60], [-179, 80], [30, 90]]) {
  const q = G.rotate(G.point(lon, lat, 400), lon, lat);
  near('camera centers longitude/latitude ' + lon + '/' + lat, Math.hypot(q[0], q[1]), 0, 1e-12);
  ok('centered satellite is in front', q[2] > 1);
}
ok('far-side satellite hidden behind Earth', !G.visible([0, 0, -1.2]));
ok('far-side satellite outside limb visible', G.visible([1.1, 0, -0.2]));
ok('front-side satellite visible', G.visible([0, 0, 1.1]));
const c = canvas(), globe = G.create(c);
const state = { sat: { latDeg: 30, lonDeg: -97, altKm: 500 }, label: 'ISS', obs: { lat: 30, lon: -90 }, footprint0: 20, footprintMin: 10,
  track: { past: [[-110, 20, 500], [-100, 25, 510]], future: [[-97, 30, 500], [0, 40, 500], [90, -30, 500]] } };
globe.update(state, 340); globe.update(state, 340);
ok('updates coalesce into one frame', frames.size === 1);
flush(); ok('renders at mobile dimensions', draws === 1 && c.width === 340 && c.height === 300);
events.keydown({ key: 'ArrowRight', preventDefault() {} }); flush(); ok('keyboard rotation redraws', draws === 2);
events.wheel({ deltaY: -100, preventDefault() {} }); flush(); ok('wheel zoom redraws', draws === 3);
events.pointerdown({ pointerId: 1, clientX: 100, clientY: 100 });
events.pointermove({ pointerId: 1, clientX: 150, clientY: 120 }); flush(); ok('pointer drag redraws', draws === 4);
events.pointerup({ pointerId: 1 });
globe.update(state, 800); globe.suspend(); ok('hidden tab cancels pending render', frames.size === 0);
globe.update(state, 800); flush(); ok('resuming resizes to desktop', c.width === 800 && c.height === 520);
globe.center(); globe.dispose(); ok('route cleanup cancels frame and removes listeners', frames.size === 0 && Object.keys(events).length === 0);
globe.update(state, 340); ok('disposed renderer stays stopped', frames.size === 0);
const all = G.create(canvas());
all.update({ centerObs: true, obs: { lat: 35, lon: -90 }, sats: [] }, 340); flush();
ok('empty Visible Now globe renders with observer and no selected satellite', draws === 6);
all.update({ centerObs: true, obs: { lat: 35, lon: -90 }, sats: [{sat:state.sat,label:'ISS'},{sat:{latDeg:20,lonDeg:0,altKm:20000},label:'GPS'}] }, 340); flush();
ok('multiple satellites render without single-satellite state', draws === 7);
all.update({ centerObs: true, compressAltitudes: true, obs: { lat: 35, lon: -90 }, sats: [{sat:state.sat,label:'ISS'},{sat:{latDeg:20,lonDeg:0,altKm:140000},label:'High orbit'}] }, 340); flush();
ok('compressed heights handle mixed low and high orbits', draws === 8);
all.center(); all.dispose(); ok('multi-satellite globe cleanup', frames.size === 0 && Object.keys(events).length === 0);
const expandedCanvas = canvas(), expanded = G.create(expandedCanvas);
expanded.update(state, 1400, 800); flush();
ok('expanded globe uses both available dimensions', expandedCanvas.width === 1400 && expandedCanvas.height === 800);
expanded.update(state, 340); flush();
ok('restoring globe returns to ordinary sizing on the same canvas', expandedCanvas.width === 340 && expandedCanvas.height === 300);
expanded.dispose();
done();
