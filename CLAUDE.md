# CLAUDE.md — PDFTools

You are building **PDFTools** (`pdf-tools.openengtools.com`): a free, offline, private, PDF-XChange-style PDF editor PWA for engineers. **`ARCHITECTURE.md` is the source of truth** — read the relevant section before starting any task, and reference decision IDs (D-xx) in commit messages.

## Non-negotiable rules

1. **Main thread is UI only.** No PDF parsing, rendering, search, extraction, encoding or file building on the main thread. Heavy work goes to the Render worker or Work worker via the typed RPC in `/src/engine`. Any main-thread task > 100 ms is a bug.
2. **Every long job is cancellable and reports progress** (> 300 ms).
3. **Search runs only on Enter/click.** Never search-as-you-type.
4. **No network calls** except same-origin update checks and the opt-in `/api/report`. No CDNs at runtime, no analytics SDKs, no telemetry. EmbedPDF font CDN fallback must stay disabled.
5. **Permissive licenses only** (MIT, Apache-2.0, BSD, ISC). Never add GPL/LGPL/AGPL/SSPL/non-commercial packages. Never copy code from BentoPDF, PyMuPDF, Ghostscript, CoherentPDF or PDF-XChange. Run the license check after adding any dependency. The full allowlist is in `scripts/license-policy.ts` (ADR-002): it also includes OFL-1.1 for fonts, and MPL-2.0 only for dev-only tooling that is never bundled.
6. **Annotations are standard PDF objects with appearance streams** — they must round-trip with Acrobat Reader and PDF-XChange. No app-private annotation formats.
7. **Ctrl+S is incremental.** Full rewrite only via Save Optimized or redaction. Never autosave to the user's original file — recovery goes to OPFS only.
8. **Redaction** always outputs a new, fully rewritten, sanitized file and must pass post-redaction verification before reporting success.
9. **Honor PDF permission flags.** Never bypass document restrictions.
10. **Error reports never contain document content** (no page text, file names, annotation text, screenshots).
11. **No hardcoded user-visible strings.** Use i18n keys (`/src/i18n/en.json`) and `Intl` formatting.
12. **Every interactive control is keyboard-reachable with an accessible name.**
13. **Test data is public or self-made PDFs only.** Never add company or client documents.
14. **Do not work on revision compare** — parked pending IP clearance.
15. **Do not copy PDF-XChange icons or artwork.** Use Fluent UI System Icons (Color); draw missing icons in the same style.

## Stack
React + TypeScript (strict) + Vite · Zustand · Radix UI primitives · EmbedPDF headless (`@embedpdf/*`) · PDF Oxide WASM · ExcelJS · docx · remark · PKI.js · i18next · vite-plugin-pwa · Vitest · Playwright · Cloudflare Pages (+ Pages Functions for `/api/report`).

## Workflow
- Work milestone by milestone (M0 spikes → M1 → M2 → M3 → M4). Do not start features from a later milestone.
- For uncertain library capabilities, write a spike first and record the result as an ADR in `/docs/adr` before building on it.
- TDD for pure logic (geometry, scale math, table grids, CRS builder, schemes). Playwright for flows and performance.
- Before declaring a task done: typecheck, lint, unit tests, relevant e2e tests, license check, and confirm no new main-thread long tasks.
- If a requirement in `ARCHITECTURE.md` seems impossible or conflicts with a library's behavior, **stop and report** with options — do not silently change the design.
- Keep feature code in `/src/features/<feature>`; shared UI in `/src/ui`; worker code in `/src/workers`.

## Commands
- `npm run dev` · `npm run build` · `npm run test` (Vitest) · `npm run e2e` (Playwright) · `npm run perf` · `npm run licenses` · `npm run typecheck` · `npm run lint` · `npm run format` / `npm run format:check`
- Node ≥ 22.18 (runs `scripts/*.ts` natively). In the cloud container, run e2e with `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.
- License exceptions (permissive-but-unlisted only, with a reason) go in `scripts/license-exceptions.json`.

## Session protocol
- At session start: read `docs/PROGRESS.md`, then the current milestone plan in `docs/plan/`.
- At session end: update `docs/PROGRESS.md` (done / in progress / next / open issues / decisions needed) and commit.
- UI layout references are in `docs/ui-reference/` (layout only; never copy artwork).
- Never change `ARCHITECTURE.md` without an approved ADR.
