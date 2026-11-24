# Spike S33 — project CRS templates with ExcelJS (M13-06)

Task M13-06 of [docs/plan/M13.md](../../docs/plan/M13.md) (D-71; plan §6, the owner's answers
C1 – C15). The result is recorded in [ADR-034](../../docs/adr/034-m13-final-improvements.md) as
**Amendment 1 (S33)**. No feature code: everything here is in `spikes/s33-crs-templates/`.

**Verdict: works with workaround.** ExcelJS 4.4.0 (MIT, already in the app, lazy in the Work
worker) loads a project's `.xlsx` or `.xltx` form, and the spike fills it the way C1 – C15 ask:
pre-drawn rows first, then inserted rows that copy borders, fonts, fills, row height, formulas
(moved to the new row), drop-downs and conditional formatting, while the sign-off block, totals,
print area and pictures below move down; one copy of the sheet per page or per document; snapshot
pictures fitted to their column. Every result opens in LibreOffice and openpyxl, LibreOffice
works every formula out to the right number, and a structural check for the known causes of
Excel's "repair" prompt finds nothing. No new dependency.

- **Workaround 1: rows are inserted on the sheet's model, not with ExcelJS's `insertRows`.**
  ExcelJS's own insert moves values and merges but leaves new rows without borders, formulas or
  drop-downs, and does not grow totals (`COUNTA(E10:E24)` stays), conditional formatting or the
  print area (so the moved sign-off block falls outside it). The spike edits the plain worksheet
  model (`ws.model` → change → `ws.model = …`) in one pass, whatever the number of rows.
- **Workaround 2: four ExcelJS write problems are fixed before writing** (each has a test):
  drop-down ranges that cross row 9 → 10 (or 99 → 100) are written twice, overlapping (a likely
  Excel repair); a column exactly 9 wide loses its width; LibreOffice shows the template's old
  formula results (for example a total of 0) because ExcelJS's files say Excel wrote them; and
  setting a sheet model keeps the old merged cells. Details below.
- **What a template loses** (the import must name it in a warning): text boxes and other shapes,
  charts, sparklines, Excel 2010-style drop-downs kept in the sheet's extension list, named cell
  style names (the formatting itself stays), and macros (refused). Everything a CRS form normally
  has survives: merged cells, logo pictures, borders, fills, fonts, column widths, row heights,
  print area and print titles, page setup, header and footer, frozen panes, drop-downs,
  conditional formatting, formulas (shared ones too), defined names, cell notes, hyperlinks,
  hidden sheets, sheet protection, Excel tables on other sheets, grouped rows.
- **Fast:** 2,000 rows with 200 pictures in about **0.5 s** in a browser worker under the app's
  CSP (the same in Node), 2,000 pictures in about 1.5 s (6.4 MB file), 2,000 rows over 50 sheet
  copies in about 1.7 s; no main-thread long task, no CSP violation, at most 55 MB of heap.
- **Owner's check still open:** open the sample files in Excel (no repair prompt, layout as
  expected). They are in the project files under `m13-06/`, and `run-node.ts` makes them again.

## How it was tested

- **Self-made templates** (`templates.ts`, rule 13; `rich_template.py` with openpyxl, spike
  tooling only):
  - **A, a full project form** on sheet "CRS": logo picture, merged title and detail cells, a
    detail block (document number, revision, title, reviewer, review date), totals by formula
    (`COUNTA`, `COUNTIF`), a header row, 15 pre-drawn bordered rows whose last row closes the
    table with a medium bottom edge, a "Days open" column as one shared formula (Excel's fill
    down), drop-downs (status from a `Lists` sheet, discipline inline, a date check), two
    conditional formats (a cell rule and an expression over the whole table), a sign-off block
    below (merged boxes, a small picture), print area, print titles, A3 landscape fit to width,
    footer, frozen panes, a workbook name pointing into the table, a column exactly 9 wide, and a
    `Notes` sheet with a formula pointing at the CRS sheet.
  - **B, a one-row form:** header row 6, one bordered start row (7), a totals row right under it
    (`COUNTA(C7:C7)`), a merged note below, a drop-down whose list is a hidden column on the same
    sheet.
  - **Variants by editing the zip:** A as `.xltx` (only the main content type differs), as
    `.xlsm` (macro content type and a VBA part), the first bytes of an old `.xls`, and A with a
    text box shape beside the logo.
  - **C, the parts ExcelJS has no model for:** a chart, a cell note, a hyperlink, an Excel table, a
    data-bar rule, a named cell style, a hidden sheet, a protected sheet, grouped rows, a
    sparkline group and an Excel 2010-style drop-down in the sheet's extension list.
