# ADR-023: M7 — second beta review: name, dark theme, text comments, sticky note popups, image paste

- **Status:** Accepted (owner, 2026-11-04, with the plan's recommended answers Q1–Q7;
  ARCHITECTURE.md Rev 0.11 applied)
- **Date:** 2026-11-04
- **Deciders:** owner (Shubham) / agent planning session
- **Related decisions:** D-03, D-20, D-23, D-35, D-36, D-37, D-38 (ARCHITECTURE.md §2); new
  D-41 … D-45 below
- **Related spike / milestone:** M7 (plan: [docs/plan/M7.md](../plan/M7.md)); spike S23
  (sticky note `/Popup` objects, task M7-06); S24 (Courier Prime) only if the owner asks for it

## Context

The owner collected a second round of beta-user feedback in
`PDF_Tools_Trita_PDF_feedback2.docx` (2026-11-04; kept outside the repository).
[docs/plan/M7.md](../plan/M7.md) maps every item to a task and lists 14 comment selection and
editing bugs reproduced on `main` (17db96f). Most items are UI work inside the current design;
these conflict with ARCHITECTURE.md Rev 0.10 or with an M6 decision and need this ADR before any
code (CLAUDE.md: "Never change ARCHITECTURE.md without an approved ADR"):

| Item                                                    | Conflict in Rev 0.10 / M6                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1 — rename "PDFTools" to "Triya PDF"                    | The header, §8 top bar (D-35: "PDFTools" at the left) and every place the product is named                                       |
| 2 — dark mode with a toggle                             | §8 "dark theme deferred"; §14 lists dark theme under Rev 2+; D-20 "light theme default"                                          |
| 3c, 3d — Home groups icon-only at every width           | D-36 / §8: groups show full labels on wide windows and step down only when space runs out                                        |
| 4b — text comments: one click moves, double-click edits | §7.1 does not describe text-comment interaction; EmbedPDF's free-text editor commits only on blur (bugs B1, B2 in the plan)      |
| 4b-ii — typewriter Courier Prime, black                 | D-37: shipped defaults are red for every text tool; §7.1 "no custom appearance-stream generation" and only PDF standard fonts    |
| 4c — PDF-XChange-like sticky note popup                 | M6 plan "Not in M6: pop-up note windows (the Comments pane card is the note)"; EmbedPDF 2.15.1 neither reads nor writes `/Popup` |
| 4d — highlights at 50 % opacity                         | D-37 shipped defaults (opacity 1)                                                                                                |
| 4e — paste an image onto the page                       | §7.1 Paste (D-38 b) is our in-app comment clipboard only (ADR-018 d5); §7.3 image stamps come only from a chosen file            |

Library facts checked on 2026-11-04 (`node_modules/@embedpdf/*` 2.15.1, the pinned version):

- `plugin-annotation`'s free-text renderers (`FreeText`, `CalloutFreeText`) commit the edited
  text in the editor's `onBlur` only; entering edit mode selects the text only when the contents
  equal the tool's `defaults.contents`. Our tools set `clickBehavior.defaultContent` instead.
- The plugin can marquee-select (`onMarqueeEnd` for `pointerMode`), but it registers the mode
  with `enableMarquee: false`.
- Free text fonts are the 14 standard fonts (`PdfStandardFont`); appearances come from PDFium
  (`EPDFAnnot_GenerateAppearance`) from `/DA`. A non-standard font (Courier Prime, OFL-1.1) would
  need embedding (`FPDFText_LoadFont`) and an appearance stream of our own.
- The engine has no `/Popup` API (no reader, no writer).
- Fluent UI System Icons has `WeatherMoon` and `WeatherSunny` (Regular and Filled) for the theme
  toggle.

## Options considered

1. **Fix the bugs only; keep the M6 decisions (no popups, no dark theme, red typewriter).**
   Least work, but it ignores the owner's explicit requests.
2. **Bring every item into M7 on EmbedPDF 2.15.1, with a spike where a library capability is
   uncertain** (chosen): the `/Popup` writer (S23) before saving popup state; Courier Prime only
   after its own spike (S24) if the owner wants it over the standard Courier.
3. **Upgrade to EmbedPDF 3.0 (next) hoping its editor fixes the commit bugs.** Prerelease, a large
   migration; the bugs are fixable in our wrapper. Rejected, as in ADR-021.

## Decision

