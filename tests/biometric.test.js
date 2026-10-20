// js/biometric.js with a STUBBED WebAuthn (navigator.credentials / PublicKeyCredential): request shape, feature detection, Safari-style PRF-only-on-get,
// error mapping. The real authenticator path is exercised in tests/browser-vault.js with Chrome's virtual authenticator; nothing here has run on a real phone.
const { ok, done } = require("./harness");
const Bio = require("../js/biometric.js"), wc = require("crypto").webcrypto;
const loc = { hostname: "satpass.example.com" };
const PRFV = new Uint8Array(32).map((_, i) => i + 1);
function mk(o = {}) {
  const calls = { create: [], get: [] };
  const PKC = Object.assign({ isUserVerifyingPlatformAuthenticatorAvailable: async () => true }, o.PKC || {});
  const nav = { credentials: {
    create: async opts => { calls.create.push(opts); if (o.createErr) throw o.createErr; return { rawId: new Uint8Array([1, 2, 3, 250, 251, 252]).buffer, getClientExtensionResults: () => o.createExt || { prf: { enabled: true, results: { first: PRFV.buffer } } } }; },
    get: async opts => { calls.get.push(opts); if (o.getErr) throw o.getErr; return { getClientExtensionResults: () => o.getExt || { prf: { results: { first: PRFV.buffer } } } }; } } };
  return { calls, env: { nav, loc: o.loc || loc, crypto: wc, PKC, secure: o.secure !== false } };
}
const E = (n, m) => { const e = new Error(m || n); e.name = n; return e; };

