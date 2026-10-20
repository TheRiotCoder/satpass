/* SatPass biometric / device unlock (browser layer, 1.3.2): WebAuthn PRF extension.
   A platform passkey (Face ID / Touch ID / Android fingerprint / Windows Hello) is created for this page's host (rpId = location.hostname,
   userVerification "required", non-discoverable). Its PRF output (32 bytes, only produced after user verification) is key material that wraps the random
   vault DATA KEY (see SatSources.wrapSecret / createVault) – never the passphrase. Nothing secret is stored here: this module only talks to the authenticator.
   SHARED-ORIGIN LIMIT: rpId cannot be narrower than the host, and localStorage (which holds the wrapped record) is per origin. On a host shared by several
   apps (e.g. <user>.github.io, where every project site is one origin) a sibling app can read the record and ask the same passkey for the PRF output after
   one biometric tap, so biometric unlock is NOT offered there (SatSources.sharedOrigin). It is offered on localhost and on hosts that are NOT detectably shared;
   the page cannot know what else lives on its host, so a GitHub Pages custom domain (which serves every project repo of the account from one origin) must not be used
   for this - use a host dedicated to SatPass (e.g. its own Netlify site). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(); else root.SatBio = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function err(kind, msg) { var e = new Error(msg); e.name = "SourceError"; e.kind = kind; return e; }
  function b64(buf) { var s = "", a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(str) { var s = atob(str), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function b64u(buf) { return b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(str) { var s = String(str).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return unb64(s); }
  var Src = typeof self !== "undefined" && self.SatSources ? self.SatSources : (typeof module === "object" && module.exports ? (function () { try { return require("./sources.js"); } catch (x) { return null; } })() : null);
  function env(e) {
    e = e || {};
    return { nav: e.nav || (typeof navigator !== "undefined" ? navigator : {}), loc: e.loc || (typeof location !== "undefined" ? location : {}), crypto: e.crypto || (typeof crypto !== "undefined" ? crypto : null),
      PKC: e.PKC || (typeof PublicKeyCredential !== "undefined" ? PublicKeyCredential : null), secure: e.secure !== undefined ? e.secure : (typeof isSecureContext !== "undefined" ? isSecureContext : false) };
  }
  function rpIdOf(v) { var h = v.loc.hostname || ""; return h; }

  // Can this browser probably do PRF-backed biometric unlock? Resolves {ok, reason}. PRF support can only be proven by trying (see enroll),
  // so this is a cheap gate to decide whether to show the option at all.
  function supported(e) {
    var v = env(e);
    if (v.loc.protocol === "satpass:") return Promise.resolve({ ok: false, reason: "Desktop vault unlock uses your passphrase; browser passkeys are not available on this app's local address." });
    if (!v.secure) return Promise.resolve({ ok: false, reason: "needs HTTPS" });
    if (!v.PKC || !v.nav.credentials || !v.nav.credentials.create || !v.nav.credentials.get) return Promise.resolve({ ok: false, reason: "no WebAuthn" });
    var rp = rpIdOf(v); if (Src && Src.sharedOrigin(rp)) return Promise.resolve({ ok: false, shared: true, reason: "shared origin: every app on " + rp + " shares this storage and passkey" });
    if (!rp || /^[\d.]+$/.test(rp) || rp.indexOf(":") >= 0 || rp.indexOf("[") >= 0) return Promise.resolve({ ok: false, reason: "WebAuthn needs a host name (not an IP address)" });
    var chain = Promise.resolve(true);
    if (typeof v.PKC.getClientCapabilities === "function") chain = Promise.resolve(v.PKC.getClientCapabilities()).then(function (c) { return !(c && c["extension:prf"] === false) ? true : "noprf"; }, function () { return true; });
    return chain.then(function (r) {
      if (r === "noprf") return { ok: false, reason: "this browser does not support the WebAuthn PRF extension" };
      if (typeof v.PKC.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return { ok: false, reason: "no platform authenticator API" };
      return Promise.resolve(v.PKC.isUserVerifyingPlatformAuthenticatorAvailable()).then(function (a) { return a ? { ok: true } : { ok: false, reason: "no Face ID / fingerprint / Windows Hello set up on this device" }; }, function () { return { ok: false, reason: "authenticator check failed" }; });
    });
  }

  function prfFrom(cred) {
    var x = cred && cred.getClientExtensionResults ? cred.getClientExtensionResults() : null, r = x && x.prf && x.prf.results && x.prf.results.first;
    return r ? new Uint8Array(r instanceof ArrayBuffer ? r : (r.buffer ? r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) : r)) : null;
  }
  function failText(e) {
    var n = e && e.name;
    if (n === "NotAllowedError") return err("cancelled", "Biometric prompt was cancelled or timed out.");
    if (n === "InvalidStateError") return err("config", "A passkey for SatPass already exists on this device – remove it in your device's passkey settings or try again.");
    if (n === "NotSupportedError" || n === "SecurityError") return err("config", "This browser or host cannot create the passkey (" + n + ").");
    return err("config", "Biometric prompt failed" + (e && e.message ? ": " + e.message : "."));
  }

  // Create the passkey and obtain its PRF output. Resolves {credId (base64url), prfSalt (base64), rpId, prf (Uint8Array 32)}.
  function enroll(e) {
    var v0 = env(e); if (Src && Src.sharedOrigin(rpIdOf(v0))) return Promise.reject(err("config", "Biometric unlock is not offered on a shared origin (" + rpIdOf(v0) + ")."));
    var v = env(e), rpId = rpIdOf(v), c = v.crypto, salt = c.getRandomValues(new Uint8Array(32)), user = c.getRandomValues(new Uint8Array(16)), ch = c.getRandomValues(new Uint8Array(32));
    var opts = { publicKey: { rp: { id: rpId, name: "SatPass" }, user: { id: user, name: "satpass-vault-unlock", displayName: "SatPass vault unlock (not a login)" }, challenge: ch,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: 60000, attestation: "none",
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged", requireResidentKey: false },
      extensions: { prf: { eval: { first: salt } } } } };
    return v.nav.credentials.create(opts).then(function (cred) {
      if (!cred) throw err("config", "No passkey was created.");
      var x = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
      if (!x.prf || (x.prf.enabled === false)) throw err("unsupported", "This device's passkeys do not support the PRF extension, so biometric unlock is not possible here. Your passphrase works as before.");
      var credId = b64u(cred.rawId), prf = prfFrom(cred), meta = { credId: credId, prfSalt: b64(salt), rpId: rpId };
      if (prf) return Object.assign(meta, { prf: prf });
      return assertWith(v, meta).then(function (p) { return Object.assign(meta, { prf: p }); });   // Safari/iOS return the PRF value only from get(), not from create()
    }, function (er) { throw er && er.kind ? er : failText(er); });
  }
  function assertWith(v, rec) {
    var ch = v.crypto.getRandomValues(new Uint8Array(32));
    return v.nav.credentials.get({ publicKey: { challenge: ch, rpId: rec.rpId, timeout: 60000, userVerification: "required",
      allowCredentials: [{ type: "public-key", id: unb64u(rec.credId), transports: ["internal", "hybrid"] }], extensions: { prf: { eval: { first: unb64(rec.prfSalt) } } } } }).then(function (cred) {
      var prf = prfFrom(cred); if (!prf || prf.length < 32) throw err("unsupported", "The authenticator did not return a PRF secret.");
      return prf;
    }, function (er) { throw er && er.kind ? er : failText(er); });
  }
  // Ask the authenticator (biometric prompt) for the PRF output belonging to a stored record. Resolves Uint8Array(32).
  function assertPrf(rec, e) {
    var v = env(e); if (rpIdOf(v) !== rec.rpId) return Promise.reject(err("config", "This biometric key belongs to " + rec.rpId + "; open SatPass there or use your passphrase."));
    return assertWith(v, rec);
  }
  function forget(rec, e) {   // best effort: ask the browser to drop the passkey when it supports the Signal API
    var v = env(e); try { if (v.PKC && typeof v.PKC.signalUnknownCredential === "function" && rec) return Promise.resolve(v.PKC.signalUnknownCredential({ rpId: rec.rpId, credentialId: rec.credId })).catch(function () {}); } catch (x) {}
    return Promise.resolve();
  }
  return { supported: supported, enroll: enroll, assertPrf: assertPrf, forget: forget, _b64u: b64u, _unb64u: unb64u };
});
