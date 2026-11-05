# ADR-025: M8 — Lossless comment export and import through XFDF and FDF

- **Status:** Proposed
- **Date:** 2026-11-05
- **Deciders:** owner (Shubham) / agent (M8 planning thread)
- **Related decisions:** D-03 (standard annotations, rule 6), D-19 (permissions, rule 9),
  ADR-005 (narrow Ctrl+S and its verification), ADR-018 (comment transfer), ADR-022, ADR-023,
  ADR-024; ARCHITECTURE.md §7.1, §7.6, §14
- **Related spike / milestone:** S26 (M8-01); M8 ([plan](../plan/M8.md))

## Context

The owner asked (2026-11-05) that comment export and import "work as good as XFDF", now that the
app can set many more comment properties (M6, M7: Properties pane, separate text and border
colours, sticky-note pop-ups, default styles, pasted images, flags, review states).

Today (ADR-018): Import Comments from a PDF and Copy/Paste copy the PDF objects and are lossless.
The file route, Export Annotations → JSON v1 → Import Comments, re-creates each comment through
EmbedPDF from its model and loses stamps, attached files, pop-ups, measurement dictionaries,
grouped labels, rich text and other viewers' appearances and keys (ADR-018 finding 8, the M8
plan's list). ADR-018 decision 9 kept XFDF and FDF out of Rev 0 as a Rev 1 candidate.

XFDF (ISO 19444-1) and FDF (PDF 32000-1 §12.7.8) are the comment files Acrobat and PDF-XChange
export and import. FDF holds PDF objects as they are; XFDF maps each annotation key to an XML
attribute or element and can carry the appearance (`<appearance>`), stamp pictures and attached
files.

## Options considered

1. **JSON v2 only.** Add what v1 loses (pop-up, `/Measure`, picture, file, raw appearance) to our
   own format. For: one format, little UI change. Against: only Triya reads it; "as good as
   XFDF" stays a claim we check ourselves.
2. **XFDF and FDF on the object-copy route.** Export writes each comment's PDF objects out as
   XFDF or FDF; import turns them back into PDF objects and applies them like a PDF import. For:
   lossless for our files; the standard files the other viewers use, both ways; reuses ADR-018's
   tested route (apply, undo, narrow save, verification, encryption). Against: an XML reader and
   writer of our own (no `DOMParser` in workers), a mapping table to maintain, and what other
   viewers write varies (spike S26).
3. **Both.** Option 2 plus a JSON v2. Against: two lossless formats to keep in step.

## Decision (proposed)

1. **Option 2.** Export Annotations offers XFDF (default) and FDF beside CSV, XLSX and JSON;
   Import Comments accepts `.xfdf` and `.fdf` beside `.pdf` and `.json`, with its existing
   options. JSON v1 is unchanged (frozen) and is described as a data export (owner Q2).
2. **Route.** Reading, writing and converting in the Work worker (rule 1); import applies the
   objects through `SaveTracker.applyObjects` (one undo step, narrow Ctrl+S, ADR-005 check,
   recovery), duplicates skipped by `/NM`, same page coordinates with an optional page offset.
3. **XML.** Our own small XML reader and writer for the XFDF subset; a DOCTYPE is refused (no
   entity expansion); size limits. No new dependency.
4. **Permissions.** Export needs **copy**; import needs **annotate** on the target (ADR-018
   decision 7). Encrypted targets get the objects encrypted with their key.
5. **Nothing app-private** goes into the files (rule 6): only standard keys, plus other viewers'
   keys copied as they are in FDF. What XFDF cannot carry is documented.
6. **New decision D-46** and ARCHITECTURE.md wording (applied on acceptance, Rev 0.13):
   - §2, new row: "D-46 | **Comment interchange** (ADR-025): Export Annotations writes XFDF and
     FDF, Import Comments reads them; built on the object-copy route, lossless for our own
     files".
   - §7.1, Comment transfer bullet: "… or from an XFDF, FDF or our JSON export …".
   - §7.6, Annotations row: "own serializer → XFDF / FDF / CSV / XLSX / JSON (XFDF, FDF and JSON
     also import, §7.1)".
   - §13: a line for M8.

## Consequences

- One more format pair to keep in step with every new comment property: the M8-04 matrix test
  makes a lost property fail the unit suite.
- Other viewers' XFDF varies; the spike decides how much we accept (standard elements only, no
  vendor special cases).
- Open risk until the owner's interop check: whether Acrobat and PDF-XChange read our
  `<appearance>` encoding as we write it.

## Evidence

To be filled by spike S26 (M8-01): the JSON v1 baseline loss, the mapping table, the owner's
PDF-XChange / Acrobat samples, and the round-trip results.
