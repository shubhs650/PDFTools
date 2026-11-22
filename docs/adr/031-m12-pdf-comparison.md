# ADR-031: M12 — PDF comparison (PDF overlay for drawings, text comparison for documents)

- **Status:** Accepted by the owner with the merge of the plan's pull request (#146), which
  carries the plan, this ADR and ARCHITECTURE.md Rev 0.21 together as the owner asked. The
  owner reviewed the plan on 2026-11-22 and took the recommended answer to each of its
  questions 1 to 4, and the optional items O1 and O4.
- **Date:** 2026-11-22
- **Deciders:** owner (Shubham) / agent (comparison planning thread)
- **Related decisions:** D-01 (layout), D-03 (standard annotations), D-06 (incremental save),
  D-09 (direct PDFium calls), D-10 (workers), D-12 (licences), D-15 (CRS), D-19 (protected
  PDFs), D-22 (no network), D-34 (OCR), D-50 (document tabs), D-57 (clean public tree);
  [ADR-008](008-s7-snap-geometry.md) (line geometry), [ADR-018](018-m4-comment-transfer.md)
  (comment transfer), [ADR-030](030-comparison-unblocked.md) (comparison unblocked);
  ARCHITECTURE.md §1.3, §2, §3.1 – §3.3, §7, §8, §8.1, §10.3, §11 – §15; CLAUDE.md rules 1, 2,
  4 – 7, 9, 13 – 15
- **Related spike / milestone:** M12 ([plan](../plan/M12.md)); spikes S27 – S31 (tasks M12-02 –
  M12-06), whose results will be recorded in ADR-032

## Context

On 2026-11-22 the owner decided to add **PDF comparison** to Triya PDF and lifted the earlier
hold (ADR-030). The aim is a comparison that serves every engineering review workflow:

- **Drawings**, where the reviewer needs to see what moved, appeared or disappeared: the **PDF
  overlay**.
- **Text documents** (tenders, specifications, purchase orders, invoices, calculation and
  inspection reports), where the reviewer needs the changed words, numbers, clauses and table
  rows: the **text comparison**.

The owner supplied a vision sketch, a market research report and a test corpus
(`Synthetic PDF Corpus/`, 13 drawing pairs and 12 document pairs with manifests), and then
answered a 43-question interview, one question at a time, before any plan was written. The
report's AI-assisted ideas were excluded by the owner.

Facts that shape the design (details in the plan):

- The view shows **one document at a time**. §14 reserved a two-document synchronized view as
  an extension point; nothing is built.
- A web app **cannot find a file again by its path**, so a saved comparison has to contain the
  documents it compares.
- A **zero-width CAD line is one device pixel wide at every zoom** in any PDF engine. Thin lines
  vanish in a comparison only when one fixed-resolution picture is compared and then enlarged.
- The app already extracts **line geometry** per page (ADR-008), **positioned text**,
  **tables**, **OCR words**, copies **comments between documents** as PDF objects (ADR-018,
  ADR-025), reads and writes **attachments**, and has an **object layer** that writes standard
  PDF objects (ADR-007).
- Rule 14: comparison is a **clean-room build** from public techniques and permissively
  licensed libraries.

## Options considered

The interview put each of these to the owner with a recommendation; the choice is the owner's.

**How the overlay is drawn (Q4).**

1. One fixed-resolution picture of each page, compared and shown. Simple; thin lines and deep
   zoom suffer.
2. A true vector overlay PDF only. Sharp at any zoom, but an unproven route for display, and
   every toggle rebuilds a document.
3. **Chosen:** render each revision at the current zoom, tint, combine with Multiply (sharp at
   any zoom, instant toggles), **and** build the true vector overlay for export and the saved
   file, offered as a beta display mode as well.

**How pages are aligned (Q5, Q6).**

1. Never automatically: the user always picks points. Reliable, slow for 200 sheets.
2. Always align every page. Wastes time on the common case (same CAD template, same position)
   and can make a good pair worse.
