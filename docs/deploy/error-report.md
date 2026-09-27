# Error-report endpoint — owner setup (M2-18)

`POST /api/report` is a Cloudflare Pages Function ([`functions/api/report.ts`](../../functions/api/report.ts))
that receives the error reports users choose to send from Help → Send Error Report (D-22,
ARCHITECTURE §10.2). It validates the report against the app's schema
([`src/model/report.ts`](../../src/model/report.ts)), rate-limits it (5 per IP per hour), stores it in
a D1 database and sends you a short notification e-mail. It makes no third-party calls, and the
app's CSP needs no change (the endpoint is same-origin).

The agent wrote and unit-tested the function (`tests/functions/report.test.ts`, with in-memory
stand-ins for D1 and the mail binding). The Cloudflare side is yours (M2-Q5): `wrangler` is not
used in this repo (LGPL, ADR-003), so every step below is in the Cloudflare dashboard.

## What is stored

- Table `reports`: an id, the time received, app version, browser and OS families, feature, error
  code, the random session id, and the full JSON exactly as the user saw it. **No IP address.**
- Table `report_rate`: a salted SHA-256 of the sender's IP and a timestamp, deleted after one hour.
- The e-mail holds the report id, app version, error code, feature, browser and OS — not the
  description or the stack. Read those in D1.

## Steps

1. **Pages project** (if not done yet; PROGRESS "Decisions needed" 2): Workers & Pages → Create →
   Pages → connect the GitHub repository. Build command `npm run build`, output directory
   `dist`, environment variable `NODE_VERSION` = `22`. The `functions/` folder at the repository
   root is picked up automatically; `/api/report` is its only route.
2. **D1 database:** Storage & Databases → D1 → Create, e.g. `pdftools-reports`. Open it →
   Console, paste [`functions/api/schema.sql`](../../functions/api/schema.sql) and run it.
3. **Bind D1 to the project:** the Pages project → Settings → Bindings → Add → D1 database.
   Variable name **`REPORT_DB`**, the database from step 2. Add it for Production and for Preview.
4. **Salt secret:** Settings → Variables and Secrets → Add → type Secret, name **`REPORT_SALT`**,
   value a long random string (e.g. the output of `openssl rand -hex 32`). Production and Preview.
5. **E-mail notification (optional but recommended):**
   1. Enable **Email Routing** on the domain (`openengtools.com`) and add your address as a
      **verified destination address**.
   2. Add variables **`REPORT_MAIL_FROM`** (a sender address on that domain, e.g.
      `reports@openengtools.com`) and **`REPORT_MAIL_TO`** (the verified address).
   3. Add a **Send email** binding named **`REPORT_MAIL`** restricted to that destination address.
      If the dashboard offers no Send email binding for Pages projects, leave `REPORT_MAIL`
      unset: reports are still stored and you check D1 instead (the function skips the e-mail
      when the binding is missing). Tell the agent, and it can move the e-mail into a small
      separate Worker called through a Service binding.
6. **Redeploy** the project so the bindings take effect (Deployments → the latest → Retry
   deployment, or push a commit).
7. **Live check on the preview** (owner pack, M2-19): open the preview URL, Help → Send Error
   Report, type a description, check the JSON shown, press Send → "Thank you. The report was
   sent." Then D1 → Console: `SELECT id, received_at, app, error_code FROM reports ORDER BY
received_at DESC LIMIT 5;` shows it, and the e-mail arrives. Sending six reports within an hour
   from one connection gives "Too many reports…" on the sixth.

## Housekeeping

- Delete old reports whenever you like, e.g. older than 180 days:
  `DELETE FROM reports WHERE received_at < (strftime('%s','now') - 180*86400) * 1000;`
- Changing `REPORT_SALT` resets the rate limiter; nothing else depends on it.

## Responses (for reference)

| Status | When                                                                  |
| ------ | --------------------------------------------------------------------- |
| 204    | Stored (the e-mail may still fail; the report is kept).               |
| 400    | Not JSON, or not exactly the report schema (extra or missing fields). |
| 403    | A browser POST from another origin.                                   |
| 405    | Anything but POST.                                                    |
| 413    | Body over 16 KB.                                                      |
| 415    | Not `application/json`.                                               |
| 429    | More than 5 reports from one IP within an hour (`Retry-After: 3600`). |
| 500    | D1 unavailable or misconfigured (no details in the response).         |

Responses never echo the input and are never cached.
