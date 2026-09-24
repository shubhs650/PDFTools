# ADR-002: License policy amendments and heavy-file acceptance targets

- **Status:** Accepted (owner decision, 2026-09-24)
- **Date:** 2026-09-24
- **Deciders:** Owner; recorded by the coding agent
- **Related decisions:** D-12, D-27 (extends ADR-001 B2, B4, B9, B12, B15)
- **Related spike / milestone:** M0 (S3, S4, S5, S7, S8)

## Context

The license gate added in session 1 (`npm run licenses`) found two problems with the ADR-001 B2
allowlist. It also left an open question about acceptance limits for heavy files.

1. **MPL-2.0 in build and lint tooling.** Vite 8 has a hard dependency on `lightningcss`
   (MPL-2.0), and `eslint-plugin-jsx-a11y` depends on `axe-core` (MPL-2.0). Neither ships in the
   app bundle. MPL-2.0 is a file-level copyleft: using unmodified tools creates no obligations for
   our MIT code. Without them, we are stuck on an older Vite and CLAUDE.md rule 12 cannot be
   linted.
2. **OFL-1.1 fonts.** EmbedPDF's fallback font packages (`@embedpdf/fonts-*`) are licensed under
   OFL-1.1. OFL allows bundling and redistribution inside software. It only forbids selling the
   fonts on their own and reusing the reserved font names for modified fonts.
3. **Heavy files.** ADR-001 said heavy-file limits "may be relaxed" but gave no numbers.

## Decision

1. **MPL-2.0 is allowed only for dev-only packages.** A package counts as dev-only when
   `package-lock.json` marks it `"dev": true`.
   - Entries marked `devOptional`, and packages missing from the lockfile, are treated as runtime.
   - Any MPL-2.0 package reachable from runtime dependencies still fails the gate.
   - Implemented as `DEV_ONLY_ALLOWED` in `scripts/license-policy.ts`, and reported separately by
     `scripts/check-licenses.ts`.
2. **OFL-1.1 is added to the allowlist.** It is intended for bundled fonts.
3. **Heavy files are "measure and report" for Rev 0.** This covers the ~500 MB contract, dense
   A0 drawings and P&IDs, and large-file saves. The §12 numbers stay the target for typical files.
   For heavy files, results are measured, recorded in the spike ADRs and performance reports, and
   do **not** fail the build. Memory is not limited during development (ADR-001 B10).
4. **Test drawings.** The owner supplies publicly available CAD drawings as **local files only**,
   kept in the git-ignored `corpus/files/drawings/`. No URLs or files are committed, because their
   copyright status is not clearly public domain.

## Consequences

- The toolchain moves to Vite 8, and `eslint-plugin-jsx-a11y` (strict) is enabled for `src/`.
- `@axe-core/playwright` can be added later for accessibility e2e checks as a dev dependency.
- If an MPL package ever becomes a runtime dependency, CI fails, and the fix is to remove it.
  The gate never downgrades a runtime package to dev-only.
- CLAUDE.md rule 5 now points to `scripts/license-policy.ts` as the full allowlist.
- ARCHITECTURE.md Rev 0.1 records D-12 and D-27 accordingly.

## Evidence

- `npm run licenses` after the change: 307 packages comply, with 3 dev-only
  (`axe-core`, `lightningcss`, `lightningcss-linux-x64-gnu`, all MPL-2.0).
- Negative tests: a fake runtime package licensed MPL-2.0, and another licensed GPL-3.0, both make
  the gate exit 1.
- Unit tests: `tests/license-policy.test.ts`, "font and dev-only licenses (ADR-002)".
