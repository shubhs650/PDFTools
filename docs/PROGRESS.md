# PDFTools — Progress

_Last updated: 2026-09-28 (session 16: M3-01 … M3-08 merged; M3-09 … M3-15 done on the branch)_

**Current milestone:** M3 — Review. Plan approved (2026-09-27); M3-01 … M3-08 done in session 16
on `claude/m3-task-breakdown-tlyokp` (ADR-014 and ADR-015 accepted).
M0–M2 are merged into `main` (M2 complete on the agent side, owner pack in
[docs/acceptance/M2.md](acceptance/M2.md)); the M0, M1 and M2 owner runs are open.

## Done

- **Session 17 — M3-18 snapping.** Geometry extracted whole in the Work worker (new geometry
  priority, cached per page), indexed and transferred to a new pure-JS Snap worker; endpoint,
  intersection, midpoint and nearest snaps with a marker; status-bar toggle and "Preparing
  snapping…", per-kind switches on the Measure tab; Alt disables. RTT p95 3.45 ms on a
  200k-segment A0 while another page is extracted.

- **Session 17 — M3-17 scale viewports.** Draw a rectangle (or Add viewport in the Properties
  pane) → name, box, ratio or known width, units; saved as page `/VP` entries; outlines on the
  Measure tab; edit/delete undoable; measurements use their viewport (smallest wins), the page
  outside, and are flagged when they span viewports. ft-in scales now keep their fraction in
  `/Measure`.

- **Session 17 — M3-16 measurement tools.** Distance, Perimeter and Area on the Measure tab
  (Distance also on Home): live value by the pointer, `/Contents` and a grouped FreeText label
  with the value, `/IT`, `/Measure`, `/Cap` in the single Ctrl+S revision; values follow vertex
  edits in the same undo step and re-value on a scale change; files' own `/Measure` trusted
  unless it is the page's scale; uncalibrated values marked; encrypted (AES-256) files saved.

- **Session 16 — M3-15 scale model.** Measure tab: Set Scale (ratio, units, precision; this page,
  all pages or a range), Calibrate (two picked or typed points and a real length) and Units; the
  scale is saved as the page's `/VP` (other viewports kept) and `/VP` from other viewers is read;
  ft-in to 1/64"; the status bar shows the scale or "Uncalibrated".

- **Session 16 — M3-14 stamps.** Dynamic stamps from the active scheme (code, reviewer, date,
  document number and revision) drawn in the encoder worker as a 4× PNG; image stamps from
  PNG/JPG or a PDF's first page (vector, copy permission honoured). `/Subj` and `/Contents`
  carry the text; keyboard placement; 50 stamps without a long task.

- **Session 16 — M3-13 status schemes.** Three presets (1–4, A–D, Approved … For Information),
  custom schemes (codes, labels, colours with a contrast warning), the active scheme, export to
  and strict import from `.pdftools-scheme.json`; IndexedDB v3 `schemes` store.

- **Session 16 — M3-12 replies and review status.** Threads under the selected comment: replies
  (`/IRT`) and Set Status (`/StateModel /Review`, per-reviewer latest state and history), read from
  files made in other viewers too; own replies editable; deleting a comment with replies asks
  first and undoes in one step.

- **Session 16 — M3-11 Comments pane.** Every comment (unsaved ones included), numbered per
  M3-Q5, filtered by author/type/status/current page and sorted; a virtualized, keyboard-driven
  list that selects on the page and follows the page's selection; page-number overlay toggle.
  10,000 comments: first rows < 1 s, no long tasks.

- **Session 16 — M3-10 Properties pane.** Colour, fill, opacity, width, line style (incl.
  cloudy), line endings, font size/colour, subject and text of the selected comments; mixed
  values; one undo step per change; read-only without the annotate permission; Copy/Apply
  Comment Style. Also fixed: the ribbon's hidden button text widened the page in the
  pseudo-locale (310 px) once Home gained the M3-09 groups.

- **Session 16 — M3-09 note, text, drawing, ink and link tools.** Sticky note, text box,
  callout, line, arrow, polyline, polygon, rectangle, oval, cloud, pencil, ink highlighter and
  link on the Comment tab; Shift constrains, Enter/Esc finish/drop polylines, keyboard creation
  of notes and text boxes (N/T then Enter). Link dialog: page or web address (unsafe schemes
  refused). Unit + `e2e/draw-tools.spec.ts` + ink perf scenario.

- **Session 16 — perf gate fix before merging M3.** CI's perf gate tripped on 3 of 6 branch
  runs. A HEAD-vs-main comparison (longest main-thread task per scenario, two full perf runs
  each) singled out Save attachment: the main thread built a 20 MB `Blob` from the transferred
  bytes (22–27 ms on main, but 180 ms+ in 2 of 6 HEAD runs). The Work worker now returns the
  Blob itself (`readAttachment` → `{ blob }`), so the main thread only gets a handle: 0 tasks
  over 50 ms in 8 of 8 runs. Other scenarios matched main within noise.

- **Session 16 — M3-08 text markup tools.** Highlight, Underline, Strikeout, Squiggly, Insert
  Text and Replace Text on the Comment tab (Highlight also on Home), keys G/U/K/Q/I/R. Select
  text first (drag, or Ctrl+A from the keyboard) and run the tool, or turn the tool on and drag
  (on until Esc). Standard annotations with `/QuadPoints` per line, `/T` from the profile and the
  selected text in `/Contents` only when copying is allowed; Replace = Caret + StrikeOut grouped
  (`/IRT`, `/RT /Group`, `/IT /StrikeOutTextEdit`). Fixed EmbedPDF writing the selected text to
  its private `/EPDFCustom` key (rule 6) and omitting `/IT` on text markups. Unit + e2e
  `e2e/text-markup.spec.ts`.

- **Session 16 — M3-07 reviewer profile (D-16, M3-Q7).** Asked before the first markup of a
  session (Skip = "Anonymous" until the next session), stored on this device only (IndexedDB v2,
  new `profile` store, listed on the Privacy page, cleared with local data), edited in Settings
  or Comment → Reviewer Profile (the Comment tab now shows). New annotations get `/T` = name.
  Fixed: EmbedPDF re-authored any markup it edited; edits now keep the original author in the
  store and in the file. Dark `--color-danger` raised to 5.6:1. Unit + `e2e/profile.spec.ts`.

- **Session 16 — M3-06 custom icons.** The 15 M3 icons ADR-010 lists as missing, in Fluent's
  Regular line style with Filled variants for toggles (`src/ui/icons/custom/m3.ts`, drawn with
  `draw.ts` at 20 and 32 px directly; no third-party artwork, rule 15); no M3 command is
  `customPending` any more (unit test). Owner visual review pending.

- **Session 16 — M3-05 annotation layer core (ADR-014).** `@embedpdf/plugin-annotation` and
  `plugin-history` 2.15.1. Annotations load through the Work worker (new Work RPC `annotations`;
  `RoutedPdfEngine` overrides `getAllAnnotations` and returns no stock appearance bitmaps), with
  stable `obj-<n>` ids for `/NM`-less markups that the Render worker names before an edit
  (`src/workers/render/annotIds.ts`). Markups are drawn by our annotation tiles
  (`src/features/annotate/AnnotationTileLayer.tsx`, Render RPC `annotationTile`,
  `src/workers/render/annotTiles.ts`); the plugin layer draws only hit areas, handles and the
  selected body. Commands: Select Comments (shipped), Undo/Redo (Quick Access, Ctrl+Z/Y/Shift+Z),
  Delete, arrow nudge, Tab/Shift+Tab, Esc; all need the annotate permission (rule 9); a live region
  names the selection. Found and fixed: the plugin's transparent link bodies sat over our link
  layer. Unit: `tests/annotate/*` (keyboard order, stable ids, annotation tiles equal PDFium's own
  render within 4/255 on plain, rotated and crop-offset pages, Work/Render id agreement); e2e:
  `e2e/annotations.spec.ts` (tiles, stable id, click-select, nudge, undo/redo, delete, Tab, save
  with `/NM` persisted, annotate-denied file); perf gate in `annotation-load` (tile p95 +13 % while
  loading 10,000 markups; was 7×). Unit 740, e2e 171, green; bundle core 7.07 MB.

- **Session 16 — M3-04 Standard security handler.** `src/model/pdf/security/` (own MD5, RC4,
  AES-CBC; WebCrypto SHA-2 for R5/R6): file keys for R2–R6 from the user or owner password, RC4 /
  AESV2 / AESV3 / Identity crypt filters. `PdfReader.open(bytes, inflate, { password })`
  decrypts strings and streams; the Render worker's tracker derives the key from the open
  password (worker memory only, M2-Q7) and encrypts only the staged values, so measurement
  strings and `/VP` now save in encrypted files (R, P and method unchanged, qpdf-clean). Unit:
  RFC 1321 / RFC 6229 / FIPS-197 vectors, CBC vs WebCrypto, qpdf R2/R3/R4/R6/owner-only files
  (plain and object streams) read back against `qpdf --decrypt`, encrypted saves incl. Save
  Optimized and rule 9 with the user password; e2e: an AES-128 file opened with its owner
  password saves encrypted keys and verifies. New probe `view.activeDocId`. Unit 733, green.

