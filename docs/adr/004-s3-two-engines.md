# ADR-004: S3 — Two PDFium instances in two workers; memory, tiles and cancellation

- **Status:** Accepted. The owner approved decisions 2–6 on 2026-09-24; applied in ARCHITECTURE.md Rev 0.3 (§3.1, §10.1, §15).
- **Date:** 2026-09-24
- **Deciders:** Owner (approved 2026-09-24); recorded by the coding agent
- **Related decisions:** D-09, D-10, D-27 (ARCHITECTURE.md §3.1, §5, §11), ADR-001 B10, B11,
  B14; ADR-002; CLAUDE.md rules 1 and 2
- **Related spike / milestone:** M0-S3
- **Outcome (spikes only):** **Works with workaround.** Two engines run concurrently with a small
  tile-latency cost. An in-flight EmbedPDF render cannot be cancelled. The workaround is small
  tiles plus queue-level abort, with direct progressive rendering for heavy renders.

## Context

D-10 puts two PDFium instances in separate workers. The **Render worker** runs EmbedPDF's engine,
which drives the headless plugins. The **Work worker** is an independent PDFium instance behind our
own typed RPC. S3 has to show that both load and run concurrently, measure memory and tiles, and
find out whether renders can be cancelled (CLAUDE.md rule 2). See
[M0 plan §S3](../plan/M0.md#s3--two-embedpdfpdfium-engine-instances-in-two-workers-memory-with-a-500-mb-contract).

## Setup

- **Render worker, two variants.** Both use the same 2.15.1 engine code, and both are tested.
  - _stock_: EmbedPDF's `createPdfiumEngine` from `@embedpdf/engines/pdfium-worker-engine`. It runs
    as an inline `blob:` worker and we cannot reach inside it.
  - _hosted_: our own worker module (`render.worker.ts`) runs EmbedPDF's exported `PdfiumNative`
    executor. On the main thread, a 60-line `Proxy` executor forwards calls to it, wrapped in
    EmbedPDF's exported `PdfEngine` orchestrator (priority queue and encoding). The headless plugins
    see an ordinary `PdfEngine`. EmbedPDF's own `RemoteExecutor` does the same job but is not
    exported.
- **Work worker:** our worker module (`work.worker.ts`) runs `init()` from `@embedpdf/pdfium` and
  `PdfiumNative` directly, behind a typed RPC (`rpc.ts`) with AbortSignal cancellation and progress.
- **Inputs.** The FAR host (acquisition.gov) is **blocked by this container's network policy**, so
  S3 used two public PDFs the owner committed in `corpus/`:
  - _contract stand-in_: `bearing catalogue.pdf` (23 MB, 1,152 pages);
  - _drawing_: `PRESSURE-VESSEL-SAMPLE.pdf` (an A1 sheet, 2384 × 1684 pt).
- **Bytes:** the Work worker receives the fetched `ArrayBuffer` as a transfer. The Render worker
  gets a copy (ARCHITECTURE §3.1).
- **Environment:** cloud container, Linux, headless Chromium 141, Playwright 1.63, EmbedPDF 2.15.1.
  The page is served under the §10.1 CSP by `spikes/shared/serve.ts`. The numbers are informative;
  the owner's reference-class machine is authoritative.

## Findings

### 1. Two instances run concurrently with no shared-state errors

Both variants work: both open the 1,152-page file, and there are **0 CSP reports** and **0 main-thread
long tasks** across open, scroll, zoom, extraction and cancellation. Open times:

| Step                   | Time    |
| ---------------------- | ------- |
| Render worker open     | ~120 ms |
| Work worker open       | ~63 ms  |
| WASM init (per worker) | ~60 ms  |

### 2. The Work worker barely affects tiles

The benchmark simulates a 1400 × 700 viewport with 256 px tiles:

- 30 scroll steps at 100 %, then 8 steps at 200 % and 8 at 400 %;
- 732 tile requests and 46 steps per run;
- each step requests every visible tile at once, so latency includes queue wait.

During the "concurrent" run, the Work worker loops full-text extraction for the whole run.

| Hosted variant (ms)   | p50   | p95   | max   |
| --------------------- | ----- | ----- | ----- |
| Tile, warm            | 66.8  | 161.1 | 253.7 |
| Tile, Work job active | 71.1  | 168.5 | 240.4 |
| Step, warm            | 117.6 | 192.5 | 253.8 |
| Step, Work job active | 124.5 | 201.2 | 240.5 |

- Across three runs, the Work job added **+5–9 % to p50 and p95**. The stock variant was similar:
  tile p95 went from 156 to 184 ms in one run.
- Extraction ran at **~200 pages/s** alone, and 230–244 pages/s while tiles rendered. The latter
  pass was warm, so page parsing was cached. The slowest page took 51 ms.
- **Work job cancellation latency: 3–9 ms.** The job checks the AbortSignal between pages and
  yields every 8 ms.

### 3. Memory: WASM memory never shrinks; respawning reclaims it

Hosted variant, `WebAssembly.Memory.buffer.byteLength`:

| Point                               | Render worker | Work worker  |
| ----------------------------------- | ------------- | ------------ |
| After init                          | 18.6 MB       | 18.6 MB      |
| After opening the 23 MB file        | 29.8 MB       | 29.8 MB      |
| After scroll/zoom + full extraction | 35.8 MB       | **128.8 MB** |
| After closing the document          | 35.8 MB       | 128.8 MB     |
| After terminate + respawn           | **18.6 MB**   | **18.6 MB**  |

- The stock worker's memory cannot be observed (inline blob worker). With COOP/COEP, the whole tab
  measures ~100–127 MB (`performance.measureUserAgentSpecificMemory()`, both variants).
- The same COOP/COEP run found no CSP reports and no breakage: blob workers, WASM and module workers
  all work under `require-corp`.

### 4. Tiles and deep zoom (A1 sheet)

For each zoom level, 256 px tiles were rendered around the page centre: n = 7, and the first tile
includes the page load.

| Zoom   | First tile | p50    | p95    |
| ------ | ---------- | ------ | ------ |
| 100 %  | 77 ms      | 6.5 ms | 47 ms  |
| 800 %  | 2 ms       | 2.3 ms | 2.7 ms |
| 6400 % | 2 ms       | 1.7 ms | 1.9 ms |

PDFium culls page objects outside the tile, so deep-zoom tiles are cheap on this sheet. A **dense
A0 drawing** is the real test, and the owner runs it (ADR-002: measure and report).

### 5. Cancellation

- **Queued renders can be cancelled.** `task.abort()` on a render still in `PdfEngine`'s queue
  removes it before it reaches the worker. In the test, 20 tiles were requested and 19 aborted; the
  worker executed **1**.
- **In-flight renders cannot be cancelled.** `PdfEngine` runs one task at a time. When a task
  already sent to the worker is aborted, EmbedPDF only drops the result. `PdfiumNative` renders
  synchronously with `FPDF_RenderPageBitmapWithMatrix`, and there is no abort message.
  - Measured: a full-page render at 150 % took 318 ms. It was aborted after 5 ms, and a 64 px tile
    requested next still waited **296 ms**.
- **Progressive rendering is reachable, but only through our own worker.** EmbedPDF never calls
  `FPDF_RenderPageBitmap_Start`, although the WASM file exports it. In the hosted worker, we called
  `FPDF_RenderPageBitmap_Start` / `FPDF_RenderPage_Continue` with an `IFSDK_PAUSE` callback built
  with `addFunction`, and yielded to the event loop between slices.
  - It works. A 1024 px region rendered in 12 slices.
  - A cancel between slices takes effect in **< 0.1 ms** (`FPDF_RenderPage_Close`).
  - Pausing is coarse. PDFium checks the pause callback only between page objects, so with an 8 ms
    budget, slices reached **37–45 ms** on this sheet.

## Options considered

For the Render worker host:

1. **Stock blob worker.**
   - For: zero code.
   - Against: no access to the WASM module, so none of the direct PDFium calls ADR-001 B14 allows.
     That rules out S1's incremental `FPDF_SaveAsCopy` and progressive rendering. Memory cannot be
     observed. The worker code is a blob, not a file.
2. **Hosted: our worker module running EmbedPDF's `PdfiumNative`, plus EmbedPDF's `PdfEngine` on the
   main thread.**
   - For: the same engine code and plugin compatibility, measured tile performance at parity, room
     for direct calls, memory probes, and a normal precacheable worker file.
   - Against: we own about 150 lines of message protocol. EmbedPDF's worker protocol itself is not
     public API, but we do not use it: we rely only on the exported `PdfiumNative`, `PdfEngine` and
     `init`.

For in-flight cancellation:

1. Accept it: small tiles, queue-level abort for stale tiles, and visible-first priority.
2. Add progressive rendering for heavy renders (full-page previews at high zoom, print rasters,
   export) through the hosted worker.
3. Patch EmbedPDF. Rejected: that means maintaining a fork.

## Decision

1. **D-10 is confirmed:** two PDFium instances, one per worker, run concurrently. The Work worker
   uses `PdfiumNative` directly behind our typed RPC.
2. _(Owner)_ **The Render worker uses the hosted variant (option 2).**
   - It is still "EmbedPDF's engine" in the sense of D-09 and D-10, so the architecture is unchanged.
   - Proposed §3.1 clarification: "Render worker = our worker module hosting EmbedPDF's
     `PdfiumNative` executor; the main thread uses EmbedPDF's `PdfEngine` orchestrator over it."
   - This ADR records the change; ARCHITECTURE.md is edited only after the ADR is accepted.
3. _(Owner)_ **Render cancellation policy:**
   - tiles stay at 256 px;
   - viewport code aborts stale queued tiles on every scroll or zoom change;
   - renders expected to take > 100 ms go through the direct progressive path with cancel between
     slices.
   - Record against CLAUDE.md rule 2 that **one in-flight tile (~2–50 ms) is not interruptible**.
4. _(Owner)_ **Memory policy:**
   - WASM memory only grows. After a large job, respawn the Work worker when it goes idle: after
     Work jobs whose peak exceeds a threshold (proposed 256 MB), and on document eviction.
   - Evicting an idle document respawns the worker, then reloads the remaining documents'
     original bytes plus tail (ADR-001 B11).
   - The Render worker is respawned only when no document is open.
5. _(Owner)_ **COOP/COEP.** This is optional hardening. It works with our stack and makes the
   whole-tab memory API available. Proposal: add
   `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to
   `_headers` in M1. This changes §10.1's header set and **needs owner approval**; it is not needed
   for Rev 0 functionality.
6. **Single WASM copy.** Import `@embedpdf/pdfium/pdfium.wasm?url` and pass that URL to both
   workers.
   - Otherwise the browser build of `@embedpdf/pdfium` makes Vite emit a second hashed copy
     (another 4.6 MB). This matters for the install budget.

## Consequences

- **M1 `/src/engine` and `/src/workers`:**
  - promote `hosted-engine.ts`, `render.worker.ts`, `rpc.ts` and `work.worker.ts` into real
    modules with tests;
  - S1 builds its incremental save on the hosted worker's module access.
- **S5 (search):** check why Work-worker memory reaches 129 MB after one full-text pass. The likely
  cause is `PdfiumNative`'s page and text-page cache. Decide whether pages are closed after
  extraction, and re-measure.
- **Owner runs, with the same harness.** Serve with
  `node spikes/shared/serve.ts --root spikes/s3-two-engines/dist --port 4181 --corpus corpus`
  after `npx vite build --config spikes/s3-two-engines/vite.config.ts`. Then open
  `http://localhost:4181/?src=/corpus/files/<file>` or use the file picker, which runs deep zoom and
  concurrency and prints JSON. Record:
  - the **FAR** (contract profile, ~2,000 pages);
  - the **500 MB contract**: open time, memory, and tile latency during extraction;
  - a **dense A0 drawing**: tile times at 100 %, 800 % and 6400 %, and progressive slice lengths;
  - **Chrome task-manager** memory for the tab and both workers.
- **Remaining risks:**
  - the coarse pause granularity on dense drawings may produce slices well over 50 ms (not blocking
    the UI, but delaying the next tile);
  - the tail of the tile-latency distribution under heavy Work load needs checking on the owner's
    machine.

## Evidence

- Code: [`spikes/s3-two-engines/`](../../spikes/s3-two-engines/). The page API is `window.__s3`:
  `boot`, `load`, `concurrency`, `cancelWork`, `deepZoom`, `cancelRender`, `progressive`,
  `memory`, `closeDoc`, `respawn`.
- Command: `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium SPIKE=s3 npm run spikes`. All 4 tests
  pass: hosted and stock concurrency, memory and respawn, and deep zoom with cancellation and
  progressive rendering. Raw numbers go to `test-results/s3-results.json`.
- COOP/COEP run: the same build served with `--coi`. `crossOriginIsolated` was true and
  `measureUserAgentSpecificMemory()` returned 100–127 MB, with 0 CSP reports.
- The FAR could not be fetched: the environment's network policy denies `www.acquisition.gov`.
