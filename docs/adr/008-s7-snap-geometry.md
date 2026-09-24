# ADR-008: S7 — Vector geometry extraction and snap queries

- **Status:** Proposed. The spike result stands; decision 2 needs owner approval because it adds a
  worker to §3.1.
- **Date:** 2026-09-24
- **Deciders:** Owner (pending); recorded by the coding agent
- **Related decisions:** D-10, D-14 (ARCHITECTURE.md §3.1, §7.4, M3); ADR-001 B14; ADR-002;
  ADR-004; CLAUDE.md rules 1 and 2
- **Related spike / milestone:** M0-S7 (feeds M3)
- **Outcome (spikes only):** **Works with workaround.** Extraction and queries are fast. Queries must
  not share a thread with PDFium: page parsing is one uninterruptible call of up to ~0.7 s. A
  PDFium-free snap worker fixes that.

## Context

§7.4 requires snapping to vector geometry: endpoints, midpoints, intersections and the nearest point
on a segment. Geometry for the visible region is extracted in the Work worker, spatially indexed,
and cached per page. S7 has to measure extraction and query speed, and check correctness on known
geometry. The target is a query round trip of 16 ms or less at p95. See
[M0 plan §S7](../plan/M0.md#s7--vector-geometry-extraction-speed-for-snapping-on-a-dense-pid).

## Setup

- **EmbedPDF** reads path objects only privately (for stamp and appearance contents), building one JS
  object per segment. There is no public page-geometry API. So extraction calls PDFium directly
  (B14), via `spikes/s7-snap/extract.ts`:
  - `FPDFPage_CountObjects` / `GetObject`;
  - `FPDFPageObj_GetType` / `GetMatrix` / `GetBounds`;
  - `FPDFPath_*` and `FPDFPathSegment_*`;
  - `FPDFFormObj_*`, recursing with composed matrices.

  Béziers are flattened (≤ 0.25 pt chord error). Explicit closes and the implicit close of filled
  subpaths are honored. The output is a flat `Float32Array` of segments in user space.

- **Index and queries** (`snap-core.ts`, 11 unit tests):
  - a uniform-grid index in CSR layout;
  - queries in CAD priority order: endpoint, intersection, midpoint, nearest point on a segment,
    within a radius;
  - intersection pairs are capped per query (2,048).
- **Inputs:**
  - a self-made known-geometry sheet (`test-sheet.ts`): lines, a rectangle, crossing diagonals,
    `cm` scale and 90° rotation, a Bézier circle, two form XObjects (one with its own `/Matrix`,
    one invoked scaled), and a fill-only triangle;
  - the public drawings in `corpus/`, including the A1 pressure-vessel sheet (page 2: 173,955
    segments in 62,536 paths);
  - synthetic dense sheets of 50k, 250k and 1M segments, for scaling only. The owner's CAD drawings
    and P&ID are run locally (ADR-002).
- **Environment:** Node 22 and headless Chromium 141 on a 4-core container. The numbers are
  informative.

## Findings

1. **Correctness.** All 13 known segments are recovered by both call paths, including `cm`, the
   rotation, and form `/Matrix` composition.
   - Snaps land exactly on the endpoint (100, 100), the intersection (200, 200) and the midpoint
     (200, 100).
   - Points on the circle are within **0.2 pt**.
   - The fill-only triangle is present only when fills are included. PDFium doesn't report the
     implicit close, so we add it.
2. **Raw WASM exports are 2.3–4.6× faster than EmbedPDF's `cwrap` wrappers** for the hot
   per-segment calls. For example, 345 ms vs 860 ms on the A1 page, and 0.93 s vs 3.5 s for 1M
   segments.
3. **Extraction cost is dominated by `FPDF_LoadPage`** (content-stream parsing): 75–90 %. It is one
   synchronous, uninterruptible call:

   | Page                       | Segments  | LoadPage   | Full extract (raw)                  | Grid        | Index memory |
   | -------------------------- | --------- | ---------- | ----------------------------------- | ----------- | ------------ |
   | Sample engineering drawing | 1,694     | —          | 2.4 ms                              | 1.4 ms      | 35 KB        |
   | Motor catalogue p1         | 5,436     | —          | 14 ms                               | 0.9 ms      | 190 KB       |
   | **Pressure vessel A1 p2**  | 173,955   | 250–320 ms | 319–416 ms (Node), 559 ms (browser) | 24–34 ms    | 3.8 MB       |
   | Synthetic 250k             | 250,000   | —          | 209–269 ms                          | 35–39 ms    | 6.7 MB       |
   | Synthetic 1M               | 1,000,000 | 670–705 ms | 0.76–0.93 s                         | 0.18–0.32 s | 36 MB        |
   - **Region extraction doesn't help.** Skipping 62,529 of 62,536 objects by their bounds still
     took 358 ms, because the page must be parsed in full first.
   - So extract the **whole page once**, cache it, and reuse it at every zoom.
   - Slicing the object walk (`sliceMs: 8`) keeps walk slices at about 8 ms, but `LoadPage` itself
     can't be sliced.

4. **Queries are cheap.** In the worker, query time p95 is **0.07–0.44 ms** on real drawings and
   0.3 / 0.7 / 3.1 ms for 50k / 250k / 1M synthetic segments.
5. **Round trip in the browser:** pointer moves are coalesced to one query in flight per animation
   frame.

   | Route (A1 page, 174k segments)                        | Steady p95 | While PDFium parses a dense page                                    |
   | ----------------------------------------------------- | ---------- | ------------------------------------------------------------------- |
   | Work worker answers the queries itself                | 0.5 ms     | **~272 ms per query** (only 3 answers in ~0.9 s; 48 frames dropped) |
   | **Pure-JS snap worker** (index transferred zero-copy) | 0.5–0.6 ms | **0.5 ms** (55 answers)                                             |
   - On the 1M sheet, the snap-worker route has p95 2.2 ms.
   - Handing the index to the snap worker costs about 1 ms (a transfer, not a copy).
   - There were no main-thread long tasks.

6. **Tiles are unaffected** by extraction in the Work worker: tile p95 is 7.0 ms at baseline and
   6.9 ms during extraction (the Render worker runs on its own thread).

## Options considered

1. **Queries in the Work worker** (§3.1 as written).
   - For: no extra worker.
   - Against: any PDFium job (page parse, search extraction, conversion) freezes snapping for its
     duration. We measured 272 ms per query, and multi-second freezes are possible during S5-style
     indexing.
2. **Queries on the main thread** from transferred typed arrays.
   - For: the lowest latency.
   - Against: geometry work on the main thread goes against CLAUDE.md rule 1. A worst case of about
     3–9 ms per query on huge pages eats into the frame budget. Rejected.
3. **A small snap worker: pure JS, no PDFium, around 2 KB of code.**
   - The Work worker extracts and indexes each page, then transfers the index to the snap worker.
   - For: queries never wait for PDFium, and no memory is duplicated.
   - Against: a third worker in §3.1.

## Decision

1. **Geometry extraction stays in the Work worker.**
   - It uses raw PDFium exports, extracts whole pages, and caches them per page. The walk is sliced
     and cancellable.
   - It runs in the background when snapping is on, for visible pages first.
   - Fill-only paths are included, which covers hatching and filled outlines.
2. _(Owner)_ **Add a snap worker** (option 3) for pointer-time queries.
   - Proposed §3.1 wording: "Snap worker (pure JS, no PDFium): holds per-page snap indexes
     transferred from the Work worker; answers pointer queries (≤ 1 in flight per frame)."
   - The Work worker's role becomes "snap geometry extraction". ARCHITECTURE.md is edited only
     after this ADR is accepted.
3. **Very dense pages.** Above a size threshold (proposed: 1M segments or 40 MB of index),
   drop segments shorter than 0.5 device px at the current zoom, or enable snapping only above a
   zoom level (§7.4 "if it fails"). Measure and report on the owner's P&ID first (ADR-002).
4. **Snapping is off until a page's index is ready.** The status-bar toggle (§5) shows "Preparing
   snapping…" while `LoadPage` runs; it takes about 0.3–0.6 s on a dense A1.

## Consequences

- **M3:**
  - port `snap-core.ts` (with tests) and `extract.ts`;
  - add `/src/workers/snap.worker.ts` and the index transfer;
  - coalesce pointer moves in the measurement tools.
- **Worker CPU on dense pages:** a Work-worker parse competes with other Work jobs (search indexing,
  S5). Schedule geometry at a priority below interactive search and above background indexing.
- **Snapping to text or images** is out of scope. Clip paths are ignored. Curves snap to their
  flattened points; a true circle-centre snap would be a later addition.
- **Owner:** run `node spikes/s7-snap/run-node.ts <drawing.pdf> …` on the four local CAD drawings and
  the dense P&ID, and the browser page (build, serve with `--corpus corpus`, then
  `await __s7.load('/corpus/files/<file>'); await __s7.extract(<page>)`). Record segments,
  extraction time and snap RTT.

## Evidence

- Code: [`spikes/s7-snap/`](../../spikes/s7-snap/)
  - `snap-core.ts` (11 tests) and `extract.ts`;
  - `test-sheet.ts`, `run-node.ts`;
  - `geometry.worker.ts`, `snap.worker.ts`, `main.ts`, `s7.spec.ts`.
- Commands:
  - `node spikes/s7-snap/run-node.ts`: writes `out/s7-node.json`;
  - `SPIKE=s7 npm run spikes -- --project=s7`: 4/4 pass; raw numbers go to
    `test-results/s7-results.json`;
  - `npx vitest run spikes/s7-snap`.
