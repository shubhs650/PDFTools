# ADR-024: Separate text and border colours for text comments (spike S25)

- **Status:** Proposed (agent, 2026-11-05), for the owner's review
- **Date:** 2026-11-05
- **Deciders:** owner (Shubham) / agent (M7-05 thread)
- **Related decisions:** D-03 (standard annotations, rule 6), D-37 (defaults), D-43 e (text
  menu, ADR-023); ARCHITECTURE.md §7.1 ("No custom appearance-stream generation in Rev 0";
  Attach File is the one exception, ADR-022 decision 1)
- **Related spike / milestone:** S25 (`spikes/s25-freetext-colors/`); follow-up to M7-05

## Context

The owner asked (2026-11-05) for **separate options for the text colour and the border colour**
of a text box and a callout, as PDF-XChange has, keeping interop with other viewers.

What happens today (EmbedPDF 2.15.1 and its PDFium build, found in M7-05):

- EmbedPDF writes a FreeText's **border colour into `/DA`** (`1 0 0 rg /Helv 12 Tf`) whenever the
  comment has one, and the **text colour into a private `/TextColor [r g b]` key** when the two
  differ. It reads them back the same way.
- PDFium's appearance generator (`EPDFAnnot_GenerateAppearance`) draws **both the border and
  the text in `/DA`'s colour**. `/TextColor` is ignored. So a text colour that differs from the
  border colour shows while the comment is selected (the editor's CSS) and reverts on the page,
  in the saved file and in every other viewer. M7-05 (PR #85) works around it by making the text
  colour set the border colour too.
- Acrobat's convention (also followed by PDF-XChange and by PDFBox's appearance handler) is the
  same split as EmbedPDF's: `/DA`'s `rg` is the **border and callout line colour**, and the
  **text colour is in `/DS`** (`color:#0000FF`) and in the rich text `/RC`, when present.

## Spike S25 (2026-11-05, real PDFium in Node, `colors.test.ts`)

A text box with a 2 pt red border, blue Courier-Bold 18 pt text, centred:

1. As EmbedPDF writes it: `/DA (1 0 0 rg …)`, `/TextColor [0 0 1]`. The appearance draws the
   border **and the text in red**. The rendered pixels are red in both places.
2. Ours: PDFium's appearance content (`FPDFAnnot_GetAP`) with the colour operator at the start of
   each `BT` block replaced by the text colour. This is set back as the appearance through a
   one-page PDF passed to `EPDFAnnot_SetAppearanceFromPage`, the call EmbedPDF itself uses for
   stamps, which carries the page's `/Resources` (fonts, `/GS`) into the appearance. `/DS` is set
   to `font: bold Courier 18pt; text-align:center; color:#0000FF`.
   - Rendered: **the border red, the text blue.**
   - Saved and reopened, the pixels are the same, and EmbedPDF reads `fontColor #0000ff` and
     `strokeColor #ff0000`.
3. `FPDFAnnot_SetAP` alone is not enough. It makes a new stream without `/Resources`, so the
   fonts would be lost and PDFium would draw the text in its stock Helvetica.
4. Recolouring the exported appearance's page objects (`EPDFAnnot_ExportAppearanceAsDocument`,
   `FPDFPageObj_SetFillColor`, `FPDFPage_GenerateContent`) does not work. PDFium does not
   regenerate the nested form, and the result rendered black with the text missing.

**Verdict: works with a workaround.** We post-process PDFium's own appearance and change only the
text colour operator. Layout, wrapping, fonts, alignment and the border stay PDFium's.

## Decision (proposed)

1. **Storage, Acrobat's convention:**
   - `/DA` `rg` holds the border colour (EmbedPDF already writes it there).
   - The text colour is written to `/DS` `color:` and to EmbedPDF's `/TextColor`, which our
     reader uses.
   - When the two colours are equal, or the comment has no border (a typewriter), nothing changes
     from today: `/DA` holds the one colour, and no `/DS` colour is needed.
   - We do not write `/RC` (rich text). Per-character styles stay out (ADR-023).
2. **Appearance:**
   - The Render worker wraps EmbedPDF's FreeText create and update calls. After PDFium has
     generated the appearance, it replaces the text colour operator inside `BT … ET` with the
     text colour.
   - The fixed appearance is set with `EPDFAnnot_SetAppearanceFromPage`. Its resources come from
     the exported appearance (`EPDFAnnot_ExportAppearanceAsDocument`) with the form stream
     replaced by an incremental update, so any font PDFium used is kept.
   - If the content does not have the expected shape (no `BT` block, or more than one colour
     operator per block), the comment keeps PDFium's appearance and the problem is logged to
     diagnostics, never shown to the user as an error.
   - This is the second exception to §7.1's "no custom appearance-stream generation", after
     Attach File. We change one operator in PDFium's stream; we do not generate a new one.
3. **UI:**
   - The Properties pane gets **Border color** (text box and callout; not the typewriter, which has
     no border) beside **Text color**.
   - The same two fields appear in the tool defaults (Text Box, Callout) and the Comment Styles
     window.
   - The text menu's Text Style ▸ Text Color sets the text colour only.
   - M7-05's "the border follows the text colour" is removed.
   - New text comments keep D-37's red text on a red border.
4. **Readback of other viewers' files:** the text colour is read from `/TextColor` if present,
   else from `/DS` `color:`, else from `/DA`.
   - Today EmbedPDF reads `/TextColor` or `/DA`, so a `/DS` reader is added beside our font
     readback (`freeTextFonts.ts`).
   - Opening an Acrobat or PDF-XChange file then shows its text colour.

## Alternatives

- **A. The border follows the text colour** (M7-05 interim). Simple and interoperable, but only
  one colour. The owner asked for two.
- **B. Our own FreeText appearance generator** (layout, wrapping, fonts, alignment, callout
  geometry). Full control, but weeks of work and a second text layout that would disagree with
  PDFium's editor preview.
- **C. Write `/RC` rich text with the colour.** Acrobat prefers `/RC` over `/DS`, but every edit
  would have to keep `/RC` in step with `/Contents`, and EmbedPDF's own reader would start
  treating the comment as rich text. Not needed for a single colour.

## Consequences

- One more Render-worker step after each FreeText write (one `GetAP`, one small PDF built and
  loaded, one `SetAppearanceFromPage`). It runs only when the text and border colours differ;
  the expected cost is well under 10 ms per comment. Measured in the follow-up's perf check.
- An EmbedPDF upgrade (3.x) must re-run S25's test. If its generator honours `/TextColor`, the
  workaround is dropped.
- Interop rows join the owner checklist. In Acrobat Reader and PDF-XChange:
  - a text box and a callout with blue text on a red border display correctly;
  - editing their text there keeps both colours (`/DS`);
  - their own two-colour comments open here with both colours.
- ARCHITECTURE.md §7.1 gains the exception sentence (Rev 0.12) once this ADR is accepted.