**D-41 — Product name "Triya PDF".** Every user-visible place says **Triya PDF**: the top bar
(D-35: the existing mark + "Triya PDF"), the document title, the PWA manifest name, Help, About,
Privacy, the error report and the GitHub issue body, exports' suggested file names
(`*.triyapdf-styles.json`, `*.triyapdf-scheme.json`; the old `.pdftools-*` files still import)
and the release notes. The name comes from one i18n key (rule 11). Not renamed: the domain
`pdf-tools.openengtools.com` (D-28), the repository, IndexedDB / OPFS / cache names,
`localStorage` keys, the PWA `id` (so installed apps update in place), CSS classes and the test
hook. (Name spelling: owner's answer Q1.)

**D-42 — Dark theme with a toggle.** A **light / dark toggle** at the right end of the top bar
(Fluent `WeatherMoon` / `WeatherSunny`), also in View and Settings. **Light is the default**; the
choice is stored on this device (read before the first paint; listed on the Privacy page;
reset by Clear all local data). The dark token set is reviewed against Fluent 2 dark neutrals and
WCAG AA for every token pair; **PDF pages stay white and are never inverted**, and comment
colours on pages are the document's own. Every surface is themed through tokens only (a test
forbids literal colours in `app.css` and components). Windows High Contrast (`forced-colors`)
still overrides both themes. The theme does not follow the operating system automatically in
M7.

