# SatPass proxy (optional, you deploy it)

Space-Track, SatNOGS DB and N2YO **do not send CORS headers**, so a browser page (SatPass is a static PWA with no backend) cannot read their
responses (verified from the real `https://theriotcoder.github.io` origin with headless Chrome, October 2026; see the repository README).
Only CelesTrak can be called directly. This tiny Cloudflare Worker is the smallest honest fix: it makes the few fixed requests SatPass needs
and adds CORS headers **for your SatPass origin only**.

* It is **not** an open proxy: only the routes below exist, arguments are validated, and only origins in `ALLOWED_ORIGINS` get CORS headers.
* Nothing is logged and no secret is ever put in a response. Internal errors never echo request data.
* It is **yours**: deploy it to your own free Cloudflare account. Do not use somebody else's proxy – it would see your credentials.
* Free-plan Workers have a ~10 ms CPU budget per request. Typical requests are fine; the big SatNOGS TLE list (≈540 KB) is cached for an hour,
  and if Cloudflare ever reports "exceeded CPU" for it, use the Workers Paid plan ($5/month) or just don't enable SatNOGS TLE (CelesTrak/Space-Track are the better element sources; SatNOGS adds transmitters).

## Routes

| Route | Upstream | Cached |
| --- | --- | --- |
| `GET /health` | – | no (but see the Origin rule below) |
| `GET /spacetrack/gp?ids=25544,43017` | login + `basicspacedata/query/class/gp/NORAD_CAT_ID/…/format/json` | 1 h |
| `GET /satnogs/tle?ids=…` | `db.satnogs.org/api/tle/` (bulk, filtered here) | 1 h |
| `GET /satnogs/transmitters?ids=…` | `db.satnogs.org/api/transmitters/?satellite__norad_cat_id=…` (≤30 ids) | 6 h |
| `GET /n2yo/tle?id=25544` | `api.n2yo.com/rest/v1/satellite/tle/{id}` | 1 h |
| `GET /n2yo/radiopasses?id&lat&lng&alt&days&minEl` | `…/radiopasses/…` | 30 min |

## Deploy (about 5 minutes)

1. Create a free account at <https://dash.cloudflare.com/sign-up> (this is *your* account; SatPass never sees it).
2. `cd proxy && npx wrangler login && npx wrangler deploy` (needs Node 18+). Note the printed URL, e.g. `https://satpass-proxy.yourname.workers.dev`.
3. `ALLOWED_ORIGINS` in `wrangler.toml` lists the SatPass origins that may call the proxy (exact origins, comma separated): the shipped value is `https://satpass-3wj.pages.dev` (primary) and `https://theriotcoder.github.io` (deprecated mirror). If you host SatPass somewhere else, add that origin first; if you deployed an older version, redeploy after pulling this change.
4. In SatPass → Setup → **Data sources**, paste the URL into *Proxy URL* and press **Test connection** on any source (it checks `/health` first).

### Recommended: keep your credentials on the Worker, not in the browser

```sh
npx wrangler secret put PROXY_TOKEN     # any long random string – SatPass sends it as X-SatPass-Proxy-Token
npx wrangler secret put ST_IDENTITY     # Space-Track user name (e-mail)
npx wrangler secret put ST_PASSWORD
npx wrangler secret put SATNOGS_TOKEN   # optional, raises the SatNOGS limit from 60/h to 240/h
npx wrangler secret put N2YO_KEY
```

Then in SatPass enter only the **proxy URL and proxy access token**; leave the credential fields empty. The Worker uses secrets **only** for
requests that carry the right `PROXY_TOKEN`, and refuses to serve at all if it holds secrets but no `PROXY_TOKEN`.

### Alternative: credentials in the browser

Leave the secrets unset and type your credentials into SatPass. They are kept in that browser's localStorage (optionally passphrase-encrypted),
sent to *your* Worker in request headers over HTTPS, forwarded to the matching service and discarded. The Worker does not store them.

## Where to get credentials

* **Space-Track**: free account at <https://www.space-track.org/auth/createAccount> (accept the user agreement – the data is for your own use and may not be redistributed). Use your e-mail as user name.
* **SatNOGS**: optional token. Sign in at <https://db.satnogs.org>, click your avatar → *Settings* → *API Token*.
* **N2YO**: register at <https://www.n2yo.com/login/>, then your profile page → *Generate API key*.

## Local test

`npx wrangler dev` serves on `http://localhost:8787`; SatPass accepts `http://localhost:*` proxies (set `ALLOWED_ORIGINS` to `http://localhost:8000` or wherever you serve SatPass).


## Origin rule (1.2.1)

Browsers always send an `Origin` header on cross-origin requests, so SatPass is unaffected. A request **without** `Origin` (curl, scripts, server-side callers) is refused with 403 unless it carries the correct `X-SatPass-Proxy-Token`: `curl -H 'X-SatPass-Proxy-Token: …' https://<worker>/health`. Cache keys for Space-Track (identity + password) and SatNOGS (token) include a hash of the secret, so a wrong password or token is never answered from another user's cached data.
