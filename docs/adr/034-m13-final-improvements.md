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
