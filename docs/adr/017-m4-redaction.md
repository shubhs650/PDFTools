# ADR-017: M4-02 — Redaction: apply, sanitize and location-based verification

- **Status:** Proposed (decisions 3 and 5 need the owner; decision 3 amends ADR-001 B8's wording)
- **Date:** 2026-09-29
- **Deciders:** Owner; recorded by the coding agent
- **Related decisions:** D-06, D-24, D-31 (ARCHITECTURE.md §7.9); ADR-001 B3, B8, B14; ADR-005 d3;
  ADR-013 (copy with unsaved edits); M3-04 (security handler); M4-Q2, M4-Q3, M4-Q4; CLAUDE.md
  rules 1, 2, 5, 8, 9, 10, 13
- **Related spike / milestone:** M4-02 (spike S15, `spikes/s15-redaction/`), feeds M4-16 … M4-18
- **Outcome (spikes only):** **Works with workaround.** EmbedPDF's PDFium build removes text
  (including invisible, white, rotated, crop-offset, hidden-layer and Form XObject text), image
  pixels (XObject and inline) and paths that lie wholly inside a rectangle. It **leaves every path
  that crosses a rectangle**, and it touches no annotation, form field or document-level data. A
  prototype that re-cuts crossing paths through PDFium's page-object API, plus our sanitize step,
  makes every adversarial page pass the location check; verification fails loudly where the
  prototype cannot reach (a crossing path inside a Form XObject).

## Context

§7.9 (D-31) requires: marks → pending list → Apply; Apply always writes a **new, fully rewritten
file**; sanitize (Info/XMP metadata, embedded thumbnails, annotations / form values / bookmarks /
links intersecting redacted areas); warn on signed documents; and **post-redaction verification by
location** (ADR-001 B3): no text, image pixels or vector content inside any redacted rectangle,
plus a search for each redacted string that does not also occur outside the redacted areas.
ADR-001 B8: the engine is EmbedPDF's redaction, with **no custom content-stream rewriter**. Rule 8:
success is reported only after verification passes.

## Setup

- **Engine calls (B14):** `EPDFPage_ApplyRedactions` (all `/Redact` annotations of a page; what
  EmbedPDF's `applyAllRedactions` calls) and `FPDFPage_GenerateContent`, on a separately opened copy
  of the document, then our writer's `FPDF_NO_INCREMENTAL` (ADR-005 d3).
- **`@embedpdf/plugin-redaction` 2.15.1** was read, not installed: MIT, depends only on
  `@embedpdf/utils` / `@embedpdf/models` 2.15.1. It is a **marking and pending-list** plugin
  (text-selection, marquee, `useAnnotationMode` for standard `/Redact` annotations) whose
  `commitAllPending` applies the redactions **in the open document** — not usable for Apply, which
  must work on a copy and write a new file (§7.9 step 2).
- **Adversarial fixture** (`fixtures.ts`, self-made, rule 13): 9 pages, each with one `/Redact`
  annotation (black `/IC`, one with `/OverlayText`) as another viewer leaves it after "mark":
  1 plain text, a word straddling the edge, a word inside **and** outside; 2 text under an image
  larger than the rectangle; 3 invisible (`3 Tr`), white, and Form XObject text; 4 an inline image,
  a stroked line, a filled triangle and a Bézier through the rectangle; 5 `/Rotate 90`;
  6 crop-offset `MediaBox`; 7 a FreeText (with appearance), a Link and a Widget in the rectangle, a
  Square and a Text note outside; 8 text in a hidden optional-content layer; 9 a line crossing the
  rectangle inside a Form XObject. Document level: `/Info` title, XMP, a page `/Thumb`, an outline
  item pointing into a rectangle and one outside, document JavaScript, an embedded file,
  `/PieceInfo`, and a structure tree whose element has `/Alt` and `/ActualText` of a redacted word.
  Every secret is a unique canary word.
- **Verification** (`verify.ts`, raw PDFium, runs in the Work worker as is): per page with
  rectangles — text characters (`FPDFText_GetCharBox`), page objects recursively through forms
  (text objects, path segments with Liang–Barsky and a filled-area test, image pixels mapped into
  image space via the inverted object matrix, shadings), and annotations; then the string rule over
  the whole document's text (pages, annotation `/Contents`, bookmark titles, document info). As an
  extra spike-only check, every decoded stream and string of the output is scanned for the canaries.
- **Sanitize** (`sanitize.ts`): our object layer writes one incremental section over PDFium's
  rewrite (catalog without `/Metadata`, `/StructTreeRoot`, `/MarkInfo`, `/PieceInfo`, `/AA`, a
  JavaScript `/OpenAction`, `/Names /JavaScript` and `/EmbeddedFiles`; pruned `/AcroForm /Fields`;
  outline items whose destination lies in a rectangle unlinked; pages without `/Thumb`,
  `/PieceInfo`, `/Metadata`, `/StructParents`, `/AA`, `/B`; `/Info` pointed at an empty
  dictionary), then **PDFium rewrites once more**, dropping everything no longer referenced. The
  result is a single revision.
- **Path prototype** (`pathsplit.ts`): each top-level path crossing a rectangle is replaced by new
  path objects holding only the geometry outside it — strokes clipped against the rectangle grown
  by half the stroke width, fills clipped to the rectangle's complement as four convex regions
  (Sutherland–Hodgman), Béziers flattened (prototype) — created with `FPDFPageObj_CreateNewPath`,
  styled like the original, inserted at its drawing-order index; `FPDFPage_GenerateContent` writes
  the content stream.
- **Inputs for timing:** 200 A4 pages × 3 `/Redact` marks (600), and the A0 sheet with 200k segments
  and one 600 × 400 pt mark. Node 22, 4-core container; indicative.

## Findings

1. **Negative controls.** Verifying the unredacted source flags every page with the right kinds
   (text, text objects, image, paths, annotations; page 9's path through the form), and the string
   rule selects 9 words, correctly skipping the word that also occurs outside a rectangle.
2. **What the engine removes** (after `EPDFPage_ApplyRedactions`, before anything of ours): all text
   in the rectangles — plain, straddling (only the characters inside), invisible, white, rotated
   page, crop-offset page, hidden layer, **inside a Form XObject**; the image pixels inside the
   rectangle (both the XObject image larger than the rectangle and the inline image: verification
   sees one uniform colour there); paths wholly inside (the triangle). The `/Redact` annotations are
   removed. Text outside is intact (`PUBLICLEFT`, `PUBLICRIGHT`, the outside `REPEATKILO`).
3. **What the engine leaves:**
   - **every path crossing a rectangle** (page 4: the line and the curve; page 9: the line in the
     form; A0 sheet: **78 path objects**) — vector content inside the rectangle, which B3 forbids;
   - every other annotation over the rectangle (FreeText with its appearance, Link, Widget);
   - all document-level data (canary scan: Info, XMP, outline title, JavaScript, embedded file,
     `/PieceInfo`, thumbnail, structure `/Alt`, and the redacted word in `/ActualText`; the field
     value in `/AcroForm`).
4. **Full pipeline** (apply → split crossing paths → remove intersecting annotations → rewrite →
   sanitize → rewrite): pages 1–8 pass the location check and the string rule; the canary scan finds
   **no secret and no hidden data**; kept text and outside annotations/outlines survive; one
   revision; qpdf-clean. **Page 9 fails verification** (the crossing line inside the form), as it
   should: the prototype does not descend into forms, and PDFium has no call to insert objects into
   a form. With `/Info` simply omitted from our trailer, PDFium kept the old one; pointing it at an
   empty dictionary fixed that.
5. **Encrypted source (M4-Q4).** AES-256 file opened with the owner password: same results; the
   output stays AES-256 encrypted, opens with the **user** password, qpdf-clean with the password.
6. **Geometry preserved by the split** (A0 sheet, total stroke length outside the rectangle):
   source 3,681,907 pt, after split 3,681,223 pt (−0.02 %: the half-stroke-width margin), 82 paths
   replaced by 2,643 pieces; engine-only 3,681,878 pt but failing verification (78 leaks).
7. **Timings** (Node; the Work worker in the browser is ~1.5–2× slower):

   | Input                | Apply       | Split paths | Remove annots | Rewrite ×2           | Sanitize                               | Verify      | Capture words (before) |
   | -------------------- | ----------- | ----------- | ------------- | -------------------- | -------------------------------------- | ----------- | ---------------------- |
   | 200 pages, 600 marks | 0.82–0.91 s | 28 ms       | 20 ms         | 13 + 11–21 ms        | 8–10 ms                                | 0.38–0.47 s | 0.53–0.71 s            |
   | A0, 200k segments    | 0.49–0.55 s | 0.51 s      | 0.12–0.13 s   | 0.48–0.96 s + 6–9 ms | 3–6 ms                                 | 0.39 s      | —                      |
   | adversarial, AES-256 | 3 ms        | 1 ms        | < 1 ms        | 2 + 12 ms            | 0.19–0.28 s (decryption in the reader) | 13–24 ms    | —                      |

   Apply is one uninterruptible PDFium call per page (cancel between pages).

## Options considered

1. **Engine only + fail loudly** whenever a path crosses a rectangle. Simple and within B8's letter,
   but nearly every redaction on a drawing (title blocks, parts lists, dimensions) would fail.
2. **Remove every object that intersects a rectangle** (whole path objects). Passes verification,
   but deletes geometry far outside the rectangle (on CAD exports a path object often holds 50+
   segments across the sheet) — silent damage to the drawing.
3. **Re-cut crossing paths through PDFium's page-object API** (the prototype): PDFium parses and
   generates the content stream; we only compute geometry. Exact for lines; Béziers need exact
   splitting (de Casteljau) in production; clip paths and forms need care.
4. **Our own content-stream rewriter** — forbidden by B8.

## Decision (proposed)

1. **Apply on a copy in the Work worker** (ADR-013 route): original + current tail, opened with the
   document's password; per page `EPDFPage_ApplyRedactions` + `FPDFPage_GenerateContent`, progress
   and cancel between pages (rules 1, 2); never in the Render worker's open document. Needs the
   **modify** capability (M4-Q2).
2. **Marking (M4-Q3):** standard `/Redact` annotations. M4-16 adds `@embedpdf/plugin-redaction`
   2.15.1 in `useAnnotationMode` for the marking tools and pending list **if** the license gate
   passes and its marks load through our ADR-014 annotation path; its `commit*` calls are never
   used. Otherwise the marks are made with `plugin-annotation`'s redact subtype.
3. _(Owner)_ **Crossing paths: option 3.** Paths that cross a rectangle are re-cut through
   PDFium's page-object API (`FPDFPageObj_CreateNewPath` / `FPDFPath_*` / style setters /
   `FPDFPage_InsertObjectAtIndex` / `FPDFPage_RemoveObject`), with exact Bézier splitting, the
   original's clip path, dash pattern, blend and transparency carried over, and the stroke margin
   including line caps. Content that cannot be re-cut (a crossing path inside a Form XObject, a
   shading crossing a rectangle) makes verification fail with a clear message naming the page — no
   file is written. **This needs a one-line amendment of B8** ("no custom content-stream rewriter;
   geometry of crossing path objects may be re-cut through PDFium's page-object API") and the same
   words in ARCHITECTURE.md §7.9 step 0, applied only after acceptance.
4. **Annotations:** every annotation whose rectangle overlaps a redacted rectangle is removed
   (with its popup and replies), and widgets' fields are pruned from `/AcroForm /Fields`.
5. _(Owner)_ **Sanitize list** (object layer + second PDFium rewrite, single revision): §7.9's items
   (Info → empty, XMP, thumbnails, intersecting annotations/fields/links, outline items whose
   destination lies in a rectangle) **plus**, because the canary scan shows each can carry redacted
   text: the structure tree and `/MarkInfo` (`/ActualText`, `/Alt`), document JavaScript and
   JavaScript open actions, **embedded files**, `/PieceInfo`, page `/Metadata` and `/AA`. Proposed
   §7.9 step 3 wording: "Sanitize: document Info + XMP metadata, embedded page thumbnails, structure
   tree (tagging), JavaScript, embedded files and private application data; annotations / form
   values / bookmarks / links intersecting redacted areas." The Apply dialog lists what will be
   removed. Alternative: keep embedded files (the user may want them) with a warning.
6. **Verification (rule 8, B3):** the algorithm in `verify.ts` becomes
   `src/workers/work/redact/verify.ts`: location checks (text characters, text objects, path
   segments and filled areas, image pixels, shadings, annotations; through forms), the string rule
   (redacted words of three or more characters that do not occur outside the rectangles in the
   source, searched in page text, annotation contents, bookmark titles and document info), and
   structural checks (one revision; no `/Info` content, XMP, `/Thumb`, structure tree, JavaScript,
   embedded files). Words are captured on the copy **before** apply. A failure names the page and
   the kind of leak (never the content, rule 10) and nothing is written.
7. **Encryption (M4-Q4 confirmed):** the output keeps the source's handler, passwords and `/P`
   (finding 5).
8. **The save target** is picked before the job (user activation); the bytes are written only after
   verification passed; signed sources warn with the signature count (§7.9 step 4).

## Consequences

- **M4-16:** `/Redact` marks (plugin decision 2), pending list; license gate.
- **M4-17:** apply on the Work-worker copy; path re-cut module (TDD: line/Bézier/fill clipping,
  margins, caps, dashes, clip paths; z-order preserved) — the prototype's clipping functions are a
  start; annotation removal; sanitize (object layer gains catalog, trailer and outline patches for a
  new document, and "remove keys" on pages); the two-pass rewrite.
- **M4-18:** verification from `verify.ts` with the S15 negative controls as unit tests (each must
  fail), the adversarial fixture as the e2e/integration corpus (moved to `e2e/fixtures/`), perf
  scenario 200 pages × 600 marks (~2.3 s in Node for capture + apply + rewrite + verify).
- **Risks:**
  - image pixels are checked with PDFium's decoded bitmap (`FPDFImageObj_GetBitmap`): soft masks and
    images drawn through patterns are not covered by the prototype and need fixtures in M4-18;
  - text drawn as vector outlines (glyphs converted to paths by some CAD exporters) is handled only
    by the path re-cut, which is why decision 3 matters;
  - the path re-cut changes how the kept geometry is written (one path per kept piece): larger
    content streams on dense sheets (A0: +5 KB);
  - `EPDFPage_ApplyRedactions` and `EPDF*` exports are EmbedPDF's PDFium patches (pinned 2.15.1).

## Evidence

- Code: [`spikes/s15-redaction/`](../../spikes/s15-redaction/) — `fixtures.ts`, `verify.ts`,
  `sanitize.ts`, `pathsplit.ts`, `run-node.ts`.
- Command (Node 22, repo root, `qpdf` 11.9 installed):
  `node --import ./spikes/shared/ts-ext.ts spikes/s15-redaction/run-node.ts` →
  `out/s15-node.json` and `out/redacted.pdf` (git-ignored).
- Inputs: self-made only (the adversarial file, `markedBulkPdf`, `a0Sheet` from
  `e2e/fixtures/generate.ts`, qpdf AES-256 variant). No owner files.
