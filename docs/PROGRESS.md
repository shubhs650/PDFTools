# PDFTools — Progress

_Last updated: 2026-09-24 (session 2: S8 and S3)_

**Current milestone:** M0 — Spikes (plan: [docs/plan/M0.md](plan/M0.md))

## Done

- **Session 1 — spec review.** Reviewed ARCHITECTURE.md, CLAUDE.md and the UI reference images.
  Raised 16 items (B1–B16) and got owner answers, recorded in
  [ADR-001](adr/001-session-1-clarifications.md).
- **Session 1 — scaffold** (D-11, D-12):
  - Vite 8 + React 19 + TypeScript 6 (strict, `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes`); an empty app shell with no features.
  - The folder layout from ARCHITECTURE.md §3.3, plus `/scripts`.
  - ESLint 9 with typescript-eslint strict-type-checked, react-hooks, **jsx-a11y strict**
    (CLAUDE.md rule 12) and `i18next/no-literal-string` for JSX (rule 11). Prettier.
  - Vitest unit tests (`tests/`) and a Playwright smoke e2e (`e2e/`) that asserts zero
    cross-origin requests.
  - The license gate `npm run licenses`:
    - it walks every installed package, parses SPDX expressions, and fails on copyleft or unknown
      licenses;
    - MPL-2.0 is allowed only for packages npm marks dev-only in the lockfile (ADR-002);
    - OFL-1.1 is allowed for fonts;
    - the policy has 52 unit tests;
    - fake runtime packages licensed GPL-3.0 and MPL-2.0 both fail the gate.
  - GitHub Actions CI: typecheck, lint, format, unit tests, license gate, build, and Playwright e2e.
- **Session 1 — docs:**
  - [ADR template](adr/000-template.md);
  - [ADR-001](adr/001-session-1-clarifications.md) and
    [ADR-002](adr/002-license-policy-and-heavy-file-targets.md);
  - the [M0 plan](plan/M0.md) with S1–S8, including an EmbedPDF v2.15.1 capability snapshot;
  - **ARCHITECTURE.md Rev 0.1**, with ADR-001 and ADR-002 applied;
  - CLAUDE.md rule 5 now points to the allowlist in `scripts/license-policy.ts`.
- **Session 2 — M0-S8 (CSP, WASM, workers, service worker).** _Works with workaround._ See
  [ADR-003](adr/003-s8-csp-wasm-workers-sw.md).
  - The §10.1 CSP works **unchanged** with EmbedPDF's `blob:` worker engine, WASM and a
    vite-plugin-pwa service worker. Result: 0 violations and 0 third-party requests, and an
    offline reload works.
  - EmbedPDF falls back to jsDelivr fonts whenever `fontFallback` is `undefined`. A negative-control
    test shows that the CSP blocks this. The engine must always get `null` or a local config with
    absolute URLs.
  - `wrangler` was dropped because it pulls in LGPL `sharp`/libvips. `spikes/shared/serve.ts`
    applies `_headers` like Pages does.
- **Session 2 — M0-S3 (two engines in two workers).** _Works with workaround._ See
  [ADR-004](adr/004-s3-two-engines.md).
  - The Render and Work PDFium instances run concurrently. The Work job adds about 5–9 % to tile
    p50/p95. No main-thread long tasks. Extraction runs at ~200 pages/s and cancels in 3–9 ms.
  - WASM memory never shrinks: the Work worker reached 129 MB after one full-text pass. Respawning
    the worker returns it to 18.6 MB.
  - Queued renders can be cancelled; in-flight EmbedPDF renders cannot. Direct PDFium progressive
    rendering works in our own worker and cancels in < 0.1 ms, but its slices run 37–45 ms.
  - Recommendation: host EmbedPDF's `PdfiumNative` in our own Render worker module (the "hosted"
    variant) so that direct PDFium calls are available (ADR-001 B14, needed by S1).
- **Session 2 — tooling:**
  - `spikes/` with a shared `_headers` server, fixture writer and probes;
  - `npm run spikes`, `npm run typecheck:spikes` and `npm run corpus`;
  - `corpus/manifest.json`, listing the FAR;
  - spikes are now covered by ESLint.
  - Dependencies added: `@embedpdf/engines`, `@embedpdf/pdfium`, `@embedpdf/models` 2.15.1
    (runtime), and `vite-plugin-pwa` 1.3.0, `workbox-window` and `workbox-build` (dev). The license
    gate passes (521 packages).

## In progress

- M0: S8 and S3 have finished the agent part. The owner checks listed under Next are pending.

## Session log

- **Session 2 (2026-09-24):** S8 → S3 as planned. Branch `claude/bold-galileo-1jyn9y`, based on
  PR #1's branch because PR #1 is not merged yet. Local checks all pass: typecheck (app and
  spikes), lint, format, 52 unit tests, license gate, app e2e smoke, and 8/8 spike Playwright
  tests.

- **Session 1 (2026-09-24):** Spec review, scaffold, and M0 docs. Commits: `b0bb839` (scaffold),
  `82956ef` (docs), `8806dc8` (PROGRESS).
- **Session 1 follow-up (2026-09-24):** Applied the owner's decisions.
  - `99e12db`: license gate treats MPL as dev-only and allows OFL; moved to Vite 8; added jsx-a11y.
  - `87e0885`: ADR-002, ARCHITECTURE.md Rev 0.1, CLAUDE.md rule 5.
  - The M0, corpus and PROGRESS updates are in the follow-up commit.
  - Local checks all pass: typecheck, lint, format, 52 unit tests, license gate (307 packages,
    3 dev-only MPL), build, and Playwright smoke.

