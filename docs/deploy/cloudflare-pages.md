# Deploying to Cloudflare Pages — owner setup

PDFTools is a static single-page PWA (D-11) served by Cloudflare Pages at
`pdf-tools.openengtools.com`, with one Pages Function, `POST /api/report` (D-22). Pages builds
the site from this GitHub repository: every push to `main` deploys production, every other
branch gets a preview URL. `wrangler` is not used (ADR-003), so everything below is in the
Cloudflare dashboard.

## What the repository already provides

| Piece                                        | Where                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Build (`tsc -b && vite build` → `dist/`)     | `npm run build`                                                                                          |
| Response headers (CSP §10.1, COOP/COEP)      | [`public/_headers`](../../public/_headers), copied to `dist/_headers`                                    |
| Service worker, manifest, icons, fonts, WASM | `dist/sw.js`, `dist/manifest.webmanifest`, `dist/icons`, `dist/fonts`, `dist/assets` (all same-origin)   |
| Error-report endpoint                        | [`functions/api/report.ts`](../../functions/api/report.ts) — setup in [error-report.md](error-report.md) |
| SPA fallback                                 | No `404.html`, so Pages serves `index.html` for unknown paths                                            |
| Build version in File → About                | `package.json` version + commit (git, else `CF_PAGES_COMMIT_SHA`)                                        |
| Pre-deploy check                             | `npm run check:pages` (CI): file count and size limits, root files, `_headers` rules and CSP             |

Largest file: PDF Oxide's WASM, ~17.6 MB (Pages limit 25 MiB per file); about 35 files in all.

## Steps

1. **Create the project.** Workers & Pages → Create → Pages → **Connect to Git** → choose
   `shubhs650/PDFTools`.
   - Project name: `pdftools` (gives `pdftools.pages.dev`).
   - Production branch: **`main`**.
   - Framework preset: **None**.
   - Build command: **`npm run build`**.
   - Build output directory: **`dist`**.
   - Root directory: leave empty (the repository root, so `functions/` is found).
   - Environment variables (Production and Preview): **`NODE_VERSION`** = **`22.22.0`** (any
     22.x ≥ 22.18; the repository's `.nvmrc` says `22`).

   Pages runs `npm ci` itself from `package-lock.json`; no other build settings are needed.
   The first build takes a few minutes.

2. **Check the first deployment** on its `*.pdftools.pages.dev` URL:
   - The app loads, a PDF opens, and DevTools → Network shows only same-origin requests.
   - DevTools → Console shows no CSP errors; `self.crossOriginIsolated` is `true`.
   - Application → Service workers shows `sw.js` activated; reload with the network set to
     Offline and the app still opens.
   - Response headers of `/` include the `Content-Security-Policy`, `Cross-Origin-Opener-Policy`
     and `Cross-Origin-Embedder-Policy` from `_headers`.

3. **Custom domain.** The project → Custom domains → Set up a custom domain →
   `pdf-tools.openengtools.com`. With `openengtools.com` on Cloudflare DNS the CNAME is added for
   you; otherwise add `pdf-tools CNAME pdftools.pages.dev` at your DNS provider. The certificate
   is issued automatically.

4. **Keep Cloudflare from injecting scripts** (they would break the CSP and rule 4). On the
   `openengtools.com` zone, for this host:
   - Web Analytics: **automatic setup off** (server-side request analytics stay, ADR-001 B1).
   - Rocket Loader: off. Zaraz: off. Scrape Shield → Email Address Obfuscation: off.
   - Security: no JavaScript or managed challenge on `pdf-tools.openengtools.com` (Bot Fight
     Mode challenges inject a script).
   - SSL/TLS → Edge Certificates → **Always Use HTTPS: on**.

5. **Error reports (optional at first).** Follow [error-report.md](error-report.md) steps 2–7 to
   create the D1 database, bindings and secret. Until then the app works fully; only Help → Send
   Error Report answers with an error.

6. **Previews (optional).** Preview deployments are public by default. To keep them private,
   the project → Settings → General → Access policy → enable Cloudflare Access for previews.

## Releasing

- Merge to `main` → Pages builds and deploys production. Users get the update prompt from the
  service worker (D-17, D-18); nothing updates without their click.
- Roll back: the project → Deployments → an earlier production deployment → **Rollback**.
- Before merging, CI already runs typecheck, lint, unit, licence, build, `check:dist`,
  `check:pages`, e2e, offline, accessibility and perf gates.

## Troubleshooting

| Symptom                                           | Cause / fix                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Build fails at `npm ci` or with a Node error      | `NODE_VERSION` not set to 22.x (step 1).                                                       |
| "File too large" at upload                        | An asset over 25 MiB; `npm run check:pages` catches this in CI.                                |
| Blank page, CSP errors naming a Cloudflare script | An injected script (step 4).                                                                   |
| `crossOriginIsolated` is `false`                  | `_headers` not applied: the output directory must be `dist` so `dist/_headers` is at the root. |
| `/api/report` returns 500                         | D1 binding `REPORT_DB` or secret `REPORT_SALT` missing, or no redeploy after adding them.      |
