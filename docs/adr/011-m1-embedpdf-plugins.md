# ADR-011: M1-01 — EmbedPDF headless plugins on the hosted Render worker

- **Status:** Accepted. The owner accepted all decisions on 2026-09-25. No ARCHITECTURE.md change is needed.
- **Date:** 2026-09-25
- **Deciders:** Owner (accepted 2026-09-25); recorded by the coding agent
- **Related decisions:** D-01, D-02, D-09, D-10, D-27 (ARCHITECTURE.md §3.1, §5, §12); ADR-003;
  ADR-004 decisions 2, 3 and 6; CLAUDE.md rules 1, 2, 4, 5 and 9
- **Related spike / milestone:** M1-01 (feeds M1-07, M1-13 to M1-17)
- **Outcome (spikes only):** **Works with workaround.** The plugin stack runs on our hosted Render
  worker with no main-thread long tasks, no CSP violations and no third-party requests, and meets
  the §12 view targets on the self-made files. Three things we must supply ourselves:
  - a **bounded preview layer** instead of the stock page layer;
  - an **encoder worker**, because the stock image converter encodes on the main thread;
  - a **non-continuous page mode** (single page, facing), which the plugins do not have.

## Context

M0 tested EmbedPDF's _engine_ only. S3 and S5 drove tiles with our own viewport code. M1 builds the
viewer on `@embedpdf/core` and the headless plugins (§5, D-09), on top of the hosted Render worker
chosen in ADR-004. Before building on them, the [M1 plan](../plan/M1.md#m1-01--embedpdf-plugin-layer-spike-adr-011)
asks six questions:

1. Do the plugins run over a `PdfEngine` built on our hosted executor?
2. How are multiple open documents handled?
3. Can tiles be 256 px, and are stale queued tiles aborted on scroll and zoom (ADR-004 decision 3)?
4. Zoom range 1 %–6400 %, and "scaled preview first, sharp tiles later" (§5).
5. Where do renders > 100 ms happen, and can we route them to the progressive path?
6. Do any plugins fetch fonts, WASM or anything else from the network?

## Setup

- **Packages** (all MIT, pinned to exactly `2.15.1`): `@embedpdf/core`, `plugin-document-manager`,
  `plugin-viewport`, `plugin-scroll`, `plugin-render`, `plugin-tiling`, `plugin-zoom`,
  `plugin-spread`, `plugin-rotate`, `plugin-interaction-manager` (installed for M1-15, not yet
  exercised). The existing `@embedpdf/engines`, `models` and `pdfium` were also pinned exactly.
  - The plugins declare Vue, Preact and Svelte as required peers, with no `peerDependenciesMeta`.
    npm had already installed them as peers of `@embedpdf/engines`. They are MIT, we import only
    the `/react` entry points, and they are not bundled.
  - `npm run licenses`: 546 packages comply.
- **Spike:** [`spikes/s9-plugins/`](../../spikes/s9-plugins/). A React page with one
  `EmbedPDF` registry over `createHostedRender()` from S3, whose image converter is now
  selectable. Each page is a base image plus a `TilingLayer`. `window.__s9` drives the scenarios.
  The engine's `renderPage` / `renderPageRect` are wrapped to record latency (request → encoded
  Blob, including queue wait) and aborts.
- **Inputs (self-made, generated at test time, not committed):** the S5 2,000-page contract
  stand-in; synthetic A0 sheets with 20k ("typical") and 200k ("dense") stroked segments from the
  S7 generator.
- **Environment:** headless Chromium 141, Playwright 1.63, 4-core container, 1400 × 900 viewport,
  DPR 1. Served by `spikes/shared/serve.ts` under the §10.1 CSP. The numbers are informative; the
  owner's machine is authoritative.

## Findings

1. **The plugins run on the hosted engine unchanged.** `EmbedPDF` accepts our `PdfEngine`
   (the hosted proxy executor). Opening, scrolling, zooming, spread and rotation all work. The
   Render worker's WASM memory after three open documents is 35.4 MB.
2. **Multiple documents: one registry, one document manager.** `plugin-document-manager` keeps
   several documents open (`openDocumentBuffer`, `setActiveDocument`, `closeDocument`,
   `moveDocument`, order events), each with its own scale, rotation and scroll state. This maps
   directly to our tabs.
   - It accepts **per-document `permissions` overrides**. We must never pass them (rule 9,
     D-19).
   - It also has `openFileDialog`, encryption and `unlockOwnerPermissions` APIs. We don't use the
     dialog (M1-13 has its own open pipeline); the others belong to M2.
