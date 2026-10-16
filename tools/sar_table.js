#!/usr/bin/env node
// Generates the SAR table in README.md (between the SAR-TABLE markers) from data/sar.js, so the docs cannot drift from the data.
//   node tools/sar_table.js          print the table
//   node tools/sar_table.js --write  update README.md in place (tests/sar.test.js checks that it is in sync)
const fs = require("fs"), path = require("path"), Sar = require("../data/sar.js");
function table() {
  const rows = ["| Mission | NORAD ids | Operator | Band | Nominal centre freq. | Max bandwidth | Sources | Public TLE |", "|---|---|---|---|---|---|---|---|"];
  for (const m of Sar.MISSIONS) {
    const ids = m.sats.map(s => s[0]), idTxt = ids.length > 6 ? `${ids.length} satellites (${Math.min(...ids)}–${Math.max(...ids)})` : ids.join(", ") || "–";
    const freq = m.centerFreqMHz != null ? `${m.centerFreqMHz} MHz${m.approx ? " (approx.)" : ""}` : "frequency not verified";
    const bw = m.bandwidthMHz != null ? `${m.bandwidthMHz} MHz` : "not verified";
    const src = m.source.map((u, i) => `[${new URL(u).host.replace(/^www\./, "")}](${u})`).join(", ");
    rows.push(`| ${m.name} | ${idTxt} | ${m.operator} | ${m.band} | ${freq} | ${bw} | ${src} | ${ids.length ? "yes" : "no public TLE"} |`);
  }
  return rows.join("\n");
}
if (require.main === module) {
  const out = table();
  if (process.argv.includes("--write")) {
    const p = path.join(__dirname, "..", "README.md"), r = fs.readFileSync(p, "utf8");
    const n = r.replace(/<!-- SAR-TABLE:START -->[\s\S]*?<!-- SAR-TABLE:END -->/, () => "<!-- SAR-TABLE:START -->\n" + out + "\n<!-- SAR-TABLE:END -->");
    if (n === r && !/SAR-TABLE:START/.test(r)) { console.error("markers missing in README.md"); process.exit(1); }
    fs.writeFileSync(p, n); console.log("README.md updated (" + Sar.MISSIONS.length + " missions)");
  } else console.log(out);
}
module.exports = { table };