- **The engine** (`engine.ts`, `a1.ts`): detection of pre-drawn rows, the row insert, sheet
  copies and renaming, safe sheet names, picture fitting, and the four write fixes.
- **Checks** (`check.ts`): every written file is unzipped and checked for overlapping merged
  cells, overlapping drop-down ranges, bad or duplicate sheet names, names pointing at missing
  sheets, parts without a content type, relationships to missing parts, rows out of order and
  upside-down picture anchors. `inventory()` counts the parts and features before and after.
- **Other readers:** LibreOffice 24 (headless) converts every result to PDF (pages rendered for a
  look) and to `.xlsx`, which ExcelJS reads back to compare the totals LibreOffice worked out;
  openpyxl 3.1 loads every result.
- **Browser** (`main.ts`, `xlsx.worker.ts`, `s33.spec.ts`): the same code in a module worker with
  `import('exceljs')` (as `src/workers/work/crs.ts` does), served with the §10.1 CSP verbatim.
- **Unit tests** (`s33.test.ts`, 11 tests, run with the app's unit tests): the reference rules,
  sheet names, file kinds, and fills read back with ExcelJS.

## Results

### Loading: which files

| File                                       | Kind (from the bytes)       | ExcelJS load                   | Plan                                  |
| ------------------------------------------ | --------------------------- | ------------------------------ | ------------------------------------- |
| `.xlsx`                                    | `xlsx`                      | loads                          | taken                                 |
| `.xltx` (Excel template)                   | `xltx`                      | loads; written back as `.xlsx` | taken                                 |
| `.xlsm` / `.xltm` (macros)                 | `macro`                     | loads, **macros dropped**      | refused                               |
| `.xlsb` (binary workbook)                  | `binary`                    | not tried (binary parts)       | refused                               |
| `.xls`, or `.xlsx` with a password to open | `ole` (both are OLE2 files) | fails ("end of central dir…")  | refused; the message names both       |
| Written by another tool (openpyxl seen)    | `xlsx`                      | **fails** (see below)          | plain error: save it again from Excel |
| Saved by LibreOffice                       | `xlsx`                      | loads                          | taken                                 |

The kind comes from the file's bytes (`detect.ts`: the OLE2 signature, else the zip's main
content type), never from the file name. **ExcelJS finds parts by Excel's own names and
prefixes, not by following the relationships:** openpyxl's file (drawing XML with a default
namespace, comments at `xl/comments/comment1.xml`, absolute relationship targets) makes the load
throw. Excel and LibreOffice write the expected form, so the import catches any load error and
says: open the workbook in Excel or LibreOffice, save it as `.xlsx`, and import it again.

### What survives a load and write

Counted in the zip before and after (`inventory()`), templates A, A as `.xltx`, A with a text
box, C:

| Kept                                                                                                                                                                                                                                                                                                                                                                                                      | Lost (warn at import)                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merged cells, pictures (logo), borders, fills, fonts, number formats, column widths (with fix 2), row heights, print area, print titles, page setup, header and footer, frozen panes, drop-downs, conditional formatting (a data bar too), formulas and shared formulas, defined names, cell notes, hyperlinks, hidden sheets, sheet protection, an Excel table on another sheet, grouped rows, the theme | Text boxes and other shapes, charts, sparklines, Excel 2010-style drop-downs in the extension list (`x14:dataValidation`), named cell style names, macros |

Not tried here, and expected lost because ExcelJS has no model for them: pivot tables, slicers,
threaded comments, form controls, pictures in the header or footer, links to other workbooks.
The import can name all of these from the zip's part list (`inventory()` shows how) before the
template is saved.

