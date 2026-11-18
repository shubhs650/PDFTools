# Pre-release bug audit

_Date: 2026-11-18 · Build: `main` at d24086a (after M11, ARCHITECTURE.md Rev 0.18) · Requested by
the owner before the full release._

> **Fix status (2026-11-18):** the owner asked to fix bugs 1–4 first, then the others. All are
> now fixed except bug 11 (bug 8 with bug 3, the same cause; bug 7 was already fixed in M7-04);
> see "Fixes" at the end. Bug 11: the owner chose to keep PDF-XChange's behaviour (the tool
> stays on across tabs), so it is not changed.

The owner reported one bug (Advanced Search leaves its highlight after the pane is closed) and asked
for a thorough recheck for similar behaviour and other major UI and feature bugs, each rated 1–5 for
severity and occurrence. This audit read the code around shared state (search, tools, panes, tabs,
measurement, snapping) and drove a local e2e build with Playwright (Chromium 153 in the cloud
container) through each scenario. Every bug below was reproduced unless it says otherwise.

**Evidence:** the scratch Playwright specs used (not part of the suite) and screenshots are in the
project files under `pre-release-audit/` (`specs/`, `shots/`). The specs log what they find and can
be turned into regression tests when each bug is fixed.

## Rating scales

| Score | Severity                                                        | Occurrence                                     |
| ----- | --------------------------------------------------------------- | ---------------------------------------------- |
| 5     | Data loss, a corrupt file or a crash                            | Almost every session                           |
| 4     | A wrong or misleading result in a core feature                  | A common workflow, met within a day of use     |
| 3     | Clearly wrong behaviour the user notices; there is a workaround | A regular workflow, met within a week          |
| 2     | Confusing or untidy, but nothing is wrong in the document       | A specific sequence of steps, met now and then |
| 1     | Cosmetic or barely noticeable                                   | Rare edge case                                 |

The list is ordered by severity × occurrence (highest first).

## Summary

