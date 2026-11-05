# ADR-025: M8 — Lossless JSON comment export and import (JSON v2)

- **Status:** Proposed
- **Date:** 2026-11-05
- **Deciders:** owner (Shubham) / agent (M8 thread)
- **Related decisions:** D-03 (standard annotations, rule 6), D-19 (permissions, rule 9),
  ADR-005 (narrow Ctrl+S and its verification), ADR-018 (comment transfer), ADR-022, ADR-023,
  ADR-024; ARCHITECTURE.md §7.1, §7.6
- **Related spike / milestone:** M8 ([plan](../plan/M8.md))

## Context

The owner asked (2026-11-05) that comment export and import keep every property and
sub-property, now that M6 and M7 added many (Properties pane, separate text and border colours,
sticky-note pop-ups, default styles, pasted images, flags, review states). XFDF/FDF were proposed
first; the owner deferred them by 2–3 weeks (they need a large, varied set of test files) and
asked for the JSON route to work properly now.

ADR-018 made JSON v1 an import format re-created through EmbedPDF (option 2). A round-trip
harness (M8 plan, measured on 25302ec) shows what that loses: stamps and Attach File comments
are skipped, sticky-note pop-ups are dropped, ink rects grow by about 1 pt, hidden review-state
markers move and measurement labels get new ids. Everything else the app can set round-trips.

Copy/Paste and Import from a PDF already use object copy (option 1), which is lossless, and Copy
already builds a small PDF of the chosen comments in the Work worker (`copyComments`).

## Options considered

1. **One JSON field per missing item** (stamp picture, attached file, pop-up rect and state).
   For: the JSON stays fully readable. Against: more code; each future property needs another
   field and another re-creation step; other viewers' appearances and keys are still lost.
2. **JSON v2 carries the comments' PDF objects.** The v1 records stay; one new field holds the
   PDF Copy makes, and import uses the object-copy route when it is there. For: lossless by
   construction, for today's and future properties and for comments made in other viewers; reuses
   tested code (copy, apply, undo, narrow save, verification, encryption). Against: the file is
   bigger (pictures and attached files are inside it); the records and the PDF could disagree if
   someone edits the JSON by hand (the PDF wins, documented).

## Decision (proposed)

1. **Option 2.** Export Annotations → JSON writes version 2: v1's fields plus `pdf` (base64 of
   the comments PDF built by `copyComments`) and `pdfPages` (its page i → the document's page).
   Format: `docs/formats/pdftools-annotations-v2.md`; v1 stays frozen.
2. **Import** accepts v1 and v2. With `pdf`, the chosen comments are copied from it with
   `importComments` (roots by `/NM`, page = `pdfPages` + offset, placed as an import from a PDF)
   and applied through `SaveTracker.applyObjects`: one undo step, narrow verified Ctrl+S,
   recovery. Without it (v1), re-creation as today; v1 does not carry what would remove its small
   differences (state marker and label rects and ids, the ink's saved rect). A damaged `pdf`
   refuses the file.
3. **Permissions.** Export Comments already needs **copy** (M4-08), which the PDF needs too.
   Import needs **annotate** on the target; encrypted targets get the objects encrypted with
   their key; the file's own PDF must open and allow copying.
4. **Nothing app-private** goes into documents (rule 6): the copied objects are the comments' own.
5. **ARCHITECTURE.md** (on acceptance, Rev 0.13): §7.6 Annotations row "own serializer → CSV /
   XLSX / JSON (JSON v2 carries the comments' PDF objects and imports losslessly, §7.1,
   ADR-025)"; §7.1 Comment transfer bullet: "… or from our JSON export (lossless from v2) …".
6. **XFDF/FDF** stay deferred (owner, 2026-11-05: after 2–3 weeks, with a varied dataset).

## Consequences

- JSON files with image stamps or attached files are larger (the base64 picture or file).
- The round-trip spec (key by key, pixel by pixel) fails CI when a future change loses a
  property; it is also the base for the XFDF/FDF work.
- A JSON edited by hand: the readable fields are informational when `pdf` is present.

## Evidence

Round-trip harness on `main` 25302ec: `e2e/json-roundtrip.spec.ts` with
`e2e/support/annotDiff.ts` (qpdf 11.9 JSON view, poppler `pdftoppm`), fixtures
`e2e/fixtures/self-made/{m3,m6,m7}-interop/*` and a file of in-app properties; results in the M8
plan's table.
