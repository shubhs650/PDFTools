# ADR-032: M12 spike results (S27 – S31)

- **Status:** Proposed, for the owner's acceptance (the second owner gate of M12: nothing of the
  comparison feature is built before this ADR is accepted, plan "Order of work" step 2). The
  owner also checks two sample packs in Acrobat Reader and a second desktop PDF editor: the
  vector overlay (S29, `/mnt/project-files/m12-04/`) and the comparison files (S31,
  `/mnt/project-files/m12-06/`).
- **Date:** 2026-11-22
- **Deciders:** owner (Shubham) / agent (M12-06 thread)
- **Related decisions:** D-58 … D-66 ([ADR-031](031-m12-pdf-comparison.md)); D-06 (incremental
  save), D-09 (direct PDFium calls), D-19 (protected PDFs); [ADR-005](005-s1-incremental-save.md),
  [ADR-011](011-m1-embedpdf-plugins.md), [ADR-016](016-m4-page-operations.md),
  [ADR-022](022-m6-spikes-s18-s22.md); CLAUDE.md rules 1, 2, 6, 7, 9
- **Related spike / milestone:** M12 ([plan](../plan/M12.md)), tasks M12-02 … M12-06; write-ups
  [S27](../../spikes/s27-linked-views/RESULTS.md), [S28](../../spikes/s28-alignment/RESULTS.md),
  [S29](../../spikes/s29-overlay/RESULTS.md), [S30](../../spikes/s30-text-diff/RESULTS.md), [S31](../../spikes/s31-comparison-file/RESULTS.md); format
  [triya-comparison-v1](../formats/triya-comparison-v1.md)
- **Outcome (spikes only):** Works with workaround (S27, S29); Works (S28, S30, S31)

## Context

The M12 plan (ADR-031) promised a comparison built on five uncertain capabilities and ran a spike
for each before any feature code (CLAUDE.md workflow):

| Spike | Question                                                                                               | Task   |
| ----- | ------------------------------------------------------------------------------------------------------ | ------ |
| S27   | Several documents on screen at once, each a live window with every comment tool, linked by a transform | M12-02 |
| S28   | Alignment, page pairing and difference detection for drawings, our own code against OpenCV             | M12-03 |
| S29   | The overlay on screen (tinted Multiply at any zoom) and a vector overlay PDF other readers draw right  | M12-04 |
| S30   | Text matching for documents                                                                            | M12-05 |
| S31   | The comparison file: one standard PDF holding both documents, reopened as the live comparison          | M12-06 |

The plan also left the numbers of the acceptance table to this ADR ("Proposed number (fixed in
ADR-032 after the spikes)"), and said that if a spike failed on something the plan promises, the
work stops and the owner gets options. **No spike failed.** Every promise of the plan holds; three
need a workaround or a rule, and four points need the owner's decision (below).

## Results

### S27 — several documents on screen (works with workaround, route 1)

- EmbedPDF 2.15.1 already keeps viewport, zoom, tiles, selection, comments and undo **per
  document** and mounts several viewports in one registry. The app's real `DocumentView` with
  every layer, menu, comment tool and shortcut works unchanged in two and three windows.
- Linked windows through a transform: within **0.2 px** (pair 15, A1 against A3) and **0.7 px**
  (three A0 sheets, one turned 0.6°) while panning; **0.1 ms** a frame; every frame on time, no
  long task. Three A0 sheets: 90–95 MB of JS + WASM heaps.
- **Workaround:** `@embedpdf/plugin-tiling` recalculates tiles from one un-keyed scroll listener,
  so linked windows stay blurry; a keyed listener calling its own `calculateVisibleTiles` fixes
  it (an internal of the pinned version, guarded by a test; worth reporting upstream).
- **Limits:** one document cannot show in two windows at once (state is keyed by document), so
  the comparison keeps and gives back a document tab's place; "active tab" and "active document"
  must become two things (`documentStore.activeId` is used in 63 files).

### S28 — alignment, pairing, detection (works, route 1: our own code)

- **Alignment:** our aligner (Fourier–Mellin coarse step, then vector refine or a scan tile
  method) meets every target on every case: vector ≤ **0.003 pt**, scans ≤ **0.25 px** at
  150 dpi, 0.3–0.4 s a typical sheet. OpenCV.js ORB is less accurate on every case, about 5 ×
  slower and **3.5 MB** gzip against **7.6 KB**: **not used**.
- **"As is" check:** the share of A's feature points with a B feature within 0.1 pt; **≥ 0.3 →
  use as is**. A raster coverage score cannot tell a 1 pt move from no move.