### The row insert (C2, C3, C11)

**Pre-drawn rows** (`detectPreDrawn`): from the start row down, rows whose table columns carry
the start row's left and right borders and fill, and hold no typed value (formula columns are
allowed). The bottom edge is not compared, so a last row that closes the table with a heavier
line counts; a row without borders (the gap before the sign-off block) ends the run. Template A:
rows 10 – 24 found; template B: the start row only. The "Last pre-drawn row" override (C3) skips
the detection.

**Inserting `n` rows after the last pre-drawn row `L`** (`insertRows`), in one pass over the
model, with one rule for every reference (`a1.ts` `shiftRows`): a row after `L` moves down by
`n`; a range that reaches `L` from above or at it **grows** (`COUNTA(E10:E24)` → `E10:E49`, print
area `A1:K30` → `A1:K55`, conditional formatting `A10:K24` → `A10:K49`, the name `CommentText`);
anything wholly above stays. Applied to: cells and their formulas (array formula ranges too),
merged cells, drop-downs and their list formulas, conditional formatting ranges and rule
formulas, pictures (anchors), print area, row breaks, the filter range, formulas on **other
sheets** that point at this one (`Notes!A3`) and the workbook's names. Each new row is a copy of
the start row: styles, height, merges inside the row, drop-downs, and formulas slid to the new
row as a fill down would (`IF(H10…)` → `IF(H40…)`). Shared formulas are turned into plain ones
first (a child names only its master, which would break when rows move apart). The closing
bottom edge of row `L` moves to the new last row. Formulas the template had with saved results
are written without them, so every reader works them out (fix 3).

Read back with LibreOffice's own calculation: 40 comments in A → total 40, open 10,
`Notes!A3` 40; 12 comments in B → total 12; every sheet copy counts its own rows.

### Sheet copies (C5, C15) and names

