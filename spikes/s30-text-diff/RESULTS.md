# Spike S30 — text matching (M12-05)

Task M12-05 of [docs/plan/M12.md](../../docs/plan/M12.md) (D-63, D-64, D-66; ADR-031). Input for
**ADR-032 (M12 spike results)**, which task M12-06 writes for the owner's acceptance. No feature
code: everything here is in `spikes/s30-text-diff/`.

**Verdict: works, with our own code.** The method below finds **every manifest difference of
all 17 text pairs** (82 of 82, including the three on the scanned page of pair 08, which need
OCR at compare time) and the three edits of a self-made scrambled two-column pair, with **no
false report**: every one of the 160 reported changes is a manifest difference or a real one
the manifest does not name (the revision letter and issue date in the title block). Reading
order by our own XY-cut is the only route that is right on every pair; PDFium's content order
and PDF Oxide's column-aware spans both fail the scrambled pair. Our own Myers code gives the
same results as jsdiff on every pair, so no library is needed. The 500-page contract is
extracted and matched in about 22 s in one Node core (target 60 s); the matching itself takes
50 ms. Headers and footers and clause renumbering stay **experimental**, as the plan says, and
so do tables without ruling lines. Nothing in the plan has to change; the numbers for the
acceptance table are below.

## How it was tested