- **Session 16 — M3-02 stamps, CRS workbook and snapshots spike.** _Works with workaround_,
  [ADR-015](adr/015-m3-stamps-crs.md) (proposed; decisions 1–2 need the owner). Stamp PNG drawn
  in a worker with the bundled Noto Sans Regular: at 4× the placed size as sharp as vector text
  up to 400 % (softer at 1600 %), ~42 KB each. ExcelJS 4.4.0's browser bundle in a worker: 1,000
  rows + 1,000 images, zip 0.6 s, 3.1 MB, worker chunk 202 KB brotli, cancel between rows, no
  long task, no CSP violation, read back correctly. **License gate fails** as installed:
  `unzipper@0.10 → binary → buffers@0.1.1` has no license (plus `chainsaw`/`traverse` "MIT/X11");
  per M3-Q9 ExcelJS is **not** added. With an npm override `unzipper@0.12.3` the gate passes (709
  packages); alternative: our own XLSX writer. Snapshots via content crop + ADR-014 annotation
  tile: 1,000 on the marked contract in 1.3 s; 200 on the marked A0 sheet in 0.5 s (72 s with
  PDFium's annotation flag). Spike `spikes/s13-stamps-crs/` (project `s13`).

- **Session 16 — M3-01 annotation spike.** _Works with workaround_,
  [ADR-014](adr/014-m3-annotations.md) (proposed). All 21 EmbedPDF tools (with appearance
  streams), replies (`/IRT` object reference, `/RT /R`) and review states (`/StateModel`,
  `/State`) round-trip through the narrow Ctrl+S and verify; Acrobat-style replies are read;
  `plugin-history` gives per-document unlimited undo. Found: the plugin loads **every**
  annotation through the Render queue on open (500-page chunks of 178–195 ms; 10,000 markups
  load in 0.73–0.77 s in the browser, tile p95 23 → 169–178 ms); today's tiles are rendered
  without annotations and the stock layer draws per-markup bitmaps at the current zoom
  (a sheet-size cloud = 384 MP at 800 %); PDFium's own annotation flag costs 330–410 ms per tile
  on a 1,000-markup page. Proposed: load via the Work worker (deterministic ids for `/NM`-less
  annotations) and our own **annotation tiles** (`EPDF_RenderAnnotBitmap` for the markups meeting
  a tile: 0.2–3.5 ms, pixel-equal within 3/255). New self-made fixtures `markedContractPdf`
  (2,000 × 5 markups) and `markedSheetPdf` (A0, 1,000 markups); perf scenario
  `e2e/perf/annotation-load.spec.ts`; e2e-only probe `view.engineLoad('allAnnotations')`.

- **Session 16 — M3-03 PDF object layer + single-revision merge.** `src/model/pdf/` (values,
  parser, serializer, async reader over `DecompressionStream`, RPC wire form) ported from S2;
  staged patches (`src/workers/render/objects/patches.ts`, Render RPC `stageObjects`) applied to
  PDFium's own serialization of the object inside the one narrow Ctrl+S tail. Patches are sticky
  (re-applied when a later save rewrites the object; appended after a Save Optimized rewrite,
  which would otherwise drop them), limited to measurement keys on annotations and `/VP` on pages,
  need the annotate permission, and refuse strings in encrypted files until M3-04. The Work
  worker checks the staged keys with our reader (`verifyObjects.ts`). The Layers pane uses the
  shared reader (scanner as fallback). Unit: `tests/objects/*` (parser, serializer, wire, reader
  incl. `/Prev`, object streams, predictors, and a qpdf cross-check of every committed fixture and
  corpus PDF), `tests/save/patch-save.test.ts` (real PDFium: 5 plain + 2 encrypted S1 originals,
  one revision, qpdf-clean, sticky re-apply, Save Optimized, undo by removal, deleted annotation,
  recovery tail, verification mismatch, rule 9); e2e: staged keys through the workers on an
  xref-stream file. Unit 705, green; no dependency added.

- **Session 16 — M3 plan.** Branch `claude/m3-task-breakdown-tlyokp`. Read PROGRESS,
  ARCHITECTURE Rev 0.4 and ADR-001 to ADR-013; wrote [docs/plan/M3.md](plan/M3.md): 20 tasks (two
  spikes → ADR-014 annotations/history/comment data path and ADR-015 stamps/CRS/snapshots; object
  layer port with single-revision merge; Standard security handler; annotation core with undo;
  custom icons; reviewer profile; text markup, note/drawing/link tools; properties pane; comments
  pane with auto-numbering; replies and review status; status schemes; stamps; scale model;
  measurement tools; scale viewports; snapping with the Snap worker; CRS export; acceptance) with
  goals, files, acceptance criteria, tests and dependencies, plus ten owner questions
  (M3-Q1 … Q10). No code.

- **Session 15 — M2-19 M2 acceptance pass and owner pack.** [docs/acceptance/M2.md](acceptance/M2.md): every §12 row met on typical files (search on the 2,000-page stand-in: first hits 52 ms, complete 5.9 s; 23 of 23 perf scenarios without a long task; M1 rows still met), every §13 M2 item mapped, owner pack (FAR / 500 MB search via `npm run owner:timings`, interop §M2 I–K, signatures after form save, live error report, Firefox). `scripts/acceptance.ts` has the M2 rows (search, M2 offline proof); new M2 offline proof in `e2e/offline.spec.ts`; the a11y gate covers every M2 pane, the find bar and the M2 dialogs in light, dark and pseudo-locale; the handler test covers every M2 command; `AVAILABLE_MILESTONES` = M1, M2. Found and fixed: Ctrl+S/O/P/F did nothing inside text fields (form fields now save with Ctrl+S, committing the typed value first); a save could overtake a form value still being committed (`pendingEdits.ts`); Home → Select Text had no handler. New perf scenario: 50-page print-ready export. Bundle 6.84 MB core / 30.85 MB installed, within budget.

- **Session 15 — M2-18 error-report endpoint.** Pages Function `functions/api/report.ts` (validate with the shared schema, same-origin, ≤ 16 KB, 5/IP/hour with a salted IP hash, D1 store, optional e-mail binding), `functions/api/schema.sql`, `functions/tsconfig.json` in `tsc -b`, owner steps in [docs/deploy/error-report.md](deploy/error-report.md). Unit: `tests/functions/report.test.ts` (in-memory D1 and mail). Unit 622, green; no dependency added.

- **Session 15 — M2-17 error-report dialog and Help.** `src/features/report/*` (payload builder, sanitizer, sender, dialog), schema shared with the endpoint in `src/model/report.ts`; the error boundary offers the report; Help → Help (`src/features/help`). e2e-only `CrashProbe` (dropped from production builds; `check:dist` clean). Unit: `tests/report` (nasty-input corpus, schema, sender); e2e: `e2e/report.spec.ts` (exact JSON posted only on Send, offline/429 with Copy report, Help). Unit 613, green.

- **Session 15 — M2-16 print-ready export and viewer print route.** File → Export Print-Ready PDF flattens a Work-worker copy (unsaved edits included; `FPDFPage_Flatten` print mode, full rewrite, `/AcroForm` and unreachable objects dropped by `src/model/printReady.ts`) and saves it as a new file; the open document is untouched; signed documents warn. Print dialog "Print with: the browser's PDF viewer" prints that copy from a `blob:` frame; §10.1 CSP gains `frame-src blob:` (ADR-013 d7). Unit: `tests/print/print-ready.test.ts` (real PDFium: 0 annots/fields, pixels, vector, object streams, encrypted, rule 9), `frame-src.test.ts`; e2e: `e2e/print-ready.spec.ts`, negative control for other frame sources. Unit 598, e2e 153, green; licenses 642 OK.

- **Session 14 — M2-15 print.** Print dialog and raster printing: `src/features/print/*`, Work-worker banded renders on a print copy with unsaved edits, encoder-worker PNGs, hidden-frame print; Ctrl+P bound; `file.print`/`qat.print` shipped. Unit: `tests/print` (range parser, raster/scale math, real-PDFium band renders); e2e: `e2e/print.spec.ts`; perf: `e2e/perf/print.spec.ts` (50 pages, no long tasks up to `print()`).

- **Session 14 — M2-14 form filling.** Fill and save AcroForms (text, checkbox, radio, combo, list) from the keyboard in `/Tabs` order; narrow Ctrl+S with the radio field family in the dirty set; Reset Form (`home.resetForm`, shipped) to `/DV`; XFA banner; rule 9 for fill-forms; Space no longer swallowed on links and toggles over the page. Unit: `tests/forms`, `tests/save/form-save.test.ts`; e2e: `e2e/forms.spec.ts`.

- **Session 14 — M2-13 Signatures pane.** Signatures pane with offline integrity check (PKI.js), signed-document banner, PKI.js-signed fixtures (valid, tampered, damaged, twice-signed, changed after signing, our Ctrl+S keeps it unchanged). Unit 535, e2e 140, green; licenses OK.

- **Session 14 — M2-12 Properties and Security Info.** Properties backstage section and Security Info dialog; byte-level facts (revisions, linearized, encryption method) with qpdf-verified RC4-40/128, AES-128/256. Unit 528, e2e 136, green; licenses OK.

- **Session 14 — M2-11 attachments (layers waiting).** Attachments pane with 20-file self-made fixture (20 MB file, embedded PDF, annotation file). Layers: list-only pane (ADR-012 d5 accepted). Unit 516, e2e 131, perf 21, green; licenses OK.

- **Session 14 — M2-10 bookmarks, links and view history.** Bookmarks tree pane, link layer with external-link confirmation, Previous/Next View. Self-made `outlinedPdf` fixture (500-entry 3-level outline, internal/named/URI links). Unit 511, e2e 129, perf 20, all green; licenses 642 OK.

- **Session 14 — M2-09 Advanced Search pane.** Advanced Search pane: options, all-tabs scope, comment and bookmark hits, virtual results with on-demand context, hand-off to Quick Find highlights. Self-made fixture `annotatedPdf` (comment + outline). Perf: common term on the 2,000-page stand-in, first rows < 1 s, 18,798 results < 15 s, 0 long tasks. Unit 502, e2e 126, perf 20 (the M2-06 indexing tile-p95 check missed once in a full run, passed 3/3 alone: watch it).

- **Session 14 — M2-08 pane framework and Thumbnails.** Pane framework (rail buttons, titled pane, Esc to rail, keyboard/pointer resizer) and the virtualized Thumbnails pane with an activity-aware, one-at-a-time thumbnail queue. Found on the way: an unconstrained list stretched the frame (fixed with an absolutely positioned list); the 2,000-page uncached Quick Find total needs ~5 s, so e2e/find.spec.ts waits up to 20 s for the total. Unit 493, e2e 122, perf 19, all green; licenses 642 OK.

- **Session 14 — M2-07 (Quick Find).** Branch `m2/07-find` (stacked on M2-06). Quick Find bar (Ctrl+F; Enter-only; F3/Shift+F3; Esc), options, "n of N", highlights on pages in view with a distinct current hit, navigation in document order across the context cap. Tests: find model units, e2e (26 keystrokes → 0 searches, needle on pages 7/1,000/1,999, wrap, options, axe), perf scenario.

- **Session 14 — M2-06 (background text indexing).** Branch `m2/06-indexing` (stacked on M2-05). Indexer in the Work worker (background priority, viewport order, pauses while scrolling/zooming via a throttled `activity` RPC); started when a document's Work copy opens, cancelled on close; searches go visible → cached → rest. Tests: Activity, indexer on real PDFium (order, pause, cancel, preempted by a search that then finds cached pages first), perf scenario on the 2,000-page stand-in.

- **Session 14 — M2-05 (search core in the Work worker).** Branch `m2/05-search` (stacked on
  M2-04). The S5 search promoted: `searchCore.ts` (query compile with error codes, matching, order,
  batcher), `search.ts` (session text cache, streaming search, context on demand past the 5,000
  cap, hit rectangles), Work RPCs `search`, `searchContext`, `hitRects`, and `SearchSession`
  (cancel on new search, stale batches dropped). New `ctx.stream()` in the RPC host: the throttled
  progress channel keeps only the latest value and would have dropped hit batches. Found: this
  PDFium counts a non-BMP character as two chars, so the hand mapping ADR-006 suggested was wrong;
  PDFium's own `FPDFText_GetCharIndexFromTextIndex` is used. Tests: ported S5 units, real-PDFium
  search (needle, exact count past the cap, cancel, rotated page rects, non-BMP, bad regex),
  session over a real channel, perf scenario on the 2,000-page stand-in (first hit 53–176 ms,
  complete 5.1–5.7 s, 0 long tasks).

- **Session 14 — M2-04 (text selection and copy).** Branch `m2/04-selection` (stacked on M2-03).
  `@embedpdf/plugin-selection` 2.15.1 (MIT; license gate 642 packages) with the interaction
  manager; per-page pointer provider and selection layer; the text geometry and text come from the
  Work worker through a `RoutedPdfEngine` (ADR-012 decision 1), falling back to the Render worker
  only when the Work worker has no copy. The Work worker now opens documents with
  `normalizeRotation` like the Render worker (rotated pages had different coordinates). Ctrl+C
  copies the selection (refused before text leaves a worker when copying is denied), Ctrl+A selects
  the current page, Esc clears; Hand never selects. Found and fixed: page images started a native
  image drag that cancelled every pointer stream after the first press. Tests: routed engine unit
  tests, Work-client open-wait, e2e drag/copy, Ctrl+A, Hand, rotated page, copy denied; perf
  scenarios for selection on the stand-in and the dense A0 sheet; the pane-load gate (geometry
  load keeps tile p50 < 2× baseline + 5 ms; it was 3× through the Render queue).

- **Session 14 — M2-03 (protected PDFs).** Branch `m2/03-protected` (stacked on M2-02). Open
  password prompt (masked, retry message, Cancel opens nothing); the same prompt on recovery and
  recent reopen. One revision-aware permission map for the UI and the Render worker's save
  tracker, which fixes the R2 case found in M2-02 (qpdf R2 file: filling was allowed). Commands
  can declare the capability they need and are disabled with a reason; a restrictions banner above
  the document; Protect → Unlock with Owner Password in both workers, surviving Work-worker
  reloads; the Protect tab shows with Unlock. New `TextField` primitive and `format.list`. Tests:
  permission rules and real-PDFium checks on qpdf R2–R6 files; Work copy unlock across a reload
  and a respawn; open-machine password transitions; e2e for the prompt, cancel, owner unlock
  (edits refused until then), and a scan of IndexedDB, OPFS and web storage that finds no password
  (with a negative control). The encrypted-fixture helper moved to `e2e/fixtures/encrypted.ts`.

- **Session 14 — M2-02 (security, forms and print spike).** Branch `m2/02-secure-print-spike`
  (stacked on M2-01). _Works with workaround_, [ADR-013](adr/013-m2-security-forms-print.md)
  (proposed). Passwords and owner unlock work on R2–R6 without reopening; saves after an unlock
  stay encrypted, narrow and qpdf-clean. Found: our M1 tracker allowed form filling on an R2 file
  that denies it (R2 needs its own permission rules, fixed in M2-03); `setFormFieldValue` ignores
  read-only; a radio change saves narrow without its parent field, which M1-21 verification
  catches (keep-all fallback, no data loss; dirty-set fix in M2-14); EmbedPDF renders ignore the
  Print flag and `preparePrintDocument` drops markups. Flattening a copy is pixel-identical and
  vector. Printing works under today's CSP as raster images in an `about:blank` iframe; vector
  printing through the browser's viewer needs `frame-src blob:` (owner decision). Spike scripts
  that import `/src` now run with `node --import ./spikes/shared/ts-ext.ts`.

- **Session 14 — M2-01 (viewer-side spike).** Branch `m2/01-read-spike`. _Works with
  workaround_, [ADR-012](adr/012-m2-read-apis.md) (proposed). EmbedPDF 2.15.1 has every API the
  panes and text layer need, but the Render worker runs one call at a time: text geometry through
  it tripled visible-tile p50 (14 → 43 ms), one dense-A0 thumbnail doubled zoom-tile p50, and a
  20 MB attachment read is one 0.4 s call. So: `plugin-selection` with text geometry from the Work
  worker; own thumbnails at lower priority; bookmarks/links straight from the engine (500 entries
  in 11 ms); attachments in the Work worker. **Layers can't be toggled** (no optional-content API
  in this PDFium) — owner choice needed (ADR-012 decision 5). New perf scenario
  `e2e/perf/pane-load.spec.ts`; e2e-only probe `view.engineLoad`.