| #   | Bug                                                                                          | Area             | Sev | Occ | Score |
| --- | -------------------------------------------------------------------------------------------- | ---------------- | --- | --- | ----- |
| 1   | Advanced Search highlights stay after the Search pane is closed (owner's report)             | Search           | 3   | 5   | 15    |
| 2   | Search highlights are drawn in the wrong place on cropped pages or pages not starting at 0,0 | Search, Crop     | 4   | 3   | 12    |
| 3   | A Polyline, Polygon, Cloud, Perimeter or Area left half-drawn stays on the page as a ghost   | Comment, Measure | 3   | 3   | 9     |
| 4   | Advanced Search says "No results" after any page change (delete, rotate, insert, crop, move) | Search, Pages    | 3   | 3   | 9     |
| 5   | The Find bar keeps the previous document's "1 of N" after a tab switch or a new file         | Search, Tabs     | 2   | 3   | 6     |
| 6   | The snap marker stays on the page after leaving the measuring tool                           | Measure          | 2   | 3   | 6     |
| 7   | Quick arrow-key nudges can lose the last move (known since M6, not re-tested)                | Comments         | 3   | 2   | 6     |
| 8   | The live measurement value appears on another tab's page                                     | Measure, Tabs    | 2   | 2   | 4     |
| 9   | Closing a document stops an "All open documents" search with an error                        | Search, Tabs     | 2   | 2   | 4     |
| 10  | A bookmark whose page was deleted does nothing when clicked, with no message                 | Bookmarks        | 2   | 2   | 4     |
| 11  | The pointer tool stays armed across tabs and into the next opened file                       | Tools, Tabs      | 2   | 2   | 4     |
| 12  | Opening an Advanced Search result replaces the Find bar's own query and options              | Search           | 1   | 4   | 4     |
| 13  | A file with the same content as an open tab does not open, with no message                   | Open, Tabs       | 2   | 1   | 2     |

No severity 5 bug (data loss, corrupt file, crash) was found in this audit.

## Bugs

### 1. Advanced Search highlights stay after the Search pane is closed (owner's report)

**Severity 3 · Occurrence 5.** Every use of Advanced Search.

**Steps:** open a PDF; Ctrl+Shift+F; search for a word; click a result (the hit is highlighted);
close the pane (its × or the rail's Search button).
**Expected:** the highlight goes with the pane. **Actual:** it stays
(`shots/B01-search-highlight-after-pane-closed.png`). It also stays when:

- another pane is chosen (Thumbnails, Bookmarks, …);
- Esc is pressed in the document;
- a new Advanced Search finds nothing: the pane says "No results" while the old hits stay
  highlighted.

The only way to clear it is Ctrl+F then Esc (closing the Find bar).

**Likely cause:** `openHit` hands the results to Quick Find (`showResults` in
`src/features/search/findStore.ts`, which sets `highlights: true`). Only `closeFind()` sets it back
to false; the Search pane has no close or unmount hook that does it, and `runAdvancedSearch`
(`searchStore.ts`) never clears the Find store's results.

### 2. Search highlights are drawn in the wrong place on cropped pages or pages not starting at 0,0

**Severity 4 · Occurrence 3.** Every page cropped with Crop Pages or the Crop Tool, and every file
whose CropBox or MediaBox does not start at 0,0. That is common for CAD plots, scanned sets and
files cut from larger sheets.

**Steps:** open a PDF; Organize › Crop Pages, Top 10 mm, Left 15 mm, Crop; Ctrl+F, search for a
word on the page. **Actual:** the orange highlight is shifted right and up from the word
(`shots/B02-find-offset-after-crop.png`). The same happens on a file with `/CropBox [40 40 555 802]`
or `/MediaBox [100 100 695 942]`; a page with `/Rotate 90` is correct
(`shots/B02-cropbox-mediabox-rotate90.png`). Applies to Quick Find and to Advanced Search results.
Next / Previous scroll to the shifted place too.

**Likely cause:** `rects()` in `src/workers/work/search.ts` turns `FPDFText_GetRect` into view
coordinates with `height - top` (page user space), without taking off the visible box's origin;
the viewer draws pages from the CropBox. Snapping and the table overlay already convert with
`frameOf()` (`src/features/measure/viewports.ts`), so the fix can follow them. Text selection,
OCR and comments are placed correctly on the same pages (checked).

### 3. A Polyline, Polygon, Cloud, Perimeter or Area left half-drawn stays on the page as a ghost

**Severity 3 · Occurrence 3.** Choosing another tool before finishing a click-by-click shape.

**Steps:** Comment › Polyline (or Polygon, Cloud; or Measure › Perimeter, Area); click two points;
before double-clicking, choose another tool on the ribbon (Rectangle, Select, Area, …).
**Expected:** the unfinished shape is either finished or removed. **Actual:** no annotation is
created, but its lines stay drawn on the page (for measurements, with the "106.0 mm" value next to
them) and remain after further clicks
(`shots/B03-ghost-polyline-polygon-cloud.png`, `shots/B03-ghost-perimeter-after-select.png`).
The user can believe the markup exists; it is never saved. Esc while drawing clears it correctly.

**Likely cause:** changing the tool (`appStore.setTool`) does not cancel the drawing handler's
preview, which the Esc path does. For measurements, `measureStore.live`
(`src/features/measure/measureStore.ts`) is cleared only by `onPreview(null)` or a commit
(`measureTools.ts`), never on a tool change.

### 4. Advanced Search says "No results" after any page change

**Severity 3 · Occurrence 3.** Any page change after a search: delete (tested); rotate, insert,
move, crop, OCR and comment import go through the same path (`afterChange` in `pageOps.ts`).

**Steps:** open a 4-page PDF; Advanced Search for "Page" (4 results); Organize › Delete Pages,
Delete. **Actual:** the pane says "No results" and lists nothing, although the word is still on
three pages (`shots/B07-no-results-after-delete-page.png`). The user can conclude the text is not
in the document. After the last document is closed the pane also keeps "No results"
(`shots/B06-B07-stale-find-bar-and-search-status.png`, left).

**Likely cause:** `invalidatePages()` (`src/features/pages/invalidate.ts`) calls
`dropDocument()` in `searchStore.ts`, which removes the document's group but leaves
`status: 'done'`, so the pane shows the "none found" text. It should say the results are out of
date and offer to search again (or re-run the search).

### 5. The Find bar keeps the previous document's "1 of N" after a tab switch or a new file

**Severity 2 · Occurrence 3.**

**Steps (a):** open two PDFs; Ctrl+F in the first, search (status "1 of 3"); switch to the second
tab. **Actual:** the bar still says "1 of 3", but nothing is highlighted in this document; Next
then searches this one ("1 of 2").
**Steps (b):** with the Find bar open, close the last tab; open another file. **Actual:** the bar
reappears by itself with the old query and "1 of 3", although the new file has 2 pages
(`shots/B06-B07-stale-find-bar-and-search-status.png`).

**Likely cause:** `findStore` is one app-wide store; its results are reset only when Ctrl+F is
pressed in another document (`openFind`). Nothing listens to the active tab changing or the
document closing (Advanced Search does, `documentStore.subscribe` in `searchStore.ts`).

### 6. The snap marker stays on the page after leaving the measuring tool

**Severity 2 · Occurrence 3.** With Enable Snapping on.

**Steps:** open a drawing; Measure › Enable Snapping; Distance; hover near a line end (the blue
snap square appears); choose Home › Select. **Actual:** the square stays on the drawing
(`shots/B05-snap-marker-after-select.png`); it also stays after Esc.

**Likely cause:** `snapStore.marker` (`src/features/measure/snapping.ts`) is cleared only inside
`snapPoint()` and when snapping is turned off; not on a tool change or when the pointer leaves the
page.

### 7. Quick arrow-key nudges can lose the last move (known, not re-tested)

**Severity 3 · Occurrence 2.** Already listed in `docs/PROGRESS.md` (open issues, seen 2026-11-02,
M6-10) and never fixed: five quick arrow-key nudges on one comment sometimes saved 4 pt instead of 5. EmbedPDF's commit marks the annotation synced after a batch, so a move made while that batch is
in flight looks saved but never reaches PDFium. Listed here because it can silently change what is
saved; it needs its own task (re-commit when the object changed during the batch).

### 8. The live measurement value appears on another tab's page

**Severity 2 · Occurrence 2.**

**Steps:** open two PDFs; in the second, Measure › Perimeter, click two points and move the
pointer; switch to the first tab. **Actual:** the "106.0 mm (uncalibrated)" label floats on the
first document's page, which has no measurement (`shots/B04-measure-readout-on-other-tab.png`).

**Likely cause:** `measureStore.live` holds only a page index, not the document; `MeasureOverlay`
shows it on whichever document is active at that page index.

### 9. Closing a document stops an "All open documents" search with an error

**Severity 2 · Occurrence 2.**

**Steps:** open three PDFs (two large); Advanced Search, Look in: All open documents, search;
while it runs, close one of the large documents. **Actual:** the search stops with "The search
didn't finish. Try again."; the documents after the closed one are never searched.

**Likely cause:** the loop in `runAdvancedSearch` (`searchStore.ts`) still starts or awaits the
closed document's search; that rejects with an error that is not an abort, so the whole search
ends in `error`. A closed document should be skipped.

### 10. A bookmark whose page was deleted does nothing when clicked, with no message

**Severity 2 · Occurrence 2.**

**Steps:** open a 4-page PDF; go to page 3; Bookmarks › New Bookmark; delete page 3 (Organize ›
Delete Pages); click the bookmark. **Actual:** nothing happens and nothing says why; the bookmark
looks like any other.

**Likely cause (not traced):** after the page goes, the bookmark's destination points at no page;
the tree does not mark it and the click is ignored. A notice ("This bookmark's page was deleted")
or a marked entry would help.

### 11. The pointer tool stays armed across tabs and into the next opened file

**Severity 2 · Occurrence 2.** Needs an owner decision: PDF-XChange also keeps the tool across
tabs, so this may be wanted for some tools.

**Steps:** turn on the Crop Tool (or Mark Area for Redaction, Select Fields, Zoom to Area,
Snapshot) in one tab; switch tabs, or close every tab and open another file. **Actual:** the tool
is still on in the other tab and in the newly opened file. A drag on a new file then starts a
crop or a redaction mark the user may not expect.

**Likely cause:** `appStore.tool` is app-wide and nothing resets it on tab switch or when the last
document closes. A possible rule: keep comment tools, return the one-shot page tools (Crop,
Redaction area, Select Fields, Zoom to Area, Snapshot) to Select on a tab switch and when no
document is open.

### 12. Opening an Advanced Search result replaces the Find bar's own query and options

**Severity 1 · Occurrence 4.**

**Steps:** Ctrl+F, search for one word; close the bar; Advanced Search for "page"; click a
result; Ctrl+F. **Actual:** the Find bar now holds "page"; the user's own query is gone, and
Enter walks the Advanced Search results with their options (wildcards or regex too, which the bar
does not show). It is how F3 walks Advanced Search results today (M2-09), so this may be
acceptable; listed so the fix for bug 1 can decide.

**Likely cause:** `showResults` in `findStore.ts` writes the Advanced Search query and options into
the Find store.

### 13. A file with the same content as an open tab does not open, with no message

**Severity 2 · Occurrence 1.**

**Steps:** drop `a.pdf` on the window; drop `b.pdf`, a byte-for-byte copy with another name.
**Actual:** no second tab; the first one is focused and nothing says why. With identical sheet
templates or "– Copy" files this looks like a failed open.

**Likely cause:** `findDuplicate` (`src/features/open/sources.ts`) compares two files by path only
when both have a file handle (opened with the picker in Chrome or Edge); a dropped file, or any
file in Firefox and Safari, is compared by content fingerprint. The `duplicate` outcome in
`openOne` (`openDocument.ts`) shows no notice. At least a short notice ("Already open as a.pdf")
would help.

## Checked and working

These scenarios were driven in the browser and behaved correctly:

- Each tab keeps its own page, zoom and view; switching back restores them.
- Text selection is cleared on a tab switch and comes back on return; the selected-text menu and
  "Search for …" work.
- A selected comment and the Properties pane follow the active tab; Delete in another tab never
  deletes it.
- A sticky note's window hides on a tab switch and keeps its typed text; Undo of the note and
  deleting its page close the window; Undo of the delete brings note and text back.
- Esc while dragging with the Crop Tool, Zoom to Area, Snapshot or Mark Area for Redaction cancels
  the drag and creates nothing.
- Measurements in progress are cleared by Esc.
- The tab hover card goes when its tab is closed.
- Text selection, OCR placement and comments are positioned correctly on cropped pages; search
  highlights are correct on rotated pages.
- The OCR flow (search after recognition, select at once) is covered by `e2e/ocr.spec.ts` and was
  not repeated.

## Not covered

- Owner-only checks (Acrobat Reader and PDF-XChange round trips, Windows fonts, real files) are in
  the M11 owner pack and were done by the owner on 2026-11-18.
- Firefox and Safari were not run (the container has Chromium only).
- Recent files, Pick up where you left off and Reopen Closed Tab read file handles back, which
  crashes headless Chromium 153 in the container (known); they rely on their CI tests.

## Fixes

| #   | Fix                                                                                                                                                                                                                                                                                                                                                             | Tests                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The Find store remembers when its results came from an Advanced Search result (`fromSearch`). Closing the Search pane (×, rail, another pane) or running a new Advanced Search takes those highlights off (`clearSearchHighlights`), unless the Find bar is open and shows them. The Find bar's own highlights are unchanged. Esc in the document is unchanged. | `e2e/search-pane.spec.ts` "closing the pane, choosing another pane or searching again takes the result highlight off"                                 |
| 2   | Hit rectangles are measured from the visible page area's top-left corner (`FPDF_GetPageBoundingBox`, crop box ∩ media box), as the image-under-pointer code already does, instead of the page height.                                                                                                                                                           | `tests/search/search-pdfium.test.ts` "hit rectangles follow the visible page area" (fails before the fix by 42 pt)                                    |
| 3   | Choosing another tool, or showing another tab, drops a half-drawn Polyline, Polygon, Cloud, Perimeter or Area as Esc does (`cancelDrawing`), with its preview and live value. Also fixes bug 8.                                                                                                                                                                 | `e2e/draw-tools.spec.ts` "another tool while a polyline, polygon or cloud is half drawn…", `e2e/measure.spec.ts` "another tool or another tab drops…" |
| 4   | A page change marks the results out of date (status `outdated`: "The pages changed. Search again to update the results.") instead of "No results"; a running search of that document stops. When the last searched document closes, the pane starts over (empty status).                                                                                        | `e2e/search-pane.spec.ts` "after a page change the pane asks for a new search…"                                                                       |
| 5   | The Find bar follows the selected tab: on another tab it starts afresh (query kept, count and highlights cleared, a running find cancelled); with no document left it closes.                                                                                                                                                                                   | `e2e/find.spec.ts` "another tab starts the bar afresh; with no document left it closes"                                                               |
| 6   | Choosing another tool or tab clears the snap marker, and a snap answer that arrives after that is ignored (`clearSnapMarker`).                                                                                                                                                                                                                                  | `e2e/snap.spec.ts` "the snap marker goes when another tool is chosen"                                                                                 |
| 7   | Already fixed in M7-04 (B13, D-43): quick nudges are re-committed when the object changed during a batch. The stale open issue in PROGRESS is closed.                                                                                                                                                                                                           | `e2e/comment-selection.spec.ts` "ten quick nudges end where ten slow ones do, and are saved (B13)"                                                    |
| 8   | Fixed with bug 3 (`cancelDrawing` on a tab change drops the live value).                                                                                                                                                                                                                                                                                        | `e2e/measure.spec.ts` "another tool or another tab drops…"                                                                                            |
| 9   | An "All open documents" search skips a document closed while it runs (counted as done) instead of stopping with an error.                                                                                                                                                                                                                                       | `e2e/search-pane.spec.ts` "closing a document while all open documents are searched skips it"                                                         |
| 10  | A bookmark whose page no longer exists shows "This bookmark doesn't lead to a page in this document. Its page may have been deleted." (`followBookmark`), from the pane and from Go To.                                                                                                                                                                         | `e2e/bookmark-editing.spec.ts` "a bookmark whose page was deleted says so…"                                                                           |
| 11  | No change, by the owner's decision: the tool stays armed across tabs, as in PDF-XChange.                                                                                                                                                                                                                                                                        | —                                                                                                                                                     |
| 12  | Opening an Advanced Search result no longer writes its query and options into the Find bar. F3 / Shift+F3 walk the result's hits while the bar is closed; Ctrl+F opens the bar afresh with its own query.                                                                                                                                                       | `e2e/find.spec.ts` "an Advanced Search result keeps the bar query; F3 walks its hits; Ctrl+F starts afresh"                                           |
| 13  | Opening a file whose content is already open under another name selects that tab and says "The same file is already open as …".                                                                                                                                                                                                                                 | `e2e/open.spec.ts` "dropping a copy of an open file under another name…"                                                                              |
