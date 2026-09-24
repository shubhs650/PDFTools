# ADR-007: S2 — Measure and Viewport dictionaries: writing, reading, viewer behavior

- **Status:** Proposed. The agent part is done; the viewer-behavior results come from the owner's
  interop run. Decisions 2–5 need owner approval.
- **Date:** 2026-09-24
- **Deciders:** Owner (pending); recorded by the coding agent
- **Related decisions:** D-03, D-14 (ARCHITECTURE.md §7.4, M3); ADR-001 B7 and B14; ADR-005 (narrow
  tail); CLAUDE.md rules 6 and 9
- **Related spike / milestone:** M0-S2 (feeds M3)
- **Outcome (spikes only):** **Works with workaround** for unencrypted files. The workaround is a
  small object layer we own. Two things are open:
  - how viewers display and accept the data (owner interop, `e2e/interop/CHECKLIST.md` §D/§F);
  - **encrypted files need our own string encryption** before we can write or read measurement
    data in them (decision 4).

## Context

§7.4 requires three things:

- distance, perimeter and area with ratio or calibration scales;
- **scale viewports** such as "Detail A 1:5", following these rules: the containing viewport wins,
  otherwise the page default applies, otherwise "uncalibrated", and spanning viewports get a
  warning;
- persistence in **standard PDF measurement structures**: `/Measure` (RL) on line, polyline and
  polygon annotations with `/IT` `LineDimension` / `PolyLineDimension` / `PolygonDimension`, and page
  `/VP` viewports.