- **Session 14 — M2 plan.** Branch `claude/m2-task-breakdown-ytspb5`. Read PROGRESS,
  ARCHITECTURE Rev 0.4 and ADR-001 to ADR-011; wrote [docs/plan/M2.md](plan/M2.md): 19 tasks
  (two spikes → ADR-012/013, protected PDFs, text selection, search core + background indexing +
  find bar + Advanced Search, panes, properties, signatures, forms, print, print-ready export,
  error report, acceptance) with goals, files, acceptance criteria, tests and dependencies, plus
  nine owner questions (M2-Q1 … Q9). No code.

- **Session 13 — M1-28 (M1 acceptance pass and owner pack).** Branch `m1/28-acceptance`. All nine
  M1 §12 rows met on typical files (offline start 227 ms, first page 872 ms, 0 blank frames, A0
  first view 371 ms, sharp tiles ≤ 276 ms, 6400 %, Ctrl+S with 100 markups 131 ms, no long tasks,
  offline proof), recomputed in CI by `npm run acceptance`. Every §13 M1 scope item checked; two
  commands without handlers found and fixed (Quick Access Open, Help → Check for Updates) with a
  test that catches any other. App-saved interop files (21, qpdf-clean) and checklist §M1; owner
  timing harness for heavy files (`npm run owner:timings`); owner pack in
  [docs/acceptance/M1.md](acceptance/M1.md).

