# PDFTools — Progress

_Last updated: 2026-09-24 (session 1)_

**Current milestone:** M0 — Spikes (plan: [docs/plan/M0.md](plan/M0.md))

## Done

- **Session 1 — spec review.** Reviewed ARCHITECTURE.md, CLAUDE.md and the UI reference images.
  Raised 16 items (B1–B16) and got owner answers, recorded in
  [ADR-001](adr/001-session-1-clarifications.md).
- **Session 1 — scaffold** (D-11, D-12):
  - Vite 7 + React 19 + TypeScript 6 (strict, `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes`); an empty app shell with no features.
  - The folder layout from ARCHITECTURE.md §3.3, plus `/scripts`.
  - ESLint 9 (typescript-eslint strict-type-checked, react-hooks,
    `i18next/no-literal-string` for JSX) and Prettier.
  - Vitest unit tests (`tests/`) and a Playwright smoke e2e (`e2e/`) that asserts zero
    cross-origin requests.
  - The license gate `npm run licenses`. It walks every installed package, dev dependencies
    included, parses SPDX expressions, and fails on copyleft, MPL or unknown licenses unless a
    reviewed exception exists. The policy has 45 unit tests. A fake GPL package was confirmed to
    fail the gate.
  - GitHub Actions CI: typecheck, lint, format, unit tests, license gate, build, and Playwright e2e.
- **Session 1 — docs:**
  - [ADR template](adr/000-template.md) and ADR-001;
  - the [M0 plan](plan/M0.md) with S1–S8 (goal, method, success criteria, fallback for each);
  - an EmbedPDF v2.15.1 capability snapshot, read from the npm packages because the docs site
    is blocked by the container's network policy.

## In progress

- Nothing. M0 spikes have not started.
- First CI run on GitHub Actions will happen with the session-1 push. Check its result at the start of session 2.

## Session log

- **Session 1 (2026-09-24):** Spec review, scaffold, and M0 docs. Commits: `b0bb839` (scaffold), `82956ef` (docs), plus this update. Local checks all pass: typecheck, lint, format, 45 unit tests, license gate (204 packages), build, and Playwright smoke.

## Next

1. Owner answers the **decisions needed** below.
2. Apply the ARCHITECTURE.md wording changes from ADR-001 in a separate commit, once the owner
   confirms that ADR-001 counts as approval.
3. Start M0 in the suggested order: **S8 → S3 → S1 → S5 → S2 → S7 → S4 → S6**. Set up
   `spikes/` and the corpus manifest and download script (FAR first).

## Open issues

- **MPL-2.0 dev tools blocked by the license gate.**
  - Vite 8 hard-depends on `lightningcss` (MPL-2.0), so the repo uses **Vite 7.3** instead.
  - `eslint-plugin-jsx-a11y` pulls in `axe-core` (MPL-2.0), so it is **not installed**. CLAUDE.md
    rule 12 (accessible names, keyboard reachability) is not linted yet.
  - Any future Playwright accessibility scan with `@axe-core/playwright` would hit the same issue.
- **EmbedPDF defaults use jsDelivr.** Both the PDFium WASM URL and the fallback fonts point at
  jsDelivr. Every spike and the app must self-host them (CLAUDE.md rule 4). S8 verifies this.
- **EmbedPDF has no incremental-save option in its engine API.** S1 will call `FPDF_SaveAsCopy`
  with the incremental flag directly.
- **EmbedPDF has no measurement annotation tool or Measure fields.** S2 decides the writing
  route, and how measurement labels render without custom appearance streams (ADR-001 B7).
- **Playwright and the container's Chromium differ in version.** In the cloud container, run e2e
  with `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`. CI installs the matching browser.
- **ESLint 9 is marked end-of-support upstream.** ESLint 10 is blocked until the plugin
  ecosystem declares support.

## Decisions needed (owner)

1. **MPL-2.0 for dev-only, unbundled tools.** Should MPL-2.0 be allowed when the package never
   ships in the app bundle (Vite 8's lightningcss, axe-core for a11y lint and tests)?
   - If yes: add a `devOnly` exception category to the license gate, upgrade to Vite 8, and add
     jsx-a11y.
   - If no: stay on Vite 7 and find a non-MPL accessibility check.
2. **OFL-1.1 for bundled fonts.** EmbedPDF's CJK, Arabic, Hebrew and Latin fallback fonts are
   OFL-1.1. OFL allows bundling in apps but is not on the allowlist.
   - If allowed: add `OFL-1.1` to the policy.
   - Otherwise: source other fallback fonts or skip CJK fallback.
3. **ADR-001 → ARCHITECTURE.md.** Confirm that ADR-001 may be applied to ARCHITECTURE.md
   (§4.3, §7.1, §7.9, §10.1, §12 wording).
4. **Relaxed heavy-file limits.** Give concrete numbers for the relaxed heavy-file acceptance
   limits (B4, B9, B12), or confirm "measure and report only" for Rev 0.
5. **Public drawings for S4 and S7.** Name public-domain drawing and table sources to use, in
   addition to your local files for the 500 MB contract and the dense P&ID.
6. **Cloudflare deployment for S8.** Provide a Cloudflare Pages project or account for the S8
   deployment check.

## Decisions log

| Date       | Ref      | Decision                                                                                                                                                                                                                                                                 |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-24 | ADR-001  | Session-1 clarifications B1–B16. Key ones: server-side analytics only; broader permissive allowlist; location-based redaction verification; EmbedPDF annotation and redaction sets; relaxed heavy-file limits; OPFS original + tail recovery; public-domain corpus only. |
| 2026-09-24 | scaffold | Vite 7 instead of 8, and no jsx-a11y, because of MPL-2.0 dependencies. Pending decision 1.                                                                                                                                                                               |
