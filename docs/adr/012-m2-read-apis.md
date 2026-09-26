# ADR-012: M2-01 — Text layer, thumbnails, bookmarks, links, attachments and layers

- **Status:** Accepted (owner, 2026-09-26). Decision 5 (layers): **option 1, list-only pane**
  (M2-Q8), built in M2-11. No ARCHITECTURE.md change.
- **Date:** 2026-09-26
- **Deciders:** Owner (M2-Q8); recorded by the coding agent
- **Related decisions:** D-09, D-10, §5, §7.12 (rule 9); ADR-001 B14; ADR-004 decisions 3–4;
  ADR-011 decision 1; CLAUDE.md rules 1, 2, 4, 5 and 9
- **Related spike / milestone:** M2-01 (feeds M2-04, M2-08, M2-10, M2-11)
- **Outcome (spikes only):** **Works with workaround.** Every API the panes and the text layer need
  exists in EmbedPDF 2.15.1. The workaround is _where_ the calls run: the Render worker's
  one-call-at-a-time queue is shared with the visible tiles, so text geometry, dense-page
  thumbnails and attachment reads must not go through it. **Layers cannot be toggled**: this
  PDFium build has no optional-content API.

## Context

The [M2 plan](../plan/M2.md#m2-01--spike-viewer-side-plugins-and-pdfium-apis-adr-012) asks, before
the panes and text selection are built:

1. Text layer and selection: `plugin-selection` or the engine's glyph APIs over the hosted engine;
   cost per page; does it delay tiles?
2. Thumbnails: `plugin-thumbnail` or our own renders; do they delay visible tiles?
3. Bookmarks and links: outline, link and named-destination APIs and their cost.
4. Attachments: listing and reading embedded files without copying large files through the main
   thread.
5. Layers: can PDFium list optional-content groups and render with a chosen visibility?
6. Network defaults and per-document `permissions` overrides.

## Setup

- **Source reading** of `@embedpdf/plugin-{selection,thumbnail,bookmark,attachment,print}` 2.15.1
  (`npm pack`, not installed) and of `@embedpdf/engines` `PdfEngine` (queue priorities).
- **Node harness** [`spikes/s10-read/run-node.ts`](../../spikes/s10-read/run-node.ts): the real
  `pdfium.wasm` with `PdfiumNative`, on self-made fixtures from
  [`make-fixtures.ts`](../../spikes/s10-read/make-fixtures.ts) and `e2e/fixtures/generate.ts`:
  - a 50-page file with a **500-entry, 3-level outline** (`/XYZ` and `/Fit` destinations), a GoTo
    link, a named-destination link and a URI link;
  - **22 embedded files** (20 small text files, one incompressible **20 MB** file, one embedded PDF)
    plus a FileAttachment annotation;
  - two **optional-content groups**, one ON and one OFF in the default configuration;
  - the 2,000-page contract stand-in and A0 sheets with 20k and 200k segments.
- **Browser measurement** [`e2e/perf/pane-load.spec.ts`](../../e2e/perf/pane-load.spec.ts): the
  real app (e2e build, §10.1 CSP, perf guard), 1400 × 900. Visible-tile latency while scrolling
  the stand-in at 900 px/s, alone and with 120 text-geometry calls or 400 thumbnail renders going
  through the Render engine; and zoom tiles on the dense A0 sheet with one thumbnail queued first.
  The load comes from a new e2e-only probe method `view.engineLoad` (never in production builds).
- **Environment:** cloud container, 4 cores, headless Chromium 151, Node 22. Informative numbers;
  the owner's machine is authoritative (ADR-002).

## Findings

### The Render queue is the constraint

EmbedPDF's `PdfEngine` runs **one executor call at a time** (ADR-004), ordered by priority:
CRITICAL (previews) > HIGH (tiles, `renderPageRect`) > MEDIUM (geometry, bookmarks, attachments,
`renderThumbnail`) > LOW. Priority only orders the _queue_. Once a call is dispatched, the tiles
wait for it to finish.

- `plugin-thumbnail` renders through `renderPageRect`, i.e. at **HIGH, the tiles' own priority**.
- `plugin-selection` calls `getPageGeometry` and `getTextSlices` (MEDIUM).
- `plugin-bookmark` and `plugin-attachment` are thin wrappers over one engine call each.
- `plugin-print` calls `preparePrintDocument` and prints a `blob:` iframe (M2-02's subject).

### 1. Text layer and selection

| Measure (Node, PdfiumNative)                              | Result                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `getPageGeometry`, stand-in page (4,883 glyphs, 105 runs) | p50 **30 ms**, p95 45 ms, max 69 ms; not cached (warm p50 28 ms) |
| `getPageTextRects`, same pages                            | p50 12 ms, p95 18 ms                                             |
| `getTextSlices`, 400 characters                           | 2.7 ms                                                           |
| `getPageGeometry`, dense A0 (200k segments, no text)      | 203 ms first call (page parse), 0.1 ms after                     |

Browser, stand-in at 900 px/s, two runs:

| Visible tiles (p50 / p95 / max, ms) | Baseline     | + text geometry through the Render queue |
| ----------------------------------- | ------------ | ---------------------------------------- |
| Run 1                               | 14 / 65 / 73 | **43 / 105 / 105**                       |
| Run 2                               | 12 / 28 / 35 | **34 / 84 / 98**                         |

Geometry calls themselves took p50 34 ms, max 107 ms (queue wait included). **Text geometry
through the Render queue triples tile p50.** No main-thread long task: receiving ~5,000 glyphs
per page on the main thread stays well under 100 ms.

`plugin-selection` otherwise fits: it hit-tests from cached geometry on the main thread,
assembles text with `getTextSlices`, and refuses `getSelectedText` / `copyToClipboard` without
`PdfPermissionFlag.CopyContents` (rule 9), read from the document's own permissions (we never
pass overrides, ADR-011).

### 2. Thumbnails

| Page (150 px wide) | First render | Again | `renderThumbnailRaw` |
| ------------------ | ------------ | ----- | -------------------- |
| Stand-in page      | 8 ms         | 4 ms  | 5 ms                 |
| A0, 20k segments   | 24 ms        | 9 ms  | 42 ms                |
| A0, 200k segments  | **209 ms**   | 86 ms | 269 ms               |

A thumbnail walks every page object whatever its size. Browser:

- stand-in, 400 thumbnails during the 900 px/s scroll: thumbnails p50 3–5 ms; tiles unchanged
  within run-to-run noise (p50 12–14 ms);
- dense A0, one thumbnail queued before a zoom to 600 %: zoom tiles p50 **46 → 107 ms**, p95
  72 → 141 ms. One dense thumbnail delays every tile of the next view.

### 3. Bookmarks and links

- `getBookmarks`: **500 entries in 11 ms**, 3 levels, titles and targets resolved:
  `{ type: 'destination', destination: { pageIndex, zoom: { mode, params: { x, y, zoom } } } }`
  (mode 1 = `/XYZ`, 2 = `/Fit`, …).
- Link annotations from `getPageAnnotations` carry the same resolved `target`: a direct `/Dest`,
  a **named destination** (resolved to page 3, `/Fit`), and a URI action
  (`{ type: 'action', action: { type: 3, uri } }`). Nothing is fetched.

### 4. Attachments

- `getAttachments` lists **document-level** files only: name, description, size (22 listed in
  88 ms). The MIME type and checksum come back empty for our files.
- `readAttachmentContent` of the 20 MB file: **438 ms in one uninterruptible call**; the WASM heap
  grew from 51 to 147 MB (it never shrinks, ADR-004).
- The embedded PDF reads back intact (`%PDF-`), so it can be opened as a tab.
- **FileAttachment annotations are not listed**, and EmbedPDF's model for them has no file field.
  Reading them needs direct PDFium calls (`FPDFAnnot_GetFileAttachment`,
  `FPDFAttachment_GetName` / `GetFile`; ADR-001 B14).

### 5. Layers (optional content)

- PDFium renders the document's **default configuration**: the ON group was drawn, the OFF group
  was not.
- This PDFium build exports **no optional-content function** (none of 599 functions matches
  OCG, OCProperties, OptionalContent or Layer). Upstream PDFium has no public API to change OCG
  visibility for rendering either. So we **can't toggle layers** without a PDFium change.
- Listing layers is possible with our own object reader (ADR-007 `pdf-object.ts`, M3 port):
  `/OCProperties /OCGs`, `/D /Order`, `/ON`, `/OFF`.

### 6. Network and permissions

- None of these APIs or plugins fetches anything. The browser run had 0 CSP violations, 0
  cross-origin requests and 0 main-thread long tasks (perf guard).
- Only `plugin-selection` checks permissions, from the document's own flags.

## Options considered

**Text layer**

1. `plugin-selection` as is. Triples tile latency while text loads. Rejected.
2. Our own selection layer on Work-worker text data. Rebuilds hit-testing, ordering, and copy that
   the plugin already does.
3. **`plugin-selection`, with its two text calls answered by the Work worker.** Our `PdfEngine`
   subclass overrides `getPageGeometry` and `getTextSlices` to call the Work worker directly,
   bypassing the Render queue. Text never changes with annotation edits, so the Work worker's
   read-only copy is always right for text (page operations in M4 refresh it anyway). The Work
   worker's scheduler runs them at interactive priority, preempting background indexing at page
   boundaries. **Recommended.**

**Thumbnails**

1. `plugin-thumbnail`. HIGH priority, and dense pages block tiles for up to 270 ms. Rejected.
2. **Our own thumbnails pane** (virtualized, like the page list): light pages via
   `renderThumbnail` (MEDIUM, below tiles), at most one thumbnail in flight, paused while the
   document scrolls or zooms; pages the M1-17 cost model marks heavy use the progressive path
   (cancellable slices) at the lowest priority. Stays in the Render worker, so thumbnails show
   the authoritative document with unsaved edits. **Recommended.**
3. Thumbnails from the Work worker. No tile interference, but they would lag unsaved edits.

**Attachments:** read and list them in the **Work worker** (its own PDFium, memory respawn
policy), transferring the bytes out; annotation-level files through direct PDFium calls there.

**Layers (M2-Q8):**

1. **List-only Layers pane** (names and default state from our object reader), clearly labelled
   that visibility follows the document's settings. Cheap; honest; no toggle.
2. Toggle by rendering from a patched in-memory copy (our object layer rewrites `/D /OFF`) opened
   as a second document in the Render worker. Doubles memory and open time per toggle, and tiles
   of the two copies must never mix. Not recommended for Rev 0.
3. Drop the Layers pane from Rev 0 until an optional-content API exists (upstream request to
   EmbedPDF/PDFium).

## Decision

1. **Text layer:** `@embedpdf/plugin-selection` 2.15.1 (MIT, with its peer
   `plugin-interaction-manager`, already installed), with `getPageGeometry` / `getTextSlices`
   served by the **Work worker** through a `PdfEngine` subclass in `/src/engine` (option 3).
   Geometry is loaded for visible pages only and cached by the plugin.
2. **Thumbnails:** our own pane (option 2). `plugin-thumbnail` is not added.
3. **Bookmarks and links:** engine `getBookmarks` and `getPageAnnotations` directly (one cheap
   call each, MEDIUM on the Render worker); `plugin-bookmark` is not added. Links for visible
   pages only.
4. **Attachments:** in the Work worker (list, read, annotation-level files by direct PDFium calls
   per B14); bytes transferred, never structured-cloned; `plugin-attachment` is not added.
5. _(Owner, M2-Q8 — accepted 2026-09-26)_ **Layers:** **option 1** (list-only pane) for M2-11, with option 3's
   upstream request filed. M2-11's layer part waits for this answer.

No new runtime dependency except `@embedpdf/plugin-selection` (added in M2-04, pinned exactly;
license gate at that point).

## Consequences

- **M2-04:** add `plugin-selection`; `PdfEngine` subclass + Work-worker `geometry` / `textSlices`
  RPCs; the pane-load scenario gets a gate: tiles p50 within +25 % of baseline while text loads.
- **M2-08:** own thumbnails pane as above; the same scenario gates thumbnail load; the dense-A0
  zoom case must not queue a thumbnail ahead of tiles (pause while zooming).
- **M2-10:** bookmarks/links from the engine; `zoom.mode` values map to our view (fit page, fit
  width, XYZ with zoom 0 = keep current zoom).
- **M2-11:** attachments in the Work worker; a 20 MB read is one ~0.4 s uninterruptible call there
  (acceptable off the Render queue; progress shown as indeterminate). Include attachment reads in
  the ADR-004 respawn policy (the heap grew ~96 MB).
- **Risk:** the `PdfEngine` subclass depends on EmbedPDF's method names (pinned 2.15.1); a unit test
  asserts the overridden methods exist.

## Evidence

- Code: [`spikes/s10-read/`](../../spikes/s10-read/) (`make-fixtures.ts`, `run-node.ts`),
  [`e2e/perf/pane-load.spec.ts`](../../e2e/perf/pane-load.spec.ts), `view.engineLoad` in
  `src/testing/viewProbe.ts` (e2e build only).
- Commands:
  - `node spikes/s10-read/run-node.ts` → `spikes/s10-read/out/s10-node.json`;
  - `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npx playwright test --project=perf
e2e/perf/pane-load.spec.ts` → `test-results/m2-pane-load.json`.
- Source reading (2.15.1): `plugin-thumbnail` `renderThumb` → `renderCapability.renderPageRect`;
  `plugin-selection` `getPageGeometry`, `getTextSlices`, `checkPermission(CopyContents)`;
  `@embedpdf/engines` `PdfEngine` priorities; `@embedpdf/pdfium` function list (no OCG exports).