- **Node harness** (`run-node.ts`) on PDFium WASM (the Work worker's build, through S28's
  `pdfium.ts`) and PDF Oxide WASM (`pdf-oxide-wasm` 0.3.77, the app's). Positions are in
  **displayed-page space** (pt, y down).
- **Corpus:** the 17 text pairs of `Synthetic PDF Corpus/` (12 original, 13 to 17 from
  M12-01), plus `fixtures.ts`: a self-made two-column specification whose Rev A stores its text
  column by column and Rev B row by row across both columns (as some layout programs and PDF
  printers do), with one inserted clause and two changed values. Corpus pair 04 draws each
  column in turn, so its content order already is the reading order and every route reads it
  right; the scrambled pair is what separates the routes.
- **Accounting** (`expected.ts`): every manifest difference is written as a test on the
  reported changes. Each reported change (moves with the edits inside them) must be explained
  by a manifest item or by a named "unlisted" item, a real difference the manifest does not
  name (the revision letter and date in the title block and running header). A change nothing
  explains is a false report; an item nothing finds is a miss.
- **Route 2 for the difference routine:** jsdiff `diffArrays` (`diff` 8.0.4, BSD-3-Clause),
  installed with `--no-save` for the run only.
- **OCR at compare time:** tesseract.js-core (the WASM the app's OCR worker loads, ADR-020) with
  the app's English data, on a 300 dpi render from PDFium.
- Times are one Node process on the cloud container (one core), not the reference machine; they
  vary by about 20 % between runs (results do not). Raw results go to `out/s30-*.json`.

```sh
npm install --no-save diff@8.0.4   # the "diff" section only
node --expose-gc --import ./spikes/shared/ts-ext.ts spikes/s30-text-diff/run-node.ts         # all sections
node --expose-gc --import ./spikes/shared/ts-ext.ts spikes/s30-text-diff/run-node.ts corpus  # one
npx vitest run spikes/s30-text-diff                                                          # 21 unit tests
```

## The method (for M12-17 and M12-18)

1. **Characters** from FPDFText (`pdfium-text.ts`): loose box, origin, size, bold, render mode
   (invisible text is an OCR layer), angle. Characters PDFium generates (spaces, line breaks)
   are ignored; a line-end hyphen arrives as U+0002 and is joined when the next line starts in
   lower case. Ligatures arrive expanded.
2. **Words** (`layout.ts`): a gap over 0.15 × the font size from the word's extent, a baseline
   shift over 0.15 × size or a size jump over 20 % ends a word. A combining mark or joiner never
   starts a word (Devanagari, Arabic harakat). Right-to-left words drawn in visual order are
   turned round. Rotated text is left out of the running text.
3. **Headers and footers** (`hf.ts`, experimental): the two outermost lines at each edge, in
   the top and bottom 12 % of the page, that recur within 4 pt on at least half the pages (and 2) with digit-masked Dice ≥ 0.5. They are taken out of the running text; each group keeps a
   template where words that change from page to page become `{n}`, so "Page {n} of 6" against
   "Page {n} of 7" is one change.
4. **Tables and figures as blocks** (`tables.ts`): the app's table detector (`detectPage`, Oxide
   words and PDFium segments) on pages with at least 4 path objects or 20 % numeric words. A
   table without ruling lines is kept only when its cells average at most 4 words and at least
   30 % of them are wholly numeric (otherwise two-column prose reads as a table). Images are
   blocks with a pixel hash and a 16 × 16 thumbnail.
5. **Reading order:** recursive **XY-cut** over words and blocks. A column cut needs a gutter of
   at least max(6 pt, 0.9 × size) with text on both sides over 30 % of the region's height, two
   lines on each side, and each side at least 3 × size wide (so a strip of footnote numbers is
   not a column). Otherwise the region is cut at its widest horizontal gap. Right-to-left pages
   read their columns from the right.
6. **Paragraphs** over all pages at once: a paragraph continues across a column or page break
   when the last line is full and the next does not start a list item or heading.
7. **Tokens** (`tokens.ts`): engineering values stay whole: a number with sign, currency,
   separators and unit (`24.0 bar(g)`, `≥ 50 MΩ`, `$1,520.00`, `+320°C`), a tag (`PO-88412-R2`,
   `17/15/12`), a date (`2026-11-14`, `14.11.2026`, only when one part can be a month). Keys are
   NFKC with dashes, quotes and µ unified and the space between a number and its unit dropped.
   Runs of a script without spaces (Han, kana, Thai, Lao, Khmer, Myanmar, Tibetan) are one token
   per grapheme; Latin runs and numbers next to them are tokenised as usual.
8. **Units** are matched first (`compare.ts`): a skeleton of units whose key is unique on both
   sides (patience-style longest increasing run), then exact matches between them (our Myers),
   then units that match with their clause numbers masked ("relabelled", for renumbering), then
   near pairs (masked Dice ≥ 0.8).
9. **Inside each gap** the remaining paragraphs on each side are compared **word by word as one
   stream**, so text that only reflowed into other paragraphs, columns or pages costs nothing.
   Table rows are matched by their label (first cell, or the second when the first is a short
   item number; merged cells resolved), then cell by cell, reported with row and column; a
   column header repeated on each page is skipped. Figures are compared by hash, then thumbnail.
10. **Moves:** a block of units deleted in one place and inserted in another that match exactly
    or nearly (grown from exact units by near neighbours) is one **moved** change carrying the
    edits inside it; a token run of at least 8 tokens with Dice ≥ 0.6 also counts.
11. **Clause renumbering** (`renumber.ts`, experimental): the relabelled units give an old → new
    map of own numbers (sub-clauses follow their parent by prefix). Consecutive numbers that
    shifted alike are one **renumbered** entry ("12 numbers shifted, 6 cross-references
    follow"). A cross-reference that does not follow the map is reported as a **reference**
    change, also in text that did not change. Raised small numbers count, so footnotes
    renumber the same way.
12. **Labels:** percent change only for a single number against a single number. Changes on an
    OCR page are **from OCR**; when both sides fold to the same text under typical confusions
    (0/O, 1/l/I, rn/m, 5/S, 8/B, spacing ignored) they are **possible OCR error**, never hidden.
13. **OCR at compare time** (`ocr.ts`): a page that is mostly an image and has no words is
    rendered at 300 dpi and read by Tesseract; its words enter step 5 like PDFium's. A page with
    no text and no OCR is listed as **limited support**.

Our own code: about 2,600 lines without the harness, no new dependency.

## Results: reading order (pairs 04, 09, scrambled)

| Pair      | Our XY-cut             | PDFium content order                                       | PDF Oxide `column_aware` spans |
| --------- | ---------------------- | ---------------------------------------------------------- | ------------------------------ |
| 04        | 3 / 3, no false report | 3 / 3, no false report                                     | 3 / 3, no false report         |
| 09        | 4 / 4, no false report | 4 / 4, **2 false** (an equation read out of line)          | 4 / 4, no false report         |
| scrambled | **3 / 3, 3 changes**   | 1 / 3, **32 false** (lines of the two columns interleaved) | 2 / 3, **17 false**            |

Only the XY-cut reads every pair right; it is the proposal. The XY-cut step is about 20 % of
extraction (pair 10: 70 of 350 ms a side; pair 17: 3 of 10 to 13 s a side).

## Results: every manifest difference

`run-node.ts corpus`, XY-cut, all switches on. "Reported" is the number of entries in the list
(a move counts once; the edits inside it are in it).

| Pair | Manifest items found | Reported | Unexplained | Notes                                                                                                                   |
| ---- | -------------------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| 01   | 7 / 7                | 14       | 0           | table cells with row and column ("3 · Flanged Gate Valve / Unit Price"); the added row 5 is one change                  |
| 02   | 4 / 4                | 17       | 0           | the replaced figure; the W-14 row in the table; header A → B once                                                       |
| 03   | 6 / 6                | 20       | 0           | `142.5 kN·m`, `σ_b` and `M_Ed` read right; "Grade 8.8 → 10.9" occurs 5 times and is reported 5 times                    |
| 04   | 3 / 3                | 6        | 0           | both new clauses as one insertion across the reflowed columns                                                           |
| 05   | 4 / 4                | 7        | 0           | **one** "renumbered 3.4–3.9 → 3.6–3.11 (12 numbers shifted, 6 cross-references follow)"; the deleted "not"              |
| 06   | 2 / 2                | 9        | 0           | font and margins changed every line break: nothing reported for it; each of the 3 occurrences of both edits reported    |
| 07   | 4 / 4                | 14       | 0           | 135 rows over 11 pages; row 038 deleted and 075A inserted as rows; header row repeated per page not reported            |
| 08   | 6 / 6 (3 / 3 no OCR) | 9        | 0           | the scanned page read by OCR at compare time: expiry, certificate and Cr value, labelled "from OCR"                     |
| 09   | 4 / 4                | 7        | 0           | **one** move (Foundation section) with its 180 → 165 kPa edit inside; the chart                                         |
| 10   | 5 / 5                | 8        | 0           | the five control chapters report nothing; the inserted Addendum 6A page is one change                                   |
| 11   | 8 / 8                | 13       | 0           | German, Hindi (2.5 → 3.0), Japanese (SUS304 → SUS316L, 6.0 → 8.0 mm), Arabic right to left (12 → 24); µm, MΩ, ≥         |
| 12   | 6 / 6                | 9        | 0           | OCR text layer; "5O0 mm" and "U1trasonic" labelled **possible OCR error**                                               |
| 13   | 5 / 5                | 5        | 0           | header "Rev C → D" and footer "of 6 → of 7" **once each**; the page numbers that moved with the added page not reported |
| 14   | 6 / 6                | 8        | 0           | hyphenated and ligature words joined; **one** "footnotes 2–3 → 3–4" entry; the new footnote and its mark                |
| 15   | 2 / 2                | 2        | 0           | the deleted page is one change; footers renumbered without a report                                                     |
| 16   | 4 / 4                | 5        | 0           | row P-101C inside a merged item; the wrapped remark; the merged material cell                                           |
| 17   | 6 / 6                | 7        | 0           | 500 pages; **one** "renumbered 96.2–96.40 → 96.3–96.41"; the deleted "not" on page 456                                  |
| scr. | 3 / 3                | 3        | 0           | the self-made scrambled pair                                                                                            |

The reported changes beyond the manifest items are the revision letter and issue date (title
block and header) of every pair that has them, and further occurrences of a manifest edit (pair
03: the bolt grade 5 times; pair 06: each edit 3 times; pair 01: amounts, subtotal, GST and total
recalculated).

## Results: the difference routine (own Myers against jsdiff)

Whole-document token streams (both sides interned); "kept" is the length of the common
subsequence found. The last two columns run the whole comparison with each routine.

| Pair | Tokens            | Own, unique anchors | Own, plain Myers | jsdiff `diffArrays` | Comparison, own | Comparison, jsdiff |
| ---- | ----------------- | ------------------- | ---------------- | ------------------- | --------------- | ------------------ |
| 03   | 1,484 / 1,484     | 0.5 ms, 1,467       | 0.4 ms, 1,467    | 1.8 ms, 1,467       | 20, all found   | 20, all found      |
| 05   | 3,241 / 3,386     | 0.6 ms, 3,221       | 0.6 ms, 3,221    | 4.8 ms, 3,221       | 7, all found    | 7, all found       |
| 09   | 963 / 963         | 0.1 ms, 761         | 0.7 ms, 763      | 8.2 ms, 763         | 7, all found    | 7, all found       |
| 10   | 10,151 / 10,611   | 0.8 ms, 10,144      | 1.9 ms, 10,144   | 11.4 ms, 10,144     | 8, all found    | 8, all found       |
| 17   | 362,811 / 362,844 | 96 ms, 361,525      | 85 ms, 362,769   | 33 ms, 362,769      | 7, all found    | 7, all found       |

- Plain Myers (linear-space middle snake) matches jsdiff's common subsequence exactly, and a unit
  test checks it against a dynamic-programming LCS on 2,000 random cases.
- Unique anchors are a heuristic: on a whole 500-page stream they lose 0.3 % of the matches
  (repeated boilerplate). The method only uses them for **units** (step 8), where they are what
  keeps repeated clauses in their place; word-level matching runs inside the gaps, where the
  streams are short.
- The comparison is the same with either routine on all five pairs. **Proposal: our own code**
  (240 lines, linear space, no dependency). jsdiff stays a known-good fallback.

## Results: time and memory (pairs 10 and 17)

| Pair           | Pages     | Units         | Tokens a side | Extraction a side                  | Matching | JS heap after               | PDFium heap |
| -------------- | --------- | ------------- | ------------- | ---------------------------------- | -------- | --------------------------- | ----------- |
| 10             | 17 / 18   | 247 / 256     | 10 k          | 0.35 s (text 0.28, order 0.07)     | 2 ms     | + 7 MB                      | 40 MB       |
| 17 (500 pages) | 500 / 500 | 7,792 / 7,793 | 363 k         | 10.6 / 13.2 s (text 7–10, order 3) | 62 ms    | **+ 249 MB** for both sides | 48 MB       |

- **500 pages: about 22–24 s in total in one core**, against the plan's 60 s. In the app the
  Work worker reads the text and the Compare worker matches (D-66), so the two overlap.
- **Results as they are ready (Q40):** matching only the pages read so far gives, for the pages
  before the last two, exactly the changes of the whole comparison (`run-node.ts prefix`: pair
  10 at 4, 9 and 14 pages; pair 17 at 10, 40, 215 and 400 pages), in under 30 ms each. So the
  first page's result can show as soon as both first pages are read (about 20 ms each), well
  inside the 3 s target; moves and renumbering are settled when the whole document is in.
- **Memory:** the spike keeps every word with its box and every token as an object: about
  250 MB for the two 500-page sides. **M12-17 must store words, boxes and tokens in typed arrays**
  (about 30 bytes a token instead of about 350) and keep only keys and offsets in the Compare
  worker; the Work worker sends text page by page.

## Results: OCR at compare time (pairs 08 and 12)

- Pair 08: the scanned page (page 3 of 3; the manifest said page 4, fixed) is read at 300 dpi in
  about 1.3 s a page. All three changes on it are found and labelled "from OCR"; without OCR the
  page is "limited support" and the three live-text changes are still found.
- Pair 12 has an OCR text layer (invisible text): it is used as is, all its changes are "from
  OCR", and both artefacts of Rev A are "possible OCR error".
- Only English data was run here. The app ships five OCR languages (ADR-020); the labels do not
  depend on the language.

## What stays experimental (each with its switch)

Switched off, each part shows what it folds together (`run-node.ts switches`):

| Part                              | Off: what is reported instead                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Headers and footers (Q28)         | pair 13: 17 changes instead of 5 (each page's header and footer, and the added page's text merged with them); pair 15: 7 instead of 2 |
| Clause renumbering (Q31)          | pair 05: 29 instead of 7 (every shifted number and cross-reference); pair 14: 10 instead of 8                                         |
| Moves                             | pair 09: the moved section as a deletion and an insertion, and its 180 → 165 kPa edit hidden inside them                              |
| Tables without ruling lines (Q30) | (proposal) recognised only with the filter in step 4; otherwise running text                                                          |

Moves are **not** experimental: without them the edit inside a moved section is lost.

## Numbers for the plan's acceptance table (for ADR-032)

| Check             | Plan's proposal                                                    | Measured here                                                                       | Proposal for ADR-032             |
| ----------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------- |
| Differences found | every manifest difference                                          | 82 / 82 on 17 text pairs (with OCR on pair 08); 3 / 3 on the scrambled pair         | keep                             |
| False reports     | none on the control pages and chapters; none on the identical pair | 0 of 160 reported changes unexplained; control chapters of 10 and 17 report nothing | keep                             |
| First result      | first page within 3 s                                              | first page matched within about 50 ms of both first pages being read                | keep                             |
| 500-page contract | complete within 60 s                                               | 22–24 s in one Node core (matching 62 ms)                                           | keep                             |
| Memory, 500 pages | —                                                                  | 250 MB as objects; typed arrays needed                                              | report; M12-17 uses typed arrays |

## Corpus bugs found and fixed

1. **Pair 17:** the manifest put the "shall not be liable" edit on page 455; the generator's
   `editAt` counted the page before the paragraph. `flow.ts` `para()` now returns the page its
   first line lands on, and `documents.ts` uses it; `npm run corpus` rewrote the pair 17 row of
   the manifest and README (page 456). No committed PDF changed.
2. **Pair 08:** the manifest said the scanned page is page 4 of 3; it is page 3. Its two further
   changes on that page (certificate CAL-2026-7741-A → B and measured Cr 16.81 % → 16.84 %,
   checked on the page images) are now listed.

## Risks

1. **Times are from one core in the cloud container**, not the reference machine; M12-17's perf
   test measures the Work and Compare workers in the browser.
2. **The corpus is synthetic and so is the truth.** The accounting is ours, written from the
   manifests; M12-23's owner hand check on real documents stays the final word.
3. **Reading order on unusual layouts** (text wrapped around figures, sidebars, tables without
   ruling lines next to prose) is where XY-cut can go wrong; the result then shows more changes,
   never fewer. Hand-drawn header and footer bands (plan D-63) are the override.
4. **Repeated identical edits** (pair 03: one grade change in 5 places) are reported each time.
   That is correct, but the list in M12-19 could group "the same change, 5 times".
5. **Memory:** see above; objects per word do not scale past a few hundred pages.
6. **OCR quality** on real scans (skew, stamps, handwriting) is untested here; the labels keep
   every OCR difference visible.
