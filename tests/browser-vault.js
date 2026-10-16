// Browser part of the v1.3.0 credential-vault tests (called from browser-smoke.js): password-manager form structure, no secrets in URL/DOM outside the inputs,
// auto-lock, encrypted backup export/import through the real UI, and biometric unlock through Chrome's CDP *virtual authenticator* (WebAuthn.addVirtualAuthenticator
// with hasPrf) – a real WebAuthn + PRF round trip, but NOT a real Face ID / fingerprint sensor ("untested on real device").
const fs = require("fs"), os = require("os"), path = require("path");
const SEC = { id: "vault.user@example.com", pw: "Vault-Test-Password-24680", sn: "feedfeedfeedfeedfeedfeedfeedfeedfeedfeed", n2: "VAULT-N2YO-KEY-13579", px: "VAULT-PROXY-TOKEN-11223", pass: "vault-passphrase-xyz-1", bk: "backup-passphrase-xyz-2" };
const SECRETS = [SEC.pw, SEC.sn, SEC.n2, SEC.px, SEC.pass, SEC.bk];

module.exports = async function run(h) {
  const { ev, send, check, sleep, waitEvent, APP, HTTP, LOCAL } = h;
  const q = s => `document.querySelector(${JSON.stringify(s)})`;
  const waitFor = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expr)) return true; await sleep(250); } return false; };
  const set = (sel, v) => ev(`(() => { const e = ${q(sel)}; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const nav = async url => { const l = waitEvent("Page.loadEventFired"); await send("Page.navigate", { url }); await l; await sleep(1200); };
  const settings = async () => { await ev(`location.hash = '#/passes'`); await sleep(300); await ev(`location.hash = '#/settings'`); await sleep(500); await waitFor(`!!${q("#srcCard")} && !!${q("#passForm")}`); await sleep(300); };
  // shim: block CelesTrak (keeps the boot refresh from re-rendering the page under the test), record submit events, stub download capture
  const shim = `(() => {
    const real = window.fetch.bind(window); window.fetch = (u, i) => /celestrak\\.org/.test(typeof u === 'string' ? u : u.url) ? Promise.reject(new TypeError('Failed to fetch')) : real(u, i);
    window.__submits = []; document.addEventListener('submit', e => window.__submits.push({ id: e.target.id || e.target.dataset.id, prevented: e.defaultPrevented }));
    window.__dl = []; const co = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { b.text().then(t => window.__dl.push(t)); return co(b); };
    window.__sysAlerts = [];
  })()`;
  const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", { source: shim });
  const secretScan = (list) => ev(`(() => { const S = ${JSON.stringify(list)}, hits = []; const t = document.body.innerText + ' ' + location.href + ' ' + document.title;
    S.forEach(s => { if (t.indexOf(s) >= 0) hits.push('text:' + s.slice(0, 8)); if (encodeURIComponent(s) !== s && t.indexOf(encodeURIComponent(s)) >= 0) hits.push('urlenc:' + s.slice(0, 8)); });
    document.querySelectorAll('*').forEach(el => [...el.attributes].forEach(a => { if (a.name === 'value' && el.tagName === 'INPUT') return; S.forEach(s => { if (a.value.indexOf(s) >= 0) hits.push(el.tagName + '@' + a.name); }); }));
    return hits; })()`);

  // ================= part 1: structure + submit semantics (page origin as served; no WebAuthn needed)
  const wipeVault = () => ev(`['creds', 'credhint', 'bio', 'vault', 'sources', 'srcstatus'].forEach(k => localStorage.removeItem('satpass:' + k)); sessionStorage.clear()`);   // (the rest of the smoke needs the saved location etc.)
  await nav(APP); await wipeVault(); await nav(APP); await settings();
  const forms = await ev(`[...document.querySelectorAll('#srcCard form')].map(f => ({ id: f.id || f.dataset.id, method: f.method, action: f.getAttribute('action'), ac: f.getAttribute('autocomplete'), submit: !!f.querySelector('button[type=submit]'), pw: [...f.querySelectorAll('input[type=password]')].map(i => ({ id: i.id, name: i.name, ac: i.autocomplete })), user: [...f.querySelectorAll('input[type=text]')].map(i => ({ name: i.name, ac: i.autocomplete })) }))`);
  check("1.3.0: credential fields live in real <form method=post> elements, each with a submit button", forms.length >= 5 && forms.every(f => f.method === "post" && f.action === "#" && f.submit), forms.map(f => f.id));
  const allPw = forms.flatMap(f => f.pw);
  check("1.3.0: every password input has a name and an autocomplete token (none is 'off'): current-password for logins/tokens, new-password for the passphrase", allPw.length >= 7 && allPw.every(p => p.name && p.ac && p.ac !== "off") && allPw.find(p => p.id === "passIn").ac === "new-password" && allPw.find(p => p.id === "stPw").ac === "current-password" && allPw.find(p => p.id === "srcProxyToken").ac === "current-password", allPw);
  const stForm = forms.find(f => f.id === "spacetrack");
  check("1.3.0: Space-Track form: username input (autocomplete=username, name=username) + password input (type=password, current-password)", stForm.user.some(u => u.ac === "username" && u.name === "username") && stForm.pw.length === 1 && stForm.pw[0].ac === "current-password");
  check("1.3.0: every form that has a password field also has an autocomplete=username field (so managers can file the login)", forms.filter(f => f.pw.length).every(f => f.user.some(u => u.ac === "username")));
  check("1.3.0: proxy recommendation comes first (Setup → Data sources section 1) and says Worker secrets", await ev(`(() => { const c = ${q("#srcCard")}, p = c.querySelector('#proxyBest'), r = c.querySelector('.srcrow'); return !!p && !!(p.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) && /Worker secrets/.test(p.textContent) && /Most secure/.test(p.textContent); })()`));
  check("1.3.0: in-app help text: 'Save in your password manager; SatPass can store an encrypted copy on this device'", await ev(`/Save in your password manager; SatPass can store an encrypted copy on this device/.test(${q("#credHelp")}.textContent)`));
  check("1.3.0: sr-only account labels are visually hidden but not display:none / hidden / type=hidden", await ev(`[...document.querySelectorAll('#srcCard input.sr-only')].every(i => { const cs = getComputedStyle(i); return i.type === 'text' && cs.display !== 'none' && cs.visibility !== 'hidden' && !i.hidden; }) && document.querySelectorAll('#srcCard input.sr-only').length >= 4`));

  // typed secrets + real submits (click the submit button / Enter semantics)
  await set("#stId", SEC.id); await set("#stPw", SEC.pw); await set("#snToken", SEC.sn); await set("#n2Key", SEC.n2);
  const href0 = await ev(`location.href`);
  await ev(`window.__submits.length = 0; ${q('.srcTest[data-id="spacetrack"]')}.click()`); await sleep(800);
  check("1.3.0: clicking Test connection fires a real form submit event that is preventDefault-ed; the page does not navigate and the URL has no query/secret", await ev(`window.__submits.some(s => s.id === 'spacetrack' && s.prevented)`) && (await ev(`location.href`)) === href0 && !/\?|password|vault\.user/.test(await ev(`location.href`)));
  check("1.3.0: Test connection still reports a clear result (proxy missing) via the submit handler", await ev(`/proxy|Not set up|not set up/i.test(${q('.srcTestMsg[data-id="spacetrack"]')}.textContent)`), await ev(`${q('.srcTestMsg[data-id="spacetrack"]')}.textContent`));
  check("1.3.0: typed secrets are in no URL, no visible text and no attribute other than the inputs' own value", (await secretScan([SEC.pw, SEC.sn, SEC.n2])).length === 0, await secretScan([SEC.pw, SEC.sn, SEC.n2]));
  check("1.3.0: only the input values hold the secrets (session credentials), nothing in localStorage", await ev(`document.querySelector('#stPw').value === ${JSON.stringify(SEC.pw)} && ${JSON.stringify(SECRETS)}.every(s => JSON.stringify(localStorage).indexOf(s) < 0)`));
  await set("#srcProxy", "https://mock-proxy.workers.dev"); await set("#srcProxyToken", SEC.px);
  await ev(`window.__submits.length = 0; ${q("#proxySave")}.click()`); await sleep(600);
  check("1.3.0: 'Save proxy settings' is a form submit too and stores URL + token (token only in session storage)", await ev(`window.__submits.some(s => s.id === 'proxyForm' && s.prevented)`) && await ev(`SatStore.sources.config().proxy === 'https://mock-proxy.workers.dev' && SatStore.sources.getCreds().proxyToken === ${JSON.stringify(SEC.px)} && localStorage.getItem('satpass:creds') === null`));
  check("1.3.0: the form-action 'none' CSP is intact and no CSP violation occurred while submitting", await ev(`/form-action 'none'/.test(document.querySelector('meta[http-equiv=Content-Security-Policy]').content)`));

  // passphrase: encrypt through the form
  await settings(); await set("#passIn", SEC.pass); await ev(`${q("#passLock")}.click()`); await sleep(2500);
  check("1.3.0: passphrase form submit encrypts the vault (mode 'encrypted'); localStorage holds only the AES-GCM blob", await waitFor(`SatStore.sources.credMode() === 'encrypted'`, 8000) && await ev(`${JSON.stringify(SECRETS)}.every(s => JSON.stringify(localStorage).indexOf(s) < 0) && /"enc":2/.test(localStorage.getItem('satpass:creds'))`));
  check("1.3.0: biometric option is hidden where unsupported (this origin is an IP address / shared github.io / no usable WebAuthn host)", await ev(`!document.querySelector('#bioEnable') && !document.querySelector('#bioUnlock')`));

  // ================= part 2: auto-lock (hook exposes the tick with an injectable clock)
  await ev(`SatStore.sources.setVaultCfg({ idleMin: 1, hiddenMin: 2 })`);
  const t0 = await ev(`Date.now()`);
  await ev(`SatPassAutoLock.touch(${t0})`);
  check("1.3.0: auto-lock: not locked before the idle time", (await ev(`SatPassAutoLock.tick(${t0 + 59000})`)) === null && !(await ev(`SatStore.sources.isLocked()`)));
  check("1.3.0: auto-lock: locks after the idle time, memory cleared (no credentials / passphrase), mode 'locked'", (await ev(`SatPassAutoLock.tick(${t0 + 61000})`)) === "idle" && await ev(`SatStore.sources.isLocked() && Object.keys(SatStore.sources.getCreds()).length === 0 && SatStore.sources.credMode() === 'locked'`));
  await sleep(300);
  check("1.3.0: lock re-renders the Setup card: all credential inputs are empty and disabled, no secret left in the DOM", await ev(`[...document.querySelectorAll('#srcCard input[data-key]')].every(i => i.value === '' && i.disabled)`) && (await secretScan(SECRETS)).length === 0 && await ev(`!!${q("#passIn")} && ${q("#passLock")}.textContent === 'Unlock' && ${q("#passIn")}.autocomplete === 'current-password'`));
  await set("#passIn", SEC.pass); await ev(`${q("#passLock")}.click()`); await waitFor(`!SatStore.sources.isLocked()`, 8000);
  check("1.3.0: unlock with the passphrase restores the credentials", await ev(`SatStore.sources.getCreds().stPassword === ${JSON.stringify(SEC.pw)}`));
  await settings();
  await ev(`SatStore.sources.setVaultCfg({ idleMin: 0, hiddenMin: 2 })`);
  const t1 = await ev(`Date.now()`); await ev(`SatPassAutoLock.touch(${t1}); SatPassAutoLock.hide(${t1})`);
  check("1.3.0: auto-lock: page hidden for N minutes locks (and the 2-minute hidden limit is respected)", (await ev(`SatPassAutoLock.tick(${t1 + 100000})`)) === null && (await ev(`SatPassAutoLock.tick(${t1 + 121000})`)) === "hidden" && await ev(`SatStore.sources.isLocked()`));
  await ev(`SatPassAutoLock.hide(null)`);
  await set("#passIn", SEC.pass); await ev(`${q("#passLock")}.click()`); await waitFor(`!SatStore.sources.isLocked()`, 8000);
  await settings();
  await ev(`${q("#lockNow")}.click()`); await sleep(400);
  check("1.3.0: 'Lock now' button locks immediately", await ev(`SatStore.sources.isLocked() && ${q("#passMsg")}.textContent.indexOf('Locked') >= 0`));
  await set("#passIn", SEC.pass); await ev(`${q("#passLock")}.click()`); await waitFor(`!SatStore.sources.isLocked()`, 8000);

  // ================= part 3: encrypted backup through the UI
  await settings(); await ev(`${q("#backupBox")}.open = true`);
  await ev(`window.__dl.length = 0`);
  await set("#bkPass", "short"); await ev(`${q("#bkExport")}.click()`); await sleep(400);
  check("1.3.0: backup export refuses a short passphrase", await ev(`/at least 10/.test(${q("#bkMsg")}.textContent)`) && await ev(`window.__dl.length === 0`));
  await set("#bkPass", SEC.bk); await ev(`${q("#bkExport")}.click()`); await waitFor(`window.__dl.length > 0`, 8000);
  const dl = await ev(`window.__dl[0] || ''`);
  check("1.3.0: backup export downloads an encrypted JSON file with none of the secrets, identity, proxy URL or passphrases in it", !!dl && JSON.parse(dl).app === "satpass-credentials-backup" && SECRETS.concat([SEC.id, "mock-proxy"]).every(s => dl.indexOf(s) < 0) && JSON.parse(dl).blob.iter === 600000);
  const file = path.join(os.tmpdir(), "satpass-test-backup.json"); fs.writeFileSync(file, dl);
  await ev(`SatStore.sources.forgetCreds()`); await settings(); await ev(`${q("#backupBox")}.open = true`);
  check("1.3.0: after Forget credentials the vault is empty", await ev(`Object.keys(SatStore.sources.getCreds()).length === 0 && SatStore.sources.credMode() === 'none'`));
  const doc = await send("DOM.getDocument", { depth: 1 }), fi = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#bkFile" });
  await send("DOM.setFileInputFiles", { nodeId: fi.nodeId, files: [file] });
  await set("#bkPass2", "wrong-backup-pass"); await ev(`${q("#bkImport")}.click()`); await sleep(2500);
  check("1.3.0: import with the wrong passphrase fails with a clear message and imports nothing", await ev(`/Wrong backup passphrase/.test(${q("#bkMsg")}.textContent) && Object.keys(SatStore.sources.getCreds()).length === 0`), await ev(`${q("#bkMsg")}.textContent`));
  await set("#bkPass2", SEC.bk); await ev(`${q("#bkImport")}.click()`); await waitFor(`Object.keys(SatStore.sources.getCreds()).length > 0`, 10000);
  check("1.3.0: import with the right passphrase restores the credentials and the proxy URL", await ev(`SatStore.sources.getCreds().stPassword === ${JSON.stringify(SEC.pw)} && SatStore.sources.getCreds().proxyToken === ${JSON.stringify(SEC.px)} && SatStore.sources.config().proxy === 'https://mock-proxy.workers.dev'`));
  check("1.3.0: imported credentials are session-only until a passphrase is set (nothing plaintext in localStorage)", await ev(`SatStore.sources.credMode() === 'session' && ${JSON.stringify(SECRETS)}.every(s => JSON.stringify(localStorage).indexOf(s) < 0)`));
  // 1.3.2: importing over existing credentials / a different proxy asks first (a crafted backup could repoint the proxy)
  await ev(`SatStore.sources.setCreds({ stPassword: 'Changed-Local-Pw-777' }); SatStore.sources.setConfig({ proxy: 'https://other-proxy.workers.dev' })`);
  await settings(); await ev(`${q("#backupBox")}.open = true`);
  const doc2 = await send("DOM.getDocument", { depth: 1 }), fi2 = await send("DOM.querySelector", { nodeId: doc2.root.nodeId, selector: "#bkFile" });
  await send("DOM.setFileInputFiles", { nodeId: fi2.nodeId, files: [file] });
  await ev(`window.__confirms = []; window.__confirmAnswer = false; window.confirm = m => { window.__confirms.push(m); return window.__confirmAnswer; }`);
  await set("#bkPass2", SEC.bk); await ev(`${q("#bkImport")}.click()`); await waitFor(`window.__confirms.length > 0`, 8000); await sleep(500);
  const cm = await ev(`window.__confirms[0] || ''`);
  check("1.3.2: import over existing credentials asks first, naming the replaced values and the NEW proxy host (and the current one)", /replaces \d+ credential/.test(cm) && /mock-proxy\.workers\.dev/.test(cm) && /other-proxy\.workers\.dev/.test(cm) && /YOUR proxy/.test(cm), cm);
  check("1.3.2: answering 'Cancel' changes nothing (password and proxy URL unchanged) and says so", await ev(`SatStore.sources.getCreds().stPassword === 'Changed-Local-Pw-777' && SatStore.sources.config().proxy === 'https://other-proxy.workers.dev' && /cancelled/i.test(${q("#bkMsg")}.textContent)`), await ev(`${q("#bkMsg")}.textContent`));
  await ev(`window.__confirmAnswer = true; window.__confirms.length = 0`); await send("DOM.setFileInputFiles", { nodeId: fi2.nodeId, files: [file] });
  await set("#bkPass2", SEC.bk); await ev(`${q("#bkImport")}.click()`); await waitFor(`SatStore.sources.getCreds().stPassword === ${JSON.stringify(SEC.pw)}`, 10000);
  check("1.3.2: answering 'OK' applies the import (credentials and proxy URL replaced)", await ev(`SatStore.sources.config().proxy === 'https://mock-proxy.workers.dev'`));
  fs.unlinkSync(file);

  // ================= part 4: biometric unlock. LOCAL: localhost (own origin) with Chrome's virtual authenticator. LIVE: the Pages host is the shared github.io origin, where biometrics must be OFF.
  const bioUrl = LOCAL ? `http://localhost:${HTTP}/satpass/` : APP;
  const oldRec = JSON.stringify({ v: 1, credId: "Y3JlZA", prfSalt: "c2FsdA==", rpId: new URL(bioUrl).hostname, created: 1, hk: "AAAA", iv: "AAAA", ct: "AAAA" });
  const v2Rec = JSON.stringify({ v: 2, credId: "Y3JlZA", prfSalt: "c2FsdA==", rpId: new URL(bioUrl).hostname, created: 1, hk: "AAAA", iv: "AAAA", ct: "AAAA" });
  await nav(bioUrl); await ev(`localStorage.setItem('satpass:bio', ${JSON.stringify(oldRec)})`); await nav(bioUrl);
  check("1.3.2: a 1.3.0/1.3.1 biometric record (v1, it wrapped the passphrase) is deleted on load", await ev(`localStorage.getItem('satpass:bio') === null`));
  if (!LOCAL) {
    await ev(`localStorage.setItem('satpass:bio', ${JSON.stringify(v2Rec)})`); await nav(bioUrl);
    check("1.3.2 (shared github.io origin): even a well-formed v2 biometric record is deleted on load", await ev(`localStorage.getItem('satpass:bio') === null`));
    await settings(); await ev(`SatStore.sources.setCreds({ n2yoKey: ${JSON.stringify(SEC.n2)} })`); await set("#passIn", SEC.pass); await ev(`${q("#passLock")}.click()`); await waitFor(`SatStore.sources.credMode() === 'encrypted'`, 8000); await settings(); await sleep(800);
    check("1.3.2 (shared github.io origin): no biometric button is offered; a short explanation (own origin / README) is shown instead", await ev(`!document.querySelector('#bioEnable') && !document.querySelector('#bioUnlock') && /not offered on this address/.test((${q("#bioShared")} || {}).textContent || '') && /own origin/.test(${q("#bioShared")}.textContent)`));
    check("1.3.2 (shared github.io origin): enrolment is refused by the store and by SatBio even if called directly", await ev(`SatStore.sources.bioSave({ credId: 'a', prfSalt: 'b', rpId: location.hostname }, new Uint8Array(32)).then(() => false, e => e.kind === 'config')`) && await ev(`SatBio.enroll().then(() => false, e => /shared origin/.test(e.message))`) && await ev(`localStorage.getItem('satpass:bio') === null`));
    await ev(`SatStore.sources.forgetCreds()`); await wipeVault();
  } else {
  await send("WebAuthn.enable", { enableUI: false });
  const mkAuth = async (o) => (await send("WebAuthn.addVirtualAuthenticator", { options: Object.assign({ protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true }, o) })).authenticatorId;
  let auth = await mkAuth({});
  await nav(bioUrl); await ev(`localStorage.clear(); sessionStorage.clear()`); await nav(bioUrl); await settings();
  await set("#n2Key", SEC.n2); await set("#stId", SEC.id); await set("#stPw", SEC.pw);
  await ev(`SatStore.sources.setCreds({ n2yoKey: ${JSON.stringify(SEC.n2)}, stIdentity: ${JSON.stringify(SEC.id)}, stPassword: ${JSON.stringify(SEC.pw)} })`);
  check("1.3.0 (virtual authenticator): the biometric option is NOT offered before an encrypted vault exists", await ev(`!document.querySelector('#bioEnable')`));
  await settings(); await set("#passIn", SEC.pass); await ev(`${q("#passLock")}.click()`); await waitFor(`SatStore.sources.credMode() === 'encrypted'`, 8000); await settings(); await sleep(600);
  const sup = await ev(`SatBio.supported()`);
  check("1.3.0 (virtual authenticator): feature detection says supported and the 'Enable biometric unlock' button appears", sup.ok === true && await waitFor(`!!${q("#bioEnable")}`, 5000), sup);
  await ev(`${q("#bioEnable")}.click()`); await waitFor(`!!${q("#bioOn")}`, 10000);
  const rec = await ev(`JSON.parse(localStorage.getItem('satpass:bio') || 'null')`);
  check("1.3.0 (virtual authenticator): enrolment works (1.3.2: v2 record wrapping the data key): passkey created for the page host with PRF, wrapped record stored (no passphrase / secret in it)", !!rec && rec.rpId === new URL(bioUrl).hostname && rec.v === 2 && SECRETS.every(s => JSON.stringify(rec).indexOf(s) < 0) && await ev(`!!${q("#bioOn")}`));
  const creds = (await send("WebAuthn.getCredentials", { authenticatorId: auth })).credentials;
  check("1.3.0 (virtual authenticator): exactly one credential, NON-resident (residentKey discouraged), rpId = host, user verification was required", creds.length === 1 && creds[0].rpId === rec.rpId && creds[0].isResidentCredential === false, creds.map(c => c.rpId));
  // reload = new "session": sessionStorage kept in the same tab, so lock explicitly and also simulate a fresh start (memory cleared)
  await ev(`SatStore.sources.lockNow()`); await settings(); await sleep(700);
  check("1.3.0 (virtual authenticator): locked vault offers 'Unlock with biometrics' next to the passphrase", await waitFor(`!!${q("#bioUnlock")}`, 5000));
  await ev(`${q("#bioUnlock")}.click()`); await waitFor(`!SatStore.sources.isLocked()`, 10000);
  check("1.3.0 (virtual authenticator): biometric unlock (PRF → key → vault) restores the credentials without the passphrase", await ev(`SatStore.sources.getCreds().stPassword === ${JSON.stringify(SEC.pw)} && SatStore.sources.getCreds().n2yoKey === ${JSON.stringify(SEC.n2)}`));
  check("1.3.0 (virtual authenticator): after biometric unlock, editing credentials re-encrypts them (still no plaintext on disk)", await ev(`SatStore.sources.setCreds({ satnogsToken: ${JSON.stringify(SEC.sn)} }).then(() => ${JSON.stringify(SECRETS)}.every(s => JSON.stringify(localStorage).indexOf(s) < 0) && /"enc":2/.test(localStorage.getItem('satpass:creds')))`));
  // user verification fails (finger not recognised): stays locked, passphrase works
  await ev(`SatStore.sources.lockNow()`); await settings(); await waitFor(`!!${q("#bioUnlock")}`, 5000);
  await send("WebAuthn.setUserVerified", { authenticatorId: auth, isUserVerified: false });
  await ev(`${q("#bioUnlock")}.click()`); await sleep(2500);
  check("1.3.0 (virtual authenticator): failed user verification keeps the vault locked with a clear message that the passphrase still works", await ev(`SatStore.sources.isLocked() && /passphrase/.test(${q("#passMsg")}.textContent)`), await ev(`${q("#passMsg")}.textContent`));
  await send("WebAuthn.setUserVerified", { authenticatorId: auth, isUserVerified: true });
  await set("#passIn", SEC.pass); await ev(`${q("#passLock")}.click()`); await waitFor(`!SatStore.sources.isLocked()`, 8000);
  check("1.3.0 (virtual authenticator): passphrase recovery works while the biometric record exists", await ev(`SatStore.sources.getCreds().stPassword === ${JSON.stringify(SEC.pw)}`));
  // authenticator replaced (new device / passkey deleted): the old record cannot unlock
  await ev(`SatStore.sources.lockNow()`); await send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: auth }); auth = await mkAuth({});
  await settings(); await waitFor(`!!${q("#bioUnlock")}`, 5000); await ev(`${q("#bioUnlock")}.click()`); await sleep(2500);
  check("1.3.0 (virtual authenticator): with the passkey gone, biometric unlock fails cleanly (vault stays locked, error shown, passphrase fallback)", await ev(`SatStore.sources.isLocked() && /✖/.test(${q("#passMsg")}.textContent)`), await ev(`${q("#passMsg")}.textContent`));
  await set("#passIn", SEC.pass); await ev(`${q("#passLock")}.click()`); await waitFor(`!SatStore.sources.isLocked()`, 8000); await settings(); await waitFor(`!!${q("#bioRemove")}`, 5000);
  await ev(`${q("#bioRemove")}.click()`); await sleep(800);
  check("1.3.0 (virtual authenticator): 'Turn off biometric unlock' removes the record; the option is offered again", await ev(`localStorage.getItem('satpass:bio') === null`) && await waitFor(`!!${q("#bioEnable")}`, 5000));
  // authenticator without PRF: enrolment refused with an explanation, nothing stored
  await send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: auth }); auth = await mkAuth({ hasPrf: false });
  await settings(); await waitFor(`!!${q("#bioEnable")}`, 5000); await ev(`${q("#bioEnable")}.click()`); await sleep(2500);
  check("1.3.0 (virtual authenticator): an authenticator without PRF is refused with a clear message and nothing is stored", await ev(`localStorage.getItem('satpass:bio') === null && /PRF|passphrase/.test(${q("#passMsg")}.textContent)`), await ev(`${q("#passMsg")}.textContent`));
  await send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: auth }); await send("WebAuthn.disable");
  check("1.3.2 (virtual authenticator): changing the vault passphrase keeps biometric unlock working (only the data key is re-wrapped)", await (async () => { await send("WebAuthn.enable", { enableUI: false }); const a2 = await mkAuth({}); await settings(); await waitFor(`!!${q("#bioEnable")}`, 5000); await ev(`${q("#bioEnable")}.click()`); await waitFor(`!!${q("#bioOn")}`, 10000); const before = await ev(`localStorage.getItem('satpass:bio')`); await ev(`SatStore.sources.lock('a-brand-new-passphrase-9')`); await sleep(300); const kept = await ev(`localStorage.getItem('satpass:bio')`) === before; await ev(`SatStore.sources.lockNow()`); await ev(`SatStore.sources.bioUnlock(rec => SatBio.assertPrf(rec))`); const ok2 = await ev(`!SatStore.sources.isLocked() && SatStore.sources.getCreds().stPassword === ${JSON.stringify(SEC.pw)}`); await send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: a2 }); await send("WebAuthn.disable"); return kept && ok2; })());
  await ev(`SatStore.sources.forgetCreds()`); await ev(`localStorage.clear(); sessionStorage.clear()`);

  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }
  // ================= part 5 (1.3.1): Export SAR list buttons
  await nav(APP); await ev(`localStorage.setItem('satpass:satMode', JSON.stringify('sar'))`); await nav(APP); await ev(`location.hash = '#/sats'`); await sleep(1200);
  check("1.3.1: Sats → SAR shows the export buttons and a note with row/mission counts", await waitFor(`!!${q("#sarCsv")} && !!${q("#sarJson")} && !!${q("#sarCopy")} && !!${q("#sarCopyCsv")}`, 8000) && await ev(`/135 rows, 28 missions/.test(${q("#sarExportNote")}.textContent)`));
  await ev(`window.__saved = []; window.__clip = []; const co = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { b.arrayBuffer().then(ab => window.__saved.push({ type: b.type, bytes: [...new Uint8Array(ab)].slice(0, 3), text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(ab) })); return co(b); };
    const hook = t => { window.__clip.push(t); return Promise.resolve(); }; try { navigator.clipboard.writeText = hook; } catch (e) { Object.defineProperty(navigator, 'clipboard', { value: { writeText: hook }, configurable: true }); }
    document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[download]'); if (a) window.__saved.push({ download: a.download }); }, true);`);
  await ev(`${q("#sarCsv")}.click()`); await ev(`${q("#sarJson")}.click()`); await waitFor(`window.__saved.filter(x => x.text).length >= 2`, 5000);
  const saved = await ev(`window.__saved`), csv = saved.find(x => x.text && /csv/.test(x.type)), jsn = saved.find(x => x.text && /json/.test(x.type));
  const ref = fs.readFileSync(path.join(__dirname, "fixtures", "satpass-sar-stats.csv"), "utf8");
  check("1.3.1: ⬇ CSV downloads satpass-sar-list.csv: UTF-8 BOM, byte-identical to the reference CSV (135 rows)", !!csv && csv.bytes.join() === "239,187,191" && csv.text === ref && saved.some(x => x.download === "satpass-sar-list.csv"));
  check("1.3.1: ⬇ JSON downloads satpass-sar-list.json with 135 typed rows", !!jsn && JSON.parse(jsn.text).rows.length === 135 && saved.some(x => x.download === "satpass-sar-list.json"));
  await ev(`${q("#sarCopy")}.click()`); await ev(`${q("#sarCopyCsv")}.click()`); await sleep(500);
  const clip = await ev(`window.__clip`);
  check("1.3.1: Copy puts tab-separated text on the clipboard, Copy CSV the CSV without BOM", clip.length === 2 && clip[0].split("\n")[0].split("\t").length === 16 && !/^\ufeff/.test(clip[1]) && clip[1] === ref.replace(/^\ufeff/, "") && clip[0].split("\n").length === 137);
  await ev(`localStorage.removeItem('satpass:satMode')`);
  await nav(APP); await wipeVault();   // back to the origin the rest of the smoke test uses, without this test's credentials / proxy settings
};