- **Session 13 — M1-27 (CI: bundle budget, perf, offline and accessibility).** Branch
  `m1/27-ci`. Bundle report per module (raw/gzip/brotli, reserved lines for Oxide/ExcelJS/docx)
  with a 60 MB install budget and a 9 MB core budget (M1: 6.66 MB core, 30.25 MB installed) in
  the job summary; perf report of every scenario's numbers; offline and axe steps of their own; qpdf
  required for the save matrix in CI. The new axe spec (light/dark, every backstage section and M1
  dialog) found four problems, all fixed: close buttons inside the document tablist, the tab strip
  outside any landmark, tile images without `alt`, and a duplicate region name in backstage Recent.

- **Session 13 — M1-26 (local data and privacy page).** Branch `m1/26-local-data`. File →
  Settings shows what is stored and "Clear all local data…" (confirmation, open/unsaved-document
  warning): OPFS recovery snapshots, the IndexedDB database and non-app caches go; the service
  worker's app files stay, so the app keeps working offline. File → About (version + build commit,
  third-party notices) and File → Privacy (promises and a table of every local store, checked
  against the code by a unit test). Third-party notices for all 127 runtime packages, generated at
  build time (PDFium and the fonts' OFL text included).

- **Session 12 — M1-25 (PWA offline precache and update flow).** Branch `m1/25-offline`. Own
  service worker (core precache at install, background precache after first render, cache-first
  same-origin fetch, on-demand fetch spinner); status bar "Preparing offline… n %" / "✓ Ready
  offline"; "Update ready" applies only on click and never with documents open. e2e: offline
  document work with zero outbound requests; two-build update flow.

- **Session 12 — M1-24 (OPFS crash recovery).** Branch `m1/24-recovery`. Debounced snapshots
  (original once + committed tails + an unsaved narrow tail from a new non-pending Render RPC +
  view state) cleared on save or close; launch dialog with Recover / Discard; recovered documents
  open dirty without a handle or re-linked to their unchanged file; `beforeunload` only while
  dirty. Unit (lifecycle, debounce with fake timers, re-link) and e2e (reload → Recover restores
  edit and page; Discard; save clears; re-link + Ctrl+S).

- **Session 12 — M1-23 (Save Optimized, growth prompt, large-save progress).** Branch
  `m1/23-save-optimized`. Full rewrite as a new file or over the original (signature-count
  warning), becoming the save base for later Ctrl+S; growth prompt at > 30 % with per-session
  dismissal; chunked writes with progress and cancel before commit. Also fixed the tail
  trailer's `/Size` (spec value, not PDFium's allocator).

- **Session 12 — M1-22 (Ctrl+S and Save As).** Branch `m1/22-save`. Ctrl+S appends the verified
  tail to the file's handle; Save As writes original + all tails to a new file that becomes the
  document's (download on the fallback path); save state machine with cancel before commit;
  status-bar phase and localized error dialog offering Save As; tab dirty mark driven by the
  engine proxy. 100 markups save in 134 ms locally.

- **Session 12 — M1-21 (save verification and Work-worker refresh).** Branch `m1/21-save-verify`.
  Read-only per-page digest (raw PDFium) computed by the Render worker with each save; the Work
  worker reopens original + tail and compares; keep-all fallback with a content-free local log;
  committed tails refresh the Work copy lazily. Unit (comparison, fallback selection, real
  two-PDFium path) and e2e (Work sees the annotation; forced mismatch → keep-all, qpdf-clean).

- **Session 11 — M1-20 (save core in the Render worker).** Branch `m1/20-save-core`. Ported S1 save
  core (own FPDF*FILEWRITE, narrow tail, xref table/stream writer) with a committed \_save base* so
  repeated Ctrl+S appends only new changes; dirty tracking and permission checks (rule 9) around
  every mutating engine call; save RPCs (`saveIncremental`, `commitSave`, `saveRewrite`,
  `saveState`) returning bytes by transfer. 8-input real-PDFium matrix (prefix, /Prev, /ID,
  encryption, signature, qpdf) and an e2e save probe for later save/recovery tests.

- **Session 11 — M1-19 (PWA manifest, file handler, launchQueue).** Branch `m1/19-pwa`. Installable
  manifest with a PDF file handler and focus-existing launch handling; own app icons (SVG source +
  generated PNGs); launchQueue consumer opening launched files as tabs; favicon and theme color in
  index.html. Owner check (Explorer → installed app) queued for the M1-28 pack.

- **Session 11 — M1-18 (start screen and recent files).** Branch `m1/18-recent`. Recent list of file
  handles in IndexedDB (dedupe by fingerprint and by same file on disk, cap 20), shown on the start
  screen and in the backstage; keyboard-reachable entries with remove buttons and "Clear recent";
  reopen re-requests permission; missing or denied files explain themselves and can be removed;
  hidden without the File System Access API. E2E uses OPFS handles as stand-ins for disk files.

