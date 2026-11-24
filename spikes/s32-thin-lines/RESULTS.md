# Spike S32 — Thin Lines: how to draw every page line 1 pixel wide (M13-03)

Task M13-03 of [docs/plan/M13.md](../../docs/plan/M13.md) §3 (D-69). The result is recorded in
[ADR-034](../../docs/adr/034-m13-final-improvements.md) as **Amendment 2 (S32)**. No feature code:
everything here is in `spikes/s32-thin-lines/`.

**Verdict: works, route b (a view-only copy of the document in the Render worker, kept thin).**

- **Width 0 does it.** A stroke width of 0 is the PDF's "thinnest line the device can draw";
  PDFium draws it exactly 1 device pixel wide at every zoom (3 pt line: 3 → 1 px at 100 %,
  12 → 1 at 400 %, 48 → 1 at 1600 %), page lines, lines under a scaled matrix, dashed lines (the
  dashes stay) and lines inside form XObjects and nested form XObjects alike. Fills, text (also
  text drawn as stroked outlines) and comments draw exactly as before (0 pixels differ).
- **Route a (set widths to 0 around each tile on the app's own document, then back) fails the
  save test.** PDFium marks every page object whose width was set as changed and putting the width
  back does not clear that. EmbedPDF calls `FPDFPage_GenerateContent` on the cached page whenever
  a comment is added, changed or removed, so after one thin tile and one comment edit **Ctrl+S
  rewrites the page's content streams**: pair 14's Ctrl+S tail grows from 925 bytes to 297 KB,
  and every other save path differs too, on all four files. Making it safe (dropping the page
  after every thin tile) means parsing the page again for every tile: +100 – 170 ms per tile on
  the A0 sheets. It also costs up to +25 ms per tile on an A0 sheet with one path per line.
- **Route b passes everything.** Saves stay byte-identical (six save paths, four files), the copy
  draws exactly what the original draws once its widths are put back (0 bytes differ, an
  encrypted file too), tiles cost the same as normal tiles, opening the copy takes 1 – 4 ms when
  the page content has not changed, and the file's bytes are not held twice.
- **Route c (thin tiles from the Work worker) is not needed and would be slow to answer:** the
  Work worker only gives way between pages, and some of its jobs draw a whole A0 page in one call
  (0.8 – 1.6 s at 150 dpi), so a tile could wait that long; its own copy of the document is the
  one redaction rewrites, so it would need a separate thin copy anyway — route b in a busier
  worker.

## How it was tested

`run-node.ts` runs everything in Node on the app's pinned engine (`@embedpdf/pdfium` and
`@embedpdf/engines` 2.15.1) with the app's own Render-worker code: `SaveTracker` for every save,
`applyPageOp` for Flatten Comments, tiles through EmbedPDF's own `renderPageRect` (256 px, no
comments, as the tiling plugin asks). `s32.test.ts` (3 tests) keeps the three findings in the
unit tests.

```
node --expose-gc --import ./spikes/shared/ts-ext.ts spikes/s32-thin-lines/run-node.ts [width|saves|perf|memory|pictures|all]
```

- `thin.ts` walks a page: every page object, into every form XObject (recursively, through
  `FPDFFormObj_CountObjects` / `GetObject`); a path whose draw mode strokes is collected with its
  width (`FPDFPageObj_GetStrokeWidth`); `thin()` sets 0, `restore()` puts the widths back
  (`FPDFPageObj_SetStrokeWidth`). It calls the WASM exports directly: the module's wrapped
  functions made the walk 9× slower (189 → 21 ms on 128,000 objects).
- `copy.ts` makes route b's copy: the opened bytes plus PDFium's incremental section for the
  current state (`FPDF_SaveAsCopy` with `FPDF_INCREMENTAL` writes the opened bytes unchanged
  first; checked). "Shared" opens it with `FPDF_LoadCustomDocument`, reading the opened bytes
  straight from the original's buffer in the WASM heap, and registers it in EmbedPDF's document
  cache so its tiles go through the same `renderPageRect` (rotation handling included);
  "buffer" is EmbedPDF's `openDocumentBuffer` (a second copy of the file).
