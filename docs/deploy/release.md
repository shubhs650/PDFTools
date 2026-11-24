# Releasing Triya PDF — owner setup and steps

Triya PDF runs on two Cloudflare Workers (ADR-029, D-28):

| Worker      | Where                                                       | Deployed by                                                          | From                          |
| ----------- | ----------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------- |
| `pdftools`  | `pdftools.shubhampatil650.workers.dev` (beta, staging)      | Cloudflare Workers Builds (unchanged)                                | every push to `main`          |
| `triya-pdf` | **`app.triyapdf.com`** and **`triya-pdf.openengtools.com`** | GitHub Actions, [`release.yml`](../../.github/workflows/release.yml) | a version tag, after approval |

Both release domains serve the same app. Each is its own origin, so an installed app, settings,
recent files and recovery data are kept per domain.

`wrangler.jsonc` describes both: the top level is `pdftools`, `env.production` is `triya-pdf`
with the two Custom Domains. wrangler is not a dependency (ADR-003); the workflow runs a pinned
version with `npx`.

## One-time setup

Do these once, before the first tag. Steps 1–3 are in the Cloudflare dashboard, 4–5 on GitHub.

1. **Both zones in the same account.** `openengtools.com` and `triyapdf.com` must be active
   zones in the Cloudflare account that holds the `pdftools` Worker. If either host already has
   a DNS record (for example an old `triya-pdf` CNAME), delete it: a Custom Domain creates its
   own record and certificate and refuses a hostname that already has one.

2. **An API token for GitHub.** My Profile → API Tokens → Create Token → template **Edit
   Cloudflare Workers** → Use template.
   - Account Resources: your account only.
   - Zone Resources: **Specific zone** → `triyapdf.com`, and add `openengtools.com` (the token
     needs Workers Routes on both zones for the Custom Domains).
   - Continue → Create Token, and copy it (it is shown once).
   - Also copy your **Account ID** (Workers & Pages → Overview, right column).

3. **Keep Cloudflare from injecting scripts** on both hosts (they would break the CSP and the
   no-network rule 4). For each zone (`triyapdf.com`, `openengtools.com`):
   - Rocket Loader: **off**. Zaraz: **off**. Scrape Shield → Email Address Obfuscation: **off**.
   - Web Analytics: no automatic setup for these hosts.
   - Security: no JavaScript or managed challenge on the two hosts (Bot Fight Mode injects one).
   - SSL/TLS → Edge Certificates → **Always Use HTTPS: on**.

4. **The `production` environment with your approval.** GitHub → the repository → Settings →
   Environments → **New environment** → name `production` → Configure:
   - **Required reviewers:** add yourself (`shubhs650`). Leave "Prevent self-review" off, since
     you push the tags yourself.
   - **Deployment branches and tags:** Selected branches and tags → Add rule → **Tag** → `v*`.
   - **Environment secrets:** add `CLOUDFLARE_API_TOKEN` (the token from step 2) and
     `CLOUDFLARE_ACCOUNT_ID` (the Account ID). As environment secrets they are only readable by a
     job you approved.

5. **Optional:** on the repository's main page → About (gear icon), set the website to
   `https://app.triyapdf.com`, a description and topics (`pdf`, `pdf-editor`, `pwa`, `offline`,
   `engineering`).

## Releasing a version

1. In a PR: set `version` in `package.json` (and `npm install` to update `package-lock.json`),
   add the release at the top of `src/i18n/whatsnew.en.json` (id `vX.Y.Z`), and add
   `docs/release-notes/vX.Y.Z.md`. Merge it with green CI. The beta updates from `main`; try it
   there first.
2. Tag the merge commit on `main`, either way:
   - GitHub → Releases → **Draft a new release** → Choose a tag → type `v1.0.0` → **Create new
     tag on publish**, target `main` → title and notes (or leave them; the workflow then keeps
     what you wrote) → **Publish release**; or
   - `git tag v1.0.0 <commit> && git push origin v1.0.0`.
3. GitHub → Actions → **Release**: the build job checks the tag (format, `package.json`
   version, on `main`, release notes present) and runs typecheck, lint, format, unit tests,
   licenses, build and the dist checks. The deploy job then **waits for your approval**: open the
   run → **Review deployments** → `production` → **Approve and deploy**.
4. The deploy job uploads the Worker, checks that both domains answer with the app and its
   security headers (it waits up to ~10 minutes for a new certificate and warns if not), and
   creates the GitHub Release from `docs/release-notes/vX.Y.Z.md` if there isn't one yet.

The workflow refuses a tag that does not match `package.json`, a commit that is not on `main`,
and a version without release notes.

**Features in preview.** A build with `VITE_COMPARE=off` leaves out every command marked
`preview` in `src/app/commands.ts` (the Compare ribbon tab and Compare with…) and Help's Compare
chapter. Release builds set it until 1.0.0; from 1.1.0 (M13-09) they no longer do, so Compare
ships. The switch stays for a future preview feature.

## Checking a release

On each domain:

- The app loads, a PDF opens; File › About shows the version and commit.
- DevTools → Network: only same-origin requests. Console: no CSP errors.
  `self.crossOriginIsolated` is `true`.
- Application → Service workers: `sw.js` activated; with the network set to Offline the app
  still opens after a reload.
- Response headers of `/` include `Content-Security-Policy`, `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Embedder-Policy` (from `dist/_headers`).

## Rolling back

- **Quickest:** Cloudflare → Workers & Pages → `triya-pdf` → Deployments → choose the previous
  version → **Rollback**. Takes effect in seconds.
- **From a tag:** GitHub → Actions → Release → **Run workflow** → `tag` = the older tag (for
  example `v1.0.0`) → approve. This rebuilds and deploys that tag.

Installed apps pick up the rolled-back version on their next update check, as with any update.

## Error reports

`/api/report` is served by both Workers but stores nothing until its bindings exist
([error-report.md](error-report.md)). Bindings are not inherited by `env.production`: when you
switch reports on, add the same D1, email and vars to `env.production` in `wrangler.jsonc`, and
set `REPORT_SALT` with `npx wrangler secret put REPORT_SALT --env production`.
