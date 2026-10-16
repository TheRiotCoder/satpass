// tiny shared test harness
let pass = 0, fail = 0;
function ok(name, cond, info) { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (info !== undefined ? "  -> " + (typeof info === "string" ? info : JSON.stringify(info)) : "")); }
function near(name, got, want, tol) { ok(name, got === want || Math.abs(got - want) <= tol, "got " + got + ", want " + want + " ±" + tol); }
function throws(name, fn, re) { let m = "no error", good = false; try { fn(); } catch (e) { m = e.message; good = !re || re.test(m); } ok(name, good, "throws: " + m); }
function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
const fs = require("fs"), path = require("path");
function snapshot() {
  const s = fs.readFileSync(path.join(__dirname, "..", "data", "tle-snapshot.js"), "utf8");
  return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
}
// all bundled snapshots: {core, sar, eo, nav, science} (the files are plain scripts that assign to window)
function snapshotAll() {
  const vm = require("vm"), win = {}, dir = path.join(__dirname, "..", "data");
  vm.runInNewContext(fs.readFileSync(path.join(dir, "tle-snapshot.js"), "utf8"), { window: win });
  for (const f of fs.readdirSync(path.join(dir, "snap")).filter(f => f.endsWith(".js"))) vm.runInNewContext(fs.readFileSync(path.join(dir, "snap", f), "utf8"), { window: win });
  return Object.assign({ core: win.SATPASS_SNAPSHOT }, win.SATPASS_SNAPSHOTS);
}
module.exports = { ok, near, throws, done, snapshot, snapshotAll };