- **Pairing:** a 32 × 32 ink thumbnail plus tf-idf words, half and half, then an order-keeping
  assignment above 0.35: **19 of 19** overlay pairs right (ink alone 18 of 19).
- **Detection at 150 dpi:** **240 of 240** true differences found on 39 sheets; Normal
  sensitivity (tol 2 px) **0 false reports**, High (tol 1 px) one (pair 15, line weight). The
  text layer is needed (it catches 8 single-digit changes the raster misses). Scans need their
  own setting (tol 3, ink 128, minimum 80 px). The detector must work in **bands** (a whole ARCH E
  sheet would need 350 MB).
- **Known gap:** scans turned by a quarter turn; M12-10 tries the two quarter-turns in the coarse
  step. ORB stays a fallback to revisit after the owner's hand check on real scans (M12-23).

### S29 — the overlay on screen and the vector overlay PDF (works with workaround)

- **On screen: composed in a worker** that owns its own PDFium: each revision rendered through a
  matrix without comments straight to grey, tinted and multiplied with lookup tables, one bitmap
  per tile. Exact black where both agree (pair 16: not one red or green pixel), every frame on
  time while zooming, half the bitmap memory of the compositor route, and Fade unchanged,
  Thicken thin lines and a neutral overlap work. The compositor route drops frames and cannot do
  Fade or Thicken: **rejected**.
- **Vector overlay PDF: route 2 (recolour)** with one-object luminosity masks for images,
  shadings, patterns and special colour spaces. Correct in PDFium, Poppler and pdf.js on eight
  pairs and a stress sheet, about the size of the two sources, as fast to draw as the screen
  route. **Route 1 (wrap and tint) alone fails in PDFium** (layers inside a soft mask). The image
  fallback is not needed.
- **Workarounds:** both sides as isolated groups, B multiplied in its own group (pdf.js ignores a
  blend mode set with a soft mask; Poppler draws fringes otherwise); full tint as the initial
  colour of each form; layers merged with each file's defaults.
- **Open:** the owner's check of the S29 pack; the grey-tile cache needs a byte cap (M12-11);
  Type 3 colour glyphs, source soft masks and clip-mode text are not covered (M12-16 decides with
  a fixture).

### S30 — text matching (works, our own code)

- **Every manifest difference, no false report:** 82 of 82 on the 17 text pairs (with OCR at
  compare time on pair 08's scanned page) and 3 of 3 on a self-made scrambled two-column pair.
  Each of the 160 reported changes is a manifest item or a real unlisted one (the revision letter
  and date); the control chapters of pairs 10 and 17 report nothing.
- **Reading order: our recursive XY-cut** over PDFium's characters (columns first, then the
  widest gap; a strip of footnote numbers is not a column; right-to-left pages read from the
  right). It is the only route right on every pair: PDFium's content order gives 32 false reports
  and PDF Oxide's column-aware spans 17 and a miss on the scrambled pair. **Rejected:** both.
- **Tokens** keep engineering values whole (`24.0 bar(g)`, `≥ 50 MΩ`, `$1,520.00`, tags, dates);
  scripts without spaces go grapheme by grapheme; combining marks stay with their letter.
- **Matching:** units (paragraphs continued across columns and pages, table rows, figures) by
  unique keys, exact keys, keys with clause numbers masked and near pairs; then **word by word
  inside the gaps as one stream**, so reflow costs nothing (pair 06: new font and margins, only
  the two real edits); table rows by label and cell with row and column; a moved section is one
  change with its edits inside. **Our Myers gives the same results as jsdiff** on every pair: no
  library.
- **Experimental (each with a switch, as the plan says):** headers and footers (pair 13: 5
  changes instead of 17), clause renumbering with the cross-reference check (pair 05: one entry
  instead of 29; footnotes too), and tables without ruling lines. Moves are not experimental.
- **OCR at compare time:** about 1.3 s a page at 300 dpi; changes labelled "from OCR", typical
  confusions "possible OCR error" (pair 12).
- **Time and memory:** the 500-page contract in **22–24 s** in one core (matching 60 ms).
  Matching the pages read so far gives the final changes for them, so the first page shows as
  soon as both first pages are read. 250 MB as objects: **M12-17 stores words and tokens in typed
  arrays.**
- **Corpus fixes:** pair 17's edit is on page 456 (generator); pair 08's scanned page is page 3
  and lists two more changes. The comparison file takes S30's marks as page, quads, kind and old
  and new text (format spec).

### S31 — the comparison file (works)