- **Fixtures** (`fixtures.ts`, self-made, rule 13): a probe page (3 pt lines: plain, vertical,
  0.75 pt under a 4× matrix, dashed, in a form XObject, in a nested form XObject; a hairline
  already 0 wide; fill-only and fill-and-stroke rectangles; text drawn with `Tr 1`; a Square
  comment with a 3 pt border; two content streams); an **A0 CAD sheet** written the way many CAD
  exporters write, one path per line (100,000 lines in five widths, 2,000 placed symbols as form
  XObjects with 13 lines each, a title block; 128,016 page objects); the e2e **A0 sheet**
  (`a0Sheet(200_000)`, 50 segments per path); a **120 MB file** (one page with an image, for
  memory). Corpus overlay **pairs 08** (P&ID with hairlines), **14** (dense A1 plot plan, with
  stroked lettering), **16** (identical control) and **12** (AES-256, password `test1234`).

## Results

### Width (probe page, ink across the line in device px; `width`)

| Scale (px/pt) | 3 pt page line | Scaled matrix |      Dashed | In form | In nested form | 0-width hairline | Fill, text, comment |
| ------------: | -------------: | ------------: | ----------: | ------: | -------------: | ---------------: | ------------------- |
|          0.25 |          1 → 1 |         1 → 1 | 0.75 → 0.75 |   1 → 1 |          1 → 1 |            1 → 1 | unchanged (0 px)    |
|             1 |          3 → 1 |         3 → 1 |       3 → 1 |   3 → 1 |          3 → 1 |            1 → 1 | unchanged (0 px)    |
|             4 |         12 → 1 |        12 → 1 |      12 → 1 |  12 → 1 |         12 → 1 |            1 → 1 | unchanged (0 px)    |
|            16 |         48 → 1 |        48 → 1 |      48 → 1 |  48 → 1 |         48 → 1 |            1 → 1 | unchanged (0 px)    |

After `restore()` every window, and the whole page at 2 px/pt, is pixel-identical to before.

Pictures (normal left, Thin Lines right, 2 device px per CSS px): project files `m13-03/`, made by
`run-node.ts pictures` (not committed). Pair 14's lettering is drawn with stroked lines, so it
thins too; text in a font does not.

### Saves (`saves`)

Each file is opened three times or more in one Render-worker engine and given the same edits:
a view of 12 tiles, a Square comment through EmbedPDF's `createPageAnnotation` (recorded as the
executor does), the view again, then **Ctrl+S** (narrow tail), **Ctrl+S keep-all**, the
**snapshot** (recovery and the Work worker's live copy), **Save Optimized** (full rewrite), then
**Flatten Comments** on page 1, the view again, **Ctrl+S** and **Save Optimized**. Byte-for-byte
against the run with plain tiles (two plain runs agree, so the saves are deterministic):

| File                | Route a | Route a + drop page after each tile | Route b (shared)        | Route b (buffer) | Copy out of sync |
| ------------------- | ------- | ----------------------------------- | ----------------------- | ---------------- | ---------------- |
| Probe page          | differs | identical                           | identical               | identical        | 0 bytes          |
| Pair 08             | differs | identical                           | identical               | identical        | 0 bytes          |
| Pair 14             | differs | identical                           | identical               | identical        | 0 bytes          |
| Pair 16             | differs | identical                           | identical               | identical        | 0 bytes          |
| Pair 12 (encrypted) |         |                                     | opens with the password |                  | 0 bytes          |

Route a's Ctrl+S tail after one comment: probe 924 → 1,309 bytes, pair 08 988 → 3,469, pair 14
925 → 297,541, pair 16 925 → 8,559 (the page content written again). The same happens with any
other `FPDFPage_GenerateContent` on the same loaded page (`dirtyHazard`: Save Optimized 1,679 →
1,687 bytes). PDFium's content writer is also not lossless for every content stream, so this is
a correctness risk, not only a size one. Flatten itself is safe: `applyPageOp` purges EmbedPDF's
page cache and loads the page fresh.

"Copy out of sync": the copy's tile with its widths put back, compared byte for byte with the
original's tile, after the comment and again after the flatten (the copy reopened).

### Tile time (`perf`; ms per 256 px tile over a 1920 × 1080 window, mean / max)

| File (objects walked)      | Zoom | Normal      | Route a, walk each tile | Route a, walk cached | Route a + drop page | Route b     |
| -------------------------- | ---- | ----------- | ----------------------- | -------------------- | ------------------- | ----------- |
| Pair 08 (187)              | fit  | 0.31 / 0.94 | 0.40 / 2.46             | 0.27 / 0.44          | 0.72 / 1.10         | 0.27 / 1.38 |
| Pair 14, A1 (1,425)        | fit  | 6.0 / 12.3  | 6.3 / 10.6              | 5.9 / 11.7           | 22.7 / 24.7         | 6.0 / 10.3  |
|                            | 400% | 5.7 / 8.7   | 6.1 / 9.8               | 5.8 / 8.9            | 21.7 / 23.1         | 5.8 / 8.9   |
| Pair 16 (191)              | fit  | 0.45 / 1.2  | 0.42 / 1.3              | 0.39 / 0.91          | 1.2 / 1.5           | 0.38 / 0.84 |
| e2e A0 sheet (4,000)       | fit  | 6.2 / 9.5   | 6.9 / 9.8               | 6.6 / 9.9            | 105.6 / 116.8       | 6.3 / 9.3   |
|                            | 400% | 0.70 / 1.4  | 1.5 / 3.8               | 0.87 / 1.6           | 98.0 / 100.9        | 0.74 / 1.7  |
| **A0 CAD sheet (128,016)** | fit  | 9.9 / 13.8  | 36.7 / 46.6             | 22.2 / 43.1          | 168.2 / 209.4       | 10.5 / 14.0 |
|                            | 100% | 5.0 / 6.1   | 30.1 / 48.8             | 13.9 / 40.1          | 151.3 / 156.8       | 5.7 / 7.3   |
|                            | 400% | 2.1 / 2.8   | 27.1 / 39.6             | 10.7 / 29.1          | 150.3 / 153.8       | 2.9 / 3.8   |

One-off costs on the A0 CAD sheet: parsing the page 137 ms (the same for the original), walking
it 21 ms, setting all widths and back 11 ms. Route b's first tile on that sheet is 172 ms (parse,
walk, draw) against about 147 ms for a normal first tile; EmbedPDF parses a page again after 5 s
unused, and route b walks it again then (21 ms). Route b's copy opens in 1.4 – 3.6 ms when the
page content is unchanged.