§7.4 already allows "a narrow low-level writer in the Render worker" if EmbedPDF/PDFium cannot
write these. B7 forbids custom appearance-stream code. See
[M0 plan §S2](../plan/M0.md#s2--measureviewport-dictionaries-read-back-in-acrobat-reader--pdf-xchange).

## Findings

1. **No existing API writes or reads these structures.**
   - EmbedPDF's annotation model has no measurement fields.
   - PDFium only has `FPDFAnnot_SetStringValue` / `GetStringValue` for top-level string keys, plus
     EmbedPDF's `EPDFAnnot_SetIntent` for `/IT`.
   - There is nothing for nested dictionaries (`/Measure`), arrays, or page keys (`/VP`), and no way
     to _read_ a nested dictionary back.
2. **Our own object layer** (`spikes/s2-measure/`, about 700 lines, 19 unit tests):
   - `pdf-object.ts`: a read-only parser covering:
     - xref tables and xref streams, including PNG predictors;
     - `/Prev` chains, hybrid `/XRefStm`, and object streams;
     - text strings in PDFDocEncoding and UTF-16BE.

     It also has a serializer that writes reals with 10 significant digits and never uses exponent
     form. With 6 digits, `/C` rounding turned 1:100 into 1:100.0006.

   - `revision.ts`: appends one incremental revision with our objects, keeping the file's xref form
     and `/Prev`, `/Root`, `/Info` and `/ID`.
   - `scale-math.ts`: scales, calibration, distance, perimeter, shoelace area, ft-in, §7.4 viewport
     choice, and `/Measure` RL ↔ scale.
   - `read-measure.ts`: a reader plus CLI for any file, whether ours or a viewer's.
3. **Write path works** on a self-made A1 sheet:
   1. EmbedPDF creates line, polyline and polygon annotations; PDFium generates their appearances
      (B7).
   2. S1's narrow incremental save.
   3. Our patch revision adds `/IT`, an Acrobat-style `/Measure` RL (`/X` C = real units per point;
      `/D` and `/A` C = 1), `/Cap` + `/CP /Top` + `/Contents` = value on lines, and page
      `/VP` = [sheet 1:100, Detail A 1:5].

   Results:
   - every variant passes `qpdf --check` and opens in PDFium;
   - read back, all 6 values match exactly (20.00 m, 60.00 m, 200.00 m², 400.0 mm, 1200.0 mm,
     80000.0 mm²);
   - the viewports read back as exactly 1:100 and 1:5;
   - the corner-to-plate line is classified as _spanning_ (§7.4).

4. **Measurement data survives PDFium/EmbedPDF edits.** After `updatePageAnnotation` (colour change)
   and adding another annotation, then saving, `/Measure`, `/IT`, `/Contents` and `/VP` are all
   intact. PDFium keeps dictionary keys it doesn't understand.
5. **PDFium's appearance for line, polyline and polygon draws only geometry.**
   - It draws no caption and no value, even with `/Cap true`, so the value is invisible in any
     viewer that uses the stored appearance.
   - A FreeText companion (EmbedPDF-generated appearance, grouped with `/IRT` + `/RT /Group`) does
     show the text.
   - Inside PDFTools, labels can be a UI overlay computed from `/Measure`, with no appearance-stream
     code.
   - How Acrobat and PDF-XChange treat `/Cap`, groups, and annotations without an appearance is for
     the owner's checklist (§D1–D4).
6. **Reader robustness:** our reader agrees with qpdf on page counts for every unencrypted file in
   `corpus/` and the S1 fixtures, including object-stream and xref-stream files. Annotations there
   parse cleanly.
7. **Encrypted files are not handled.**
   - In an encrypted file every string is encrypted (`/R`, `/U`, the viewport `/Name`, and so on),
     and object streams are too.
   - PDFium can't write nested structures, and our layer has no encryption, so we can neither write
     nor read measurement data there.
   - The public 1,152-page catalogue in `corpus/` is RC4-encrypted (owner password only), so this
     case is real.
   - Numbers and names are not encrypted. Only the unit strings and object streams block us.
8. **Two revisions per save** (PDFium's narrow tail, then our patch) are valid. They can be merged
   into one: feed the patched objects into the S1 tail writer.

## Options for encrypted files (decision 4)

1. **Implement the Standard security handler for strings and streams** in the Render and Work
   workers.
   - This means file-key derivation for R2–R6: MD5 and RC4 for R2–R4, SHA-256/384/512 and AES for
     R5/R6.
   - AES and SHA come from WebCrypto; MD5 and RC4 are small own implementations or permissive
     libraries.
   - Estimated at about 400 lines plus tests against qpdf-encrypted fixtures.
   - It unlocks measurements, and later any feature needing nested dictionaries, on encrypted files.
     Rule 9 still applies: we only write where the permissions allow annotations.
2. **Rev 0: don't persist measurements in encrypted files.** Measure in the UI, but show "Scale and
   measurement data can't be saved in encrypted PDFs". Geometry annotations (lines, polygons) still
   save through EmbedPDF.
3. **Reuse PDFium-encrypted strings** by setting temporary top-level string keys and moving the
   encrypted bytes into our dictionaries.
   - This only works where the key doesn't depend on the object number (AESV3).
   - Page `/VP` has no string setter, so it doesn't work there. Brittle; rejected.

## Decision

1. **Adopt the object layer** (reader, serializer, patch writer) in the Render worker for §7.4, as
   §7.4 already foresees. There is no ARCHITECTURE change for this part.
2. _(Owner, after the interop run)_ **Label strategy.**
   - Default proposal: always write `/Measure`, `/IT`, `/Cap` and `/Contents`, plus a grouped
     FreeText label (EmbedPDF appearance). Draw in-app labels as an overlay.
   - Drop the FreeText if both viewers show measurement values from `/Cap` / `/Contents` or
     regenerate appearances. If neither works, that is escalated here, because the remaining option
     is a custom appearance, which conflicts with B7.
3. _(Owner, after the interop run)_ **Viewport semantics.**
   - Keep our §7.4 rules for our own tools.
   - For files from viewers, trust each annotation's own `/Measure` (what the author saw).
   - Use `/VP` only for new measurements. The owner's D5–D7 results confirm or adjust this.
4. _(Owner)_ **Encrypted files:** option 1 in M3, with option 2 as the interim behavior until it
   lands.
5. _(Owner)_ Merge the patch into the single Ctrl+S revision in M1/M3 (finding 8).

## Consequences

- **M3:**
  - port `pdf-object.ts`, `revision.ts`, `scale-math.ts` and `read-measure.ts` with their tests;
  - the measurement tools create EmbedPDF geometry annotations and record their object numbers, and
    the save path adds the measurement keys;
  - snapping comes from S7.
- **Inflate:** the reader currently uses Node's zlib. In the workers use `DecompressionStream`
  (async) or a permissive inflate library. The license gate applies.
- **Owner:** run `e2e/interop/CHECKLIST.md` §D and §F with `e2e/fixtures/self-made/s2-interop/`,
  and send back viewer-saved files or `read-measure.ts` output.
- **Risks:**
  - viewer-specific `/Measure` details, such as Acrobat's multi-element `/X` for ft-in or the
    `/O`, `/CYX` and `/SS` keys, may need small reader additions once real viewer files arrive;
  - the reader is intentionally minimal: no encryption and no filters other than Flate. It fails
    loudly rather than misreading.

## Evidence

- Code: [`spikes/s2-measure/`](../../spikes/s2-measure/)
  - `scale-math.ts` (11 tests), `pdf-object.ts` + `revision.ts` (8 tests);
  - `read-measure.ts`;
  - `run-node.ts`: sheet, variants, survival, reader-vs-qpdf.
- Commands:
  - `npx vitest run spikes/s2-measure`: 19/19;
  - `node spikes/s2-measure/run-node.ts`: writes `spikes/s2-measure/out/s2-node.json`. All
    variants pass qpdf, all values match, and the survival check passes;
  - `node spikes/s2-measure/read-measure.ts e2e/fixtures/self-made/s2-interop/s2-cap.pdf`.
- Interop pack: `e2e/fixtures/self-made/s2-interop/`; checklist `e2e/interop/CHECKLIST.md` §S2.
