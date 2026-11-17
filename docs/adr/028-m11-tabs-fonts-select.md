# ADR-028: M11 — document tabs v2, comments in every pointer mode, and a font library for text comments

- **Status:** Accepted (owner, 2026-11-17, with the plan's recommended answers Q1–Q6 and Q8, and
  all nine optional items O1–O9 for Q7). Applied: ARCHITECTURE.md Rev 0.17.
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
background (owner's Q1: option A, the whole library ships with the app). Chinese reuses the Noto Sans SC file already
shipped for rendering. The comment stays a standard FreeText (`/Contents`, `/DA`, `/DS`, `/RC`
naming the family); **its appearance stream is generated by us** with the used glyphs embedded as
a subset font (CIDFontType2, Identity-H, ToUnicode), text shaped for complex scripts, characters
missing from the chosen font falling back by script to Noto Sans Devanagari or Noto Sans SC.
Generation runs in a worker (rule 1) on the route spike S26 selects (PDFium page objects with
`EPDFAnnot_SetAppearanceFromPage`, or our object layer with HarfBuzz shaping and subsetting), and
is re-applied whenever EmbedPDF regenerates the appearance. This is the **third exception** to
"no custom appearance streams" in §7.1. Form fields keep the standard fonts (owner's Q3). If S26
finds a blocker, this ADR is amended with the fallback (Latin families first) before M11-07.

_S26 result (2026-11-17, M11-02, `spikes/s26-freetext-fonts/`): **works, route R2**, with
the changes below. **Amendment accepted by the owner on 2026-11-17** (route R2 and the
measured 16.0 MB library, Chinese Regular and Bold); the owner's interop check of the sample file
still gates M11-07:_

- **Route R2 is chosen.** HarfBuzz (`harfbuzzjs` 1.6.4, MIT; `harfbuzz.wasm` 444 KB for shaping,
  `harfbuzz-subset.wasm` 684 KB for subsetting, which needs no JavaScript glue) shapes the text
  and cuts the font; we write the text and the font objects. Route R1 (PDFium's
  `FPDFText_LoadFont` and text objects) is rejected: it does not shape (for कि it writes क then
  the vowel sign, in typed order and with nominal glyphs, where HarfBuzz draws a contextual ि
  first), and it embeds the whole face in every comment (Roboto 38 KB, Noto Sans Devanagari
  75 KB, Noto Sans SC 1.4 MB compressed, per comment) where R2 adds 3.5–6.5 KB of font objects.
- **The appearance.** PDFium's own appearance stays for everything but the text: its fill,
  border and callout line (so ADR-024's border colour, the callout geometry and the opacity are
  PDFium's), with its `BT … ET` blocks removed. Our text follows in the text area: the box inset
  by the border width, or a callout's /Rect minus /RD inset by the border and 2 pt (PDFium's
  numbers; PDFium draws no text at all for characters outside WinAnsi, which is why Hindi and
  Chinese text boxes are blank today in every viewer but ours). Lines use the editor's CSS line
  height (1.18) and the face's ascent and descent; breaks after spaces and hyphens, between
  ideographs, and inside a word wider than the box (as the editor's `contenteditable` does).
  Each face is a Type0 font → CIDFontType2 (Identity-H, `/CIDToGIDMap /Identity`) with HarfBuzz's
  subset of the used glyphs (glyph ids kept, layout and hinting tables dropped, Flate), `/W` from
  `hmtx`, and a ToUnicode CMap (the first glyph of a cluster maps to the cluster's text). Every
  run of one font and baseline is a `/Span << /ActualText … >>`, so text that shaping reordered or
  merged (Devanagari) is extracted as typed. It is set with `EPDFAnnot_SetAppearanceFromPage` as
  ADR-024 does, which copies the font objects into the document.
- **Fallback by character:** the chosen face, then **Noto Sans Math** (new, not in the picker,
  90 KB: no family in the list has ⌀ U+2300, several lack ≤ ≥ ≈ √ ∞ or arrows), Noto Sans
  Devanagari, Noto Sans SC. Faces without bold or italic (Devanagari, Chinese, Caveat, Kalam,
  Architects Daughter) are drawn bold with a stroke of 1/30 em and italic with a 12° slant.
- **Chinese is Noto Sans SC TrueType from Google Fonts**, pinned to Regular and Bold and cut to
  GB 2312 (6,763 hanzi and its symbols, plus CJK punctuation and full-width forms; 2.25 MB each).
  The CFF Noto Sans CJK SC we ship for rendering (`@embedpdf/fonts-sc`) cannot be reused: embedded
  either as OpenType or as bare CFF, PDFium draws it, but MuPDF draws half of the glyphs and
  extracts no text, and poppler reports glyph errors. M11-07 may widen the cut to the 8,105
  characters of the Table of General Standard Chinese Characters (Unihan `kTGH`).
- **Licenses.** Every file is OFL-1.1 in the Google Fonts repository today (Arimo, Tinos,
  Cousine and Roboto included; Carlito is there, under OFL). Three families reserve their names
  (OFL §3): Carlito ("Carlito") and IBM Plex Sans and Mono ("Plex"), so they ship as the
  unmodified upstream files (a pinned or cut copy is a Modified Version); subsets embedded in a
  document are not. Tinos has no OFL.txt upstream; its notice comes from the font's `name` table.
- **Size, measured** (`build-library.ts`): 26 families, 88 faces, **16.0 MB** in the background
  precache (8.7 MB over the wire compressed): the Latin families 11.5 MB (Office-compatible
  3.9, sans 2.9, serif 1.1, mono 1.0, hand 0.7, technical 0.6, narrow 0.4), Hindi 0.75, Chinese
  4.5, the math fallback 0.09. The plan estimated 8–10 MB; the difference is the Chinese file
  (planned as the existing one) and the reserved-name families. Every other face is pinned to one
  instance and cut to Latin, Latin Extended, Greek and the technical symbols (Devanagari for the
  Hindi families), keeping its layout tables. The upstream files total 46 MB.
- **Checked** (17 tests, real PDFium, `s26.test.ts`): Latin with accents and ° ± µ Ω ² ³ ⌀ Δ → ≤;
  Devanagari conjuncts and vowel signs; Hindi typed in Roboto (fallback); Chinese; mixed scripts;
  bold and italic, real and drawn; wrap with left, centre and right alignment; rotation;
  ADR-024's blue text on a red border; a callout; Ctrl+S's incremental save (the original bytes
  untouched); reopened pixels identical; flattened, the text is found exactly. poppler and MuPDF
  draw the saved files the same and extract the text from the flattened ones, except MuPDF
  1.23's Devanagari (it ignores `/ActualText`; Acrobat, PDF-XChange, PDFium and poppler use it).
  Cost about 3–7 ms per comment write (median, Node). A saved comment grows by 6–9.5 KB.
- **Re-applying:** EmbedPDF regenerates a Helvetica appearance on a resize or any change with
  `regenerateAppearance` (the default); ours must be applied again after it, as ADR-024 does.
  A move without regeneration keeps our appearance and places it right.
- **Found on the way, fixed in the same PR:** ADR-024's recoloured appearance was squeezed when
  the text box is turned. `EPDFAnnot_SetAppearanceFromPage` makes the page's MediaBox the
  appearance's /BBox, which viewers fit to /Rect, and a turned comment's /Rect is the turned
  box's bounds, larger than the box. The page now has the bounds' size
  (`turnedBounds` in `freeTextColors.ts`); the unit test now writes a turned comment as the
  annotation plugin does (bounds as /Rect, plus `unrotatedRect`).

**Optional items (owner, 2026-11-17: all nine accepted).** O1 (selected-text menu), O4 (Zoom
to Area) and O6 (copy or save a page image, extracted in the Work worker) need no architecture
change. The others:

**D-53 — Pick up where you left off (O2, O3).** Settings → "When Triya PDF starts": the start
screen (default) or the files open last time, reopened from their saved file handles as Recent
files does (the browser may ask once per file). Each file's last page, zoom, layout and view
rotation are kept on the device, keyed by a fingerprint of the file (never its name or content),
and restored on reopen. Both are listed in Privacy and removed by Clear all local data (§10.3).

**D-54 — Fonts installed on this computer (O5).** In Chromium, the font list offers "Show fonts
on this computer…", which calls Local Font Access (`queryLocalFonts()`) on that click only, behind
the browser's permission prompt. A system font is used through D-52's appearance writer only when
its OS/2 embedding flags allow embedding; restricted fonts are listed but disabled with the reason.
Only the family name is remembered (Recently used); font files are never stored or sent. Built
after the library and its interop check.

**D-55 — Page tools: split, images to PDF, crop (O7, O8, O9).** Organize → **Split** (every N
pages, page ranges, top-level bookmarks) writes the parts in the Work worker into a folder the
user picks. **Images to PDF** (open or drop JPG/PNG; Organize → Insert → From Image) builds pages
in the Work worker, one image per page (fit, A4 or Letter), as a new unsaved document or inserted
pages. **Crop** (drag on the page or type margins, for a page range) sets only `/CropBox`, as one
undo step through the page operations; Remove Crop restores it; measurement viewports keep their
coordinates.

**D-56 — Panes: resizable Properties pane and edge arrows (owner, 2026-11-17, added after
acceptance).** The right Properties pane gets the left pane's window splitter (drag and keys,
160–480 px, width kept while the app is open, as the left pane's). Each pane has a chevron button on its inner edge,
always visible, that hides or shows it through the existing pane commands (the left one reopens
the last pane); 24 × 48 px, keyboard-reachable, `aria-expanded`, never over the document's
scrollbar.
_Amended by the owner, 2026-11-17 (M11-10, PR #120):_ the arrows are **12 × 48 px** on a 12 px
edge strip, like PDF-XChange's (the owner tried 24 px and found it too wide). They meet WCAG 2.5.8
through its equivalent-control exception (the ribbon and rail buttons run the same commands),
and axe passes. The document keeps its reading place when a pane is shown, hidden or resized.

### ARCHITECTURE.md changes (Rev 0.17, applied 2026-11-17)

- §2: add D-50 … D-56.
- §7.1: comments are selectable in every pointer mode (D-51; until now an unwritten M3-05 rule
  in `DocumentView.tsx` locked them in Hand and Select Text); the exceptions to "no custom
  appearance streams" gain text comments in a library font (D-52), and the font list for text
  comments points to D-52.
- §3.2: the font library (Google Fonts families, OFL-1.1 / Apache-2.0, self-hosted) and, if S26
  picks route R2, `harfbuzzjs` (MIT).
- §8: the document tab strip (D-50): accent selected tab, hover card, + button, drag reorder,
  tab and strip menus; §8.1 adds Ctrl+Shift+Left/Right (move tab) and Reopen Closed Tab.
- §7.8: split, images to PDF and crop (D-55).
- §8: panes are resizable on both sides and have edge arrows (D-56).
- §9: the background precache includes the font library.
- §10.3: local data gains the start-up choice, each file's last view (by fingerprint) and the
  recently used fonts (D-52, D-53, D-54).
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
