# pineconegp-contact Worker

Receives the investor access form on `https://pineconegp.com/investor-access` (POST JSON to `/api/contact`) and emails it to `admin@pineconegp.com`.

- Accepts `POST` with `Content-Type: application/json` only from Origin `https://pineconegp.com` or `https://www.pineconegp.com` (others get 403).
- Honeypot field `company`: if filled, returns `{ok:true}` and sends nothing.
- Validates name (2+ chars), email, and phone (10+ digits). Returns 400 with `fields` on failure.
- Cleans every value (CR/LF and control characters stripped from single-line fields, length caps: name 120, email 200, phone 40, message 1000). Tap answers must match the known options or are recorded as `(invalid)`.
- Sends a plain-text email: From `forms@mail.pineconegp.com`, Reply-To the visitor, Subject `Investor access request: <name>`, with every answer, the message, and a timestamp (Mountain Time and UTC).
- Returns `{ok:true}` (200) on success, 502 if sending fails. The page shows an error on any non-2xx.

Source lives in `infra/pinecone-form-worker/`. GitHub Pages publishes the whole repo (there is a `.nojekyll`), so the Worker also owns `pineconegp.com/infra/*` and `www.pineconegp.com/infra/*` and answers 404 there, which keeps this folder off the public site.

Deployed: 2026-10-28. Email Routing is enabled for the subdomain `mail.pineconegp.com` only (Cloudflare MX route1/2/3.mx.cloudflare.net on `mail.`, SPF TXT on `mail.`, DKIM `cf2024-1._domainkey.pineconegp.com`). Cloudflare sends with an SRS return path on the apex, so the apex SPF includes `_spf.mx.cloudflare.net` next to Google: `v=spf1 include:_spf.google.com include:_spf.mx.cloudflare.net ~all`.

## Deploy prerequisites (one time)

1. **Email Routing on the subdomain `mail.pineconegp.com` only.** In Cloudflare dashboard > pineconegp.com > Email > Email Routing, enable it for the subdomain `mail.pineconegp.com` (Settings > Subdomains > add `mail`). Do **not** enable Email Routing on the apex `pineconegp.com`: that would replace the existing MX records and break the current admin@pineconegp.com mailbox. Cloudflare adds MX/SPF/DKIM records for `mail.pineconegp.com` only.
2. **Verify the destination.** Email Routing > Destination addresses > add `admin@pineconegp.com` and click the verification link sent to that inbox. The `send_email` binding can only send to verified destination addresses.
3. **API token** (for whoever deploys, if not using `wrangler login`): create a token scoped to the pineconegp.com account/zone with
   - Account > Workers Scripts: Edit
   - Zone > Workers Routes: Edit (zone pineconegp.com)
   - Account > Account Settings: Read
   - (Email Routing itself is set up in the dashboard; the token does not need Email permissions.)
   Keep the token in your shell environment (`CLOUDFLARE_API_TOKEN`), never in this repo.
4. Node.js 18+ installed.

## Deploy

From the repo root:

```sh
cd infra/pinecone-form-worker
npx wrangler deploy
```

This creates the `pineconegp-contact` Worker with routes `pineconegp.com/api/contact` and `www.pineconegp.com/api/contact` and the `SEND_EMAIL` binding from `wrangler.toml`.

## Test after deploy

```sh
curl -i https://pineconegp.com/api/contact \
  -H 'Origin: https://pineconegp.com' -H 'Content-Type: application/json' \
  -d '{"name":"Test Person","email":"test@example.com","phone":"801 555 0100","accredited":"Yes","us_person":"Yes","investor_type":"Individual","heard_from":"Other","interest":"Income","message":"Test, please ignore","company":"","page":"curl"}'
```

Expect `200 {"ok":true}` and an email in admin@pineconegp.com. Then submit the real form once, and merge the `new-access-form` branch to `main`.

Logs: `npx wrangler tail pineconegp-contact`.