## Next

1. **Owner:** review and decide ADR-003 decisions 3–5 and ADR-004 decisions 2–6:
   - fallback fonts (Regular only; CJK non-core);
   - Pages emulation without `wrangler`;
   - the hosted Render worker;
   - the render-cancellation and memory policies;
   - optional COOP/COEP.
2. **Owner runs** (ADR-004 "Owner runs"): the FAR (`npm run corpus` on a machine that can reach
   acquisition.gov), the 500 MB contract and a dense A0 drawing through the S3 harness. Also the
   S8 Firefox smoke check and the Cloudflare Pages preview checks once a project exists.
3. **Agent:** continue M0 with **S1** (incremental save) on the hosted Render worker, then S5 → S2 →
   S7 → S4 → S6.
4. Get [PR #1](https://github.com/shubhs650/PDFTools/pull/1) merged. This branch builds on it.

## Open issues

- **Committed corpus PDFs vs ADR-002.** Commit `cd52644` added six PDFs directly to `corpus/`,
  including CAD drawings. ADR-002 says drawings stay local and are never committed, and
  `.gitignore` excludes `*.pdf`, so these were force-added. S3 uses `bearing catalogue.pdf` and
  `PRESSURE-VESSEL-SAMPLE.pdf` from there. The owner needs to decide (see "Decisions needed").
- **FAR not fetchable from the cloud container.** The environment's network policy denies
  `www.acquisition.gov` (HTTP 403 from the proxy). To allow it, add that host under the
  environment's Network access settings; otherwise run `npm run corpus` locally.
- **In-flight EmbedPDF renders cannot be cancelled** (ADR-004). This needs the small-tiles and
  progressive-rendering policy; see CLAUDE.md rule 2.
- **Font install budget.** All weights of the `@embedpdf/fonts-*` packages come to ~122 MB against a
  60 MB budget. Regular weights only come to ~24 MB (ADR-003).

- **EmbedPDF defaults use jsDelivr.** S8 resolved this: the spikes self-host the WASM file and
  fonts, and the CSP blocks the default (ADR-003). M1 must keep `fontFallback` explicit.
- **EmbedPDF has no incremental-save option in its engine API.** S1 will call `FPDF_SaveAsCopy`
  with the incremental flag directly (ADR-001 B14).
- **EmbedPDF has no measurement annotation tool or Measure fields.** S2 decides the writing
  route, and how measurement labels render without custom appearance streams (ADR-001 B7).
- **Playwright and the container's Chromium differ in version.** In the cloud container, run e2e
  with `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`. CI installs the matching browser.
- **ESLint 9 is marked end-of-support upstream.** ESLint 10 is blocked until
  `eslint-plugin-jsx-a11y` supports it.
- **The container's network policy blocks the owner's drawing hosts** and the EmbedPDF docs site.
  Drawings are supplied locally by the owner anyway (ADR-002).

## Decisions needed (owner)

1. **ADR-003 and ADR-004 proposals** (see Next, item 1).
2. **Committed corpus PDFs.** Either confirm that all six files in `corpus/` are public domain and
   may stay in git, and amend ADR-002 to say so, or move them to the git-ignored `corpus/files/`
   (drawings to `corpus/files/drawings/`) and remove them from history. The S3 spec skips if they
   are missing.
3. **Cloudflare Pages project for S8.** Until one exists, S8 runs locally with
   `spikes/shared/serve.ts`, because `wrangler` is blocked by LGPL (ADR-003). The analytics and
   injection checks wait for the project.
4. **More test drawings (optional).** Item 5 in the drawing list was blank. Add more whenever you
   like; they stay local only.

## Decisions log

| Date       | Ref      | Decision                                                                                                                                                                                                                                                |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-24 | ADR-001  | Session-1 clarifications B1–B16. Key ones: server-side analytics only; broader permissive allowlist; location-based redaction verification; EmbedPDF annotation and redaction sets; OPFS original + tail recovery; public-domain corpus only.           |
| 2026-09-24 | scaffold | Vite 7 instead of 8, and no jsx-a11y, because of MPL-2.0 dependencies. Superseded by ADR-002.                                                                                                                                                           |
| 2026-09-24 | ADR-002  | MPL-2.0 allowed for dev-only tooling only (lockfile `dev` flag). OFL-1.1 allowed for fonts. Heavy files are measure and report for Rev 0. Test drawings are owner-supplied local files, with no URLs in the repo. Moved to Vite 8 and enabled jsx-a11y. |
| 2026-09-24 | Rev 0.1  | ARCHITECTURE.md amended per ADR-001 and ADR-002 (owner-approved).                                                                                                                                                                                       |
| 2026-09-24 | ADR-003  | S8 proposal: CSP unchanged; `fontFallback` always explicit; Regular-weight fallback fonts, CJK non-core; local `_headers` server instead of `wrangler` (LGPL). Awaiting owner.                                                                          |
| 2026-09-24 | ADR-004  | S3 proposal: hosted Render worker (our module + EmbedPDF `PdfiumNative`/`PdfEngine`); small tiles + queue abort + direct progressive render; respawn-based memory policy; optional COOP/COEP. Awaiting owner.                                           |