- **Text comparison file = Document B's own bytes + one appended section** (marks as standard
  markups, Document A and the data attached, the catalog tagged). B comes back as the file's
  first `length` bytes, checked by SHA-256: **exact on all 17 text pairs**, the 500-page contract
  included. Against a rewritten copy it is **25–45 % smaller**, keeps B's signature valid and B's
  own encryption. The rewritten copy is **rejected**.
- **Overlay comparison file** = S29's vector overlay pages + Documents A and B attached
  unchanged + the data: about **1.3–2 × the inputs**; a set of three files per side works.
- Written entirely by our object layer and save core (`narrowTail` "only our objects",
  `StandardCrypt` for encrypted bases). Opens without complaint in **PDFium, Poppler, pdf.js and
  qpdf**; Poppler and pdf.js extract every attachment byte for byte and show every mark.
- **Detection** reads only the catalog's `/PieceInfo /TriyaPDF`: 0.1–1 ms on a plain file, 8 ms
  on the 500-page comparison file; the data attachment by name is the fallback (both PDFium's and
  qpdf's full rewrites keep `/PieceInfo` anyway).
- **Encrypted inputs** (RC4, AES-128, AES-256): the text file keeps B's encryption and password;
  an encrypted A stays encrypted inside. **Signed inputs:** the prefix route keeps the signature
  valid (covers its revision, "changed after"); a certified B that forbids comments needs the
  **unsigned route** (decision 4).
- **Save review** into a reopened file: each copy gets an incremental section (a signature in it
  stays valid); the comparison file is then compacted (overlay) or rebuilt (text) (decision 3).
- Format: [docs/formats/triya-comparison-v1.md](../formats/triya-comparison-v1.md) (version 1).

## Decisions for the owner

The spikes settle the routes above. Four points change what a user sees or how a rule is read,
so they are the owner's:

1. **A password-protected input makes a password-protected comparison file.** The overlay pages
   are drawn from decrypted drawings, so an unlocked comparison file would show protected content
   to anyone who opens it. Save comparison… then asks for an open password (AES-256, the
   Password Security route). _Recommended._ Alternative: allow an unlocked file after a warning.
   (A text comparison file over an encrypted B is already locked with B's own password.)
2. **The text comparison file marks deletions with a caret, not a strike-out.** D-65 said
   "highlights, strike-outs and notes", but B's pages hold only the new text, so there is nothing
   to strike: inserted text is highlighted green, replaced text amber with "was: …" in its note,
   moved text blue, and deleted text gets a red caret at its place with "Deleted: …" in the note.
   _Recommended._
3. **Save review in a reopened comparison file rewrites the comparison file's own wrapper.**
   Documents A and B inside are always saved incrementally (rule 7: their bytes and signatures
   are kept). The wrapper around them is Triya PDF's own output: an overlay file is compacted on
   each save (appending would add a full copy of every changed document every time: 23 KB → 63 KB
   after three saves of pair 19, +243 KB per save on the dense A1 pair), and a text file is
   rebuilt (B's new section must follow B). What another program saved into the file after our
   section is kept on the overlay file and warned about before a text file is rebuilt.
   _Recommended._ Alternative: append on Ctrl+S and compact only on Save comparison… or Save
   Optimized.
4. **A certified Document B that forbids comments uses the "unsigned copy".** A certification
   with `/DocMDP /P 1` or `2` does not allow the marks and attachments our section adds, so a
   checking reader would call it broken. Instead the visible pages are B without its signature
   fields and B itself is attached unchanged with its certification intact (B twice in size).
   Approval signatures and `/P 3` keep the prefix route. _Recommended._ Alternative: refuse the
   text comparison file for such a B.

## The acceptance numbers (D-66)

The plan's table with the numbers fixed by the spikes. "Reference machine" times are checked in
CI's perf job and on the owner's machine; the spike numbers are one core in a cloud container.

| Check                                        | Plan's proposal                                                           | Measured in the spikes                                                         | Fixed here                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Differences found (drawings)                 | every manifest difference, all pairs                                      | 240 / 240 on 39 sheets; all 3 on the scan pair (S28)                           | every manifest difference, at Normal sensitivity                        |
| False reports (drawings)                     | none on control pages; none on the identical pair                         | 0 at Normal; 1 at High (S28)                                                   | none at Normal on the control sheets and pair 16                        |
| Differences found, false reports (documents) | every manifest difference; none on control chapters                       | 82 / 82 on 17 pairs; 0 false of 160 reported (S30)                             | every manifest difference; none on the control chapters                 |
| Alignment, vector pages                      | 0.5 pt, 0.05 %, 0.05°                                                     | ≤ 0.003 pt (S28)                                                               | 0.5 pt, 0.05 %, 0.05° (kept: real files are less exact than the corpus) |
| Alignment, scans                             | 2 px at 150 dpi                                                           | ≤ 0.25 px (S28)                                                                | 2 px at 150 dpi (kept)                                                  |
| First result                                 | first sheet or page within 3 s                                            | align 0.3–0.4 s + detect 0.2 s a typical sheet (S28); first page < 0.1 s (S30) | 3 s                                                                     |
| Typical sheet (A1, CAD-like)                 | aligned and listed within 2 s                                             | 0.5–0.6 s; as is 0.2 s (S28)                                                   | 2 s                                                                     |
| Dense A1 pair                                | measured and reported                                                     | 1.3–1.7 s align + 1.1 s detect; as is 0.24 + 1.1 s (S28)                       | reported, not a limit                                                   |
| 500-page contract                            | complete within 60 s                                                      | 22–24 s (S30); its comparison file written in 0.27 s, reopened in 37 ms (S31)  | 60 s                                                                    |
| Overlay drawing                              | —                                                                         | every zoom frame on time; style change 40–70 ms a screen (S29)                 | no frame over 50 ms while zooming the corpus sheets (perf test, M12-11) |
| Main thread                                  | no task over 100 ms                                                       | 0 long tasks in every spike                                                    | no task over 100 ms                                                     |
| Comparison file in Acrobat Reader etc        | opens without a warning; overlay black where they agree; attachments open | PDFium, Poppler, pdf.js, qpdf: yes (S29, S31); Acrobat: owner's check          | as proposed, checked by the owner with the M12-23 interop checklist     |

## Consequences

- The plan stands as written: no task is added or dropped. Changes for the tasks, all in the
  write-ups' "what must change" sections: the active tab / active document split and the keyed
  tile listener (M12-08, M12-12); the overlay worker with its own PDFium and a capped grey-tile
  cache (M12-11); the "as is" rule, quarter turns and banded detection (M12-10, M12-14); the
  vector overlay builder on route 2 in the Work worker (M12-16); the comparison file per the
  spec, with decisions 1 – 4 (M12-20).
- **ARCHITECTURE.md** gets, on acceptance, a short amendment in §7.16 (D-59, D-65): route 2 for
  the vector overlay; the comparison file per `docs/formats/triya-comparison-v1.md`; "highlights,
  carets and notes" instead of "highlights, strike-outs and notes"; the protected-input rule; the
  unsigned copy for certified B; and §2's D-65 row to match. It is not edited before.
- New permissive dependencies: **none** (OpenCV and jsdiff rejected; pdf.js, Poppler and qpdf were used only
  outside the repository to check files).

## Risks

1. **Acrobat Reader and other desktop editors** are not checked by any spike: the owner's two
   sample packs (S29, S31) are the check. If a reader draws the vector overlay wrongly or rejects
   the comparison file, the plan's fallbacks apply (image overlay for export; for the comparison
   file, attaching both documents and plain pages).
2. **Readers that rewrite on save** lose Document B's exact bytes in a text comparison file. It
   is detected (SHA-256), and the comparison then opens read-only.
3. **Internals of EmbedPDF** (the tiling workaround, the render queue ranker) are pinned and
   guarded by tests; an upgrade has to re-check them.
4. **Spike times are from a cloud container.** M12-07 and M12-23 measure in the browser on the
   reference machine.

## Evidence

- S27: `spikes/s27-linked-views/` (8 Playwright tests, `test-results/s27-results.json`).
- S28: `spikes/s28-alignment/` (Node harness on the app's PDFium, 11 unit tests,
  `out/s28-*.json`).
- S29: `spikes/s29-overlay/` (Node and browser harnesses, PDFium, Poppler, pdf.js 4.10.38;
  sample pack in `/mnt/project-files/m12-04/`).
- S30: `spikes/s30-text-diff/` (Node harness on the app's PDFium, PDF Oxide and tesseract.js-core,
  21 unit tests, the manifest accounting in `expected.ts`, `out/s30-*.json`).
- S31: `spikes/s31-comparison-file/` (Node harness, 5 unit tests, qpdf 11, Poppler 24.02, pdf.js
  4.10.38; `test-results/s31-node.json`; sample pack in `/mnt/project-files/m12-06/`).
- Inputs: the self-made `Synthetic PDF Corpus/` and its generated pairs (M12-01), self-made
  stress sheets, signed and encrypted copies made per run with throwaway keys (rule 13).
