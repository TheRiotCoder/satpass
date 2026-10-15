// Runs every tests/*.test.js and prints a summary. Usage: node tests/run-all.js
const { spawnSync } = require("child_process"), fs = require("fs"), path = require("path");
let total = 0, failed = 0, files = 0;
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort()) {
  const r = spawnSync("node", [path.join(__dirname, f)], { encoding: "utf8" });
  const m = (r.stdout || "").match(/(\d+) passed, (\d+) failed/);
  const p = m ? +m[1] : 0, fl = m ? +m[2] : 1;
  console.log(`${r.status === 0 && fl === 0 ? "OK  " : "FAIL"} ${f}: ${p} passed, ${fl} failed`);
  if (r.status !== 0) console.log((r.stdout || "").split("\n").filter(l => l.startsWith("FAIL")).join("\n") + (r.stderr || ""));
  total += p; failed += fl; files++;
}
console.log(`\n${files} files, ${total} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
