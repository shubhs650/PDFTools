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