`copySheet` builds a new sheet from a model of the template sheet taken **before** filling:
cells, styles, merges, widths, heights, drop-downs, conditional formatting, pictures (sharing
the workbook's image), print area and titles, page setup, frozen panes, header and footer; the
copy's own references to the sheet name point at the copy. The first page or document fills the
template sheet itself, renamed (`renameSheet` rewrites every reference in the workbook, so
`Notes!A3` becomes `'A-101'!K4`); the others go right after it, in order. Sr. No. restarts on
each sheet (C6). Workbook names keep pointing at the first sheet (Excel's copy would add
sheet-level names; not needed for a CRS).

Sheet names (`sheetName`): characters `: \ / ? * [ ]` become `-`, control characters go, quotes
at either end go, at most 31 characters (UTF-16 units, as Excel counts; a surrogate pair is never
split), "History" becomes "History 1" (Excel reserves it), and a clash (case-insensitive) gets
" (2)", " (3)" … within the 31. ExcelJS itself throws on forbidden characters, quotes, "History"
and an empty name, cuts long names silently, and lets "history" through.

| Page label or document                    | Sheet name                        |
| ----------------------------------------- | --------------------------------- |
| `B:102/Section*?`                         | `B-102-Section--`                 |
| `GA drawing – nozzle orientation detail…` | `GA drawing – nozzle orientation` |
| `a-101` after `A-101`                     | `a-101 (2)`                       |
| `History`                                 | `History 1`                       |
| `PA-1200-ME-DWG-0042_RevB pump skid GA`   | `PA-1200-ME-DWG-0042_RevB pump s` |

### Snapshot pictures (C9)

The Snapshot column's width in pixels comes from its character width (`widthPx`, Excel's own
formula with the default font's 7-pixel digit; a merged snapshot cell counts all its columns).
The picture is scaled to that width less a 4-pixel margin, capped at the height limit, anchored
to its cell ("move with cells", `oneCell`, native offsets in EMU), and the row grows to fit.
ExcelJS's fractional anchors assume its own column units, so the native anchor is given. Wide,
square and tall stand-ins all sit inside their cells in LibreOffice's PDF. A filled row whose
wrapped text needs more lines than its height gets an explicit height (`fitTextHeight`, lines
estimated from the column width): without it LibreOffice grows the row on opening but places the
pictures below by the stored heights, so they drifted up by a line (seen on template B). A
template whose default font is much larger than Calibri 11 would leave a slightly wider margin; Excel's row
height limit (409 points) caps the height limit at about 540 pixels.

### The four write fixes

1. **Drop-down ranges** (`compactValidations`): ExcelJS keeps one drop-down per cell and squeezes
   them back into ranges when writing, after sorting the cells **as text** ("E10" before "E7").
   Drop-downs on E5:E14 come out as `E10:E14` and `E5:E14`, overlapping, even when a template is
   saved back untouched. The spike hands ExcelJS ready column ranges in row order.
2. **Width 9** (`keepWidth9`): ExcelJS leaves out of the file, and out of the sheet model, a
   column exactly 9 wide (its own default), which Excel then shows at 8.43. Straight after
   loading, such widths become 9.0001 (looks the same).
3. **Old formula results** (`dropFormulaResults`, `fullCalcOnLoad`): the template's saved results
   (a total of 0) are written again, and LibreOffice trusts them because ExcelJS's files say
   Excel wrote them. Results are dropped and Excel is told to recalculate on opening.
4. **Setting a sheet model** keeps the sheet's old merged cells and refuses the new list as
   overlapping; merged cells also come back as "merge" cells that the setter refuses. The spike
   clears the old list and passes merged cells as plain styled cells.

### Time and memory (2,000 rows, template A)

| Run                             | Browser worker (Chromium) | Node     | File    | Heap peak (Node) |
| ------------------------------- | ------------------------- | -------- | ------- | ---------------- |
| 2,000 rows, 200 pictures        | 482 ms                    | 447 ms   | 0.74 MB | 47 MB            |
| 2,000 rows, no pictures         | —                         | 332 ms   | 0.12 MB | 43 MB            |
| 2,000 rows, 2,000 pictures      | 1,461 ms                  | 1,184 ms | 6.4 MB  | 55 MB            |
| 2,000 rows over 50 sheet copies | 1,684 ms                  | 1,552 ms | 0.91 MB | 35 MB            |

One run each; times vary by about 10 % between runs. Node phases for the first run: load 15 ms,
fill (insert 1,985 rows, write 2,000 rows, 200 pictures) 106 ms, write 325 ms. Loading ExcelJS
in the worker the first time: 55 – 75 ms. No
main-thread long task and no CSP violation in the browser run. The fill of one sheet is one
synchronous step of about 100 ms per 2,000 rows and the zip is one step at the end (as in the
Standard CRS today), so Cancel takes effect between sheets and before the write; progress counts
rows and sheets.

## What M13-07 takes from this

- The import refuses `macro`, `binary` and `ole` files with a plain message (the `ole` message
  also covers a workbook with a password to open), catches a failed load with "save it again
  from Excel", and warns by name about the lost parts above.
- The engine is the spike's method: model-level insert with the one reference rule, sheet copies
  from a model taken before filling, the first group renaming the template sheet, safe sheet
  names, and the four write fixes. ExcelJS's own `insertRows`, `spliceRows` and
  `duplicateRow` are not used.
- Not covered here and to be decided or tested in M13-07: an Excel table (list object) or a
  filter **on the chosen sheet** below the start row (the spike moves a filter range but not a
  table's range: warn, or move it with the same rule and test it), notes and hyperlinks in moved
  rows (they travel with their cells in the model; add a test), and relative references in
  custom drop-down formulas (ExcelJS keeps one rule per cell with the formula of the range's
  first cell).

## Running

```sh
node --expose-gc --import ./spikes/shared/ts-ext.ts spikes/s33-crs-templates/run-node.ts
# → out/templates/, out/results/, out/lo/ (PDF and page 1 pictures), out/s33-results.json
#   (LibreOffice, pdfinfo/pdftoppm and python3 with openpyxl are optional)
npx vitest run spikes/s33-crs-templates
PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium SPIKE=s33 npm run spikes -- --project=s33
# → test-results/s33-results.json
```