- **Session 11 — M1-17 (progressive render for heavy renders).** Branch `m1/17-progressive`. Cost model
  (objects, path segments, pixels) routes heavy previews to PDFium's progressive path in the Render
  worker, cancellable between 10 ms slices; the page comes from EmbedPDF's page cache via a second
  accessor next to `docPtrOf`; pixels are encoded in the encoder worker and cached. Unit tests run
  real PDFium in Node (pixel-equal to EmbedPDF's render, multi-slice, cancel at a slice boundary).
  The accepted in-flight tile exception is documented in code. Dense A0 thrash: 7 of 8
  progressive renders cancelled, longest slice 13 ms, no long tasks.

- **Session 11 — M1-16 (view modes and rotate view).** Branch `m1/16-view-modes`. Four view modes
  from the View tab and a status-bar switch, per document in the store; the current page stays in
  view across mode and rotation changes; previous/next move by spread in facing modes; rotate view
  clockwise/counterclockwise is view state only (never dirty). Found and fixed: rotated pages kept
  their unrotated box (the layout's `rotatedWidth`/`rotatedHeight` are the box), and page jumps
  used the scroll plugin's default smooth scrolling. Owner decisions recorded (zoom 100 %, PR #13
  closed, single-core not a target).

- **Session 10 — M1-15 (zoom, page navigation, hand tool).** Branch `m1/15-zoom-nav`. Zoom In/Out
  stops, Ctrl+0/1/2, Ctrl+wheel at the pointer, a zoom box ("150", "150 %", localized decimals) with
  a level menu (fit page / width / visible, actual size, presets), clamp 1 %–6400 %; status-bar page
  navigation with a validated, localized page box; Home/End/PageUp/PageDown in the document; Hand
  (H, drag-pans), Space for Hand while held, Esc back to Select; view commands on the ribbon.
  Also fixed a race in M1-11's key-probe test (merged up the stack). CI follow-ups: closing a tab no
  longer starts the engine or Work worker (M1-13 bug); Home/End navigate explicitly; long-task
  checks moved from the parallel e2e project into perf scenarios (\`e2e/perf/open|scroll|zoom\`),
  and `npm run perf` runs one test at a time. CI (e2e runs 1 worker) had measured a 639 ms task
  on the first open: the app's own Render/encoder workers and PDFium start-up competing with the
  main thread on a small runner (reproduced pinned to one core, even without the Work worker; clean
  on two cores). Worth re-checking on the owner's low-end machine (open issue). Test server
  keep-alive raised to stop a teardown ECONNRESET. Sharp tiles 150–170 ms after
  zoom on the A0 sheet.

- **Session 10 — M1-14 (viewer: virtual scroll and tiling).** Branch `m1/14-viewer`. Plugin stack per
  ADR-011 (viewport, scroll, render, tiling 256 px, zoom 1 %–6400 % with fit width by default);
  bounded preview layer; visible-first render ranking; byte-bounded LRU image cache across tabs;
  render counters (requested / done / aborted / cached, latency) for tests; focusable, named
  document region. Found and fixed: EmbedPDF's Viewport adds 10 px padding inline, which overflowed
  the document area by 20 px (now border-box). Perf: first preview 886 ms cold, 0 blank frames at
  900 and 3,000 px/s, no long tasks.

- **Session 10 — M1-13 (open pipeline and document tabs).** Branch `m1/13-open`. Ctrl+O (FSA
  picker or `<input type=file>`), window-level drop (Explorer files, Outlook attachments via
  `DataTransferItem`), one tab per file in order, duplicates focus the existing tab (`isSameEntry`
  for two handles, else fingerprint). Open state machine with localized errors (not a PDF, damaged,
  password-protected "not supported yet", unreadable, too many). Permission flags stored in the
  document record; no per-document overrides. Tabs: busy placeholders while opening, overflow menu,
  close with Save / Don't save / Cancel, start screen when the last tab closes. Found and fixed: the
  engine needed `ready` before the document manager's first open, the open buffer was being
  copied (now transferred) and the start screen's muted text failed contrast on the canvas.

- **Session 10 — M1-12 (storage layer).** Branch `m1/12-storage`. IndexedDB (`settings`, `recent`
  capped at 20, versioned migrations with an upgrade test on fake-indexeddb 6.2.5, Apache-2.0,
  dev-only); OPFS recovery store (original once + narrow tail in A/B slots + UI state, list, read,
  discard, clear) in a new pure-JS storage worker; SHA-256 fingerprint of size + `/ID` + first/last
  64 KB reading only those slices; file access with FSA pickers, append-in-place that refuses if the
  file changed on disk and leaves it untouched on abort, and the `<input type=file>` + download
  fallback. E2E proves the main thread cannot create sync access handles.

- **Session 10 — M1-11 (keyboard shortcut manager).** Branch `m1/11-keys`. Central keymap with
  global/document scopes (H/V only when the document has focus), no shortcuts while typing except
  Esc, Mac Cmd mapping, alternates for browser-reserved chords (Ctrl+Alt+W, Ctrl+Alt+PageUp/Down),
  printable shortcut sheet from Help generated from the keymap, and an e2e key-probe page for the
  owner to confirm which reserved keys reach the page in real browsers. Ribbon's local Ctrl+F1
  listener moved into the keymap.

- **Session 9 — M1-10 (ribbon framework and File backstage).** Branch `m1/10-ribbon`. Ribbon layout
  derived from the command table (M1 shows File, Home, View, Help; unavailable commands omitted;
  Home repeats its reuses); quick access toolbar; command dispatch with enabled/pressed state and
  reasons (disabled buttons stay focusable via `aria-disabled` with the reason announced); tablist
  → toolbar with roving focus, Esc to the document, Ctrl+F1 collapse; full-window File backstage
  (modal, keyboard section list, focus back to File). Found and fixed: the backstage did not return
  focus to File (same Radix trigger issue as the Dialog), and a wide ribbon in the pseudo-locale
  made the whole page scroll (frame grid column now `minmax(0, 1fr)`). Axe-clean; 65/65 stable
  over 5 repeats.

- **Session 9 — M1-09 (app frame, stores, status bar, error boundary).** Branch `m1/09-frame`. Zustand
  5.0.15 (MIT). Frame with named landmarks (banner, main, two complementary panes, contentinfo), a
  document tablist with roving focus and separate close buttons, collapsible left rail, Properties
  pane, status-bar slots; vanilla stores with pure transitions and selector hooks (a render-count
  test proves view changes don't re-render tab readers); error boundary that records only
  `{code, stack}` locally and offers Reload. Axe asked for a page-level heading (added, visually
  hidden). No horizontal scroll at 1280 px, including the pseudo-locale.

- **Session 9 — M1-08 (Work worker and memory policy).** Branch `m1/08-work-worker`. PDFium #2 with
  read-only copies (original transferred in, kept in the worker; tails applied lazily by reopening
  original + tail, never re-serialized); cooperative priority scheduler (interactive > save-verify >
  background, preemption at page boundaries, background parked during saves, cancel at checkpoints);
  `WorkClient` respawns the worker when idle above 256 MB or after an eviction and reloads open
  documents from a `reload()` source plus their tails. Found and fixed a race where two jobs
  finishing together started two memory checks and the first respawn killed the second's call
  (now single-flight). E2E: 2,000-page text pass peaks ~31 MB from an ~18 MB baseline on the
  stand-in, respawn returns to baseline and the document keeps working; perf gate: 0 main-thread
  long tasks during the job.

- **Session 9 — M1-07 (Render worker and engine factory).** Branch `m1/07-render-worker`. Hosted Render
  worker (`PdfiumNative` behind our RPC; the main-thread proxy maps RPC errors back to
  `PdfErrorCode` and task aborts to RPC cancels); encoder worker for all image encoding (ADR-011);
  `createRenderEngine` rejects an undefined `fontFallback` at type level and at runtime; seven
  Regular-weight fallback fonts self-hosted with their OFL licenses (packages pinned as direct
  dependencies); one `pdfium.wasm` in the build; `docPtrOf()` is the single private accessor and
  fails loudly if EmbedPDF internals change; permission flags and signature count come with every
  opened document; `needs-password` error (prompt in M2). `qpdf` added to the CI e2e job (fixture
  encryption only).

- **Session 9 — M1-06 (icon registry and command table).** Branch `m1/06-icons`. Command table ported
  from S6 (127 commands, milestone per command; only M1 is shown, M1-Q2) with English labels in
  `en.json`; `scripts/gen-icons.ts` generates per-icon path imports (a renamed Fluent icon breaks
  typecheck; a test keeps the file in sync); registry `iconFor(id, {large, pressed})` with Filled
  glyphs for toggles; custom **Save Optimized** and **Continuous Facing** icons built with Fluent's
  own `createFluentIcon` on the 20/32 px grid (the first badge design read as an "x" in review and
  was redrawn). Root-barrel imports banned by test.

- **Session 9 — M1-05 (design tokens and UI primitives).** Branch `m1/05-tokens-ui`. `src/ui/tokens.css`
  (colors, spacing, sizes, radius, type, elevation, motion; light default; dark set and
  `forced-colors` mapping override every color token). Radix-based primitives with required
  accessible names; component CSS uses tokens only (enforced by a test). Findings fixed: dark-theme
  primary button failed WCAG contrast (axe); the Dialog did not return focus to an opener outside
  Radix's own Trigger. Added Radix dialog/dropdown-menu/tooltip/toggle (MIT); dev: Testing Library,
  jsdom, `@axe-core/playwright` (MPL, dev-only per ADR-002). Gallery e2e: axe clean in light, dark
  and pseudo-locale; keyboard-only traversal, menus and dialog; focus ring in forced-colors.

- **Session 9 — M1-04 (i18n).** Branch `m1/04-i18n`. i18next 26.4.2 + react-i18next 17.0.15 (MIT), strings
  bundled and initialised synchronously; typed keys (unknown key = type error); `msg()` marker for
  keys in data; `Intl`-only formatters (number, percent, zoom, bytes, date, relative time) in the
  user's locale; pseudo-locale (+40 %, accented, bracketed) behind `?locale=pseudo` in dev/e2e.
  Completeness test: every referenced key exists and every key is used. Document title from i18n.

- **Session 9 — M1-03 (typed RPC).** Branch `m1/03-rpc`. `src/engine/{protocol,errors,rpc}.ts` and
  `src/workers/rpc-host.ts`: one typed API spec per worker (wrong argument or result types don't
  compile); every call is a `Job` with `cancel()` and progress; cancel rejects with `AbortError`
  exactly once and drops late results; progress throttled to 1 per 100 ms (trailing edge); a dev
  warning when a job runs > 300 ms without progress (rule 2); zero-copy transfers both ways; errors
  cross as `{code, message, stack}`, and non-`RpcError`s lose their message (rule 10); a lost
  worker rejects every pending call with `WorkerLostError`. 14 unit tests over a real
  `MessageChannel`.

- **Session 9 — M1-02 (e2e harness under production headers).** Branch `m1/02-e2e-harness`.
  - `public/_headers`: the §10.1 CSP verbatim plus COOP/COEP (ADR-004 decision 5).
    `scripts/serve.ts` + `scripts/headers.ts` promoted from the S8 spike (ADR-003 decision 4).
  - Playwright builds the app once in `e2e` mode (`dist-e2e/`); every worker serves it with the
    production headers, and every page is cross-origin isolated.
  - Shared `guard` fixture (`e2e/support/fixtures.ts`): fails any test on a CSP violation (document
    or Report-Only endpoint, so workers are covered), a request leaving the origin, or, in `perf`,
    a main-thread task > 100 ms after `guard.startMeasuring()`. Negative controls prove each check
    fires. Finding: a busy loop inside Playwright's own `evaluate` is not reported as a long task;
    the control runs it as a page task.
  - Test-only hook (M1-Q3) behind `import.meta.env.MODE === 'e2e'`; `npm run check:dist` (CI)
    fails if its marker reaches a production build, verified against both builds.
  - Self-made fixture generators in `e2e/fixtures/generate.ts` (simple, 2,000-page contract, A0
    sheets, CJK fallback), all opened by PDFium in unit tests. CI now also runs `npm run perf`.

- **Session 8 — M1-01 (EmbedPDF plugin layer).** _Works with workaround._ See
  [ADR-011](adr/011-m1-embedpdf-plugins.md) (accepted).
  - Core, document manager, viewport, scroll, render, tiling, zoom, spread and rotate plugins run on
    the hosted Render worker. Pinned to exactly 2.15.1; the license gate passes (546 packages).
  - Self-made files: 2,000-page contract first preview 231 ms; dense A0 first view 0.4–0.7 s;
    sharp tiles 148–328 ms at 100 %–6400 %; 0 blank-page frames at 900 and 3,000 px/s; **0 long
    tasks**, 0 CSP violations, 0 third-party requests.
  - Workarounds: our own bounded `PreviewLayer` (the stock page layer renders the whole page at the
    current zoom); our own **encoder worker** (the stock converter encodes on the main thread,
    against rule 1; the worker is also faster: scroll tile p95 91 vs 132 ms); our own paged mode for
    single page and facing (the plugins are continuous only).
  - Stale tiles are aborted by the stock `TilingLayer` (311–331 of ~370 in zoom thrash).

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
- **Session 7 — ADR approvals.** The owner accepted ADR-003 to ADR-007 and ADR-009. They are
  applied as **ARCHITECTURE.md Rev 0.3**:
  - hosted Render worker, render cancellation and the respawn memory policy; COOP/COEP headers;
  - narrow-tail Ctrl+S; background search indexing with a 5,000-hit context cap;
  - own Measure object layer, with encrypted files handled in M3;
  - PDFium permission gate before PDF Oxide; own stream-table detector; the font split.
- **Session 7 — M0-S6 (Fluent icon coverage).** _Fails as specified, works with workaround._
  ADR-010 accepted (ARCHITECTURE.md Rev 0.4: Regular icons; CLAUDE.md rule 15). See
  [ADR-010](adr/010-s6-fluent-icons.md) and the generated
  [icon map](plan/S6-icon-map.md).
  - 126 Rev 0 commands inventoried: the quick access toolbar, the nine §8 tabs, the rail panes and
    the status bar.
  - **Fluent Color covers only 24 (19 %)**, and upstream has **deprecated** all Color icons: no
    High Contrast support, global gradient IDs, and failing dark-theme contrast. **Regular and
    Filled cover all 126.**
  - Large buttons: only 25 of 50 have a native 32 px glyph; the rest scale up from 28 or 24 px.
  - 23 custom icons are needed, including the four named in §8 (cloud, calibrate, scale
    viewport, CRS export) and Stamp, which exists only in the Light style. Express extract fits
    Fluent's `TableLightning`.
  - Bundle: about 22 kB brotli for the whole set plus 5.6 kB of runtime. It tree-shakes, and
    per-icon path imports build about 4× faster than the root barrel.
  - Added dependency `@fluentui/react-icons` 2.0.341 (MIT). The license gate passes (536
    packages).
- **Session 7 — M0-S4 (PDF Oxide WASM).** _Works with workaround._ See
  [ADR-009](adr/009-s4-pdf-oxide.md).
  - The WASM build has every API needed for §7.6 and §7.7: text, Markdown, HTML, tables with cell
    boxes, images, words and paths. It is **4.45 MB brotli** (17.6 MB raw).
  - Licenses: `MIT OR Apache-2.0`, and all 394 Rust crates compiled into the WASM are permissive.
  - In a module worker under the §10.1 CSP: 0 violations, 0 third-party requests, and the only
    fetch is the self-hosted `.wasm`. Init takes 0.7 s in the browser. Cancel between pages takes
    11 ms. No main-thread long tasks.
  - The **first extraction per instance takes ~0.7 s** (a one-time warm-up), so it should run in
    the background right after init.
  - 2,000 pages: text at 215–286 pages/s, Markdown at 109–140 pages/s, and PDFium text at 459
    pages/s. Memory is about 47 MB.
  - Tables: **lattice 100 %**, merged-header data 100 % (the merged header text is dropped), and
    **stream 0 %**. There are no useful tables in the public corpus. Unruled catalogue tables come
    out as jumbled text. So an own stream detector is needed (§7.7).
  - Structure: H1, lists and two-column reading order are correct; the H2 comes out as bold text.
  - **Oxide has no permission API.** It extracted from the encrypted catalogue without checks, so
    it must be gated by PDFium's permission flags (rule 9).
  - Added dependency `pdf-oxide-wasm` 0.3.77. The license gate passes.
- **Session 6 — M0-S7 (vector geometry for snapping).** _Works with workaround._ See
  [ADR-008](adr/008-s7-snap-geometry.md).
  - Extraction goes straight through PDFium (EmbedPDF has no public API):
    - paths and forms, with composed matrices;
    - Bézier flattening and implicit closes;
    - raw WASM exports, 2.3–4.6× faster than `cwrap`.
  - Correct on a known-geometry sheet (11 unit tests plus an integration check): exact endpoint,
    intersection and midpoint snaps, and the circle within 0.2 pt.
  - Dense public A1 page (174k segments): extraction ~0.35 s (Node) / 0.56 s (browser), grid
    ~30 ms, queries p95 < 0.5 ms. Synthetic 1M segments: ~0.9 s + 0.2–0.3 s, 36 MB.
  - `FPDF_LoadPage` is 75–90 % of the extraction time and can't be interrupted, so region
    extraction doesn't help: extract whole pages once and cache them.
  - While PDFium parses, snap queries that go to the Work worker wait **~272 ms** each. A
    **pure-JS snap worker** fed by transferred indexes answers at **p95 0.5 ms** even during
    extraction. This is proposed as a new worker (ADR-008 decision 2).
  - Tiles are unaffected, and there are no main-thread long tasks.
- **Session 5 — M0-S2 (measurement and viewport dictionaries).** _Works with workaround._ See
  [ADR-007](adr/007-s2-measure-viewport.md).
  - Neither EmbedPDF nor PDFium can write or read nested `/Measure` dictionaries or page `/VP`.
  - Built our own layer (19 unit tests):
    - a minimal PDF object reader (xref tables and streams, object streams, predictors);
    - a serializer;
    - an incremental patch-revision writer;
    - scale math: ratio, calibration, ft-in, and the §7.4 viewport choice including "spanning";
    - a reader CLI for files saved by the viewers.
  - On a self-made A1 sheet (1:100, plus Detail A at 1:5):
    - EmbedPDF creates the geometry annotations; we add `/IT`, `/Measure`, `/Cap`, `/Contents` and
      page `/VP`;
    - qpdf is clean and the values read back exactly;
    - the data survives later EmbedPDF edits.
  - PDFium appearances draw geometry only, with no value text. Label variants (`/Cap`, grouped
    FreeText, no appearance) went into an interop pack for the owner.
  - **Encrypted files are not handled.** Writing or reading measurement strings needs our own
    security handler; this is an owner decision.
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

- **M3 (session 16):** M3-01 … M3-08 as one commit each on
  `claude/m3-task-breakdown-tlyokp` (the session's branch; the plan's `m3/<task>` branches were
  not used because this session may only push to its own branch), pushed; no PR opened yet.
- **Git in one paragraph (for the owner):** each task lives on its own _branch_ (a named line
  of commits). A _commit_ is a saved snapshot with a message; _push_ uploads the branch to
  GitHub; a _pull request_ (PR) asks to bring a branch into `main`, and GitHub runs the checks
  (CI) on it; _merge_ adds it to `main` once the checks are green.

## Session log

- **Session 16 (2026-09-27), continued:** M3 plan approved; M3-03, M3-01, M3-02 (one commit
  each). Local checks: typecheck, lint, format, 705 unit tests, license gate (642 packages), the
  save/recovery/layers e2e specs (18) and the new perf scenario `annotation-load`; spike runs
  `s12` (Node) and `s13` (2/2, ExcelJS installed with `--no-save` only). qpdf installed in the
  container.

- **Session 16 (2026-09-27):** M3 plan only (docs); no code, so no checks beyond Prettier on the
  changed Markdown.

- **Session 15 (2026-09-27):** M2-16, M2-17, M2-18 and M2-19 on `claude/m2-tasks-16-19-wt8d51`
  (one commit each). Local checks on the last commit: typecheck (app, node, functions), lint,
  format, 623 unit tests, license gate (642 packages), build + `check:dist`, bundle report
  (within budget), 163 e2e (incl. 3 offline and 9 a11y), 23 perf scenarios, acceptance table all
  met. qpdf installed in the container for the fixtures.

- **Session 14 (2026-09-26):** M2 plan (approved), then M2-01 to M2-05 on stacked `m2/…`
  branches. Local checks on the last branch all pass: typecheck (app and spikes), lint, format,
  472 unit tests, license gate (642 packages), build + `check:dist`, bundle report (core 6.72 MB),
  116 e2e, 16 perf scenarios. qpdf installed in the container for the encrypted fixtures.
  Continued with M2-06 to M2-15 (one PR each). On `m2/15-print`: typecheck, lint, format,
  575 unit tests, license gate (642 packages); the affected e2e specs and the new print perf
  scenario pass locally.

- **Session 13 (2026-09-26):** M1-26, M1-27 and M1-28, on `m1/26-local-data`, `m1/27-ci` and
  `m1/28-acceptance` (stacked; one PR each). Local checks all pass on the last branch: typecheck,
  lint, format, unit tests, license gate, build + `check:dist`, bundle report (within budget), e2e,
  offline, a11y, perf, acceptance table. qpdf was installed in the container for this session, so
  the save matrix and the interop outputs were checked with it.

- **Session 9 (2026-09-25):** M1-02. Local checks all pass: typecheck (app and spikes), lint,
  format, unit tests, license gate, production build + `check:dist`, e2e (6/6) and perf (2/2).

- **Session 8 (2026-09-25):** Read PROGRESS, ARCHITECTURE Rev 0.4 and ADR-001 to ADR-010; wrote
  the M1 plan; the owner approved it and accepted M1-Q1 to M1-Q8. Then M1-01 on branch
  `m1/01-plugin-spike`: typecheck (app and spikes), lint, format, unit tests, license gate (546
  packages) and the S9 Playwright spec (3/3) pass.

- **Session 7 (2026-09-24):**
  - ADR-008 accepted (ARCHITECTURE.md Rev 0.2).
  - S4 done: 102 unit tests, license gate (529 packages), and 20/20 spike Playwright tests.
  - ADR-003 to ADR-007 and ADR-009 accepted (ARCHITECTURE.md Rev 0.3).
  - S6 done. Local checks all pass: typecheck (app and spikes), lint, format, 106 unit tests,
    license gate (536 packages), and the app e2e smoke. S6 has no Playwright part, and the other
    spikes are unchanged.

- **Session 6 (2026-09-24):** S7. Local checks all pass: typecheck (app and spikes), lint, format,
  unit tests (11 new S7 tests), license gate, app e2e smoke, and all spike Playwright tests.

- **Session 5 (2026-09-24):** S2. Local checks all pass: typecheck (app and spikes), lint, format,
  unit tests (19 new S2 tests), license gate, app e2e smoke, and all spike Playwright tests. The S2
  Node harness passes: qpdf clean, all values match, survival check OK.

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

1. **Owner:** review ADR-014 (annotation load via the Work worker, own annotation tiles) and
   ADR-015 — **decide** stamps (PNG at 4× vs a B7 exception for vector stamps) and the workbook
   library (ExcelJS with the `unzipper` override vs our own XLSX writer); then review and merge
   `claude/m3-task-breakdown-tlyokp` (M3 plan, M3-01 … M3-03).
2. **Owner:** the M2 owner pack in [docs/acceptance/M2.md](acceptance/M2.md) §4 — FAR / 500 MB
   search timings, interop §M2 (I–K and signatures after a form save), the live error report
   (Cloudflare setup in [docs/deploy/error-report.md](deploy/error-report.md)), Firefox smoke.
3. **Owner:** the M1 owner pack in [docs/acceptance/M1.md](acceptance/M1.md) §3 and the M0 owner
   runs:
   - **S1 interop checklist** (`e2e/interop/CHECKLIST.md`) in Acrobat Reader and PDF-XChange;
   - S1 FSA button on the 500 MB contract;
   - **S5 search on the FAR and the 500 MB contract** (now also in `npm run owner:timings`);
   - **S2 interop checklist** §D and §F (`e2e/fixtures/self-made/s2-interop/`);
   - **S7 on the four local CAD drawings and the dense P&ID**
     (`node spikes/s7-snap/run-node.ts <files>`, plus the browser page; see ADR-008);
   - **S4 on the local pipe-chart fixture and a parts-list drawing**
     (`node spikes/s4-oxide/run-node.ts <files>`; dumps in `out/review/`, see ADR-009);
   - FAR, 500 MB and A0 through the S3 harness;
   - S8 Firefox check and Pages preview.
4. **Owner:** decide the items under "Decisions needed" (keyboard text selection, committed
   corpus PDFs, Pages project).
5. **Owner:** the S2 interop run (§D/§F) before M3-16/M3-20 (M3-Q2 defaults are in use until then).
6. **Agent:** M3-16 (distance, perimeter and area measurement tools) next, then M3-17 … M3-20 in
   plan order. M3-09 … M3-15 are pushed on `claude/m3-task-breakdown-tlyokp`; no PR opened yet.

## Open issues

- **M3-08 tool keys** (G highlight, U underline, K strikeout, Q squiggly, I insert text,
  R replace text) are our choice — §8.1 names none. Owner may prefer others (the keymap is one
  table). M3-09 will need letters for note/text box/shapes; R may move if rectangle wants it.
- **Markups in previews:** page previews and thumbnails still show no markups (M3-05 follow-up).

- **Send-email binding on Pages (M2-18):** not verified that the dashboard offers a Send email
  binding for Pages projects. Without it, reports are stored in D1 only (the function skips the
  e-mail); the alternative is a small Worker behind a Service binding.
- **Browser-viewer print route (M2-16):** prints the chosen pages in document order (a custom
  order like "3, 1" keeps its order only on the raster route); browsers without a built-in PDF
  viewer need the owner check in interop §K4.
- **CI perf stalls on pull_request runs:** one-off 200–400 ms main-thread tasks in scroll /
  thumbnails / pane-load perf scenarios, only on the pull_request run while the push run of the
  same commit (started at the same time) passes. Not reproduced locally. If it recurs on re-runs,
  run CI once per commit (push for `main`, pull_request for PRs) to halve runner load, and look at
  the traces in the `playwright-report` artifact.
- **PDFium form limits (M2-14):** a combo box item can't be deselected (Reset Form leaves a combo
  without `/DV` as it is), and a radio group with NoToggleToOff can't be switched off.
- **Perf noise to watch:** the M2-06 indexing check (tiles p95 while indexing is paused vs idle)
  missed once in CI (164 ms vs a 142 ms limit) and once in a full local run; it passes alone.
  If it keeps missing, look at CPU contention from the Work worker between activity messages.
- **Quick Find total** on the uncached 2,000-page stand-in takes ~5 s (first hit ~50–180 ms);
  e2e waits up to 20 s for the total.
- **Chromium 153 headless crash on stored file handles (M1-18).** Reading a
  `FileSystemFileHandle` back from IndexedDB crashes the whole browser in headless Chromium and
  Google Chrome 153 (OPFS and on-disk handles alike; CI diagnostic, PR #21). Chromium 141/151 and
  headed Chrome/Edge 154 (owner check) are fine. `@playwright/test` is pinned to 1.62.1
  (Chromium 151) with an override for `playwright-core`; re-test the recent-files e2e specs before
  bumping Playwright.
- **Committed corpus PDFs vs ADR-002.** Commit `cd52644` added six PDFs directly to `corpus/`,
  including CAD drawings. ADR-002 says drawings stay local and are never committed, and
  `.gitignore` excludes `*.pdf`, so these were force-added. S3 uses `bearing catalogue.pdf` and
  `PRESSURE-VESSEL-SAMPLE.pdf` from there. The owner needs to decide (see "Decisions needed").
- **PDF Oxide ignores permission flags** (ADR-009). It must never receive a document before
  PDFium's permission check allows copying or extraction (D-19, rule 9).
- **Oxide finds no unruled (stream) tables** (ADR-009). §7.7's stream candidate has to be our own
  detector. The pipe-chart fixture of record is still to be run by the owner.
- **FAR not fetchable from the cloud container.** The environment's network policy denies
  `www.acquisition.gov` (HTTP 403 from the proxy). To allow it, add that host under the
  environment's Network access settings; otherwise run `npm run corpus` locally.
- **PDFium incremental save needs our narrow-tail post-processing** (ADR-005). Used raw, it
  bloats files and damages xref-stream files. The narrow tail depends on EmbedPDF's private
  `PdfiumNative.cache` for the document pointer (pinned 2.15.1; upstream request proposed).
- **Chrome's `createWritable(keepExistingData)` copies the whole file**, so Ctrl+S on very large
  files is O(file size). The owner measures it on 500 MB; it needs a progress UI (ADR-005).
- **Measurement data in encrypted PDFs** can be neither written nor read without our own
  security handler (ADR-007). The public catalogue in `corpus/` is RC4-encrypted, so this is a
  real case.
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

- **Keyboard text selection (M2-04).** Caret-based selection (Shift+arrows) is not built; the
  keyboard path is Ctrl+A (page text) + Ctrl+C. Accept as an exception to the M2-04 criterion, or
  schedule caret selection (about one session).

1. **Committed corpus PDFs.** Either confirm that all six files in `corpus/` are public domain and
   may stay in git, and amend ADR-002 to say so, or move them to the git-ignored `corpus/files/`
   (drawings to `corpus/files/drawings/`) and remove them from history. The S3 spec skips if they
   are missing. Note: `bearing catalogue.pdf` is a commercial manufacturer catalogue under
   copyright, not public domain (found during S4). It should move out of git either way.
2. **Cloudflare Pages project for S8.** Until one exists, S8 runs locally with
   `spikes/shared/serve.ts`, because `wrangler` is blocked by LGPL (ADR-003). The analytics and
   injection checks wait for the project.
3. **More test drawings (optional).** Item 5 in the drawing list was blank. Add more whenever you
   like; they stay local only.

## Decisions log

| Date       | Ref              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-27 | ADR-014, ADR-015 | Owner accepted ADR-014 (annotations loaded through the Work worker; markups drawn as our own annotation tiles) and ADR-015 (PNG image stamps at 4×; ExcelJS 4.4.0 with an npm override `unzipper@0.12.3`, added in M3-19). Proceed with M3-04 … M3-08.                                                                                                                                                                                                    |
| 2026-09-27 | M3 plan          | M3 plan approved with M3-Q1 … Q10 as proposed: annotation export in M4; ADR-007 label/viewport defaults until the interop run; review status = standard `/StateModel /Review` replies, schemes drive stamps and the CRS header; image-stamp route (spike first); derived auto-numbers; keyboard creation for note/text box/stamp only; `/T` = reviewer name; own MD5/RC4; ExcelJS in the Work worker (non-core); `m3/<task>` branches.                    |
| 2026-09-26 | ADR-012, ADR-013 | Owner approved all pending ADRs. ADR-012 decision 5: list-only Layers pane (M2-11). ADR-013 decision 7: §10.1 CSP gains `frame-src blob:` for M2-16's browser-viewer print route (ARCHITECTURE.md updated with M2-16).                                                                                                                                                                                                                                    |
| 2026-09-25 | M1-15            | Owner: zoom 100 % = one PDF point per CSS pixel (EmbedPDF scale 1, ADR-011's range), so Actual Size is not physical size. PR #13 (main → M0 branch) closed. Single-core machines are not a target; the one-core first-open contention from M1-13/15 CI needs no work.                                                                                                                                                                                     |
| 2026-09-26 | M1-18            | Owner: headed Chrome/Edge 154 read stored file handles fine, so the Chromium 153 crash is headless/153-only; pin Playwright to 1.62.1 (Chromium 151) for CI rather than change the recent-files design (option 3).                                                                                                                                                                                                                                        |
| 2026-09-26 | M1-14            | Owner: the CI first-preview check for the 2,000-page stand-in gets a 2 s margin (shared runners measured 1.50–1.54 s); the value is still recorded, and the §12 1.5 s target stays authoritative on the owner's machine (ADR-002). M1-27 sets the final gating.                                                                                                                                                                                           |
| 2026-09-24 | ADR-001          | Session-1 clarifications B1–B16. Key ones: server-side analytics only; broader permissive allowlist; location-based redaction verification; EmbedPDF annotation and redaction sets; OPFS original + tail recovery; public-domain corpus only.                                                                                                                                                                                                             |
| 2026-09-24 | scaffold         | Vite 7 instead of 8, and no jsx-a11y, because of MPL-2.0 dependencies. Superseded by ADR-002.                                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-24 | ADR-002          | MPL-2.0 allowed for dev-only tooling only (lockfile `dev` flag). OFL-1.1 allowed for fonts. Heavy files are measure and report for Rev 0. Test drawings are owner-supplied local files, with no URLs in the repo. Moved to Vite 8 and enabled jsx-a11y.                                                                                                                                                                                                   |
| 2026-09-24 | Rev 0.1          | ARCHITECTURE.md amended per ADR-001 and ADR-002 (owner-approved).                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-09-24 | ADR-003          | S8: CSP unchanged; `fontFallback` always explicit; Regular-weight fallback fonts, CJK non-core; local `_headers` server instead of `wrangler` (LGPL). **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                                                                                                              |
| 2026-09-24 | ADR-004          | S3: hosted Render worker (our module + EmbedPDF `PdfiumNative`/`PdfEngine`); small tiles + queue abort + direct progressive render; respawn-based memory policy; optional COOP/COEP. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                                                                               |
| 2026-09-24 | ADR-005          | S1: Ctrl+S = PDFium `FPDF_INCREMENTAL` + narrow tail (changed objects only, our own xref/trailer), verified in the Work worker with keep-all fallback; Save Optimized = `FPDF_NO_INCREMENTAL` via our writer. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                                                      |
| 2026-09-24 | ADR-006          | S5: search in the Work worker (raw FPDFText extraction + session text cache + JS RegExp, viewport order, 50 ms batches, cancel between pages); ≤ 5,000 hits streamed with context; background indexing after open; EmbedPDF plugin-search not used. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                |
| 2026-09-24 | ADR-007          | S2: own PDF object layer (reader, serializer, patch revision) writes `/Measure`, `/IT` and page `/VP`; label strategy and viewport semantics after owner interop; encrypted files need our own security handler (M3) or measurements are not saved there. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                          |
| 2026-09-24 | ADR-008          | S7: geometry extracted whole-page in the Work worker via raw PDFium exports and cached; snap queries answered by a new pure-JS snap worker holding transferred indexes (queries never wait for PDFium). **Accepted**; ARCHITECTURE.md Rev 0.2.                                                                                                                                                                                                            |
| 2026-09-24 | Rev 0.3          | ARCHITECTURE.md amended per ADR-003 to ADR-007 and ADR-009 (owner-approved): hosted Render worker, render cancellation and memory policy, COOP/COEP, narrow-tail Ctrl+S, background search indexing and context cap, own Measure object layer, Oxide permission gate and own stream-table detector, font split.                                                                                                                                           |
| 2026-09-24 | ADR-010          | S6: Fluent **Regular** icons (Filled for active states) instead of the deprecated, 19 %-coverage Color style; large buttons use native 32 px or scaled 28/24 px glyphs; 23 custom icons in the same line style; icon registry with per-icon path imports. **Accepted**; ARCHITECTURE.md Rev 0.4, CLAUDE.md rule 15.                                                                                                                                       |
| 2026-09-24 | ADR-009          | S4: adopt PDF Oxide for text/Markdown/HTML (lazy, background warm-up); PDFium permission gate before every Oxide call; Oxide tables as the lattice candidate only, own stream detector; search stays on PDFium; pin 0.3.x and add notices. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                         |
| 2026-09-25 | M1 plan          | M1 plan approved. M1-Q1: Ctrl+Alt+W / Ctrl+Alt+F4 close tab and Ctrl+Alt+PageUp/PageDown switch tab, alongside the §8.1 keys (ADR-001 B5). Q2: ribbon tabs hidden until they have a working command. Q3: test hook only in the `e2e` build mode. Q4: dependency list accepted. Q5: Select without text selection until M2. Q6: File → Properties in M2. Q7: CI uses generated self-made fixtures only. Q8: merge PR #1 and M0, then `m1/<task>` branches. |
| 2026-09-26 | M2 plan          | M2 plan approved. M2-Q1: no Oxide in M2 (M4). Q2: signature pane in M2. Q3: search reads existing annotation text and bookmark titles. Q4: internal links navigate; external links confirm first. Q5: agent writes the Pages Function, owner provisions Cloudflare. Q6: `frame-src blob:` only after ADR-013 approval. Q7: passwords in worker memory only. Q8: layers per M2-01. Q9: `m2/<task>` branches.                                               |
| 2026-09-25 | ADR-011          | M1-01: adopt the EmbedPDF plugin stack (pinned 2.15.1, one registry + document manager, no per-document permission overrides); own bounded PreviewLayer, own encoder worker, own paged mode for single/facing. **Accepted**; no ARCHITECTURE.md change.                                                                                                                                                                                                   |
