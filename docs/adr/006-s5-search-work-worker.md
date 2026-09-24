# ADR-006: S5 — Search in the Work worker while scrolling

- **Status:** Proposed. The spike result stands; decisions 2–4 need owner approval.
- **Date:** 2026-09-24
- **Deciders:** Owner (pending); recorded by the coding agent
- **Related decisions:** D-02, D-08, D-10, D-27 (ARCHITECTURE.md §6, §11, §12); ADR-002; ADR-004;
  CLAUDE.md rules 1–3
- **Related spike / milestone:** M0-S5
- **Outcome (spikes only):** **Works with workaround.** All §6 targets are met with the Work-worker
  design. Two mitigations are needed:
  - cap the hits streamed with context;
  - index in the background after open, so that rare terms far from the viewport also get first
    hits in under 1 s.

## Context

§6 requires:

- search on Enter or click only;
- the search runs in the **Work worker**, results stream in, and a new search cancels the old one;
- first hits in under 1 s, a full 2,000-page search in under 15 s, and **no main-thread task over
  100 ms**.

The options are match case, whole word, and wildcards/regex. See
[M0 plan §S5](../plan/M0.md#s5--search-in-the-work-worker-on-a-2000-page-document-while-scrolling).

## Setup

- **Inputs.** The FAR host is blocked in the cloud container (network policy), so two stand-ins
  were used. The owner runs the real FAR with the same harness.
  - **Contract stand-in**, self-made (`spikes/s5-search/make-contract.ts`): 2,000 pages, ~4,900
    characters per page, FAR-style clause numbers, 3.5 MB. Needles are placed on known pages
    (7, 1,000, 1,999).
  - **Real public text:** `corpus/bearing catalogue.pdf` (1,152 pages).
- **Render worker:** the hosted EmbedPDF engine from ADR-004, driving a **continuous auto-scroll**
  at 900 px/s with 256 px tiles. Per-tile latency from "tile visible" to "pixels drawn" is recorded
  by phase, and rAF frame gaps are recorded too.
- **Work worker** (`search.worker.ts`), with its own PDFium instance:
  - per-page text comes from raw `FPDFText_LoadPage` / `CountChars` / `GetText`, so string index
    equals PDFium char index and hits map straight to highlight rects;
  - page text is cached for the session;
  - the query is compiled to a JS `RegExp` (`search-core.ts`, 10 unit tests), covering case, whole
    word (Unicode-aware), wildcards and regex. Query whitespace matches line breaks;
  - pages are searched in viewport order: visible pages, then onward, wrapping;
  - results stream in batches no more often than every 50 ms;
  - the AbortSignal is checked between pages, and the worker yields every 8 ms.
- **Main thread:** an Enter-only search box, stale-result accounting by search id, and a list that
  renders only the first 50 rows.
- **Environment:** headless Chromium 141 on a 4-core Xeon container. The numbers are informative;
  the owner's reference-class machine is authoritative.

## Findings

| Measure (2,000-page stand-in unless noted)                                     | Result                                               | Target             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------ |
| Typing 26 characters into the search box                                       | **0 searches** (only Enter searches)                 | D-08               |
| Cold search (index built during the search), common term: first hit / done     | **53–71 ms / 4.0–5.6 s**                             | < 1 s / < 15 s ✅  |
| New query cancels the running one                                              | **19–21 ms**; 0 stale results shown or even arrived  | < 100 ms ✅        |
| Main-thread long tasks during the whole scenario                               | **none** (after decision 2)                          | none > 100 ms ✅   |
| Cold search, rare term far from the viewport (needle on p. 1,000)              | first hit ≈ **1.8 s**                                | < 1 s ❌ without 3 |
| Warm index (after one pass): rare term / wildcard / "contractor" (18,798 hits) | **6 ms / 10 ms / ~110 ms**                           | ✅                 |
| Warm, regex `e` (910,320 hits)                                                 | 1.6 s; 0 long tasks; worst frame 16.8 ms             | ✅ with decision 2 |
| Same query **without** a context cap                                           | 3.6 s; long tasks **66–68 ms**; frame gaps to 150 ms | ⚠️                 |
| Real text (catalogue, 1,152 pages), cold "bearing": first hit / done           | 55 ms / 5.6 s, 0 long tasks                          | ✅                 |
| PDFium's own `FPDFText_Find` over all pages (baseline)                         | 3.9–4.0 s per query, nothing reusable                | —                  |
| Highlight rects (`FPDFText_CountRects` / `GetRect`) for 2 hits on a page       | 1.9 ms                                               | —                  |
| Text cache for 2,000 pages                                                     | 9.8 M characters (~20 MB of JS strings)              | reported           |

**Tile latency while scrolling** (visible → drawn, p50 / p95 / max, in ms):

| Phase                                             | p50 | p95   | max |
| ------------------------------------------------- | --- | ----- | --- |
| Baseline                                          | 16  | 28–43 | 72  |
| Work-worker search (cold)                         | 19  | 37–41 | 66  |
| Work-worker, 910k-hit stream (capped)             | 22  | 54    | 71  |
| **EmbedPDF `plugin-search` path (Render engine)** | 45  | 72    | 91  |
| 910k-hit stream **uncapped**                      | 26  | 138   | 259 |

**EmbedPDF `plugin-search` runs in the Render engine.** Its source (2.15.1) calls
`engine.searchAllPages`. That queues 25-page `searchBatch` chunks at LOW priority in the same
one-at-a-time queue as tiles, and a running chunk can't be interrupted (ADR-004). It also only
supports PDFium find flags, so no wildcards or regex. Measured, it doubles tile p50 and p95. That
confirms D-10: Advanced Search must not use it.

## Decision

1. **Adopt the Work-worker design as built**, with the logic in `spikes/s5-search/search-core.ts`
   and its tests:
   - raw `FPDFText_*` extraction with a per-document text cache;
   - JS `RegExp` matching;
   - search order from the viewport;
   - batches no more often than every 50 ms;
   - cancel between pages.

   Do **not** use EmbedPDF `plugin-search` for Advanced Search or Quick Find. Keep its highlight
   and overlay ideas only for the UI layer.

2. _(Owner)_ **Stream at most 5,000 hits with context per search.** Beyond that, send per-page
   counts only. The results list is virtualized and asks the Work worker for context when the user
   scrolls to rows beyond 5,000. The hit count stays exact.
3. _(Owner)_ **Index in the background after open.**
   - After first render, the Work worker extracts all pages at idle priority, in viewport order.
   - It is cancellable, yields to searches, and is paused while a save or extraction job runs.
   - A search that arrives mid-index searches cached pages first, then continues extracting. This
     makes "first hits in under 1 s" hold for rare terms anywhere (warm: 6 ms).
   - Proposed §6 wording: "Text index per document built in the Work worker **in the background
     after open (idle priority)** and on demand by searches; cached for the session."
4. _(Owner)_ **No IndexedDB text cache for Rev 0.** A cold pass takes about 5 s per 2,000 pages and
   stays off the main thread. Revisit if the owner's FAR or 500 MB runs show otherwise; §10.3 would
   then need a privacy entry.

## Consequences

- **M2 `/src/workers/work.worker.ts`:**
  - search handler, background indexer and `rects` handler;
  - `/src/engine/workClient.ts` gets streaming progress with search ids;
  - port the S5 unit tests.
- **Char-index mapping:** `FPDFText_GetText` returns UTF-16. For non-BMP characters (rare in
  engineering text), convert between string index and char index with
  `FPDFText_GetTextIndexFromCharIndex` / `GetCharIndexFromTextIndex`, both exported, before
  computing rects.
- **"All open tabs" scope (§6)** runs the same loop over each document in the Work worker, one
  document at a time.
- **Memory:** about 10 MB of text per 1,000 dense pages, inside the Work worker. It is released
  when the document is evicted or the worker respawns (ADR-004 decision 4).
- **Owner runs:** the FAR and the 500 MB contract through the S5 page.
  1. Build it, then serve it with `--corpus corpus`.
  2. In the console, run `await __s5.load('/corpus/files/<file>'); __s5.startScroll(900)`.
  3. Search from the box (press Enter).
  4. Read `__s5.runs()`, `__s5.tileStats()` and `__s5.probe.longTasks`: first hit, completion,
     long tasks and tile p95.
- **Risk:** CPU contention on low-core machines. The Work worker's extraction competes with the
  Render worker; tile p95 went up about 10 ms here on 4 cores. Background indexing should back off
  while the user is actively scrolling or zooming.

## Evidence

- Code: [`spikes/s5-search/`](../../spikes/s5-search/)
  - `search-core.ts` and its tests;
  - `search.worker.ts`;
  - `main.ts`: auto-scroll, tile metrics, Enter-only box, stale accounting;
  - `make-contract.ts`;
  - `s5.spec.ts`.
- Commands:
  - `node spikes/s5-search/make-contract.ts`;
  - `SPIKE=s5 npm run spikes -- --project=s5`: 4/4 pass; raw numbers go to
    `test-results/s5-results.json`;
  - `npx vitest run spikes/s5-search`: 10/10 pass.
- `plugin-search` behavior: read from `@embedpdf/plugin-search@2.15.1` `dist/index.js`
  (`searchAllPages` → `this.engine.searchAllPages`) and `@embedpdf/engines` `PdfEngine.searchAllPages`
  (25-page `searchBatch` chunks, `Priority.LOW`).