**D-43 — Text comment interaction and comment selection.**
(a) A new text box, typewriter or callout is **selected and starts editing with its "Type here"
placeholder selected**, so typing replaces it. (b) **One click** anywhere on a text comment (box,
text, callout line) selects it; dragging moves it (a callout's box and line together); handles
resize; Delete, the clipboard and the context menu act on it. (c) **Double-click** (or Enter /
F2 on a selected one) edits at the clicked character; inside the editor the mouse selects text.
(d) The edit is **committed on every exit** — Esc (first Esc commits, a second deselects), a
click elsewhere, a tool or tab change, Ctrl+S, closing — as one undo step; the page shows the
committed text immediately. (e) While editing, right-click opens **our** text menu (Undo, Redo,
Cut, Copy, Paste, Delete, Select All, Text Style ▸, Properties); Text Style applies to the whole
comment (`/DA`, `/Q`) — per-character styling would need rich text (`/RC`) and is not in M7.
(f) A callout can also be drawn with one drag from the arrow tip to the box. (g) **Marquee
selection**: with Select Comments (and with Select on empty space), a drag selects every
comment it touches; Shift+click and Ctrl+click toggle; a newly drawn comment is selected. All of
this is built in our wrapper and configuration around `plugin-annotation` 2.15.1, not a fork.

**D-44 — Sticky note popup.** A sticky note (`/Text`) has a **popup window on the page**
(PDF-XChange layout, our own drawing): header with "Sticky Note", author and date; a multi-line
text area (Enter = new line); a footer with a menu, status, lock and **Reply**; draggable,
resizable, attached to the note by a leader, following scroll and zoom; opened on creation and on
double-click. It replaces the modal "Note" dialog. This reverses the M6 plan's "no pop-up note
windows" for sticky notes only; other comment types keep their Comments pane card. The note's
text, replies (`/IRT`) and status are saved as today. The popup's position and open state are
saved as a standard `/Popup` annotation (`/Parent`, `/Rect`, `/Open`, the note's `/Popup` key)
written by our object layer (ADR-007) in the narrow tail **only if spike S23 passes**; otherwise
the popup is on-screen only and the owner is told before M7-06 is built.

**D-45 — Paste an image onto the page.** Ctrl+V and the page menu's Paste accept an image from
the system clipboard (PNG, JPEG; other raster formats converted to PNG in the Encoder worker) and
place it as an **Image Stamp** (the M3-14 path, standard `/Stamp` with an image appearance),
scaled down to fit inside the page (90 % of its width and height, aspect ratio kept, never
enlarged), centred at the pointer (menu) or in the visible part of the page (Ctrl+V); one undo
step; the annotate permission is required (rule 9). The newest clipboard content wins between
our comment clipboard (ADR-018) and an image. Reading uses the `paste` event (Ctrl+V) or
`navigator.clipboard.read()` on the user's click (menu); nothing leaves the device (rule 4).

**D-37 amendment — defaults.** Highlight, Highlight Area and Free Highlight default to **50 %
opacity** (`/CA 0.5`, still multiplied and yellow); their palette presets too; stored presets
the user never changed are migrated, the user's own values are kept. Typewriter defaults to
**black text in Courier** (the standard PDF font, so it round-trips with PDFium's appearances
— owner's answer Q4). If the owner chooses Courier Prime instead, spike S24 (embedding the
OFL-1.1 font, our own appearance stream, Acrobat / PDF-XChange display and editing, file and
install size) comes first and a follow-up ADR records its verdict.

**D-36 amendment — Home tab.** Home's groups are Tools › Zoom › View › Comments › Measure ›
Protect. **Tools** (Hand, Select, Snapshot, Find, Advanced Search) and **View** (Rotate View
CW / CCW, Comments, Thumbnails, Bookmarks, Attachments and Properties panes) are **icon-only at
every width**; the tooltip and the accessible name give the full name. Protect shows Sign
Document. Reset Form is on the Form tab only. The adaptive steps (D-36) still apply to the other
groups and fold any group into a dropdown on a very narrow window.

### ARCHITECTURE.md changes (Rev 0.11, applied 2026-11-04)

- Title and header: "Triya PDF — Architecture & Product Specification"; **App:** Triya PDF; Rev
  0.11 amendment note citing this ADR.
- §2: add D-41 … D-45; D-20 "Light theme default, **dark theme toggle** (D-42)"; D-37 wording
  (50 % highlights, black Courier typewriter).
- §7.1: text comment interaction and selection (D-43); sticky note popup (D-44); paste image
  (D-45); D-37 defaults wording.
- §7.3: image stamps also come from the clipboard (D-45).
- §8: top bar — "Triya PDF", theme toggle; Home tab layout and icon-only groups (D-36
  amendment); "Design tokens … light theme default, **dark theme** via the top-bar toggle
  (D-42)".
- §10.3: local data gains the theme choice.
- §13: M7 — second beta review. §14: dark theme leaves Rev 2+.
- CLAUDE.md first line names the product "Triya PDF".

## Consequences

- No new runtime dependency is planned (the theme icons are Fluent; Courier is a standard font).
  If S24 is chosen, the Courier Prime font files (OFL-1.1) join the install budget (2.5 MB
  headroom today, §9).
- The text-comment commit path becomes ours: every exit path is tested, because a miss loses the
  user's text (B1, B2 are Critical).
- A popup writer joins the object layer if S23 passes: encrypted files need the object layer's
  string encryption, as the outline writer does (ADR-022 decision 5).
- The dark theme makes every new UI pay a small cost: contrast checks in dark run in CI on every
  surface the a11y spec visits.
- The rename touches many strings but no stored data: users keep their settings, styles,
  signatures and recent files; installed apps update in place.
- Interop: multi-line notes with popups, edited/moved callouts, 50 % highlights, the Courier
  typewriter and pasted images join the owner's Acrobat Reader / PDF-XChange checklist (D-33).

## Evidence

Bug reproduction (2026-11-04, `main` 17db96f, Chromium 151, 1280 × 800, `simplePdf(2)`): a
throwaway Playwright script drew each text tool, typed, pressed Esc, clicked away, double-clicked,
dragged and right-clicked, and read the annotation objects through the e2e test hook. Results:
plan §"Comment selection and editing bugs" (B1 – B14).

**Spike S23 (2026-11-05, M7-06): works.** `spikes/s23-popup/popup.test.ts` (real PDFium and our
save tracker in Node, runs with the unit tests; qpdf checks every saved file):

- Files laid out as Acrobat and PDF-XChange write them (a `/Text` note with `/Popup`, a `/Popup`
  with `/Parent`, `/Rect`, `/Open true`) keep the pop-up, its rect and `/Open` when the note is
  edited and moved and saved with Ctrl+S — also in an AES-256 copy.
- PDFium creates a pop-up and links both ways (`EPDFPage_CreateAnnot` subtype 16,
  `EPDFAnnot_SetLinkedAnnot` `/Parent` and `/Popup`), and writes `/Rect` and the flags (NoZoom,
  NoRotate, not Print). `/Open` is a boolean PDFium can neither write nor read: our object layer
  stages it (ADR-007, keyed by the pop-up's `/NM`) and the Work worker reads it from the file. One
  narrow revision; moving and closing rewrite the same object; in AES-256 and RC4-128 files the
  pop-up's `/NM` is encrypted like the rest.
- PDFium draws no pop-up (on screen or for printing), so the page never shows the window twice.
- EmbedPDF alone leaves an orphan pop-up when the note is deleted (also in files from Acrobat);
  ours removes the note's pop-up first.

So D-44's `/Popup` route stands: position and open state are saved as a standard pop-up.
