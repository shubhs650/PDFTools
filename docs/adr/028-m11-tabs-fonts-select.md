# ADR-028: M11 — document tabs v2, comments in every pointer mode, and a font library for text comments

- **Status:** Proposed (waiting for the owner's answers to the plan's Q1–Q8)
- **Date:** 2026-11-17
- **Deciders:** owner (Shubham) / agent (M11 planning thread)
- **Related decisions:** D-01 (layout), D-12 (licenses), D-17 (offline), D-22 (no network),
  D-29 (keyboard), D-30 (accessibility), D-34 (OCR), D-37 (comment styles), D-43 (text comments),
  D-47 (design language v2, accents); ADR-014 (annotations), ADR-020 (OCR text layer), ADR-022
  (Attach File appearance), ADR-024 (text colours via our appearance); ARCHITECTURE.md §1.3,
  §3.2, §7.1, §8, §8.1, §9, §10.3
- **Related spike / milestone:** M11 ([plan](../plan/M11.md)); spike S26 (task M11-02)

## Context

After testing the M10 build, users reported (owner, 2026-11-17): OCR text that Find finds but
Select Text cannot select until the file is reopened; too few fonts ("include the Google Fonts
library", enough for every profession and supported language, not infinite); a selected file tab
that is hard to see; no hover information, drag reordering, right-click menu or + button on the
tabs (PDF-XChange shown as reference); and comments that cannot be clicked in Hand or Select
Text. The owner also asked for obvious missing features.

Relevant facts from the code (details in the plan):

- The OCR bug is a stale **text geometry cache** in EmbedPDF's selection plugin: an `objects`
  change (the comment-transfer route OCR uses) keeps page identities and lists no content pages,
  so `afterChange` never evicts the geometry cached while the page had no text. No design change
  is needed; it is a bug fix (M11-01).
- The faint selected tab is a CSS order bug (`.tab-button`'s transparent background overrides
  `.tab--active`) on top of a weak white-on-grey cue.
- **A web app cannot know a file's folder path** (File System Access API), so PDF-XChange's
  "full path" tooltip and its folder and trash commands cannot be copied.
- Annotations are locked in Hand and Select Text since M3-05 (so drags there always pan or select
  text).
- Text comments can use only the PDF standard fonts, because PDFium generates their appearance
  from `/DA` (`EPDFAnnot_GenerateAppearance`). §7.1: "No custom appearance-stream generation in
  Rev 0", with two exceptions so far (Attach File, ADR-022; text colours, ADR-024).

## Options considered

**Fonts:**

1. **Keep the standard fonts.** Interoperable and small, but it ignores the owner's request.
2. **Load fonts from Google Fonts at runtime.** Unlimited choice, but breaks rule 4 (no CDNs,
   no third-party network) and privacy (Google sees each user's address), and fails offline.
   Rejected.
3. **A curated library of Google Fonts families (OFL-1.1 / Apache-2.0) shipped from our own
   origin**, embedded as subsets in standard FreeText appearance streams that we generate
   (chosen, subject to spike S26). Offline, private, interoperable for display; Acrobat and
   PDF-XChange redraw with their own fonts only when the comment is edited there and the font is
   not installed (as for any FreeText).
4. **Fonts installed on the user's computer** (Local Font Access). Useful (Arial, Calibri,
   ISOCPEUR), but Chromium-only, permission-gated and subject to each font's embedding license.
   Offered as optional item O5, after option 3.

**Delivery of the library (the plan's Q1):** (A) all shipped in the background precache, or (B) a
core set shipped and the other groups downloaded from our own origin on first use (the OCR
language pattern). Never from a third party.

**Comments in Hand and Select Text:** (a) keep the M3-05 lock; (b) unlock fully (a drag on a
highlight would move nothing but could no longer select text); (c) **unlock with a click-versus-
drag rule for text markups in Select Text** (chosen).

**Tabs:** a plain `title` tooltip (cannot show a thumbnail, not keyboard-accessible) versus a
**hover card** that meets WCAG 1.4.13 (chosen); a library for drag-and-drop versus **our own
pointer-event drag** (chosen: one horizontal list, no dependency, `transform`-only).

## Decision

**D-50 — Document tabs v2.** The selected tab is filled with the current accent
(`--color-brand`) with white semibold text, white close button and unsaved dot; in dark it also
has a 2 px light-accent line so the state meets 3 : 1 against the strip with every accent;
forced colours use Highlight/HighlightText. A **hover card** (500 ms hover or 800 ms keyboard
focus; WCAG 1.4.13) shows the page 1 thumbnail, the full file name, where the file came from (no
path: browsers do not expose it), pages, size, last modified time and status; the tab's
accessible description carries the same text. A **+** button after the last tab opens a file
(owner's Q4), and double-clicking the empty strip does too. Tabs **reorder by dragging**
(pointer events; lift, neighbours slide, auto-scroll, Esc cancels; motion only on `transform`,
none under reduced motion) and by **Ctrl+Shift+Left/Right** and Move Left/Right in the tab menu;
middle-click closes. A **tab menu** (Save, Save As, Close, Close Others, Close to the Right,
Close All, Reopen Closed Tab, Move Left/Right, Sort by Name, Copy File Name, Rename File only
where the browser can rename the original in place, Document Properties) and a **strip menu**
(Open, Create Blank PDF, Reopen Closed Tab, Close All). Commands a web app cannot perform
(folder, path, trash, file clipboard, new window) are not shown.

**D-51 — Comments in every pointer mode.** Comments (all kinds, including image stamps,
signatures and attachments) can be selected in Select, Select Comments, **Hand and Select
Text**. Hand: click selects, a drag that starts on a comment moves it (owner's Q5), elsewhere it
pans. Select Text: click selects; on a text markup a drag selects text and a click selects the
markup (Q6); on other comments a drag moves them. Form fields are unchanged (filled in every
mode except Select Fields). Locked comments and documents without the annotate permission
(rule 9) select but do not move. The page menu lists **Select** and checks the current tool.
This replaces the M3-05 rule in the code ("Select Text and Hand never pick up annotations").

**D-52 — Font library for text comments.** Text boxes, typewriters and callouts can use, besides
the three standard families, a curated library of about 26 families from the Google Fonts
library (the plan's table, the owner's Q2), each under OFL-1.1 or Apache-2.0 and checked by the
license gate, **shipped with the app and served from our origin** (rule 4), precached in the
background (owner's Q1: A, or B above 12 MB). Chinese reuses the Noto Sans SC file already
shipped for rendering. The comment stays a standard FreeText (`/Contents`, `/DA`, `/DS`, `/RC`
naming the family); **its appearance stream is generated by us** with the used glyphs embedded as
a subset font (CIDFontType2, Identity-H, ToUnicode), text shaped for complex scripts, characters
missing from the chosen font falling back by script to Noto Sans Devanagari or Noto Sans SC.
Generation runs in a worker (rule 1) on the route spike S26 selects (PDFium page objects with
`EPDFAnnot_SetAppearanceFromPage`, or our object layer with HarfBuzz shaping and subsetting), and
is re-applied whenever EmbedPDF regenerates the appearance. This is the **third exception** to
"no custom appearance streams" in §7.1. Form fields keep the standard fonts (owner's Q3). If S26
finds a blocker, this ADR is amended with the fallback (Latin families first) before M11-07.

The optional items O1–O9 that the owner accepts are recorded here as an amendment, with their
own decision numbers where they change the architecture (O2 and O3 add local data, §10.3; O5 adds
a permission-gated API).

### ARCHITECTURE.md changes (Rev 0.17, applied on acceptance)

- §2: add D-50, D-51, D-52.
- §7.1: comments are selectable in every pointer mode (D-51; until now an unwritten M3-05 rule
  in `DocumentView.tsx` locked them in Hand and Select Text); the exceptions to "no custom
  appearance streams" gain text comments in a library font (D-52), and the font list for text
  comments points to D-52.
- §3.2: the font library (Google Fonts families, OFL-1.1 / Apache-2.0, self-hosted) and, if S26
  picks route R2, `harfbuzzjs` (MIT).
- §8: the document tab strip (D-50): accent selected tab, hover card, + button, drag reorder,
  tab and strip menus; §8.1 adds Ctrl+Shift+Left/Right (move tab) and Reopen Closed Tab.
- §9: the background precache includes the font library (or its core, under Q1's option B).
- §13: add M11.

## Consequences

- The tabs and the pointer-mode change are UI and interaction work on existing stores and
  commands; no new dependency.
- The font library is the largest piece: new files in the precache (about 8–10 MB, measured in
  S26), a new appearance writer, and an owner interop check in Acrobat Reader and PDF-XChange.
  Saved files grow by the embedded subsets (typically tens of KB per font used).
- Editing one of our text comments in another viewer that lacks the font redraws it in that
  viewer's font: expected PDF behaviour, documented in Help.
- Some e2e tests that drag over comments in Select Text or Hand change behaviour; updated in
  M11-06, with a full-suite run.
- Risk: EmbedPDF regenerating FreeText appearances after edits; covered by re-applying ours on
  every write, as ADR-024 does for colours, with tests for each edit path.

## Evidence

- Code reading on `main` (0490721): `src/features/pages/pageOps.ts` (`contentPages`,
  `afterChange`), `@embedpdf/plugin-selection` 2.15.1 (`getOrLoadGeometry`,
  `EVICT_PAGE_GEOMETRY`), `src/workers/work.worker.ts` (`setLive` drops the search cache),
  `src/app/TabStrip.tsx` and `src/app/app.css` (`.tab--active` before `.tab-button`),
  `src/features/view/DocumentView.tsx` (lock per tool), `src/features/view/documentMenus.ts`
  (`PAGE_MENU`), `src/workers/render/freeTextFonts.ts` and `src/features/annotate/properties`
  (three font families).
- Screenshots of the e2e build at 1366 × 800, light and dark: the tab strip, a tab hovered (no
  tooltip), the page menu, and a rough CSS-only preview of D-50 (shared folder `m11-plan/`).
- Contrast (WCAG relative luminance): white on `#2563eb` 5.17 : 1, `#0f766e` 5.47, `#4f46e5`
  6.29, `#475569` 7.58; the filled accents against the dark strip `#0b1120`: 3.64, 3.44, 2.99,
  2.48 (hence the line in dark).
