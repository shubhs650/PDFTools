# ADR-034: M13 — final improvements for version 1.1.0

- **Status:** Accepted by the owner on 2026-11-24 with the approval of the plan
  [docs/plan/M13.md](../plan/M13.md) (CRS answers C1 – C15, plan answers P1 – P3, optional items
  O1, O2 and O5; O3 and O4 moved into the plan; O6 later).
- **Date:** 2026-11-24
- **Deciders:** owner (Shubham) / agent (M13 planning thread)
- **Adds:** D-67 … D-71. **Amends:** §5, §7.4, §7.5, §7.16, §8.1, §13 of ARCHITECTURE.md (Rev 0.24).
- **Spikes to follow:** S32 (Thin Lines) and S33 (Excel templates) record their results here as
  amendments before the tasks that build on them.

## Context

Before releasing 1.1.0 the owner listed seven last changes: sample files to try Compare, a loupe
and automatic snapping for Measure, Thin Lines, labelled status bar buttons, Previous view and
Next view in the status bar, CRS export into project Excel templates, and the final Help and
release checks. The CRS item was settled in fifteen questions asked one at a time.

## Decision

1. **D-67 Sample comparisons.** Two self-made pairs per comparison type from
   `Synthetic PDF Corpus/` (overlay 01 and 19, text 05 and 01) ship with the app from our origin,
   precached in the background, and fill both sides of the input window from a small "Try a
   sample" menu. With no document open, the start screen offers the first overlay sample (O5).