3. **Chosen:** score each pair as it is, align only poor matches, show the status, allow manual
   alignment anywhere. The method (own geometry aligner against OpenCV) is chosen by spike.

**Where a comparison lives (Q13).** A dialog with a result window; a mode of an existing
document tab; or **(chosen)** its own tab in the tab strip, so several comparisons and normal
documents sit side by side.

**What is saved (Q19, Q20, Q33).**

1. Only an exported picture or report. Nothing can be reopened.
2. A project file in a private format. Unreadable elsewhere, and against the spirit of rule 6.
3. **Chosen:** new comments go into the two documents by the normal save, **and** a comparison
   file that is one standard PDF with the documents attached, readable anywhere and live here.

**Text comparison scope (Q26 – Q31).** A plain word diff of extracted text was the minimum.
The owner chose the fuller set: moves, whole engineering values with percent change, automatic
header and footer handling, table rows, clause renumbering and OCR at compare time, with the
less certain ones labelled experimental and switchable.

## Decision

Nine decisions, D-58 … D-66. The plan carries the full detail and the interview references.

### D-58 — Comparison as a tab, with an input window

- Two comparison types: **PDF Overlay** and **Text Comparison**. No third type.
- A new ribbon tab **Compare**. A comparison is **its own tab** in the document tab strip.
- The tab opens on an **input window**: Document A (old) and Document B (new), each from a
  dropped file, a picked file or an open tab; thumbnails and a page range; swap; a collapsed
  Options section; named **presets** stored on the device. Two files and Compare are enough.
- PDF Overlay accepts **several files per side as one set**. Text Comparison takes one file per
  side.
- A document open in its own tab and in a comparison is one document with one undo history.
- Dropping one document tab on another offers "Compare these two" (optional item O4, accepted).
- While M12 is being built, Compare is switched on in the beta site, previews and tests with a
  "Preview" tag, and **off in release builds** until the acceptance task.
- **Permissions per action, per file** (rule 9): viewing a comparison is viewing; commenting
  needs that file's commenting permission; copying text from the list, exporting and saving a
  comparison file need the content-copying permission of both files.

### D-59 — The overlay: tinted Multiply on screen, a vector overlay for export (beta display)

- On screen each revision is rendered **at the current zoom, without comments**, turned to
  grey, tinted, and the two combined with **Multiply**: the same is black. Default old red, new
  green; presets red/blue and magenta/green; custom colours with a dark-overlap warning.
- Controls: show/hide each side, balance, Fade unchanged, Thicken thin lines, Blink (hold X).
- Comments of both documents are drawn on top in their own colours, switchable per document;
  **Hide check highlights** hides Highlight comments and anything under 70 % opacity.
- Each file is shown with its own default layer visibility; layer switches per document.
- A **vector overlay PDF** is built by one builder for Export Overlay…, for the comparison
  file's pages, and as a **beta display mode**. Route by spike S29 (wrap and tint through a
  mask, or recolour, each with the PDF Multiply blend mode); fallback a high-resolution image
  PDF.

### D-60 — Pairing and alignment

- Pages are **paired automatically by similarity** (picture and text signature), finding
  inserted, removed and reordered sheets; the pairing table is editable.
- Each pair is **scored as it is**; only poor matches are aligned automatically. Status per
  sheet: as is, auto-aligned (values shown), low confidence.
- The transform is a **similarity**: shift, one scale, rotation. Never uneven stretching. The
  old revision is drawn in the new revision's frame; `/Rotate` and page boxes are folded in.
- Method by spike S28: our own geometry aligner on the snap geometry (feature points, RANSAC,
  least-squares refinement) with our own image method for scans (phase correlation), against
  OpenCV feature matching. **OpenCV is adopted only if scans need it, and then loaded on
  demand.**
- **Manual alignment on any sheet:** 1 to 3 point pairs with snapping and a magnifier, numeric
  fine-tune, and Apply to (this sheet, all, all low-confidence).