3. **Tiles: 256 px works, and stale tiles are aborted.**
   - `TilingPluginPackage` takes `tileSize`, `overlapPx` and `extraRings`.
   - The stock `TilingLayer` aborts a tile's render task when the tile leaves the visible set
     (component unmount). The engine queue (`WorkerTaskQueue`, concurrency 1) removes aborted
     tasks that are still queued.
   - Zoom thrash (12 zoom changes 40 ms apart): **311 of 351** (20k sheet) and **331 of 383**
     (200k sheet) tile requests were aborted, with no long tasks.
   - In an earlier run, the worker's call counter showed that most aborted tiles had **already
     been dispatched**. A deep-zoom tile renders in a few milliseconds, so the queue drains faster
     than the view changes. Abort mostly saves the encode and display work; queued-abort matters
     more for expensive tiles (dense pages at low zoom).
4. **Zoom range.** `minZoom: 0.01` and `maxZoom: 64` are honoured: the zoom state reads exactly
   1, 8 and 64 after requesting them. Zoom modes are `fit-page`, `fit-width` and `automatic`.
   "Fit visible" and "actual size" are our own calculations (M1-15).
5. **The stock page layer (`RenderLayer`) is not usable as the base image.** It renders the
   **whole page at the current zoom**. At 6400 % on an A0 sheet that is a bitmap of about
   190,000 × 134,000 px. Instead, the spike renders a **bounded preview** (longest side ≤ 1024 px)
   under the tiles. With it, there were **0 blank-page frames** at 900 px/s and at 3,000 px/s.
   - Preview renders are the renders that exceed 100 ms: they go through the engine's
     `renderPage` at CRITICAL priority, as one uninterruptible call in the Render worker. With
     the facing and rotated views, preview p95 was 773 ms. (In that path the spike derived the cap
     from a stale scale, so some previews reached 4.4 MP; M1-14 must take the scale from the
     plugin's document state and test the cap.)
   - Because the base layer is our own component, it can call the Render worker's progressive
     path for heavy pages (M1-17) instead of `renderPage`. No plugin change is needed.
6. **Main-thread image encoding.** `browserImageDataToBlobConverter`, which S3 used, draws each
   tile into a `<canvas>` on the main thread and encodes it there. EmbedPDF's own type docs say it
   "blocks the main thread during encoding". That goes against rule 1. The spike added an encoder
   worker (`OffscreenCanvas.convertToBlob`, pixels transferred, not copied). Same run, same files:

   | Converter              | Contract first preview | Tiles while scrolling 900 px/s (p50 / p95 / max) | Dense A0 first preview | Dense A0 at 800 %: sharp / tile p95 |
   | ---------------------- | ---------------------- | ------------------------------------------------ | ---------------------- | ----------------------------------- |
   | Main-thread canvas PNG | 242 ms                 | 68 / 132 / 198 ms                                | 564 ms                 | 190 ms / 173 ms                     |
   | **Encoder worker PNG** | **224 ms**             | **51 / 91 / 119 ms**                             | **407 ms**             | **138 ms / 124 ms**                 |
   | Encoder worker WebP    | 371 ms                 | 55 / 122 / 125 ms                                | 466 ms                 | 118 ms / 95 ms                      |

   None of the variants produced a long task. The worker is faster anyway, and WebP gives no
   consistent gain.

7. **No non-continuous page mode.** `plugin-scroll` is always continuous (vertical or horizontal).
   `plugin-spread` gives facing pairs (`odd` / `even`). So **continuous** and **continuous
   facing** come from the plugins. **Single page** and **facing** (one page or spread at a time,
   §5) do not exist.
8. **Network:** the viewer plugins fetch nothing. There were **0 CSP violations** and **0
   cross-origin requests** in every scenario. One same-origin 404 appeared in the console; it was
   not traced (the spike page has no favicon or manifest, which is the likely cause).
9. **§12 targets on these self-made files** (typical files; heavy files remain owner runs):

   | Target                                  | Measured                                                                       |
   | --------------------------------------- | ------------------------------------------------------------------------------ |
   | 2,000-page contract: first page < 1.5 s | open 134 ms, first preview 231 ms                                              |
   | Smooth scroll, no blank flashes         | 0 blank-page frames at 900 and 3,000 px/s; frame gap p95 16.8 ms               |
   | Dense A0: first view < 2 s              | 403–743 ms (200k segments); 120–202 ms (20k)                                   |
   | Sharp tiles < 0.5 s after zoom          | 148–328 ms to settle at 100 %, 800 %, 6400 % and fit page, both sheets         |
   | No main-thread task > 100 ms            | **0 long tasks** across open, scroll, zoom, thrash, spread, rotate, three docs |

## Options considered

For the base (preview) layer:

1. **Stock `RenderLayer` at the current zoom.** Unbounded bitmaps at deep zoom. Rejected.
2. **Stock `RenderLayer` with a capped `scale` prop.** Works, but every preview is one
   uninterruptible `renderPage`, even when it takes 800 ms.
3. **Our own `PreviewLayer`**: a capped scale taken from the plugin's document state, served by
   `renderPage` for light pages and by the Render worker's progressive path for heavy ones
   (ADR-004 decision 3). **Recommended.**

For image encoding:

1. **Main-thread canvas (stock).** Against rule 1. Rejected.
2. **EmbedPDF's `createWorkerPoolImageConverter` with its encoder pool.** The pool is started as
   inline `blob:` workers (ADR-003) and copies the pixels.
3. **Our own encoder worker behind the same `ImageDataConverter` interface**, receiving transferred
   pixels. A normal precacheable worker file. **Recommended.**

For single-page and facing (non-continuous) modes:

1. **Our own paged mode:** the same viewport, preview and tiling layers, laid out to show only
   the current page or spread, with page navigation moving the window. **Recommended**; it stays
   inside our view layer.
2. **Drop the non-continuous modes.** They are in §5, so that would need an ARCHITECTURE change.
   Not proposed.

## Decision

1. **Adopt the plugin stack** listed under Setup, pinned to exactly 2.15.1, with one registry and
   `plugin-document-manager` for tabs. Never pass per-document `permissions` overrides (rule 9).
2. **Tiles:** stock `TilingLayer` with `tileSize: 256`, `overlapPx: 2.5` and `extraRings: 0`. This
   gives the ADR-004 queue-level abort without extra code.
3. **Base layer:** our own `PreviewLayer` (option 3), capped at a longest side of 1024 px (tunable),
   with the scale taken from the plugin's document state. Heavy pages use the progressive path.
4. **Encoding:** our own encoder worker (option 3), PNG. The main thread never encodes an image
   (rule 1). `browserImageDataToBlobConverter` is not used in `/src`.
5. **Zoom:** `minZoom: 0.01`, `maxZoom: 64`. Fit visible and actual size are computed by us.
6. **View modes:** continuous and continuous facing come from the plugins. Single page and facing
   come from our own paged mode (option 1).

No ARCHITECTURE.md change is needed: §5 already specifies "EmbedPDF virtualized scroll + tiled
rendering" and "an immediate scaled preview, sharp tiles within 0.5 s".

## Consequences

- **M1-07:** add `src/workers/encoder.worker.ts` and the converter; the hosted engine takes it.
  Count the encoder worker in the core precache (M1-25).
- **M1-14:** build `PreviewLayer` and test the preview-size cap. Use the stock `TilingLayer`.
- **M1-16:** build the paged mode (single page, facing) next to the plugins' continuous modes.
- **M1-17:** `PreviewLayer` is where heavy renders switch to the progressive path.
- **M1-13:** open documents with `openDocumentBuffer` from our own pipeline, not `openFileDialog`.
- **Dependencies:** Vue, Preact and Svelte stay in `node_modules` as unused peers. The license gate
  covers them, and M1-27's bundle report must show that none of them is bundled.
- **Risks:**
  - Plugins pinned at 2.15.1. An upgrade needs this spike re-run (tile abort, zoom clamp, render
    priorities).
  - The tile-latency tail at 3,000 px/s (p95 340 ms, max 555 ms) is covered by the preview, but
    the owner's dense drawings may be slower (measure and report, ADR-002).

## Evidence

- **Code:** [`spikes/s9-plugins/`](../../spikes/s9-plugins/): `main.ts` (plugin page,
  instrumentation, scenarios), `encoder.worker.ts`, `make-fixtures.ts`, `s9.spec.ts`. Also
  `spikes/s3-two-engines/hosted-engine.ts`, which now takes an optional image converter (the
  default is unchanged).
- **Command:** `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium SPIKE=s9 npm run spikes --
--project=s9`. 3/3 pass; raw numbers go to `test-results/s9-results.json`.
- **Source reading (2.15.1):** `plugin-tiling` React `TileImg` (abort on unmount);
  `plugin-render` React `RenderLayer` (whole page at `documentState.scale`); `@embedpdf/engines`
  `WorkerTaskQueue` (concurrency 1, `cancel()` removes queued tasks) and
  `browserImageDataToBlobConverter` (main-thread canvas); `plugin-zoom` clamp to
  `[minZoom, maxZoom]`; `plugin-scroll` strategies (vertical, horizontal only).