### Memory (`memory`; WASM heap with one tile drawn)

| File                    | Document only | + route b, buffer | + route b, shared | + route b, shared, content unchanged | Route c (the Work worker's own heap) |
| ----------------------- | ------------: | ----------------: | ----------------: | -----------------------------------: | -----------------------------------: |
| Pair 14 (0.3 MB)        |       17.8 MB |           17.8 MB |           17.8 MB |                              17.8 MB |                              17.8 MB |
| A0 CAD sheet (1.4 MB)   |       53.3 MB |           92.1 MB |           92.1 MB |                              92.1 MB |                              53.3 MB |
| 120 MB file (one image) |      290.1 MB |          693.6 MB |          577.9 MB |                             434.1 MB |                             290.1 MB |

The copy's own parsed pages cost what the original's do (the CAD sheet's parsed page is about
36 MB), at most EmbedPDF's 10 pages per document, and only while Thin Lines is on; with Thin
Lines on, the original's pages are still parsed for comment tiles and other work, so count both.
The "shared" open never holds the file twice. Opening the copy after a page-content change costs
one PDFium incremental save (3.3 s on the 120 MB file once its image has been drawn, see below;
a few ms on drawings).

### Route c

A second engine starts in 11 – 20 ms and draws the same tiles in the same time. But the Work
worker's scheduler only gives way between pages, and some of its jobs draw a whole page in one
call (OCR raster, Compare material): the whole A0 CAD sheet at 150 dpi takes 1.55 s, the e2e A0
sheet 0.84 s, pair 14 0.17 s; a thin tile could wait that long. The Work worker's copy of the
document is the one redaction rewrites with `FPDFPage_GenerateContent`, so thinning it has route
a's problem; it would need a separate thin copy, which is route b in a busier worker plus a new
tile path from the page to that worker.

## Found on the way (not Thin Lines)

**Ctrl+S on an image-heavy file gets slow once its pages have been viewed.** After a page with a
120 MB image is drawn, PDFium's incremental save writes that image stream again (125 MB through
the writer) and the narrow tail then drops it: `SaveTracker.save` takes 8.4 s instead of 0.15 s,
with a tail of 0 bytes either way. It is today's behaviour (any document, Thin Lines or not);
reported to the owner for a later look, not fixed here.

## What M13-05 takes from here

See ADR-034 Amendment 2.