- **Compare an area** (optional item O1, accepted): a rectangle on each revision, on the same or
  different sheets, overlaid through an alignment of their own, for a detail that moved.

### D-61 — Differences on drawings

- The overlay **detects differences**: regions added, removed or changed, found on the aligned
  pair with a tolerance, in a worker.
- Entries are **text-aware** where the pages have text ("Ø120 → Ø128"; text, geometry or both).
- Sensitivity and minimum size apply live; **ignore zones** per sheet or for all sheets, saved
  as named sets.
- A list with filters, search, next/previous (F8, Shift+F8) and a checked tick; a sheet list with unchanged
  sheets and percent changed; view-only outlines on the overlay.
- **Make cloud comments** on request; never automatic.

### D-62 — Review across revisions

- Layouts: **Overlay only** and **Review** (overlay left, Document A top right, Document B
  bottom right), one sheet at a time.
- **Every comment tool and context menu works in every window.**
- **The overlay is reference only:** what is drawn on it is a note of the comparison, stored in
  the comparison file, never written into Document A or B.
- **Aligned sync** of the windows (lock on by default) and a **linked pointer**.
- **Aligned copy** of comments between revisions, and **close-out tracking** of the old
  revision's comments (Addressed, Carried over, Changed differently) with a check highlight;
  each sets the standard status **Completed** on the old comment and adds a reply naming the
  outcome and the new file, so both reach the CRS export and other viewers understand them.

### D-63 — Text comparison: what is compared

- Changes: inserted, deleted, replaced, **moved** (once, with a link), changed figure.
  Formatting-only changes are not reported.
- **Word level with engineering values kept whole**; percent change for numbers; no unit
  conversion.
- Reading order by column; paragraphs matched first, then words (Myers' algorithm with unique
  anchors); details by spike S30.
- **Headers and footers** found automatically and reported once (experimental, switchable,
  manual bands). **Tables** matched row by row where recognised. **Clause renumbering** reported
  once (experimental, switchable).
- **Scanned pages:** OCR at compare time for the comparison only; "from OCR" and "possible OCR
  error" labels.
- Every script is compared; Latin, Hindi, Japanese and Arabic are verified; "limited support"
  where text cannot be read reliably.

### D-64 — Text comparison: the view

- Document A and Document B **side by side**, continuous scroll, **synchronised by content**,
  bands across the gap, the list on the right.
- Marks by **colour and shape**: deleted red struck through, inserted green underlined,
  replaced amber on both sides, moved blue with a band, changed figure a blue frame.
- The marks belong to the view, not to the documents. The comment and close-out rules of D-62
  apply.

### D-65 — Saving and outputs

- **Save review** (Ctrl+S in a comparison): only the reviewer's new comments, into Document A
  and Document B, by the normal incremental save (rule 7).
- **Save comparison…** writes the **comparison file**, one standard PDF:
  - overlay: the vector overlay as pages, Document A and B attached unchanged;
  - text: Document B's pages with the changes as standard highlights, strike-outs and notes
    with the old text, Document A attached;
  - the comparison data as one JSON attachment, the file tagged through `/PieceInfo`.

  Any reader opens it; Triya PDF reopens it as the live comparison. The exact format is set by
  spike S31 and documented as a versioned spec.

- **Export Document A / B** from a reopened comparison file; a plain statement in the Save
  dialog that the file contains both documents.
- **Change register** to Excel and CSV; an optional **summary page**.

### D-66 — Workers, progress and acceptance

- A new PDFium-free **Compare worker** does alignment maths, difference detection and text
  matching. The Work worker supplies signatures, analysis rasters and positioned text; the
  Render worker supplies screen tiles. The main thread does none of it (rule 1).
- Results are **progressive**, viewed items first, with progress and Cancel (rule 2).
- Compare modules load lazily and are precached in the background like the other non-core
  modules. Nothing is fetched from a third party (rule 4).
