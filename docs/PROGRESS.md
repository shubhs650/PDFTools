# PDFTools — Progress

_Last updated: 2026-09-24 (session 4: S5)_

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
- **Session 4 — M0-S5 (search in the Work worker while scrolling).** _Works with workaround._ See
  [ADR-006](adr/006-s5-search-work-worker.md).
  - Design: the Work worker extracts text with raw `FPDFText_*` into a session cache, then:
    - matches with JS `RegExp` (case, whole word, wildcards, regex);
    - searches in viewport order;
    - streams batches no more often than every 50 ms;
    - cancels between pages.
  - Results on a self-made 2,000-page contract stand-in, with continuous auto-scroll:
    - Enter-only is verified: typing never searches;
    - cold search: first hit **53–71 ms**, done **4.0–5.6 s**;
    - a new query cancels the old one in **19–21 ms**, with 0 stale results;
    - **0 main-thread long tasks**;
    - warm index: 6–110 ms.
  - Needed mitigations:
    - stream at most **5,000 hits with context** and counts beyond that. Without the cap, a
      910k-hit regex caused 66–68 ms long tasks and 150 ms frames;
    - **background indexing after open**, so rare terms far from the viewport also get first hits
      in under 1 s (≈1.8 s cold otherwise).
  - EmbedPDF `plugin-search` runs in the **Render engine**, in 25-page uninterruptible chunks, and
    doubles tile p50/p95. It is not used, which confirms D-10.
  - Real text (the 1,152-page catalogue): first hit 55 ms, done 5.6 s, 0 long tasks.
- **Session 3 — M0-S1 (incremental save + full rewrite).** _Works with workaround._ See
  [ADR-005](adr/005-s1-incremental-save.md).
  - EmbedPDF's `saveAsCopy()` is a **full rewrite**, and it copies bytes out one at a time (1.1 s
    for 23 MB). A direct `FPDF_SaveAsCopy(doc, writer, flags)` through our own `FPDF_FILEWRITE`
    works in both modes. It needs EmbedPDF's private document pointer.
  - PDFium's incremental save keeps the original prefix, signatures and encryption, but it:
    - appends **every loaded object**: +22 MB on a 23 MB file for one annotation;
    - **damages files with xref streams**;
    - replaces the permanent `/ID`.
  - Proposed fix, the **narrow tail**: keep PDFium's object serialization, append only changed
    objects, and write our own xref and trailer in the original's form.
    - Result: a 1,044-byte tail on the 23 MB file, qpdf-clean on all 8 inputs, and signatures and
      encryption preserved.
    - qpdf shows every dropped object is unchanged (26k checked); PDFium's differences are float
      rounding, `/NM` and `/P` noise.
    - When nothing changed, no revision is appended.
    - Keep-all fallback: every appended object with our xref.
  - All 21 EmbedPDF tool annotations are created with appearance streams and survive every mode.
    Form values persist. Annotate-denied files are not edited (rule 9).
  - Ctrl+S timing: **12–42 ms** end to end for 100 markups on small files (target < 1 s). On
    23 MB, ~0.5–0.6 s, of which `createWritable(keepExistingData)` takes 166–285 ms because it
    copies the whole file. An OPFS sync-handle tail write takes ~1.5 ms.
  - Interop pack (33 self-made files) in `e2e/fixtures/self-made/s1-interop/`; owner checklist in
    `e2e/interop/CHECKLIST.md`.
  - Tooling: `qpdf` CLI installed with apt (verification only, not a dependency). Added `pkijs` and
    `asn1js` (BSD-3, planned for D-24). Spike unit tests now run in `npm run test`.
- **Session 2 — tooling:**
  - `spikes/` with a shared `_headers` server, fixture writer and probes;
  - `npm run spikes`, `npm run typecheck:spikes` and `npm run corpus`;
  - `corpus/manifest.json`, listing the FAR;
  - spikes are now covered by ESLint.
  - Dependencies added: `@embedpdf/engines`, `@embedpdf/pdfium`, `@embedpdf/models` 2.15.1
    (runtime), and `vite-plugin-pwa` 1.3.0, `workbox-window` and `workbox-build` (dev). The license
    gate passes (521 packages).

## In progress

- M0: S8, S3, S1 and S5 have finished the agent part. The owner checks listed under Next are pending.

## Session log

- **Session 4 (2026-09-24):** S5. Local checks all pass: typecheck (app and spikes), lint, format,
  unit tests (including 10 search-core tests), license gate, app e2e smoke, and all spike
  Playwright tests (15/15).

- **Session 3 (2026-09-24):** S1. Local checks all pass: typecheck (app and spikes), lint, format,
  62 unit tests (including 10 narrow-tail tests), license gate (528 packages), app e2e smoke, and
  11/11 spike Playwright tests. The S1 Node matrix has 0 problems.

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

