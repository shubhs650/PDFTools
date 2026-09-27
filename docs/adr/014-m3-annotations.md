# ADR-014: M3-01 — Annotation plugin, undo history, drawing markups and the comment data path

- **Status:** Accepted (owner, 2026-09-27). Decisions 2 and 3 replace parts of the stock plugin with our
  own code; neither changes ARCHITECTURE.md (§5 tiled rendering, §7.1, D-09 "replace that plugin
  only; drop to engine level for that subsystem").
- **Date:** 2026-09-27
- **Deciders:** Owner (accepted 2026-09-27); recorded by the coding agent
- **Related decisions:** D-03, D-09, D-10, §5, §7.1; ADR-001 B7 and B14; ADR-004; ADR-005 (`/NM`);
  ADR-011; ADR-012; CLAUDE.md rules 1, 2, 6, 7, 9 and 12
- **Related spike / milestone:** M3-01 (feeds M3-05, M3-08 … M3-12)
- **Outcome (spikes only):** **Works with workaround.** Every EmbedPDF tool, reply and review
  state round-trips through our narrow Ctrl+S, and `plugin-history` gives per-document undo. Two
  stock behaviours don't scale and are replaced: the plugin **loads every annotation of the
  document through the Render queue** at open, and the stock layer **draws markups as bitmaps at
  the current zoom** (unbounded at deep zoom). PDFium's own "draw annotations" render flag is no
  alternative: it re-parses every annotation of the page on every tile.

## Context

§7.1 asks for every EmbedPDF annotation tool with standard appearance streams (B7), replies
(`/IRT`), review status, per-document unlimited undo, a Comments pane over all markups, and
keyboard editing (rule 12). ADR-012 showed that the Render worker runs **one call at a time**: any
bulk call on its queue delays the visible tiles. The [M3 plan](../plan/M3.md#m3-01--spike-annotation-plugin-history-and-comment-data-path-adr-014)
asks eight questions before M3-05 builds the annotation layer.

## Setup

- **Source reading** of `@embedpdf/plugin-annotation`, `plugin-history` and
  `plugin-interaction-manager` 2.15.1 (`npm pack`, not installed) and of `@embedpdf/engines`
  (`PdfEngine` queue, `PdfiumNative` annotation calls).
- **Node harness** [`spikes/s12-annotate/run-node.ts`](../../spikes/s12-annotate/run-node.ts):
  real `pdfium.wasm` with `PdfiumNative`, our `SaveTracker`, digest and verification (M1-20/21).
- **Annotation tiles** [`spikes/s12-annotate/annot-tiles.ts`](../../spikes/s12-annotate/annot-tiles.ts):
  a 256-px tile of only the markups whose rect meets it, drawn with `EPDF_RenderAnnotBitmap`
  through the tile's matrix, checked pixel by pixel against PDFium's full render.
- **Browser** [`e2e/perf/annotation-load.spec.ts`](../../e2e/perf/annotation-load.spec.ts): the
  real app (e2e build, §10.1 CSP, perf guard), 1400 × 900, visible tiles while scrolling the
  stand-in at 900 px/s, alone and while `getAllAnnotations` runs on the Render queue (new
  e2e-only probe method `view.engineLoad('allAnnotations')`).
- **Fixtures** (self-made, generated at test time, `e2e/fixtures/generate.ts`):
  `markedContractPdf` — the 2,000-page stand-in with 5 square markups per page (10,000), each with
  `/NM`, `/T`, dates and an appearance stream; `markedSheetPdf` — the dense A0 sheet (200k
  segments) with 1,000 markups; plus the 21-tool set from S1 and small reply/`/NM` files.
- **Environment:** cloud container, 4 cores, Node 22, headless Chromium 151. Informative numbers;
  the owner's machine is authoritative (ADR-002).

## Findings

### 1. The plugins and what they call

- `plugin-annotation` (MIT; deps `@embedpdf/models`, `@embedpdf/utils` — MIT, already installed)
  requires `plugin-history`, `plugin-selection`, `plugin-interaction-manager` and `plugin-scroll`
  as peers (all MIT, all but history already in the app).
- Engine calls: `getAllAnnotations` (**once per document on load**, `onDocumentLoaded`),
  `createPageAnnotation` / `updatePageAnnotation` / `removePageAnnotation` (commit batches),
  `renderPageAnnotations` (the React layer's appearance bitmaps, per page and per scale), and
  `getPageAnnotations`, `renderPageAnnotation`, `exportAnnotationAppearanceAsPdf` on demand.
- Every mutation is refused by the plugin itself without `ModifyAnnotations` (bit 6), read from
  the core's permission state; the document manager refreshes it after an owner unlock. Our
  Render worker refuses independently (M1-20, rule 9). No per-document overrides are passed
  (ADR-011).
- Nothing is fetched from the network.

### 2. Every tool round-trips (questions 2, 3)

- All **21** S1 tool annotations (19 tools + 2 cloud variants, incl. the image stamp) are created
  through `PdfiumNative`: create p50 0.6 ms, p95 6.2 ms, max 13.8 ms.
- The narrow Ctrl+S (18.5 KB tail) reopens with all 21, **every one with an appearance stream**
  (rule 6), and the M1-21 digest verifies.
- Select, move, resize, vertex edit and rotate are plugin interactions (`AnnotationContainer`
  handles); keyboard moves are possible through its `moveAnnotations` / `updateAnnotation` API
  (M3-05 wires the keys).

### 3. Loading every annotation (question 1, 6)

`getAllAnnotations` = `getAnnotationsBatch` over chunks of **500 pages**, LOW priority, each chunk
one uninterruptible executor call:

| Document                          | Annotations | Per 500-page chunk (Node) | Per page, warm                      |
| --------------------------------- | ----------- | ------------------------- | ----------------------------------- |
| Stand-in, 2,000 pages, no markups | 0           | 0.7–1.3 ms                | 0.4 ms                              |
| Stand-in with 5 markups per page  | 10,000      | **178–195 ms**            | 2.6 ms                              |
| Dense A0 sheet with 1,000 markups | 1,000       | 62 ms                     | 510 ms (first call parses the page) |

Browser, scrolling the marked stand-in at 900 px/s (two runs):

| Visible tiles (p50 / p95 / max, ms) | Baseline           | While `getAllAnnotations` runs on the Render queue |
| ----------------------------------- | ------------------ | -------------------------------------------------- |
| Run 1                               | 14.6 / 22.8 / 29.2 | 16.0 / **168.6** / 170.2 (load 734 ms)             |
| Run 2                               | 17.3 / 100.8 / 112 | 15.7 / **177.9** / 186.2 (load 773 ms)             |

The 10,000 annotation objects arrive on the main thread without a long task (0 over 100 ms);
the plugin's store update for them is not measured here (M3-05 gate).

### 4. Drawing markups (question 1)

Today's tiles and previews are rendered **without** annotations (`plugin-render`'s default
`withAnnotations: false`): EmbedPDF expects the annotation layer to draw them. Three ways, on the
dense A0 sheet with 1,000 markups:

| Route                                                                                                   | Cost                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content tile (256 px), no markups                                                                       | p50 27 ms at 25 %, 0.5 ms at 800 %                                                                                                                                |
| **PDFium's `FPDF_ANNOT` flag in the same tile**                                                         | **p50 346 ms / 332 ms** (every render call rebuilds the page's whole annotation list)                                                                             |
| Stock layer: `renderPageAnnotations` (one bitmap per markup, per page, per zoom step)                   | 44–167 ms per page per zoom change; bitmap = the markup's rect at the current zoom: a sheet-size cloud is 6 MP at 100 %, **384 MP at 800 %**, 24,576 MP at 6400 % |
| **Annotation tile**: only the markups meeting the tile, `EPDF_RenderAnnotBitmap` with the tile's matrix | **p50 3.5 ms at 25 % (≈170 markups per tile), 0.2 ms at 800 %**; rect list for the page 4 ms once                                                                 |

The annotation tile composited over the content tile matches PDFium's own full render within
**3/255 per channel** at 25 %, 100 % and 800 % (straight alpha, top-left page matrix as in
EmbedPDF's `buildUserToDeviceMatrix`).

### 5. Undo and redo (question 4)

`plugin-history` keeps a per-document command stack per topic plus a global timeline, unlimited,
cleared on close; `plugin-annotation` registers every create/update/delete (and grouped moves)
as one command. An undo issues ordinary engine calls, so the Render worker's tracker marks the
objects dirty and the next Ctrl+S appends a new revision (rule 7): history never rewrites a saved
file. Object-layer patches (M3-03) are not engine calls: measurement tools register their own
history command that re-stages or removes keys (M3-16).

### 6. Replies and review state (question 5)

- `createPageAnnotation` with `inReplyToId` + `replyType` writes `/IRT` as an **object reference**
  to the parent and `/RT /R`; with `stateModel` + `state` it writes `/StateModel (Review)` and
  `/State (Accepted)`. Saved narrow; read back with the same fields.
- An Acrobat-style file (reply and `/StateModel`/`/State` reply with `/IRT` references) is read
  with `inReplyToId`, `state`, `stateModel` set. The parent must be on the same page (EmbedPDF
  resolves `/IRT` per page), which is how viewers write them.
- `/RT /Group` is supported by the model (the ADR-007 grouped measurement label).

### 7. `/NM` (question 7)

- EmbedPDF's reader assigns a random `/NM` in memory to an annotation without one (M1-21).
- A no-op `updatePageAnnotation` of that annotation marks it dirty; the next narrow save persists
  the `/NM` (1.7 KB tail, 2–3 ms). Cheapest way to make a reference (reply, CRS row, number)
  stable (ADR-005 consequence).
- Reading an annotation **without an appearance** makes PDFium generate one: the next Ctrl+S then
  has a small tail (1.3 KB here) though nothing was edited.
- The ids come from the worker that read the file: if the Work worker lists annotations, its
  random ids for `/NM`-less annotations differ from the Render worker's. Decision 2 fixes that.

## Options considered

**Loading every annotation**

1. Stock (`getAllAnnotations` on the Render queue). 0.7 s of uninterruptible LOW-priority chunks
   right after open; tile p95 7× baseline while it runs; worse on files with more markups.
2. Visible pages only (`getPageAnnotations` as pages appear). Cheap per page, but the Comments
   pane, auto-numbering and the CRS need all markups, and the plugin's store would be partial.
3. **`getAllAnnotations` answered by the Work worker** (like text geometry in ADR-012): the
   `RoutedPdfEngine` override calls a Work RPC that runs the same batch on the read-only copy.
   At load time that copy _is_ the document (original + committed tails; a recovered document
   opens both workers with the same tail). **Recommended.**

**Drawing markups**

1. Stock appearance bitmaps. Unbounded bitmaps at deep zoom (the ADR-011 `RenderLayer` problem
   again) and a Render call per page per zoom step.
2. `withAnnotations: true` in content tiles. 330–410 ms per tile on a markup-heavy page, and every
   edit re-renders content tiles.
3. **Own annotation tiles**: a second tile layer of transparent 256-px tiles holding only the
   markups that meet each tile, drawn in the Render worker from PDFium's own appearance streams
   (no appearance code of ours, B7), encoded in the encoder worker. Bounded at every zoom; cost
   follows the markups in the tile; an edit invalidates only the annotation tiles under the old
   and new rect; content tiles never re-render. The plugin's layer keeps selection, handles,
   previews and hit-testing. **Recommended.**
4. The plugin's SVG renderers (`useAppearanceStream: false`). Vector and cheap, but they draw
   from the model, not the appearance stream, so what we show would differ from what Acrobat
   shows. Rejected (D-03).

## Decision

1. **Adopt** `@embedpdf/plugin-annotation` and `@embedpdf/plugin-history` 2.15.1 (MIT, pinned
   exactly), added in M3-05 with the license gate. `annotationAuthor` from the reviewer profile
   (M3-07). Never pass permission overrides (ADR-011).
2. **Load path:** `getAllAnnotations` is served by the Work worker through `RoutedPdfEngine`
   (new Work RPC `annotations`, background priority below interactive search). Ids for
   annotations without `/NM` are **deterministic** (`obj-<object number>`, set on the Work side
   before EmbedPDF's reader would invent one); the Render worker's executor wrapper resolves such
   an id by object number and writes that `/NM` before any update, delete or reply that targets
   it, so the edit also persists it (question 7).
3. **Drawing:** own annotation tiles (option 3) over the content tiles, one new Render RPC
   (`annotationTile`, raw `EPDF_RenderAnnotBitmap`), at the tiles' priority, cancellable like
   tiles. `renderPageAnnotations` is answered with an empty map by `RoutedPdfEngine` so the stock
   layer never asks for bitmaps; our renderers make the plugin's layer draw only hit areas,
   selection and live previews. An annotation being dragged or edited is left out of its annotation
   tiles until the change commits.
4. **Undo/redo:** `plugin-history`'s global timeline per document for Ctrl+Z / Ctrl+Y and the
   Quick Access buttons; object-layer patches register their own commands.
5. **Replies and review states:** EmbedPDF's model (`inReplyToId`, `replyType`, `stateModel`,
   `state`) as is; the M3-Q3 review states are `/StateModel (Review)` replies.
6. **Comments pane data:** the plugin's store (filled by decision 2, kept current by every
   create/update/delete) is the pane's source; no separate listing RPC. M3-05 measures the store
   update for 10,000 markups against the long-task rule.

Direct PDFium exports used (B14): `EPDF_RenderAnnotBitmap`, `FPDFAnnot_GetRect`,
`FPDFPage_GetAnnotCount`, `FPDFPage_GetAnnot`, `FPDFPage_CloseAnnot`, `FPDFAnnot_GetSubtype`,
`EPDFAnnot_GetAvailableAppearanceModes`, `FPDFBitmap_CreateEx`, `FPDFBitmap_FillRect`,
`FPDFBitmap_Destroy` (and, for decision 2, `FPDFAnnot_HasKey`, `FPDFAnnot_SetStringValue`,
`EPDFAnnot_GetObjectNumber`, already used by the save tracker).

## Consequences

- **M3-05:** add the two plugins; `RoutedPdfEngine` overrides for `getAllAnnotations` and
  `renderPageAnnotations`; Work RPC `annotations`; deterministic ids and the Render-side `/NM`
  write; `AnnotationTileLayer` + Render RPC `annotationTile` with invalidation on commit and an
  exclusion set for live edits; perf gates: `e2e/perf/annotation-load.spec.ts` (tile p95 while
  loading within +25 % of baseline once routed), annotation tiles on the marked A0 sheet at 25 %,
  100 %, 800 % and 6400 % with no long task, store update for 10,000 markups without a long task.
- **M3-08 / M3-09:** tools come from the plugin's tool list; their previews are the plugin's.
- **M3-11:** the Comments pane reads the plugin store; numbers and filters are pure functions of
  it.
- **M3-12:** replies and state replies through the plugin API; `/IRT` needs the parent on the
  same page.
- **Annotations without appearance streams** (old viewers): PDFium generates one when such an
  annotation is read; with decision 3 they are read by the Render worker only when an annotation
  tile needs them, and their new objects join the next real save (never an extra save).
- **Risks:**
  - both overrides and the annotation-tile call depend on EmbedPDF method names and the
    `EPDF_RenderAnnotBitmap` export (pinned 2.15.1); a unit test asserts they exist;
  - rotated annotations (`/Rotate` extension) and appearance modes other than Normal need checks
    in M3-05 (the stock layer skips rotated ones too);
  - the plugin's main-thread store with 10,000 markups is unmeasured until M3-05.

## Evidence

- Code: [`spikes/s12-annotate/`](../../spikes/s12-annotate/) (`run-node.ts`, `annot-tiles.ts`),
  [`e2e/perf/annotation-load.spec.ts`](../../e2e/perf/annotation-load.spec.ts),
  `view.engineLoad('allAnnotations')` in `src/testing/viewProbe.ts` (e2e build only), fixtures
  `markedContractPdf` / `markedSheetPdf` in `e2e/fixtures/generate.ts`.
- Commands:
  - `node --import ./spikes/shared/ts-ext.ts spikes/s12-annotate/run-node.ts` →
    `spikes/s12-annotate/out/s12-node.json`;
  - `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npx playwright test --project=perf
e2e/perf/annotation-load.spec.ts` → `test-results/m3-annotation-load.json`.
- Source reading (2.15.1): `plugin-annotation` `onDocumentLoaded` → `getAllAnnotations`,
  `executeCommitBatch`, `checkPermission(ModifyAnnotations)`, React `AnnotationLayer`
  (`getPageAppearances` per page and scale, `useAppearanceStream`, `annotationRenderers`);
  `plugin-history` `register` / `undo` / `redo`; `@embedpdf/engines` `getAllAnnotations` (500-page
  LOW chunks), `renderPageAnnotationsRaw` / `renderSingleAnnotAppearance`
  (`EPDF_RenderAnnotBitmap`), `renderRectEncoded` (`withAnnotations` → `FPDF_ANNOT`);
  `@embedpdf/core` `getEffectivePermission`.