- **Done** = the corpus acceptance suite in CI (every manifest difference found, control pages
  silent, known transforms recovered, time limits) plus the owner's hand check on real
  documents. The numbers are proposed in the plan and fixed in ADR-032 after the spikes.
- The corpus stays in `Synthetic PDF Corpus/` and grows by the pairs in the plan, all self-made
  by a script in the repository (rule 13).

### Not in scope

More than two revisions at once; non-PDF inputs; any AI; accepting, rejecting or merging
changes; several files per side in a text comparison; a curtain slider; an inline redline pane;
a title-block reader; unit conversion; formatting-only changes; comparing comments as content;
a folder picker; tablet and phone layouts.

### ARCHITECTURE.md changes (Rev 0.21)

- Title, date and a Rev 0.21 amendment note.
- §1.3: a comparison opens as its own tab.
- §2: rows D-58 … D-66.
- §3.1: the Compare worker in the diagram and the rules.
- §3.2: a "Comparison" row (own code; OpenCV only if spike S28 requires it, on demand).
- §3.3: `compare` in the feature list, the Compare worker, `Synthetic PDF Corpus/`.
- §7.1: comment transfer gains the aligned copy between revisions.
- §7.16 (new): Comparison.
- §8: the **Compare** ribbon tab and the comparison tab; §8.1: the comparison keys.
- §10.3: comparison presets and ignore-zone sets in local data.
- §11: the comparison corpus and its acceptance suite.
- §12: a note that the comparison targets are fixed in ADR-032.
- §13: M12. §14: comparison moves from the roadmap into M12; the extension point is used.
- §15: three risks.

## Consequences

- **A new kind of tab and several documents on screen at once.** The view layer changes for
  this; spike S27 comes first and can stop the plan.
- **A new worker** and new Work worker jobs; the typed RPC, cancellation and progress rules
  apply unchanged.
- **Our first document-level file format decision**: the comparison file. It is standard PDF,
  but its data attachment is ours and needs a version number and a written spec from day one.
- **The comparison file contains the compared documents.** The Save dialog says so; Export
  Overlay… gives a file without them.
- **Install size** grows by the Compare modules (measured in CI). OpenCV, if adopted, is on
  demand and reported to the owner first.
- **Experimental parts** (header and footer detection, clause renumbering, table rows, the
  vector display mode) are labelled as such in the UI and each can be switched off.
- M12 is large: 23 tasks, five of them spikes, with ADR-032 as a second owner gate before any
  feature code.
- Optional items O1 (compare an area) and O4 (drop a tab on a tab) are part of M12; O2, O3
  and O5 in the plan are follow-ups outside it.

## Evidence

- The owner's interview answers Q1 – Q43 (2026-11-22), cited throughout the plan, and the
  owner's answers to the plan's five questions (2026-11-22).
- Code read on `main` at 92f302f: `src/engine/workApi.ts` (jobs `snapGeometry`, `pageGeometry`,
  `textSlices`, `detectTables`, `ocrRaster`, `copyComments`, `listLayers`, `listAttachments`),
  `src/model/snapIndex.ts`, `src/features/view/DocumentHost.tsx` (one host, one active
  document), `src/features/annotate/comments/commentsModel.ts` (review states).
- The corpus: `Synthetic PDF Corpus/engineering_pdf_overlay_test_corpus/CORPUS_MANIFEST.csv`
  and `Synthetic PDF Corpus/text_comparison_pdf_corpus/TEXT_CORPUS_MANIFEST.csv`.
- Public methods named: RANSAC (Fischler and Bolles, 1981); least-squares similarity transform
  (Umeyama, 1991); phase correlation and its log-polar form (Kuglin and Hines, 1975; Reddy and
  Chatterji, 1996); ORB features (Rublee et al., 2011); Myers' difference algorithm (1986);
  recursive XY-cut page segmentation (Nagy and Seth, 1984); PDF 1.4 transparency (blend modes
  and soft masks, ISO 32000-1 §11).