1. **Owner decisions:**
   - ADR-003 decisions 3–5;
   - ADR-004 decisions 2–6;
   - **ADR-006 decisions 2–4**: context cap, background indexing (a §6 wording change), and no
     IndexedDB text cache for Rev 0;
   - **ADR-005 decisions 2–6**: narrow-tail Ctrl+S with verification and keep-all fallback, Save
     Optimized via our writer, the private EmbedPDF accessor, §4.2/§4.3 wording, and large-file
     save progress.
2. **Owner runs:**
   - **S1 interop checklist** (`e2e/interop/CHECKLIST.md`) in Acrobat Reader and PDF-XChange;
   - S1 FSA button on the 500 MB contract;
   - **S5 search on the FAR and the 500 MB contract** (ADR-006, "Owner runs");
   - FAR, 500 MB and A0 through the S3 harness;
   - S8 Firefox check and Pages preview.
3. **Agent:** continue M0 with **S2** (Measure/Viewport dictionaries), then S7 → S4 → S6.
4. Get [PR #1](https://github.com/shubhs650/PDFTools/pull/1) merged. This branch builds on it.

## Open issues

- **Committed corpus PDFs vs ADR-002.** Commit `cd52644` added six PDFs directly to `corpus/`,
  including CAD drawings. ADR-002 says drawings stay local and are never committed, and
  `.gitignore` excludes `*.pdf`, so these were force-added. S3 uses `bearing catalogue.pdf` and
  `PRESSURE-VESSEL-SAMPLE.pdf` from there. The owner needs to decide (see "Decisions needed").
- **FAR not fetchable from the cloud container.** The environment's network policy denies
  `www.acquisition.gov` (HTTP 403 from the proxy). To allow it, add that host under the
  environment's Network access settings; otherwise run `npm run corpus` locally.
- **PDFium incremental save needs our narrow-tail post-processing** (ADR-005). Used raw, it
  bloats files and damages xref-stream files. The narrow tail depends on EmbedPDF's private
  `PdfiumNative.cache` for the document pointer (pinned 2.15.1; upstream request proposed).
- **Chrome's `createWritable(keepExistingData)` copies the whole file**, so Ctrl+S on very large
  files is O(file size). The owner measures it on 500 MB; it needs a progress UI (ADR-005).
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

1. **ADR-003 to ADR-006 proposals** (see Next, item 1).
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

| Date       | Ref      | Decision                                                                                                                                                                                                                                                                     |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-24 | ADR-001  | Session-1 clarifications B1–B16. Key ones: server-side analytics only; broader permissive allowlist; location-based redaction verification; EmbedPDF annotation and redaction sets; OPFS original + tail recovery; public-domain corpus only.                                |
| 2026-09-24 | scaffold | Vite 7 instead of 8, and no jsx-a11y, because of MPL-2.0 dependencies. Superseded by ADR-002.                                                                                                                                                                                |
| 2026-09-24 | ADR-002  | MPL-2.0 allowed for dev-only tooling only (lockfile `dev` flag). OFL-1.1 allowed for fonts. Heavy files are measure and report for Rev 0. Test drawings are owner-supplied local files, with no URLs in the repo. Moved to Vite 8 and enabled jsx-a11y.                      |
| 2026-09-24 | Rev 0.1  | ARCHITECTURE.md amended per ADR-001 and ADR-002 (owner-approved).                                                                                                                                                                                                            |
| 2026-09-24 | ADR-003  | S8 proposal: CSP unchanged; `fontFallback` always explicit; Regular-weight fallback fonts, CJK non-core; local `_headers` server instead of `wrangler` (LGPL). Awaiting owner.                                                                                               |
| 2026-09-24 | ADR-004  | S3 proposal: hosted Render worker (our module + EmbedPDF `PdfiumNative`/`PdfEngine`); small tiles + queue abort + direct progressive render; respawn-based memory policy; optional COOP/COEP. Awaiting owner.                                                                |
| 2026-09-24 | ADR-005  | S1 proposal: Ctrl+S = PDFium `FPDF_INCREMENTAL` + narrow tail (changed objects only, our own xref/trailer), verified in the Work worker with keep-all fallback; Save Optimized = `FPDF_NO_INCREMENTAL` via our writer. Awaiting owner.                                       |
| 2026-09-24 | ADR-006  | S5 proposal: search in the Work worker (raw FPDFText extraction + session text cache + JS RegExp, viewport order, 50 ms batches, cancel between pages); ≤ 5,000 hits streamed with context; background indexing after open; EmbedPDF plugin-search not used. Awaiting owner. |
