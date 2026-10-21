// A short-lived browser handoff. Only the loopback interface is used; there is
// no hosted service, API key, or upload of coordinates to SatPass servers.
const http = require("node:http");
const { randomBytes } = require("node:crypto");

function coordinates(value) {
  if (!value || typeof value !== "object") return null;
  const { latitude, longitude, accuracy, altitude } = value;
  if (![latitude, longitude, accuracy].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) return null;
  if (altitude != null && (!Number.isFinite(altitude) || altitude < -500 || altitude > 9000)) return null;
  return { latitude, longitude, accuracy, altitude: altitude == null ? null : altitude };
}

function page(nonce) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SatPass — your location</title>
<style nonce="${nonce}">body{font:18px/1.6 system-ui,sans-serif;background:#0b1220;color:#e6edf7;margin:0;padding:24px}main{max-width:560px;margin:8vh auto}h1{font-size:28px}button{font:inherit;padding:12px 18px;border:1px solid #93c5fd;border-radius:8px;cursor:pointer;background:#bfdbfe;color:#0b1220;margin:8px 12px 8px 0}button:disabled{opacity:.5}#status{min-height:3em}small{color:#c4cedd}</style>
<main><h1>Share your location with SatPass</h1><p>Your browser will ask permission to find your position. After sharing it, return to the SatPass app.</p>
<p><small>Your browser may use an online location provider. The result is sent only to the SatPass app on this computer. SatPass stores your observing location locally.</small></p>
<button id="share" type="button">Share location with SatPass</button><button id="cancel" type="button">Cancel</button><p id="status" role="status" aria-live="polite"></p></main>
<script nonce="${nonce}">
const share=document.getElementById('share'), cancel=document.getElementById('cancel'), status=document.getElementById('status');
let done=false;
async function send(route,data){const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error('The request has expired. Return to SatPass and try again.');}
share.onclick=()=>{if(done)return;if(!navigator.geolocation){status.textContent='Location is unavailable in this browser. Enter coordinates in SatPass instead.';return;}
share.disabled=true;status.textContent='Allow location in your browser when prompted…';
navigator.geolocation.getCurrentPosition(async p=>{if(done)return;const c=p.coords;try{await send('result',{latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,altitude:c.altitude != null && c.altitude >= -500 && c.altitude <= 9000 ? c.altitude : null});done=true;cancel.disabled=true;status.textContent='Location sent. Return to SatPass. You can close this tab.';}catch(e){status.textContent=e.message;share.disabled=false;}},e=>{if(done)return;share.disabled=false;status.textContent=e.code===1?'Location permission was denied. Allow location for this page in your browser, then try again, or enter coordinates in SatPass.':e.code===3?'The location request timed out. Try again or enter coordinates in SatPass.':'Your browser could not find your location. Try again or enter coordinates in SatPass.';},{enableHighAccuracy:false,timeout:20000,maximumAge:600000});};
cancel.onclick=async()=>{if(done)return;done=true;share.disabled=cancel.disabled=true;try{await send('cancel',{});status.textContent='Cancelled. You can close this tab.';}catch(e){status.textContent=e.message;}};
</script></html>`;
}

function requestLocation({ openExternal, signal, timeoutMs = 120000 }) {
  return new Promise(resolve => {
    const token = randomBytes(24).toString("hex"), base = "/" + token + "/", nonce = randomBytes(18).toString("hex");
    let origin, timer, settled = false;
    function finish(result) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      server.close(); server.closeAllConnections(); resolve(result);
    }
    function abort() { finish({ ok: false, code: 1, message: "Location request cancelled." }); }
    const server = http.createServer((req, res) => {
      res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Connection", "close");
      res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      const reply = (status, body, type = "text/plain; charset=utf-8") => { res.writeHead(status, { "Content-Type": type }); res.end(body); };
      if (settled || req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return reply(403, "Forbidden");
      if (req.method === "GET" && req.url === base) return reply(200, page(nonce), "text/html; charset=utf-8");
      if (req.method !== "POST" || ![base + "result", base + "cancel"].includes(req.url)) return reply(404, "Not found");
      if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json") return reply(403, "Forbidden");
      let body = "", oversized = false;
      req.setEncoding("utf8");
      req.on("data", chunk => { if (oversized) return; body += chunk; if (Buffer.byteLength(body) > 2048) { oversized = true; reply(413, "Too large"); req.resume(); } });
      req.on("error", () => {});
      req.on("end", () => {
        if (oversized || settled) return;
        let data; try { data = JSON.parse(body); } catch { return reply(400, "Invalid data"); }
        const coords = coordinates(data);
        if (req.url === base + "result" && !coords) return reply(400, "Invalid coordinates");
        res.once("finish", () => finish(coords && req.url === base + "result" ? { ok: true, coords } : { ok: false, code: 1, message: "Location request cancelled." }));
        reply(200, '{"ok":true}', "application/json");
      });
    });
    server.requestTimeout = 10000; server.headersTimeout = 10000;
    server.on("error", () => finish({ ok: false, code: 2, message: "Could not start the browser location request. Enter your coordinates manually." }));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish({ ok: false, code: 3, message: "Browser location request expired. Try again or enter coordinates manually." }), timeoutMs);
    server.listen(0, "127.0.0.1", () => {
      if (settled) { server.close(); return; }
      origin = "http://127.0.0.1:" + server.address().port;
      Promise.resolve().then(() => openExternal(origin + base)).catch(() => finish({ ok: false, code: 2, message: "Could not open your browser. Enter coordinates manually." }));
    });
  });
}

module.exports = { requestLocation, coordinates };