2. **D-68 Measure loupe and snapping.** One shared loupe component (from M12-13's magnifier)
   follows the pointer for every Measure tool, Calibrate and Scale Viewport; picking those tools
   turns snapping on, and ending them restores the earlier state unless the person changed it.
   Loupe toggle in the Measure ribbon; size, magnification and auto-snap in Settings. View → Loupe
   in any tool (O1) and the loupe with snapping for Line, Arrow, Polyline and Callout comments (O2).
3. **D-69 Thin Lines.** Ctrl+5, a View ribbon toggle and a status bar button draw every stroked
   line of the page 1 device pixel wide, on screen only; comments, files, print and exports are
   untouched. One setting for all documents, stored on the device. The rendering route is chosen
   by spike S32, which must prove that saved files never change.
4. **D-70 Status bar.** Labelled toggles (icon plus text, at least 28 px tall) for Thin Lines and
   Enable Snapping; Previous view and Next view buttons beside the page buttons; one view history
   for the whole window, which records typed pages, Go to Page, bookmarks, links, search results,
   Zoom to Area, thumbnails, tab switches and opened documents, and not plain scrolling or
   Next/Previous Page.
5. **D-71 CRS project templates.** Export CRS fills a project's own `.xlsx` CRS form, kept on the
   device: one chosen sheet; a required start row; pre-drawn rows detected by their borders, then
   inserted rows that copy format, formulas, drop-downs and conditional formatting and push content
   below down; optional detail cells and a file-name rule for number and revision; a field list
   with tick and column; one row per comment with reply fields; status words mapped per template;
   comment-type ticks and Ignore highlights (under 70 % opacity); order by page with text comments
   first; snapshots fitted to their column; optional one sheet per commented page (page-label
   names, Sr. No. restarting per sheet) and one sheet per document for several open documents; four
   guided set-up steps with a live sheet preview, a template manager, and a template file to
   share. The Standard CRS stays the default. ExcelJS (MIT) does the work in the Work worker; what
   it cannot keep is set by spike S33.

## Consequences

- No new dependency is planned; S32 and S33 may change that, and their amendments say so.
- New IndexedDB stores for CRS templates and settings (schema bump); templates are document-free
  but private, so they are never sent and never in an error report.
- Help gains topics for each item; every Help screenshot is regenerated for 1.1.0.
- Version 1.1.0 ships after M13-09 and the owner's hand check, with Compare switched on in
  release builds.

## Amendment 1 — S33: project Excel templates with ExcelJS (M13-06, 2026-11-24)

Spike S33 ([`spikes/s33-crs-templates/`](../../spikes/s33-crs-templates/),
[RESULTS.md](../../spikes/s33-crs-templates/RESULTS.md)) checked D-71 against ExcelJS 4.4.0 on
self-made templates (rule 13). **Verdict: works with workaround; no new dependency; D-71 stands
as written.** The owner opened the sample files (project files, `m13-06/`) in Excel on
2026-11-24: they open without errors.

1. **Files taken.** `.xlsx` and `.xltx` only, told apart by their bytes (OLE2 signature, else the
   zip's main content type), never by the file name. Refused with a plain message: macro-enabled
   (`.xlsm`, `.xltm`: ExcelJS loads them but drops the macros), binary (`.xlsb`), and OLE2 files,
   which are both old `.xls` files and workbooks with a password to open (the message names
   both). ExcelJS finds parts by Excel's own names and prefixes, so a workbook written by some
   other tools fails to load (openpyxl's did); the import catches any load error and asks for the
   file to be saved again from Excel or LibreOffice (files saved by either load).
2. **What survives** a load and write: merged cells, pictures, borders, fills, fonts, number
   formats, column widths, row heights, print area and titles, page setup, header and footer,
   frozen panes, drop-downs, conditional formatting, formulas including shared formulas, defined
   names, cell notes, hyperlinks, hidden and protected sheets, Excel tables on other sheets,
   grouped rows, the theme. **Lost, named in the import's warning** (found from the zip's part
   list): text boxes and other shapes, charts, sparklines, Excel 2010-style drop-downs in the
   sheet's extension list, named cell style names (their formatting stays); expected lost and
   warned the same way though not tried: pivot tables, slicers, threaded comments, form
   controls, header and footer pictures, links to other workbooks.
3. **Row insert method.** Not ExcelJS's `insertRows` / `spliceRows` / `duplicateRow` (new rows
   get no borders, formulas or drop-downs; totals, conditional formatting and the print area do
   not grow). The engine edits the worksheet's plain model in one pass: rows after the last
   pre-drawn row move down; a range that reaches that row grows (totals such as
   `COUNTA(E10:E24)`, print area, conditional formatting, names); the same rule rewrites merged
   cells, drop-downs and their list formulas, conditional formatting rules, picture anchors, row
   breaks, the filter range, other sheets' formulas and the workbook's names. Each new row copies
   the start row's styles, height, in-row merges and drop-downs, with formulas slid as a fill
   down would. Shared formulas are made plain first; the last pre-drawn row's closing bottom edge
   moves to the new last row. Pre-drawn rows are detected by the start row's side borders and
   fill in every table column (bottom edge not compared), empty except formula columns.
4. **Sheet copy method.** A copy is built from a model of the template sheet taken before any
   filling (everything above comes along; pictures share the workbook's image). The first page or
   document fills the template sheet itself, renamed with every reference in the workbook
   rewritten; the others follow it in order. Sheet names: forbidden characters to `-`, no control
   characters, no quote at either end, at most 31 UTF-16 units without splitting a pair,
   "History" → "History 1", clashes (case-insensitive) get " (2)", " (3)" …
5. **Four ExcelJS write fixes** are part of the engine: drop-downs handed over as ready column
   ranges (ExcelJS sorts cells as text and writes ranges crossing row 9 → 10 twice, overlapping);
   a width of exactly 9 nudged to 9.0001 straight after loading (ExcelJS drops it); formula
   results dropped and `fullCalcOnLoad` set (LibreOffice otherwise shows the template's old
   totals); the old merge list cleared before a sheet model is set.
6. **Snapshots** are scaled to the Snapshot column's pixel width (Excel's width formula, a merged
   cell counts all its columns) less a 4 px margin, capped by the height limit (at most about
   540 px: Excel's 409-point row limit), anchored to their cell with native offsets; the row
   grows. Every filled row with wrapped text gets an explicit height for its lines, otherwise
   LibreOffice grows the row on opening and draws the pictures below a line too high.
7. **Time.** 2,000 rows with 200 pictures: about 0.5 s in a browser worker under the CSP; 2,000
   pictures about 1.5 s (6.4 MB); 2,000 rows over 50 sheet copies about 1.7 s; heap at most 55 MB; no
   main-thread long task. Cancel acts between sheets and before the zip is written; progress
   counts rows and sheets.
8. **Left to M13-07:** a table (list object) on the chosen sheet below the start row (warn, or
   move its range by the same rule with a test), tests for notes and hyperlinks in moved rows, and
   relative references in custom drop-down formulas.

## Amendment 2 — S32: the Thin Lines rendering route (M13-03, 2026-11-24)

Spike S32 ([`spikes/s32-thin-lines/`](../../spikes/s32-thin-lines/),
[RESULTS.md](../../spikes/s32-thin-lines/RESULTS.md)) compared the three routes of plan §3 on the
app's pinned engine (`@embedpdf/pdfium` and `@embedpdf/engines` 2.15.1) with the Render worker's
own save code, on overlay corpus pairs 08, 12, 14 and 16, a self-made A0 CAD sheet (128,016 page
objects, one path per line, 2,000 placed symbols in form XObjects), the e2e A0 sheet and a
120 MB file. **Verdict: works, route b. No new dependency; D-69 stands as written.**

1. **How a line is thinned.** Every stroked path of the page, including those inside form
   XObjects at any depth, gets stroke width 0 (`FPDFPageObj_SetStrokeWidth`), which PDFium draws
   exactly 1 device pixel wide at every zoom (3 pt: 3 → 1 px at 100 %, 48 → 1 px at 1600 %),
   dashes kept. Fills, images, shadings, text in fonts (also drawn as stroked outlines) and
   comments are not page objects that change and draw exactly as before. Lettering drawn as
   lines (common in CAD files) thins like any other line. Not reached: lines inside tiling
   pattern cells and Type 3 glyphs (PDFium gives no access); Help says so with the filled-outline
   note. The walk calls the WASM exports directly (21 ms for 128,016 objects; the wrapped
   functions take 9× longer).
2. **Route a (toggle widths on the app's own document) is rejected.** PDFium keeps a "changed"
   mark on every object whose width was set, and putting the width back does not clear it.
   EmbedPDF calls `FPDFPage_GenerateContent` on the cached page for every comment added, changed
   or removed, so one thin tile followed by one comment edit makes Ctrl+S, keep-all, the
   snapshot, Save Optimized and Flatten-then-save write the page's content streams again (pair
   14's Ctrl+S tail: 925 bytes → 297 KB), and PDFium's content writer is not lossless for every
   stream. Dropping the page after every thin tile keeps the bytes identical but parses the page
   for every tile (+100 – 170 ms per tile on A0 sheets).
3. **Route c (Work worker tiles) is rejected.** The Work worker gives way only between pages and
   some of its jobs draw a whole page in one call (an A0 sheet at 150 dpi: 0.8 – 1.6 s), its copy
   of the document is the one redaction rewrites (so it would need a separate thin copy anyway),
   and tiles would need a new path to it.
4. **Route b (chosen): a view-only copy in the Render worker.** While Thin Lines is on, the Render
   worker opens a second, read-only copy of each document being viewed and draws page tiles (and
   the progressive preview) from it; comment tiles, snapshots, print, exports, the CRS and every
   save keep using the document itself, which Thin Lines never touches.
   - **Bytes of the copy:** the file as opened, read straight from the document's own buffer in
     the WASM heap (`FPDF_LoadCustomDocument`, so the file is never held twice), plus, only when
     the page content changed since opening, PDFium's incremental section for the current state.
     Comments and form values do not count (tiles have no comments), so the usual case opens in
     1 – 4 ms. The copy is registered in EmbedPDF's document cache (in `pdfium.ts`, the one file
     allowed into its internals) and drawn with the same `renderPageRect`, so rotation and tiles
     line up exactly; it is closed before its document.
   - **Kept thin:** each page of the copy is walked once per load and its widths set to 0; the
     copy is never edited otherwise and never saved.
   - **Kept current:** reopened after anything that changes page content or pages — page
     operations and their undo, Flatten Comments, object and OCR-layer transfers, redaction —
     the moments the app already calls `syncLive` for the Work worker; the tile cache is keyed by
     the setting and dropped for those pages. Reopening after a change costs one PDFium save of
     the document (a few ms on drawings, 3.3 s on a 120 MB image file), never per tile.
   - **Measured:** all six save paths byte-identical on four files; the copy with its widths put
     back draws the original byte for byte (an AES-256 file too); tiles cost what normal tiles
     cost (A0 CAD sheet at fit: 10.5 ms against 9.9 ms); the first tile of a page adds the walk
     (21 ms on the CAD sheet); memory adds the copy's own parsed pages (about 36 MB for the CAD
     sheet's one page, at most 10 pages per document) and its image cache, only while Thin Lines
     is on.
5. **Left to M13-05:** close copies when Thin Lines is turned off or a document closes; use the
   copy for the Measure loupe too (it shows the view as drawn) but not for snapshots; decide
   whether thumbnails follow Thin Lines (they draw through the normal path today); a unit test
   that a 3 pt line draws 1 device pixel and that saves stay byte-identical with Thin Lines on
   (`spikes/s32-thin-lines/s32.test.ts` shows how).
6. **Found on the way:** Ctrl+S on an image-heavy file is slow once its pages were drawn (PDFium
   writes the decoded image streams again and the narrow tail then drops them: 8.4 s instead of
   0.15 s for a 120 MB image). Today's behaviour, unrelated to Thin Lines; reported to the owner, not fixed here.
