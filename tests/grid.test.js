const { ok, near, throws, done } = require("./harness");
const G = require("../js/grid.js");
// known locators
const em10 = G.fromGrid("EM10");
near("EM10 centre lat 30.5", em10.lat, 30.5, 1e-9); near("EM10 centre lon -97", em10.lon, -97, 1e-9);
near("EM10 bounds lon", em10.lonMax - em10.lonMin, 2, 1e-9); near("EM10 bounds lat", em10.latMax - em10.latMin, 1, 1e-9);
ok("Austin TX -> EM10", G.toGrid(30.27, -97.74, 4) === "EM10", G.toGrid(30.27, -97.74, 4));
ok("Austin TX 6-char -> EM10dg", G.toGrid(30.27, -97.74, 6) === "EM10dg", G.toGrid(30.27, -97.74, 6));
ok("London 51.5, -0.1 -> IO91wm", G.toGrid(51.5, -0.1, 6) === "IO91wm", G.toGrid(51.5, -0.1, 6));
ok("Munich 48.14, 11.62 -> JN58td", G.toGrid(48.14, 11.62, 6) === "JN58td", G.toGrid(48.14, 11.62, 6));
ok("Newington CT 41.714, -72.727 -> FN31pr", G.toGrid(41.714, -72.727, 6) === "FN31pr", G.toGrid(41.714, -72.727, 6));
ok("Sydney -33.87, 151.21 -> QF56od", G.toGrid(-33.87, 151.21, 6) === "QF56od", G.toGrid(-33.87, 151.21, 6));
ok("Tokyo 35.68, 139.69 -> PM95uq", G.toGrid(35.68, 139.69, 6) === "PM95uq", G.toGrid(35.68, 139.69, 6));
ok("(0,0) -> JJ00aa", G.toGrid(0, 0, 6) === "JJ00aa");
ok("SW corner (-90,-180) -> AA00aa", G.toGrid(-90, -180, 6) === "AA00aa");
ok("NE extreme (90,180) -> field AA/RR safe", /^[A-R]{2}\d\d[a-x]{2}$/.test(G.toGrid(90, 180, 6)), G.toGrid(90, 180, 6));
ok("lat 90 -> RR", G.toGrid(90, 10, 2) === "JR");
ok("2-char field JN", G.toGrid(48.14, 11.58, 2) === "JN");
ok("8-char extended is 8 chars", G.toGrid(48.14, 11.58, 8).length === 8, G.toGrid(48.14, 11.58, 8));
ok("8-char starts with 6-char", G.toGrid(48.14, 11.58, 8).startsWith(G.toGrid(48.14, 11.58, 6)));
// round trip: centre of grid maps back to same grid, for random points
let rt = true, maxErr = 0;
for (let i = 0; i < 2000; i++) {
  const lat = -89.99 + Math.random() * 179.98, lon = -179.99 + Math.random() * 359.98;
  for (const n of [2, 4, 6, 8, 10]) {
    const g = G.toGrid(lat, lon, n), c = G.fromGrid(g);
    if (G.toGrid(c.lat, c.lon, n) !== g) rt = false;
    if (lat < c.latMin - 1e-9 || lat > c.latMax + 1e-9 || lon < c.lonMin - 1e-9 || lon > c.lonMax + 1e-9) rt = false;
    if (n === 6) maxErr = Math.max(maxErr, Math.abs(lat - c.lat), Math.abs(lon - c.lon));
  }
}
ok("round trip toGrid(fromGrid(g)) = g & point inside cell (2000 random × 5 lengths)", rt);
ok("6-char centre error ≤ half cell (2.5'×1.25' => ≤0.0417° lon, 0.0208° lat)", maxErr <= 5 / 120 + 1e-9, maxErr);
// case-insensitive, validation
near("lower-case input", G.fromGrid("em10bg").lat, G.fromGrid("EM10dg").lat, 1e-12);
ok("isValid EM10", G.isValid("EM10")); ok("isValid em10BG (mixed case)", G.isValid("em10BG"));
ok("isValid rejects 'EM1'", !G.isValid("EM1")); ok("isValid rejects 'ZZ99'", !G.isValid("ZZ99")); ok("isValid rejects 'EM10y9'", !G.isValid("EM10y9")); ok("isValid rejects empty", !G.isValid(""));
throws("fromGrid invalid", () => G.fromGrid("XX"), /valid/);
throws("toGrid lat out of range", () => G.toGrid(91, 0), /Latitude/);
throws("toGrid lon out of range", () => G.toGrid(0, 181), /Longitude/);
near("distance Austin–London ≈ 7900 km", G.distanceKm(30.27, -97.74, 51.5, -0.12), 7900, 100);
done();