(async () => {
  ok("supported: secure context + WebAuthn + platform authenticator -> ok", (await Bio.supported(mk().env)).ok === true);
  ok("hidden on http (not a secure context)", (await Bio.supported(mk({ secure: false }).env)).ok === false);
  ok("hidden without WebAuthn", (await Bio.supported({ nav: {}, loc, crypto: wc, PKC: null, secure: true })).ok === false);
  ok("hidden on an IP-address host (WebAuthn needs a domain)", (await Bio.supported(mk({ loc: { hostname: "192.168.1.5" } }).env)).ok === false && (await Bio.supported(mk({ loc: { hostname: "127.0.0.1" } }).env)).ok === false);
  ok("hidden when no Face ID / fingerprint / Hello is set up", (await Bio.supported(mk({ PKC: { isUserVerifyingPlatformAuthenticatorAvailable: async () => false } }).env)).ok === false);
  ok("hidden when getClientCapabilities says PRF is unsupported; shown when it says yes or throws", (await Bio.supported(mk({ PKC: { getClientCapabilities: async () => ({ "extension:prf": false }) } }).env)).ok === false && (await Bio.supported(mk({ PKC: { getClientCapabilities: async () => ({ "extension:prf": true }) } }).env)).ok === true && (await Bio.supported(mk({ PKC: { getClientCapabilities: async () => { throw new Error("x"); } } }).env)).ok === true);
  ok("localhost is allowed (dev / tests)", (await Bio.supported(mk({ loc: { hostname: "localhost" } }).env)).ok === true);
  ok("desktop local origin uses passphrase unlock without offering unsupported passkeys", (await Bio.supported(mk({ loc: { hostname: "app", protocol: "satpass:" } }).env)).ok === false);

  const m = mk(), r = await Bio.enroll(m.env), pk = m.calls.create[0].publicKey;
  ok("enroll: platform authenticator, user verification REQUIRED, rpId = page host, PRF eval requested, no attestation", pk.rp.id === "satpass.example.com" && pk.authenticatorSelection.userVerification === "required" && pk.authenticatorSelection.authenticatorAttachment === "platform" && pk.extensions.prf.eval.first.length === 32 && pk.attestation === "none" && pk.pubKeyCredParams.some(p => p.alg === -7));
  ok("enroll: passkey is labelled as a vault key, not a login, and carries no personal data", /not a login/.test(pk.user.displayName) && pk.user.id.length === 16 && !/@/.test(pk.user.name));
  ok("enroll returns credId (base64url), prfSalt (matches the requested eval salt), rpId and the 32-byte PRF", r.credId === "AQID-vv8" && Buffer.from(r.prfSalt, "base64").equals(Buffer.from(pk.extensions.prf.eval.first)) && r.rpId === loc.hostname && r.prf.length === 32 && r.prf[0] === 1 && m.calls.get.length === 0);
  const rec = { credId: r.credId, prfSalt: r.prfSalt, rpId: r.rpId };
  const p = await Bio.assertPrf(rec, m.env), g = m.calls.get[0].publicKey;
  ok("assertPrf: allowCredentials = the stored id, same PRF salt, userVerification required, rpId pinned", g.rpId === rec.rpId && g.userVerification === "required" && Buffer.from(g.allowCredentials[0].id).equals(Buffer.from([1, 2, 3, 250, 251, 252])) && Buffer.from(g.extensions.prf.eval.first).equals(Buffer.from(r.prfSalt, "base64")) && p.length === 32 && p[31] === 32);
  const safari = mk({ createExt: { prf: { enabled: true } } }), rs = await Bio.enroll(safari.env);
  ok("Safari/iOS style: create() says prf.enabled without a value -> enroll then calls get() to obtain it", rs.prf.length === 32 && safari.calls.get.length === 1);
  const np = await Bio.enroll(mk({ createExt: { prf: { enabled: false } } }).env).catch(e => e), np2 = await Bio.enroll(mk({ createExt: {} }).env).catch(e => e);
  ok("no PRF support on this authenticator -> clear 'unsupported' error, passphrase unaffected", np.kind === "unsupported" && np2.kind === "unsupported" && /PRF/.test(np.message));
  ok("get() returning no PRF result -> 'unsupported'", (await Bio.assertPrf(rec, mk({ getExt: {} }).env).catch(e => e)).kind === "unsupported");
  ok("user cancels / times out -> friendly 'cancelled' error", (await Bio.enroll(mk({ createErr: E("NotAllowedError") }).env).catch(e => e)).kind === "cancelled" && (await Bio.assertPrf(rec, mk({ getErr: E("NotAllowedError") }).env).catch(e => e)).kind === "cancelled");
  ok("other failures are mapped, never leak a raw exception", (await Bio.enroll(mk({ createErr: E("InvalidStateError") }).env).catch(e => e)).kind === "config" && (await Bio.enroll(mk({ createErr: E("SecurityError") }).env).catch(e => e)).kind === "config");
  ok("a record made for another host is refused before any prompt", (await Bio.assertPrf(Object.assign({}, rec, { rpId: "other.example" }), m.env).catch(e => e)).kind === "config");
  let signalled = null; await Bio.forget(rec, mk({ PKC: { signalUnknownCredential: async x => { signalled = x; } } }).env);
  ok("forget(): best-effort signalUnknownCredential when available, harmless otherwise", signalled && signalled.rpId === rec.rpId && signalled.credentialId === rec.credId && (await Bio.forget(rec, mk().env)) === undefined);
  ok("base64url helpers round-trip", Buffer.from(Bio._unb64u(Bio._b64u(PRFV))).equals(Buffer.from(PRFV)));
  // ---- 1.3.2
  ok("shared origin: hidden on <user>.github.io and github.io (with a 'shared' flag and an explanation), allowed elsewhere", await (async () => { const a = await Bio.supported(mk({ loc: { hostname: "theriotcoder.github.io" } }).env), b = await Bio.supported(mk({ loc: { hostname: "github.io" } }).env), c = await Bio.supported(mk({ loc: { hostname: "myapp.netlify.app" } }).env), d = await Bio.supported(mk({ loc: { hostname: "satpass.example.com" } }).env); return a.ok === false && a.shared === true && /shared origin/.test(a.reason) && b.ok === false && c.ok === true && d.ok === true; })());
  ok("enroll refuses on a shared origin before any prompt (no credentials.create call)", await (async () => { const s2 = mk({ loc: { hostname: "x.github.io" } }); const e = await Bio.enroll(s2.env).catch(x => x); return e.kind === "config" && /shared origin/.test(e.message) && s2.calls.create.length === 0; })());
  ok("passkey is created non-discoverable (residentKey 'discouraged') so it does not show in other apps' passkey pickers", pk.authenticatorSelection.residentKey === "discouraged" && pk.authenticatorSelection.requireResidentKey === false);
  ok("js/biometric.js no longer claims the shared-origin passkey is harmless (comment fixed)", !/useless without this app's wrapped record, which is itself encrypted/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "js", "biometric.js"), "utf8")) && /SHARED-ORIGIN LIMIT/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "js", "biometric.js"), "utf8")));
  done();
})();
