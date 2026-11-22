# Triya PDF — Architecture & Product Specification (Rev 0.21)

**App:** Triya PDF (formerly PDFTools, D-41) · **URL:** `app.triyapdf.com` and `triya-pdf.openengtools.com` (D-28) · **Platform:** Open Engineering Tools (OET)
**Status:** Approved for implementation · **Last updated:** 22-Nov-2026 (Rev 0.21)
**Companion file:** `CLAUDE.md` (standing rules for the coding agent — read it first)

> This document is the single source of truth. Where code and this document disagree, this document wins until it is deliberately amended. Decisions are numbered (D-xx) so commits, issues and ADRs can reference them.

> **Rev 0.1 amendments** — applied from [ADR-001](docs/adr/001-session-1-clarifications.md) (session-1 clarifications B1–B16) and [ADR-002](docs/adr/002-license-policy-and-heavy-file-targets.md) (license policy, heavy-file targets). Amended passages cite the ADR item.

> **Rev 0.2 amendment** — [ADR-008](docs/adr/008-s7-snap-geometry.md) (owner-approved): a PDFium-free **Snap worker** answers pointer-time snap queries (§3.1, D-10, §7.4).

> **Rev 0.3 amendments** — M0 spike results, owner-approved: [ADR-003](docs/adr/003-s8-csp-wasm-workers-sw.md) (explicit font fallback, font split — §9), [ADR-004](docs/adr/004-s3-two-engines.md) (hosted Render worker, render cancellation, memory policy, COOP/COEP — §3.1, §10.1), [ADR-005](docs/adr/005-s1-incremental-save.md) (narrow-tail Ctrl+S — §4.2, §4.3), [ADR-006](docs/adr/006-s5-search-work-worker.md) (background indexing, context cap — §6), [ADR-007](docs/adr/007-s2-measure-viewport.md) (own object layer, encrypted files — §7.4) and [ADR-009](docs/adr/009-s4-pdf-oxide.md) (PDF Oxide gating, stream tables — §7.6, §7.7).

> **Rev 0.4 amendment** — [ADR-010](docs/adr/010-s6-fluent-icons.md) (owner-approved): Fluent **Regular** icons (Filled for active states) replace the deprecated Color style (D-20, §8).

> **Rev 0.5 amendment** — [ADR-017](docs/adr/017-m4-redaction.md) decisions 3 and 5 (owner-approved 2026-09-29): §7.9 steps 0 and 3 (crossing paths re-cut through PDFium's page-object API; wider sanitize list).

> **Rev 0.11 amendment** — [ADR-023](docs/adr/023-m7-second-beta-review.md) (owner-approved 2026-11-04): **M7 — second beta review** — product name **Triya PDF** (D-41), dark theme with a top-bar toggle (D-42), text comment interaction and marquee selection (D-43), sticky note popup (D-44), pasting an image onto the page (D-45); 50 % highlights and a black Courier typewriter (D-37); Home tab layout with icon-only groups (D-36) (§2, §7.1, §7.3, §8, §10.3, §13 M7, §14).

> **Rev 0.12 amendment** — [ADR-024](docs/adr/024-freetext-text-and-border-colours.md) (owner-approved 2026-11-05): separate **text and border colours** for text boxes and callouts, stored as Acrobat does (`/DA` border, `/DS` text) and drawn by recolouring the text in PDFium's own appearance — the second exception to "no custom appearance streams" (§7.1).

> **Rev 0.14 amendment** — [ADR-026](docs/adr/026-m9-help-page.md) (owner-approved 2026-11-07): **M9 — Help in its own window** with generated screenshots, offline (D-46, §8, §8.2, §9, §13 M9); the ~60 MB install size is a reference, not a limit (§9).

> **Rev 0.17 amendment** — [ADR-028](docs/adr/028-m11-tabs-fonts-select.md) (owner-approved 2026-11-17, all optional items accepted): **M11** — document tabs v2 (D-50), comments selectable in every pointer mode (D-51), a self-hosted font library for text comments with our own appearance streams (D-52), pick up where you left off (D-53), fonts installed on the computer (D-54), split, images to PDF and crop (D-55), resizable panes with edge arrows (D-56) (§2, §3.2, §7.1, §7.8, §8, §8.1, §9, §10.3, §13 M11).

> **Rev 0.18 amendment** — [ADR-028](docs/adr/028-m11-tabs-fonts-select.md) amendment (owner, 2026-11-18): **D-54 withdrawn** — fonts installed on the user's computer are not supported (a cross-compatibility risk); text comments use only the fonts that ship with the app (D-52), and the library may grow later on user request (§2, §7.1, §10.3, §13 M11).

> **Rev 0.21 amendment** — [ADR-031](docs/adr/031-m12-pdf-comparison.md) (owner, 2026-11-22): **M12 — PDF comparison** — a comparison as its own tab with an input window and the Compare ribbon tab (D-58); the PDF overlay drawn as tinted Multiply at the current zoom, with a vector overlay PDF for export and as a beta display mode (D-59); automatic page pairing, check-then-align and manual alignment (D-60); difference detection on drawings (D-61); review across revisions in three live windows (D-62); text comparison (D-63, D-64); Save review, the comparison file and the change register (D-65); the Compare worker, progressive results and corpus acceptance (D-66) (§1.3, §2, §3.1 – §3.3, §7.1, §7.16, §8, §8.1, §10.3, §11 – §15).

> **Rev 0.20 amendment** — [ADR-030](docs/adr/030-comparison-unblocked.md) (owner, 2026-11-22): **comparison is unblocked** — the hold on revision compare is lifted by the owner; it is no longer a parked item or a non-goal and will be planned as its own milestone, as a clean-room build from public techniques (§1.5, §14; CLAUDE.md rule 14).

> **Rev 0.19 amendment** — [ADR-029](docs/adr/029-v1-public-release.md) (owner-approved 2026-11-18): **V1 — version 1.0.0, the first public release** — release domains `app.triyapdf.com` and `triya-pdf.openengtools.com`, deployed from a version tag after approval; the beta keeps deploying `main` (D-28); no home button in the top bar, a repository link in About (D-35); the public tree names no other PDF product as a model and holds no third-party artwork or documents (D-57).

> **Rev 0.16 amendment** — [ADR-027](docs/adr/027-m10-visual-refresh.md) amendment (owner-approved 2026-11-16, all optional items accepted): one-row header, bundled Inter font, accent colour and density choices (D-47), Create Blank PDF (D-49) (§2, §3.2, §7.8, §8, §10.3).

> **Rev 0.15 amendment** — [ADR-027](docs/adr/027-m10-visual-refresh.md) (owner-approved 2026-11-16): **M10 — visual refresh** within the existing layout: design language v2 with motion rules (D-47), an in-app About with open-source licenses and the service worker serving non-app files as files (D-48) (§2, §8, §9, §13 M10).

> **Rev 0.13 amendment** — [ADR-025](docs/adr/025-m8-lossless-json-comments.md) (owner-approved 2026-11-05): **M8 — lossless JSON comment export and import** — JSON v2 carries the comments' own PDF objects and imports them by object copy; JSON v1 still imports; XFDF/FDF deferred (§7.1, §7.6, §13 M8).

> **Rev 0.10 amendment** — [ADR-022](docs/adr/022-m6-spikes-s18-s22.md) (owner-approved 2026-11-02): M6 spike results S18 – S22 — the signature font package and the form plugin's license exception (§3.2); Attach File by direct PDFium calls (§7.1); the modify + annotate gate and `/TU` for form fields (§7.10); the bundled handwriting font (§7.11); the copy route, owner-rights gate and 127-byte limit for passwords (§7.12); our own outline writer for bookmark editing (§7.15).

> **Rev 0.9 amendment** — [ADR-021](docs/adr/021-m6-beta-review.md) (owner-approved 2026-11-01): **M6 — beta review** — top bar, full screen and magnet snapping (D-35), adaptive ribbon with a **Form** tab (D-36), comment styles and defaults (D-37), context menus, page cut/copy/paste, flatten, attach file, snapshot, flags and bookmark editing (D-38), basic AcroForm field creation (D-39), password security and visual signatures (D-40) (§1.5, §2, §3.2, §5, §7.1, §7.10–§7.12, §7.15, §8, §10.2, §10.3, §13 M6, §14).

> **Rev 0.8 amendment** — [ADR-020](docs/adr/020-m5-ocr.md) (owner-approved with amendments 2026-10-03): **OCR** (Rev 1 item 1) — the Tesseract WASM core in an OCR worker, five languages, the text layer by our object layer with a glyphless font (§1.5, §3.1, §3.2, §7.14, §9, §13 M5, §14, D-34).

> **Rev 0.7 amendment** — [ADR-019](docs/adr/019-m4-express-extract-two-steps.md) (owner-approved 2026-10-01): Express Extract in two steps, Find Tables then Save… (§7.7).

> **Rev 0.6 amendment** — [ADR-018](docs/adr/018-m4-comment-transfer.md) (owner-approved 2026-09-29): comment transfer — import from another PDF or our JSON, copy/paste between documents (§7.1, §7.6, §13 M4).

> **Rev 0.4 amendment (M2-16)** — [ADR-013](docs/adr/013-m2-security-forms-print.md) decision 7 (owner-approved 2026-09-26): §10.1's CSP gains `frame-src blob:` for printing the print-ready copy through the browser's PDF viewer.

---

## 1. Product definition

### 1.1 Promise
Free to everyone. No login. No cookies. Private. Works offline after first load. **Documents never leave the device.**

### 1.2 Primary user
Engineers and technical professionals in EPC / mechanical / civil work who review drawings, datasheets, vendor documents and contracts. General users benefit as a side effect; they are not the design target.

### 1.3 Interaction model (D-01)
Document-centric editor in the style of classic desktop PDF editors: PDFs open into **tabs**, every ribbon command acts on the **active document**, multi-file jobs (e.g. merge) open as dialogs. A **comparison** of two documents opens as a tab of its own (D-58, §7.16).

### 1.4 Two reference document profiles (D-02)
All performance work and acceptance tests target both:

| Profile | Shape | What must be fast |
|---|---|---|
| **Contract** | A4, text-heavy, 1,000–2,000+ pages | open, scroll, search, outline navigation, thumbnails |
| **Drawing** | CAD-exported (AutoCAD / SmartPlant / E3D), < 100 MB, A0, dense vectors | pan, deep zoom to 6400 %, crisp tiled re-render, never freezes |

### 1.5 Non-goals for Rev 0
Tablet/phone UI · Safari parity · PDF text/content editing · form design beyond the basic AcroForm fields of §7.10 (signature, button, barcode, image and scripted fields; calculations) · JavaScript in forms · XFA forms · certificate-based signing (visual signatures only, §7.11) · certificate trust validation · any server-side processing · any analytics beyond Cloudflare's server-side request counts (no analytics script; ADR-001 B1).

---

## 2. Decision log (summary)

| ID | Decision |
|---|---|
| D-01 | Document-centric editor, desktop-editor-style layout (ribbon, tabs, left rail + panes, right Properties pane, status bar) |
| D-02 | Two reference document profiles — **Contract** and **Drawing** — drive all performance work and acceptance tests (§1.4) |
| D-03 | **Full annotation round-trip**: standard PDF annotation objects, readable/editable by Acrobat and other desktop editors, and theirs by us |
| D-04 | Save in place via File System Access API (Chromium); download fallback elsewhere |
| D-05 | Crash-recovery autosave to **OPFS** ~5 s after last change; never touches the original file |
| D-06 | Ctrl+S = **incremental** save. "Save Optimized" = full rewrite, warns if signed. Offer optimize when unsigned file's incremental growth > 30 % |
| D-07 | Desktop only. Chrome/Edge primary; Firefox supported; Safari best-effort. Pointer Events throughout |
| D-08 | Search runs **only on Enter/click**, never as-you-type |
| D-09 | **EmbedPDF headless** (engine + plugins) + own React UI. Direct calls to the bundled PDFium WASM functions from the workers are allowed where EmbedPDF does not expose an API (ADR-001 B14) |
| D-10 | **Two PDFium instances in separate workers**: Render worker and Work worker (search/extract/convert/table/snap geometry extraction), plus a PDFium-free **Snap worker** for pointer-time snap queries (ADR-008) |
| D-11 | React + TypeScript + Vite, static SPA, Cloudflare Pages |
| D-12 | **MIT license; permissive-only dependency tree**, enforced in CI by `npm run licenses` (allowlist in `scripts/license-policy.ts`; OFL-1.1 for fonts; MPL-2.0 only for dev-only tooling that is never bundled — ADR-001 B2, ADR-002). BentoPDF is reference-only (AGPL — no code copied) |
| D-13 | Repo private during development; published as MIT at an owner-chosen milestone. No external contributions without a CLA |
| D-14 | Measurement: ratio or calibration scales, units, **vector snapping**, **multiple scale viewports per sheet** |
| D-15 | CRS-ready comment export to Excel |
| D-16 | Local reviewer profile, requested on first markup, stored on device only |
| D-17 | Core-first loading, remaining modules background-precached, visible "✓ Ready offline" |
| D-18 | Updates never reload while documents are open; "Update ready" applies on click / next launch |
| D-19 | Protected PDFs behave like Adobe Reader: open password prompt, permission flags honored, owner password unlocks |
| D-20 | Fluent UI System Icons (MIT), **Regular** style (Filled for active/toggled states; Color style is deprecated upstream — ADR-010); custom engineering icons drawn to match. Light theme default, token-based colors; **dark theme** via the top-bar toggle (D-42, ADR-023) |
| D-21 | Installable PWA, `.pdf` file handler, single window (new files → new tabs) |
| D-22 | Network: zero from app except update checks + opt-in error report; strict CSP; analytics = Cloudflare **server-side** request counts only — no analytics script, no CSP exception (ADR-001 B1) |
| D-23 | Status schemes (presets + custom, export/import) drive stamps and CRS status; image stamps |
| D-24 | Signature panel with **offline integrity check**; trust shown as "not verified" |
| D-25 | Custom print dialog + "Export Print-Ready PDF" (flattened) |
| D-26 | Fill & save AcroForms; XFA → banner |
| D-27 | Acceptance targets in §12 are contractual for typical files; **heavy files are measure-and-report for Rev 0** (ADR-002) |
| D-28 | Release domains `app.triyapdf.com` and `triya-pdf.openengtools.com`, both serving the app from one Worker (`triya-pdf`), deployed only from a tag `vX.Y.Z` matching `package.json` on `main`, after one-click approval (ADR-029); the beta Worker keeps deploying `main` |
| D-29 | Acrobat and desktop-editor shortcut conventions; Windows alternates for browser-reserved keys |
| D-30 | English only at launch, fully i18n-ready; baseline keyboard + screen-reader accessibility |
| D-31 | Redaction in Rev 0 with strict safety rules (§7.9), using EmbedPDF's redaction engine (ADR-001 B8) |
| D-32 | Public beta only after M1–M4 complete; solo internal testing with **public or self-made PDFs only** |
| D-33 | Interop verified against **Acrobat Reader + a second desktop PDF editor**. Bluebeam "expected, not verified" — never claimed publicly until confirmed |
| D-35 | App shell (ADR-021): product mark and name in the banner; **Report an issue on GitHub** opens in a new tab (the OpenEngTools home button was removed for the two release domains, ADR-029) (user navigations, no app request, no document content); **Full screen** of the whole app; status-bar snapping is a magnet toggle |
| D-36 | **Adaptive ribbon** (ADR-021): groups step down from full labels to icons to a group dropdown so every tab fits 1280 px; ribbon tabs gain **Form** |
| D-37 | **Comment styles** (ADR-021): per-tool defaults (red, 10 pt text, 1 pt lines; highlight and sticky note yellow; highlights at 50 % opacity and the typewriter black Courier — ADR-023) and style palettes, stored on the device |
| D-38 | **Comment workflow** (ADR-021): context menus; cut/copy/paste of comments on the page; flatten; Attach File; Snapshot; Locked/Printable/Marked flags and review history; bookmark editing |
| D-39 | **Form field creation** (ADR-021): Text, Check Box, Radio, List, Dropdown via EmbedPDF's form plugin; no JavaScript |
| D-40 | **Password security** (apply/remove, new file, full rewrite, verified, AES-256) and **visual signatures** (draw/type/image as standard annotations; not certificate signing) (ADR-021) |
| D-41 | **Product name Triya PDF** (ADR-023): every user-visible place; the repository, storage names, PWA `id` and internal ids are unchanged; the release domains are in D-28 |
| D-42 | **Dark theme** (ADR-023): light/dark toggle in the top bar, light default, stored on the device, pages stay white; tokens only |
| D-43 | **Text comment interaction** (ADR-023): a new text comment starts editing with its placeholder selected; one click selects and drags; double-click edits; every exit commits the edit; our own text-editing menu; marquee, Ctrl+ and Shift+click selection; a new comment is selected |
| D-44 | **Sticky note popup** (ADR-023): a multi-line popup window on the page (author, date, menu, status, lock, Reply); `/Popup` saved by our object layer if spike S23 passes |
| D-45 | **Paste an image** (ADR-023): an image on the system clipboard becomes an Image Stamp scaled to fit the page; needs annotate |
| D-46 | **Help window** (ADR-026): Help is a separate same-origin page `/help` opened in its own window (Help → Help, F1, "?" buttons); task-oriented topics with screenshots generated from the app, search on Enter, print, deep links; offline; the floating Help dialog is removed |
| D-47 | **Design language v2** (ADR-027): visual refresh inside the D-01 layout: slate neutrals and a blue brand, 6/8/12 px radii, layered elevation, styled native controls, pressed toggles as brand tint plus Filled icon, focus ring with halo; **motion** 120–240 ms on opacity/transform only, never in the document view, off under reduced motion; every pair tested at WCAG AA; Fluent icons kept. Also (Rev 0.16): a **one-row header** (mark, Quick Access, File, tabs, top-bar buttons), a bundled **Inter** UI font, **accent colour** (Blue, Teal, Indigo, Graphite) and **density** (Comfortable, Compact) choices stored on the device |
| D-49 | **Create Blank PDF** (ADR-027): File → New builds a document of a chosen page size, orientation and page count in the Work worker and opens it as an unsaved tab (first save is Save As) |
| D-48 | **About and open-source licenses** (ADR-027): About shows version, build, offline status, Copy version info (no document data), links, the main components, and an in-app searchable list of every runtime package's license (a lazy build-time chunk; the `.txt` stays for download); the service worker returns `index.html` only for app-route navigations |
| D-50 | **Document tabs v2** (ADR-028): the selected tab filled with the accent (plus a light-accent line in dark), a hover card (page 1 thumbnail, full name, where the file came from: browsers expose no folder path, pages, size, modified, status; WCAG 1.4.13), a **+** button that opens a file, Chrome-like drag to reorder with keyboard and menu alternatives, middle-click close, a tab menu and a strip menu (no folder, path, trash or new-window commands) |
| D-51 | **Comments in every pointer mode** (ADR-028): comments are selected in Select, Select Comments, Hand and Select Text; Hand: click selects, a drag on a comment moves it, elsewhere pans; Select Text: on a text markup a drag selects text and a click selects the markup; form fields unchanged; the page menu lists Select and checks the current tool |
| D-52 | **Font library for text comments** (ADR-028): about 26 Google Fonts families (OFL-1.1 / Apache-2.0) shipped with the app from our origin and precached in the background, never fetched from Google; text boxes, typewriters and callouts drawn by **our appearance stream** with a subset embedded font, shaping and per-script fallback, generated in a worker on the route of spike S26; form fields keep the standard fonts |
| D-53 | **Pick up where you left off** (ADR-028): on start, the start screen or last session's files (saved handles); each file's last page, zoom, layout and view rotation kept on the device by file fingerprint |
| D-54 | ~~Fonts installed on this computer~~ — **withdrawn** by the owner 2026-11-18 (ADR-028 amendment, Rev 0.18): a cross-compatibility risk; only the fonts that ship with the app are supported (D-52), and the library may grow later on user request |
| D-55 | **Page tools** (ADR-028): Split (every N pages, ranges, top-level bookmarks) into a chosen folder; Images to PDF (JPG/PNG, new document or inserted pages); Crop (sets `/CropBox` only, one undo step) |
| D-56 | **Panes** (ADR-028): the right Properties pane is resizable like the left pane (splitter, drag and keys); a chevron on each pane's inner edge, always visible, hides or shows it through the existing pane commands |
| D-57 | **Clean public tree** (ADR-029): the repository names no other PDF product as a model for its UI and holds no third-party artwork or documents; interop is described as "Acrobat Reader and other viewers"; a unit test fails if the name returns |
| D-58 | **Comparison as a tab** (ADR-031): two types, **PDF Overlay** (drawings) and **Text Comparison** (documents), started from the **Compare** ribbon tab; a comparison is its own tab in the document tab strip, opening on an input window (Document A old, Document B new, from a dropped or picked file or an open tab; thumbnails, page range, swap, options, named presets on the device); several files per side as one set for the overlay; a document open in a tab and in a comparison is one document; permission flags followed per action and per file |
| D-59 | **PDF overlay** (ADR-031): on screen each revision is rendered at the current zoom without comments, turned to grey, tinted and combined with **Multiply** (old red, new green, the same black; red/blue and magenta/green presets; custom colours with a dark-overlap warning); show/hide, balance, Fade unchanged, Thicken thin lines, Blink; comments of both documents drawn on top, switchable, with Hide check highlights; each file's own default layers. A **vector overlay PDF** from one builder serves export, the comparison file's pages and a **beta** display mode (route by spike S29; image fallback) |
| D-60 | **Pairing and alignment** (ADR-031): pages paired automatically by similarity (picture and text), inserted, removed and reordered sheets found, the table editable; each pair scored **as it is** and only poor matches aligned automatically; the transform is shift, one scale and rotation (never uneven stretching), old drawn in the new revision's frame; method by spike S28 (own geometry aligner and image method; OpenCV only if scans need it, on demand); **manual alignment** on any sheet with 1 – 3 snapped point pairs, numeric fine-tune and Apply to |
| D-61 | **Differences on drawings** (ADR-031): regions added, removed or changed found on the aligned pair in a worker, **text-aware** where the pages have text ("Ø120 → Ø128"); sensitivity and minimum size applied live; ignore zones as named sets; a list with filters, search, next/previous and a checked tick; unchanged sheets and percent changed per sheet; cloud comments made only on request |
| D-62 | **Review across revisions** (ADR-031): layouts Overlay only and Review (overlay, Document A, Document B), one sheet at a time; every comment tool and context menu works in every window; the overlay is reference only (its notes belong to the comparison file, never to Document A or B); aligned sync with a lock and a linked pointer; aligned copy of comments between revisions; close-out tracking of the old revision's comments through the existing comment status |
| D-63 | **Text comparison engine** (ADR-031): inserted, deleted, replaced, moved (once, linked) and changed figures, never formatting alone; word level with engineering values kept whole and percent change for numbers; reading order by column; headers and footers found automatically and reported once, clause renumbering reported once (both experimental, switchable); table rows matched where a table is recognised; OCR at compare time for the comparison only; every script compared |
| D-64 | **Text comparison view** (ADR-031): Document A and Document B side by side, continuous scroll synchronised by content, bands across the gap, the list on the right; marks by colour and shape (deleted red struck, inserted green underlined, replaced amber, moved blue, changed figure framed); the marks belong to the view, not to the documents; the comment and close-out rules of D-62 |
| D-65 | **Saving a comparison** (ADR-031): **Save review** (Ctrl+S) writes only the reviewer's new comments into Document A and Document B by the normal incremental save; **Save comparison…** writes one standard PDF (overlay pages, or Document B's pages with the changes as standard markups) with the other document(s) and the comparison data as attachments, readable in any viewer and reopened here as the live comparison (format by spike S31); Export Document A / B; change register to Excel and CSV; optional summary page |
| D-66 | **Comparison work and acceptance** (ADR-031): a PDFium-free **Compare worker** for alignment, difference detection and text matching, fed by the Work worker; progressive results, viewed items first, with progress and Cancel; done = the corpus acceptance suite in CI (`Synthetic PDF Corpus/`, self-made) plus the owner's hand check; numbers fixed after the spikes (ADR-032) |
| D-34 | **OCR** (Rev 1 item 1, ADR-020): Tesseract WASM core in its own worker, five languages (English precached, the rest on first use), invisible text layer written by our object layer with a glyphless font, pages with text skipped unless asked; needs the modify permission |

---

## 3. System architecture

### 3.1 Process model

```
┌───────────────────────── Main thread (UI only) ──────────────────────────┐
│ React UI: ribbon · tabs · panes · property inspector · status bar        │
│ State: Zustand stores (per-document + app)                               │
│ EmbedPDF headless plugins (viewport, scroll, tiling, annotation, etc.)   │
│ NEVER does parsing, rendering, search, extraction or file encoding.     │
└───────────────┬───────────────────────────────────────┬──────────────────┘
                │ postMessage (typed RPC, cancellable)  │
      ┌─────────▼──────────┐                  ┌─────────▼──────────────────┐
      │  RENDER WORKER     │                  │  WORK WORKER               │
      │  PDFium #1         │                  │  PDFium #2 + PDF Oxide     │
      │  (EmbedPDF engine) │                  │  search · text/structure   │
      │  tiles · thumbs    │                  │  extraction · tables ·     │
      │  annotation edits  │                  │  MD/HTML/DOCX/XLSX build · │
      │  save / flatten    │                  │  snap geometry · sig hash  │
      └────────────────────┘                  └─────────────┬──────────────┘
                │                                           │ transfers per-page snap indexes
                │                             ┌─────────────▼──────────────┐
                │                             │  SNAP WORKER (pure JS,     │
                │                             │  no PDFium): pointer-time  │
                │                             │  snap queries (ADR-008)    │
                │                             └────────────────────────────┘
                │                                        │
                │                             ┌──────────────────────────────┐
                │                             │  OCR WORKER (tesseract.js-   │
                │                             │  core WASM, per job): page   │
                │                             │  rasters in, words out       │
                │                             │  (ADR-020)                   │
                │                             └──────────────────────────────┘
                │                             ┌──────────────────────────────┐
                │                             │  COMPARE WORKER (pure JS,    │
                │                             │  no PDFium): alignment,      │
                │                             │  differences, text matching  │
                │                             │  (ADR-031)                   │
                │                             └──────────────────────────────┘
                └─────────── OPFS (recovery) · IndexedDB (settings, handles, recent) ───────────┘
```

Rules:
- The **Render worker owns the authoritative document** (annotations, form values, save). The Work worker holds a **read-only copy** of the bytes; after edits it is refreshed lazily (on next Work job) with the **original bytes plus the incremental-update tail** produced by the Render worker, never a full re-serialization (ADR-001 B11).
- Every worker call is **cancellable** (AbortSignal → message) and reports **progress** for jobs > 300 ms.
- One set of workers serves all tabs; documents are keyed by `docId`. Idle documents may be evicted from the Work worker under memory pressure.
- The **Render worker** is our own worker module hosting EmbedPDF's `PdfiumNative` executor; the main thread uses EmbedPDF's `PdfEngine` orchestrator over it (ADR-004). Both workers load the **same** self-hosted `pdfium.wasm` URL.
- Render cancellation: tiles are 256 px; stale queued tiles are aborted on every scroll/zoom change; renders expected to take > 100 ms use PDFium's progressive path with cancel between slices. One in-flight tile (~2–50 ms) is not interruptible — the accepted exception to "every call cancellable" (ADR-004).
- Memory: WASM memory only grows. The Work worker is respawned when idle after a job whose peak exceeds ~256 MB and on document eviction (remaining documents reload original bytes + tail); the Render worker is respawned only when no document is open (ADR-004).
- The **Snap worker** holds per-page snap indexes (typed arrays) transferred from the Work worker and answers pointer queries (≤ 1 in flight per animation frame), so snapping never waits for PDFium work (ADR-008).
- The **OCR worker** hosts the Tesseract WASM core behind the typed RPC, started for a job with the chosen languages and terminated when it ends (its memory only grows) or on a mid-page cancel. The Work worker renders the page raster and builds the text-layer objects; the Render worker applies them like transferred comments (§7.14, ADR-020).
- The **Compare worker** (our own code, no PDFium) does the comparison's alignment maths, difference detection and text matching (§7.16, D-66, ADR-031). The Work worker supplies page signatures, analysis rasters without comments and positioned text; the Render worker supplies the screen tiles of both revisions, the old one through the alignment matrix (a direct PDFium call, D-09). Jobs are cancellable, report progress, and work on the viewed sheet first.

### 3.2 Technology stack (all permissive — verify each at install)

| Concern | Choice | License |
|---|---|---|
| Build | Vite + TypeScript (strict) | MIT |
| UI | React 18+ | MIT |
| UI primitives (menus, dialogs, tooltips, tabs) | Radix UI primitives | MIT |
| State | Zustand | MIT |
| PDF engine + viewer plugins | EmbedPDF (`@embedpdf/core`, `@embedpdf/engines`, `@embedpdf/plugin-*`) | MIT (PDFium: Apache-2.0) |
| Extraction / Markdown / HTML / tables | PDF Oxide (`pdf-oxide-wasm`) | MIT/Apache-2.0 |
| Signature CMS parsing | PKI.js + asn1js | BSD-3 |
| XLSX writing (with embedded images) | ExcelJS | MIT |
| DOCX writing | `docx` | MIT |
| Markdown AST | unified / remark (mdast) | MIT |
| Icons | Fluent UI System Icons (`@fluentui/react-icons`) | MIT |
| i18n | i18next + react-i18next | MIT |
| PWA | vite-plugin-pwa (Workbox) | MIT |
| Unit tests | Vitest | MIT |
| E2E / perf | Playwright | Apache-2.0 |
| Fallback fonts (CJK, Arabic, Hebrew, Latin) | `@embedpdf/fonts-*`, **self-hosted** (never EmbedPDF's CDN default) | OFL-1.1 (ADR-002) |
| OCR engine | `tesseract.js-core` (the WASM core only, in our own worker; never tesseract.js's CDN-defaulting worker layer) | Apache-2.0 (Tesseract; Leptonica BSD-2) |
| OCR language data | `@tesseract.js-data/{eng,chi_sim,hin,spa,fra}`, **self-hosted** under `/ocr/` | MIT (packages); data Apache-2.0 |
| Context menus | `@radix-ui/react-context-menu` (ADR-021) | MIT |
| Form field creation · visual signatures | `@embedpdf/plugin-form`, `@embedpdf/plugin-signature` at the pinned EmbedPDF version (ADR-021) | MIT (`plugin-form` declares no license in `package.json`; its `LICENSE` file is MIT — reviewed entry in `scripts/license-exceptions.json`, ADR-022) |
| UI font | Inter (variable WOFF2, Latin subsets), **self-hosted**, core precache; system fonts as fallback (ADR-027) | OFL-1.1 |
| Font library for text comments (D-52) | About 26 Google Fonts families, **self-hosted**, background precache; route and any shaping library (e.g. `harfbuzzjs`, MIT) per spike S26 (ADR-028) | OFL-1.1 / Apache-2.0 |
| Handwriting fonts for typed signatures | `@embedpdf/default-signature-fonts`, **exact pin** (prerelease), self-hosted and precached (ADR-022) | Apache-2.0 AND OFL-1.1 |
| Comparison (D-58 … D-66) | Own code: similarity alignment (RANSAC, least squares, phase correlation), tolerance-based difference detection, Myers' text matching, the vector overlay builder on the object layer. OpenCV.js only if spike S28 shows scans need it, **self-hosted and loaded on demand**, never in the core (ADR-031) | MIT (ours); OpenCV Apache-2.0 |
| License gate | own script `scripts/check-licenses.ts` + `scripts/license-policy.ts` in CI | MIT (ours) |

**Forbidden:** GPL, LGPL-with-static-link concerns, AGPL (incl. PyMuPDF, Ghostscript, CoherentPDF, BentoPDF source), SSPL, "non-commercial" licenses, any runtime CDN dependency. MPL-2.0 is forbidden in anything that ships; it is allowed only for dev-only tooling that npm marks `dev` in the lockfile (e.g. Vite's lightningcss, axe-core) (ADR-002).

### 3.3 Repository layout

```
/src
  /app            shell: AppFrame, Ribbon, TabStrip, LeftRail, Panes, PropertiesPane, StatusBar, StartScreen
  /features       one folder per feature (view, search, annotate, measure, stamps, crs, extract,
                  tables, convert, pages, redact, forms, signatures, print, protect, settings, recovery,
                  compare)
  /engine         typed RPC clients for workers (renderClient.ts, workClient.ts), job/cancel/progress infra
  /workers        render.worker.ts, work.worker.ts, compare.worker.ts (ADR-031)
  /model          domain types: Annotation, StatusScheme, ScaleViewport, TableGrid, ReviewerProfile …
  /storage        opfs.ts, idb.ts, fileAccess.ts (FSA API + fallback)
  /i18n           en.json (+ future locales), format helpers (dates, numbers, units)
  /ui             design tokens, shared components, icon registry
/public           manifest assets, bundled fonts, _headers (CSP)
/functions/api    Cloudflare Pages Function: error-report endpoint
/tests            unit tests (Vitest)
/e2e              Playwright: functional, perf, offline, interop-prep
/corpus           git-ignored, local only: the owner's test PDFs (never committed, D-57)
/Synthetic PDF Corpus  self-made revision pairs with manifests of the expected differences,
                  for the comparison's acceptance tests (rule 13, D-66)
/scripts          tooling (license gate, checks)
/spikes           throwaway M0 spike code — never imported by /src, never shipped
/docs/adr         architecture decision records (one per D-xx change)
```

---

## 4. Files, saving and recovery

### 4.1 Opening (D-04, D-21)
- Sources: Open dialog (`showOpenFilePicker`), drag-and-drop (Explorer, Outlook attachments), OS file handler (`launchQueue`), recent-files list.
- `manifest.file_handlers` registers `application/pdf` / `.pdf`; `launch_handler.client_mode = "focus-existing"`; files from `launchQueue` open as new tabs in the existing window.
- File handles are persisted in IndexedDB for the recent list; permission is re-requested on reopen.
- Firefox/Safari fallback: `<input type=file>`; saving = download.

### 4.2 Save (D-06)
| Command | Behavior |
|---|---|
| **Ctrl+S** | Incremental save (append-only) to the original handle. Target < 1 s for 100 markups on typical files; large files are measure-and-report (the FSA API copies the whole file on write) (ADR-001 B12, ADR-002). |
| **Save As…** | Incremental copy to a new location (full rewrite if user picks "optimized"). |
| **Save Optimized** | Full rewrite (garbage-collected, Flate-compressed streams, no object streams) via `FPDF_SaveAsCopy(FPDF_NO_INCREMENTAL)` through our writer (ADR-005). If signatures exist: modal "This will invalidate N signature(s). Continue?" |
| **Growth prompt** | Track bytes appended since open. If file is unsigned and growth > 30 %, Ctrl+S offers "Save Optimized instead?" (dismissable, remembered per doc). |

Ctrl+S calls PDFium `FPDF_SaveAsCopy(FPDF_INCREMENTAL)` in the Render worker, then keeps only changed objects and writes its own xref section and trailer in the original's form — the **narrow tail** (ADR-005). The result is verified in the Work worker; on mismatch the full PDFium tail is used with our xref (never PDFium's own xref section), and the fallback is logged without document content. Files over ~50 MB show save progress. EmbedPDF's engine API exposes only `saveAsCopy()` (a full rewrite), so the bundled PDFium export is called directly (ADR-001 B14).

### 4.3 Crash recovery (D-05)
- On first edit, store the **original bytes once** in OPFS, keyed by a document fingerprint. Then ~5 s after the last change (debounced), write a recovery snapshot consisting of the **narrow incremental-update tail** (bytes appended since the original; ADR-005) **+ UI state** (tab order, page, zoom) — never a full re-serialization (ADR-001 B11).
- Never writes to the original file. Cleared on successful save or explicit discard.
- On launch, if snapshots exist: "Recover unsaved changes?" per document.
- Window close / Ctrl+W with unsaved changes → `beforeunload` confirmation.

---

## 5. Rendering & navigation

- EmbedPDF virtualized scroll + **tiled rendering**; zoom shows an immediate scaled preview, sharp tiles within 0.5 s; zoom range 1 %–6400 %.
- Tile cache bounded per document (LRU); off-screen documents drop tiles first.
- Thumbnails and text layers load lazily in viewport order.
- View modes: single, continuous, facing, continuous facing; rotate view; fit page / width / visible / actual size; loupe and pan-and-zoom window are **nice-to-have** within Rev 0.
- Left rail panes: Bookmarks, Thumbnails, Comments, Attachments, Signatures, Search results, Layers (display toggle only).
- Comments pane: one toolbar row (options menu with sort, group and filters; Find runs on Enter), cards grouped by page with replies, status and lock, selection mirrored with the page, context menu (ADR-021).
- Status bar: page nav, zoom, view mode, **snapping** (magnet toggle, ADR-021), "✓ Ready offline" / "Preparing offline… n %", "Update ready".

---

## 6. Search (D-08)

- **Ctrl+F**: quick find bar (current doc), runs on Enter.
- **Ctrl+Shift+F**: Advanced Search pane — results grouped by page with context; options: match case, whole word, wildcards/regex; scope: current doc / all open tabs; include comments, annotations, bookmarks.
- Runs in the **Work worker** only. Results stream in while the rest of the document is being indexed. A new search cancels the previous one.
- Text index per document built in the Work worker **in the background after open (idle priority, viewport order, backs off while the user scrolls/zooms)** and on demand by searches; cached for the session. No persistent text cache (ADR-006).
- At most **5,000 hits are streamed with context** per search; beyond that, per-page counts only, with context fetched on demand as the virtualized results list scrolls. The hit count stays exact (ADR-006).
- Target: first hits < 1 s, full 2,000-page search < 15 s, **no main-thread task > 100 ms at any point**.

---

## 7. Features

### 7.1 Annotation (D-03)
Types: **every annotation type/tool supported by EmbedPDF** (ADR-001 B7). No custom appearance-stream generation in Rev 0, with three exceptions: Attach File's paperclip, the text colour of text boxes and callouts (both below), and text comments in a library font (D-52, below). Mapping from the required set (EmbedPDF v2.15.1 tool ids):

| Required | EmbedPDF |
|---|---|
| highlight · underline · strikeout · squiggly | `highlight` · `underline` · `strikeout` · `squiggly` |
| sticky note | `textComment` |
| text box / typewriter · callout | `freeText` · `freeTextCallout` |
| line · arrow · polyline · polygon | `line` · `lineArrow` · `polyline` · `polygon` |
| rectangle · oval | `square` · `circle` |
| **cloud** | `square` / `circle` / `polygon` with `cloudyBorderIntensity` |
| ink / pencil | `ink` (+ `inkHighlighter`) |
| stamp | `stamp` |
| measurement types | not provided by EmbedPDF — line/polyline/polygon + Measure dictionaries per §7.4 / M0-S2 |
| (additional) | `insertText` / `replaceText` (Caret), `link`; Redact via §7.9 |

- Written as **standard PDF annotation dictionaries with appearance streams** (generated by EmbedPDF/PDFium) so any viewer renders them.
- Replies (`IRT`), review state/status, author (`T`), dates, subject, colors, opacity, line styles all round-trip.
- Properties pane edits the selected annotation(s); style copy/apply.
- Undo/redo per document, unlimited within a session.
- Comments pane: list, filter (author, status, type, page), sort, reply, set status, jump-to.
- **Comment transfer:** import comments from another PDF (e.g. an earlier revision; page range, filters, page mapping, duplicates skipped by `/NM`) or from our JSON export (lossless from v2, which carries the comments' own PDF objects, ADR-025), and copy/paste comments between documents; imported comments are standard annotation objects saved by the next Ctrl+S (ADR-018). In a comparison, a comment copied or pasted to the other revision lands at the **matching spot** through the alignment (D-62, §7.16).
- **Styles** (D-37, ADR-021): every tool has default properties (red `#FF0000`, 10 pt text, 1 pt lines and borders; highlight and sticky note yellow; Highlight, Highlight Area and Free Highlight at 50 % opacity; the typewriter black Courier — ADR-023), editable in the Properties pane while the tool is active; a **style palette** per tool (presets incl. cloudy variants, the user's own styles, Comment Styles Palette manager, export/import `.pdftools-styles.json`). Styles are property sets applied through the normal property path; appearances stay PDFium's.
- **Text comments** (D-43, ADR-023): a new text box, typewriter or callout is selected and edits with "Type here" selected; one click selects it (box, text or callout line) and a drag moves it; double-click (Enter / F2) edits; Esc, a click elsewhere, a tool or tab change, Ctrl+S and closing all commit the edit as one undo step; right-click while editing opens our text menu (Undo, Redo, Cut, Copy, Paste, Delete, Select All, Text Style for the whole comment, Properties); a callout can be drawn with one drag. **Selection:** marquee with Select Comments (and Select on empty space), Ctrl+ / Shift+click toggle, a newly drawn comment is selected.
- **Sticky note popup** (D-44, ADR-023): a popup window on the page for `/Text` notes — header (author, date), multi-line text, menu, status, lock, Reply; draggable and resizable; opened on creation and double-click. Its position and open state are saved as a standard `/Popup` by our object layer only if spike S23 passes.
- **Paste an image** (D-45, ADR-023): Ctrl+V or the page menu's Paste with an image on the system clipboard places an Image Stamp, scaled to fit inside the page (90 %, aspect kept, never enlarged); one undo step; needs annotate.
- **Comments in every pointer mode** (D-51, ADR-028): a comment is selected by clicking in Select, Select Comments, Hand and Select Text. Hand: a drag that starts on a comment moves it, elsewhere it pans. Select Text: on a text markup a drag selects the text under it and a click selects the markup; on other comments a drag moves them. Form fields are filled in every mode except Select Fields. Locked comments and documents without annotate permission select but do not move.
- **Fonts** (D-52, ADR-028): text boxes, typewriters and callouts use the three standard families or the self-hosted font library (§3.2). With a library font the comment stays a standard FreeText (`/Contents`, `/DA`, `/DS`, `/RC` naming the family) and its appearance stream is ours: the used glyphs embedded as a subset (CIDFontType2, Identity-H, ToUnicode), shaped for complex scripts, missing characters falling back by script (Noto Sans Devanagari, Noto Sans SC), generated in a worker and re-applied whenever EmbedPDF regenerates the appearance — the third exception to "no custom appearance streams". Another viewer that edits the comment without the font redraws it in its own. Only the fonts that ship with the app are offered; fonts installed on the user's computer are not (D-54 withdrawn).
- **Text and border colours** (ADR-024): a text box and a callout have a Text color and a Border color (Properties pane, tool defaults, Comment Styles). The border colour is `/DA`'s `rg`, the text colour `/DS` `color:` (and EmbedPDF's `/TextColor`), as Acrobat and other desktop editors store them; another viewer's `/DS` colour is read back. PDFium draws the text in `/DA`'s colour, so after each write the Render worker changes only the text colour operator of PDFium's own appearance and sets it back with `EPDFAnnot_SetAppearanceFromPage` — the second exception to "no custom appearance streams", after Attach File. If the appearance doesn't have the expected shape, PDFium's is kept and a diagnostics event is recorded (spike S25).
- **Context menus and clipboard** (D-38, ADR-021): right-click (or Shift+F10 / Menu key) on a comment on the page, a comment card, the page background, bookmarks and thumbnails; every item is a command-table command. Cut/Copy/Paste of comments on the page (Ctrl+X/C/V; Paste from the page menu lands at the pointer).
- **Flatten** selected or all comments (page range) into page content in the Render worker; one undo step; capability **modify**; marks the document "optimize recommended".
- **Attach File**: a standard `/FileAttachment` annotation with an embedded file and a paperclip appearance drawn by us — the first exception to "no custom appearance streams" (the second: text colours, ADR-024) — created by **direct PDFium calls in the Render worker** (`FPDFAnnot_AddFileAttachment`, `FPDFAttachment_SetFile`, `FPDFAnnot_SetAP`, …), not by our object layer; move / resize use their own Render call (`FPDFAnnot_SetRect`), delete uses the engine; saved in the narrow tail (spike S22, ADR-022 decision 1).
- **Snapshot**: a rectangle rendered by the Render worker and written to the system clipboard as PNG; needs **copy**.
- **Flags and marks**: Locked, Printable, Read only, Marked (review state model) and review history in the Properties pane (a property grid: General, Style, Text) and the context menu.
- **Auto-numbering**: each markup gets a sequence number shown in the comments pane and optionally on-page; used by the CRS export.

### 7.2 Reviewer profile (D-16)
First markup triggers a dialog: name, initials, discipline, company (optional). Stored in IndexedDB. Editable in Settings. Fills annotation author, stamps, CRS columns.

### 7.3 Status schemes & stamps (D-23)
- `StatusScheme = { id, name, codes: [{ code, label, color }] }`. Presets (e.g. 1/2/3/4; A/B/C/D; Approved / Approved as Noted / Revise & Resubmit / Rejected / For Information).
- Custom schemes; export/import as `.pdftools-scheme.json`.
- Dynamic stamps generated from active scheme: code, label, reviewer, date, doc number/rev. Written as Stamp annotations with appearance streams.
- Image stamps: import PNG/JPG/PDF page, or paste an image from the clipboard (D-45).

### 7.4 Measurement (D-14)
- Tools: distance, perimeter (polyline), area (polygon); calibration tool.
- Scale by ratio (1:50) or calibration (pick two points, enter real length). Units: mm, m, in, ft-in; precision setting.
- **Scale viewports**: user draws regions with their own scale (e.g. Detail A 1:5). Measurement uses the viewport containing it; outside any viewport → page default scale; no scale → shows "uncalibrated"; spanning viewports → flagged warning.
- Persist using standard PDF measurement structures (Measure / Viewport dictionaries). EmbedPDF/PDFium cannot write or read these, so a narrow **own PDF object layer** (reader, serializer, patch writer) in the Render worker adds `/Measure`, `/IT`, `/Cap`, `/Contents` and page `/VP`, merged into the single Ctrl+S revision (ADR-007). Encrypted files: the Standard security handler is implemented in M3; until then, measurements in encrypted PDFs are shown but not saved, with a message (ADR-007). Label strategy and viewport semantics for viewer-made files follow the owner's interop run (ADR-007 decisions 2–3).
- **Snapping** to vector geometry (endpoints, midpoints, intersections, nearest-on-segment). Geometry for each visible page is extracted whole in the Work worker (page parsing dominates, so region extraction does not pay off — ADR-008), spatially indexed, cached per page. Queries are answered by the Snap worker (§3.1, ADR-008).

### 7.5 CRS export (D-15)
Excel (ExcelJS). Header block: document number, revision, title, reviewer, date, status scheme. Columns: No. · Page · Location/Type · Reviewer · Discipline · Comment · Replies · Status · Snapshot · Vendor Response (blank) · Final Status (blank). Optional snapshot thumbnail of each markup region embedded per row. Also CSV (no images).

### 7.6 Extraction & conversion
| Output | Engine | Label |
|---|---|---|
| Text (plain) | PDF Oxide | — |
| Images | PDF Oxide / PDFium | — |
| Markdown | PDF Oxide | — |
| HTML | PDF Oxide | — |
| Word (.docx) | PDF → Markdown → mdast → `docx` | **Beta** |
| Annotations | own serializer → CSV / XLSX / JSON (JSON v2 carries the comments' PDF objects and imports losslessly, §7.1, ADR-025) | — |

PDF Oxide runs in the Work worker, lazy-loaded (non-core) from a self-hosted WASM URL and warmed up in the background after init. **Every Oxide call is gated by PDFium's permission check** — Oxide itself ignores permission flags (D-19, ADR-009). Search keeps PDFium text extraction (§6).

### 7.7 Table extraction (beta)
- Text-layer PDFs only (scanned → message "requires OCR — planned").
- Detection candidates: (1) **lattice** — ruling lines from vector paths (PDF Oxide's table output is exact here); (2) **stream** — our own text alignment/whitespace-column detector (PDF Oxide does not detect unruled tables — ADR-009). Merge/score candidates. Merged header cells come from the grid model, not the engine.
- **Express Extract**: Find Tables → auto-detect selected pages → Save… as XLSX/CSV, no review (two clicks: the save picker needs a fresh click, and nothing is created when no table is found — [ADR-019](docs/adr/019-m4-express-extract-two-steps.md)).
- **Review & Extract**: proposed outlines as overlays → accept / adjust grid (drag/add/remove row & column dividers, mark header rows, merged cells) / draw manually → preview → export. Saved **templates** apply the same grid to other pages.
- Test fixture of record: a public pipe dimension chart style table (side-by-side tables, merged headers, multi-row cells, dual units).

### 7.8 Page operations
Rotate, delete, insert (blank / from file), extract to new PDF, merge files, reorder via thumbnails drag. **Split, Images to PDF and Crop** (D-55, ADR-028): Organize → Split (every N pages, page ranges, top-level bookmarks) into a folder the user picks; Images to PDF (open or drop JPG/PNG, or Insert → From Image), one image per page; Crop sets only `/CropBox` for a page range as one undo step (Remove Crop restores it). **Create Blank PDF** (File → New, D-49): a new document of a chosen page size, orientation and page count, built in the Work worker and opened as an unsaved tab. Page ops that rewrite content streams mark the doc as "optimize recommended".

### 7.9 Redaction (D-31)
0. Engine: EmbedPDF redaction (`plugin-redaction`; engine `redactTextInRects` / `applyRedaction` / `applyAllRedactions`) — no custom content-stream rewriter; the geometry of path objects crossing a redacted rectangle may be re-cut through PDFium's page-object API (ADR-001 B8, ADR-017 decision 3). Steps 2–5 wrap it.
1. Mark (text selection or area) → pending list → review → **Apply**.
2. Apply **always** produces a **new file via Save As** with a **full rewrite**; never incremental; never overwrites the original by default.
3. Sanitize: document Info + XMP metadata, embedded page thumbnails, structure tree (tagging), JavaScript, embedded files and private application data; annotations / form values / bookmarks / links intersecting redacted areas (ADR-017 decision 5).
4. Signed document → warn that signatures will be invalidated.
5. **Post-redaction verification** (by location — ADR-001 B3): reopen the output in the Work worker and confirm that **no text, image pixels or vector content remain inside any redacted rectangle**; additionally search for each redacted string that does not also occur outside the redacted areas. Success is reported only if both checks pass; otherwise fail loudly.

### 7.10 Forms (D-26)
Fill & save AcroForm text, checkbox, radio, combo, list; tab order; reset form. Saved incrementally. XFA → banner "XFA forms are not supported."

**Create fields (D-39, ADR-021):** Form tab — Select Fields, Text, Check Box, Radio, List, Dropdown, Highlight Fields, Reset Form — on `@embedpdf/plugin-form`; field properties (name, tooltip, required, read-only, default, options, export values, font, colors) in the Properties pane; tab order editable; capability **modify + annotate** for creating, renaming, sharing, changing and deleting fields; the tooltip (`/TU`) is written by our object layer and radio widgets get readable export values (`Choice1`, `Choice2`, …), which the plugin does not write; saved incrementally (narrow tail) (spike S19, ADR-022 decision 4). No JavaScript is written or run; signature, button, barcode, image and scripted date fields are later.

### 7.11 Signatures (D-24)
Signature pane: signer, time, reason, location, covered revision. Integrity: hash of byte ranges vs CMS message digest (PKI.js) → "Unchanged since signing" / "Modified after signing". Trust: always "Not verified (offline)". Never contacts OCSP/CRL.

**Sign Document (D-40, ADR-021):** visual signatures and initials — drawn, typed or an image — via `@embedpdf/plugin-signature`, placed as standard Stamp/Ink annotations (optionally flattened); the typed pad uses a handwriting font from `@embedpdf/default-signature-fonts` loaded from our own origin (spike S20, ADR-022 decision 3); saved signatures stay on this device. The UI states it is **not** a certificate-based digital signature (that remains Rev 1 item 3).

### 7.12 Protected PDFs (D-19)
Open-password prompt; read permission flags; disable restricted commands with an explanatory banner; owner password grants full access. Never bypass restrictions.

**Password Security (D-40, ADR-021):** set an open and/or permissions password with permission tick boxes, or **Remove Security** with full rights; engine `setDocumentEncryption` / `removeEncryption`, AES-256 only (`/V 5 /R 6`). They run on a **copy**, never the open document (spike S18, ADR-022 decision 2): full rewrite of the current state → open that copy in the Render worker (with the owner password when removing) → encrypt or decrypt → save the copy without the incremental flag → close it. Remove Security and changing passwords need **owner rights** (unencrypted, opened with the owner password, or owner-unlocked). Passwords are limited to **127 UTF-8 bytes**. Output is always a **new file via Save As with a full rewrite** (never Ctrl+S, never the original by default), reopened and verified in the Work worker (passwords, permissions, page and annotation counts) before success; signed documents warn first. Passwords are never stored.

### 7.13 Print (D-25)
Own dialog: range (all, current page, current view, selected area, custom), fit / actual / custom %, markups on / off / only, quality (standard / high DPI for drawings), orientation auto. Renders pages in the Work worker (refreshed to the current revision first, annotations included) at the chosen DPI into a print iframe. **Export Print-Ready PDF**: copy with annotations flattened (vector-quality elsewhere). For large/high-DPI jobs, printing the flattened print-ready PDF through the browser's built-in PDF viewer is acceptable; the required narrowly scoped `frame-src blob:` CSP addition is designed in M2 (ADR-001 B13).

### 7.14 OCR (D-34)
Convert → **Recognize Text (OCR)** (ADR-020). Dialog: pages (all / current / selected / custom), **languages** as tick boxes (English, Chinese Simplified, Hindi, Spanish, French — several at once; English precached, the others downloaded on first use and kept for offline use, said in the dialog), and **"Also recognize pages that already have text"** (off by default: such pages are skipped and counted). The Work worker renders each page as displayed (8-bit gray, 300 dpi, the document as it is now); the OCR worker (Tesseract LSTM, SIMD build) returns words with boxes and lines with baselines; the Work worker writes the **text layer** with our object layer: per page one invisible text stream (render mode 3) appended to `/Contents` behind a `q`/`Q` wrap of the untouched original streams, words on their baselines in any direction and stretched to their boxes, one embedded **glyphless font** per document (Tesseract's `pdf.ttf`: CIDFontType2, Identity-H, identity ToUnicode) so every script round-trips in Acrobat, other desktop editors and here; a layer this app wrote before is replaced, other text stays. Applied by the Render worker as one undo step (the comment-transfer route, capability **modify**, rule 9); Ctrl+S stays a narrow verified revision. Progress per page with Cancel (between pages, or the worker terminated mid-page). Search, selection, copy, exports and table detection then see the text like any text page (§6, §7.6, §7.7). Limits: BMP characters; no orientation detection or deskew; a foreign OCR layer is never removed.

### 7.15 Bookmark editing (D-38)
New (from the current view), rename (F2), delete / delete but keep children / delete only children, set destination, cut/copy/paste within the document, drag to reorder and nest, expand/collapse all — from the Bookmarks pane toolbar and context menu. Edits go through **our own outline writer** (ADR-022 decision 5, route B; the engine's `setBookmarks` loses colour, style and open state and truncates outlines with actions it cannot write): the Work worker reads the outline, applies the edit and writes fresh outline objects keeping every key of every item; the Render worker applies them with the reopen route (`applyObjects`) as one undo step each (capability **modify**); Ctrl+S saves them in the narrow tail with the catalog and outline root marked dirty; encrypted files use the object layer's string encryption (ADR-021, spike S21).

### 7.16 Comparison (D-58 … D-66)
Two comparison types (ADR-031, plan `docs/plan/M12.md`): **PDF Overlay** for drawings and **Text Comparison** for documents. **Document A** is the old revision, **Document B** the new one. A clean-room build from public techniques (rule 14). No network, no AI.

- **Starting** (D-58): Compare → PDF Overlay or Text Comparison, or Compare with… on a document tab, opens a **comparison tab** on its input window: each side takes a dropped file, a picked file or an open tab (the overlay also several files as one set), with thumbnails, a page range and a swap button; a collapsed Options section and named presets (colours, ignore zones, sensitivity, header handling) stored on the device. Compare runs with the defaults and turns the same tab into the result; the inputs can be revisited. A document open in its own tab and in a comparison is one document (one undo history, one unsaved mark).
- **Protected files** (D-58, rule 9): viewing a comparison is viewing; commenting needs that file's commenting permission; copying text from the list, Export Overlay…, the change register and Save comparison… need the content-copying permission of both files; the permissions password unlocks; a blocked action names the file and the reason.
- **Pairing** (D-60): pages are paired by a similarity signature (a coarse picture and a text fingerprint), keeping order where possible and finding inserted, removed and reordered sheets; the pairing table is editable.
- **Alignment** (D-60): each pair is scored as it is, and only a poor match is aligned automatically, by a **similarity transform** (shift, one scale, rotation; `/Rotate` and page boxes folded in) that draws the old revision in the new revision's frame. Status per sheet: as is, auto-aligned (values shown), low confidence. Manual alignment on any sheet: 1 – 3 point pairs picked with snapping and a magnifier, numeric fine-tune (offset, scale %, rotation °, nudge), applied to this sheet, all sheets or all low-confidence sheets. The method is set by spike S28.
- **Overlay display** (D-59): both revisions are rendered at the **current zoom**, without comments, turned to grey, tinted (old red, new green by default) and combined with **Multiply**, so what is the same is black and thin lines stay as sharp as in the normal view at any zoom. A floating bar: show/hide old and new, balance, Fade unchanged, Thicken thin lines, Blink. Comments of both documents are drawn on top in their own colours, switchable per document; **Hide check highlights** hides Highlight comments and anything under 70 % opacity. Each file uses its own default layer visibility, with layer switches per document.
- **Vector overlay** (D-59, beta as a display mode): one builder writes a standard PDF in which each source page is a tinted form and the two are combined with the PDF Multiply blend mode; used for Export Overlay…, for the comparison file's pages and as a display mode. Route by spike S29; fallback a high-resolution image PDF.
- **Differences on drawings** (D-61): on the aligned pair, ink of one revision with no ink of the other within a tolerance forms regions (added, removed, changed); positioned text is compared too, so an entry reads "Ø120 → Ø128" and is labelled text, geometry or both. Sensitivity and minimum size apply live; ignore zones (rectangles, one sheet or all) are saved as named sets. The list has filters, search, next/previous and a checked tick; the sheet list shows unchanged sheets and percent changed. **Make cloud comments** creates real cloud comments on the new revision only on request.
- **Review across revisions** (D-62): layouts **Overlay only** and **Review** (overlay left, Document A top right, Document B bottom right; splitters; one sheet at a time). Every comment tool, the Properties pane and every context menu work in every window. What is drawn on the overlay is a note of the comparison and is never written into Document A or B. The windows stay on the same spot through the alignment (lock on by default) with a linked pointer. Copy to new revision (and back) and paste land at the matching spot. A close-out list tracks every comment of the old revision (Addressed, Carried over, Changed differently) with a check highlight, through the existing comment status, so the states reach the CRS export (§7.5).
- **Text comparison** (D-63): text in reading order by column, normalised (line-end hyphens, ligatures, spacing), matched paragraph by paragraph and then word by word, with **engineering values kept whole** (a number with its separators and unit, a tag, a date, a document number) and the percent change of numbers. Reported: inserted, deleted, replaced, **moved** (once, linked, inner edits shown) and changed figures (compared as pictures); never formatting alone. Headers and footers are found automatically, left out and a changed one reported once; clause renumbering is reported once and consistent cross-references are not flagged (both experimental, each with a switch). Where a table is recognised (§7.7) rows are matched as rows. Scanned pages are read by OCR at compare time for the comparison only (§7.14), labelled "from OCR", with typical confusions grouped as "possible OCR error". Every script is compared; "limited support" is shown where text cannot be read reliably. One file per side.
- **Text comparison view** (D-64): Document A and Document B side by side in continuous scroll, synchronised by content, with bands across the gap and the list on the right. Marks by colour and shape: deleted red with a strike-through, inserted green with an underline, replaced amber on both sides, moved blue with a band, changed figure a blue frame. The marks belong to the view; they are not comments. The comment and close-out rules of the overlay apply.
- **Saving** (D-65): **Save review** (Ctrl+S in a comparison) writes only the reviewer's new comments into Document A and Document B by the normal incremental save (§4.2), each file with its own unsaved mark. **Save comparison…** writes the **comparison file**, one standard PDF: for the overlay, the vector overlay as pages with Document A and B attached unchanged; for text, Document B's pages with the changes as standard highlights, strike-outs and notes holding the old text, with Document A attached; in both, the comparison data (pairing, alignment, options, ignore zones, ticks, close-out states) as one JSON attachment, the file tagged through `/PieceInfo`. Any viewer opens it; this app reopens it as the live comparison, saves review comments into the copies inside and exports Document A / B. The Save dialog states that the file contains both documents. Format by spike S31, kept as a versioned spec.
- **Outputs** (D-65): a **change register** to Excel and CSV (number, sheet or page, kind, old, new, percent, checked; follows the list's filters) and an optional summary page (files, date, counts, legend, settings).
- **Work and progress** (D-66): the Compare worker (§3.1) computes; results arrive sheet by sheet, the viewed one first, with progress and Cancel.
- **Not in scope:** more than two revisions at once; non-PDF inputs; accepting, rejecting or merging changes; several files per side in a text comparison; a curtain slider; an inline redline pane; a title-block reader; unit conversion; formatting-only changes; comparing comments as content; a folder picker.

---

## 8. UI specification

- Ribbon tabs (Rev 0) — this list is authoritative, and out-of-scope commands are omitted rather than shown disabled (ADR-001 B6): **File** (backstage: open, recent, save, save as, save optimized, print, properties, settings, about (version, open-source licenses, D-48)/privacy), **Home**, **View**, **Comment**, **Form** (ADR-021), **Measure**, **Organize**, **Convert**, **Compare** (PDF overlay, text comparison, ADR-031), **Protect** (redact, security info, signatures), **Help**.
- **Top bar** (D-35, ADR-021): **one row** (D-47) holding the product mark and "Triya PDF" at the left (D-41), Quick Access, File and the ribbon tabs; a **light/dark theme** toggle (D-42), **OpenEngTools** (standard Home icon), **Report an issue** (GitHub, new tab, version/browser/OS only) and **Full screen** (the whole app; Esc leaves) at the right.
- Large (32 px) and small (16/20 px) buttons, groups with labels, split buttons and dropdowns, collapsible ribbon, keyboard access (Alt key tips — nice-to-have).
- **Adaptive ribbon** (D-36, ADR-021): when a tab does not fit, groups step down by priority — full labels → icons with short labels → icon-only grid → one group button opening a dropdown — so every tab fits 1280 px and every command keeps its accessible name and keyboard path. Home's rotate buttons rotate the **view**; Organize rotates pages.
- Icons: Fluent System Icons **Regular** style (Filled for active/toggled states), colored via design tokens (`currentColor`); small buttons use 20 px glyphs, large (32 px) buttons use the native 32 px glyph or the 28/24 px glyph scaled up. The 23 missing icons listed in [ADR-010](docs/adr/010-s6-fluent-icons.md) and [S6-icon-map.md](docs/plan/S6-icon-map.md) (incl. cloud, calibrate, scale viewport, CRS export, stamp; express extract uses Fluent `TableLightning`) are drawn in the same grid/line style in `/src/ui/icons`. Fluent icons are imported per icon by path, via one registry (ADR-010).
- Design tokens (color, spacing, type, radius, elevation, **motion**) as CSS variables (design language v2, D-47: motion only on opacity/transform, never in the document view, off under `prefers-reduced-motion`); light theme default; **dark theme** through the top-bar toggle (D-42, ADR-023), stored on the device; PDF pages stay white in both; no literal colours outside the tokens.
- **Panes** (D-56, ADR-028): the left panes and the right Properties pane are both resizable (window splitter, drag and keys, 160–480 px) and each has an always-visible chevron on its inner edge to hide or show it.
- **Document tabs** (D-50, ADR-028): the selected tab is filled with the accent; a hover card shows the page 1 thumbnail, full name, where the file came from (no folder path: browsers do not expose it), pages, size, modified time and status; a **+** button opens a file; tabs reorder by dragging (Chrome-like), Ctrl+Shift+Left/Right or the tab menu; middle-click closes; a tab menu (Save, Save As, Close, Close Others, Close to the Right, Close All, Reopen Closed Tab, Move Left/Right, Sort by Name, Copy File Name, Rename File where the browser can rename in place, Document Properties) and a strip menu (Open, Create Blank PDF, Reopen Closed Tab, Close All).
- **Comparison tab** (D-58, ADR-031): a comparison is a tab in the document tab strip with its own icon; it shows the input window, then the result (overlay: Overlay only or Review with splitters; text: side by side), with the differences list in the right pane (§7.16).
- Layout minimum 1280 px wide.
- Start screen: open file, drop zone, recent files (clearable).
- **Do not copy other PDF products' artwork or proprietary visual assets.** Layout conventions only.

### 8.1 Keyboard (D-29)
Ctrl+O/S/P, Ctrl+Shift+S, Ctrl+Z/Y, Ctrl+F, Ctrl+Shift+F, Ctrl+0/1/2 (fit page / actual / fit width), Ctrl+= / Ctrl+-, H (hand), V (select), single-letter tool keys, **Ctrl+F4** close tab, **Ctrl+PageUp/PageDown** switch tabs, Esc cancels tool. **F1** opens Help (ADR-026). **Ctrl+Shift+Left/Right** moves the focused document tab and **Reopen Closed Tab** is on the tab menu (D-50). In a comparison: next and previous difference, and a key held for Blink (ADR-031; the keys are set in M12). Help → printable shortcut sheet. Ctrl+F4 and Ctrl+PageUp/PageDown are reserved by Chrome in a normal tab (may work in the installed PWA window); alternates are defined in M1 (ADR-001 B5).

### 8.2 i18n & accessibility (D-30)
No user-visible string literals in components — all via i18n keys in `en.json` (Help's text in `help.en.json`, ADR-026). Locale-aware dates/numbers/units via `Intl`. Layouts tolerate +40 % label length. Every control keyboard-reachable with visible focus and an accessible name.

---

## 9. Offline, PWA & updates (D-17, D-18)

- Service worker precaches the **core** (shell, UI, Render worker, PDFium WASM, base fonts) first; after first render, background-precaches the rest (Work worker, PDF Oxide WASM, CJK/extra fonts, ExcelJS, docx, the OCR worker with its WASM and the English data, the font library for text comments, D-52). Status bar shows progress then "✓ Ready offline". **On demand** (ADR-020): the other OCR languages are never precached (the install budget) but cached by the service worker when first fetched.
- The service worker answers navigations to app routes with `index.html` (and `/help` with `help.html`); other same-origin files, such as the third-party notices, are served as themselves, from the cache when offline (D-48).
- A feature used before its module is cached triggers a priority fetch with a spinner.
- Fonts bundled; **EmbedPDF CDN font fallback disabled** (`fontFallback: null` or local config with absolute same-origin URLs — never `undefined`, ADR-003). Fallback fonts: Regular weight only; Latin, Arabic and Hebrew in core, SC/TC/JP/KR in the background precache (ADR-003). No runtime CDN anything. EmbedPDF defaults both `pdfium.wasm` and `@embedpdf/fonts-*` to `cdn.jsdelivr.net`; both must be overridden with self-hosted copies (verified in M0-S8).
- Updates: new SW installs in the background; app shows "Update ready" and activates only on user click or next launch; never while documents are open.
- Install size is measured and reported per module in CI. About **60 MB is a reference, not a limit** (owner, 2026-11-07, ADR-026): the report warns above it and does not fail. The 9 MB core precache budget stays a limit.

---

## 10. Privacy, security & network (D-22)

### 10.1 CSP (Cloudflare Pages `_headers`)
```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
connect-src 'self'; img-src 'self' blob: data:; font-src 'self'; style-src 'self' 'unsafe-inline';
frame-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
```
`frame-src blob:` exists only for printing the print-ready copy through the browser's PDF viewer (ADR-013 decision 7): one helper frames a `blob:` of type `application/pdf` made from our own flattened copy; every other frame source stays blocked.
Additional headers: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (hardening; enables whole-tab memory measurement — ADR-004).

Analytics uses **Cloudflare's server-side request analytics only**. No beacon script is injected (Web Analytics automatic setup stays off), so the CSP above needs **no exception** (ADR-001 B1).

### 10.2 Error report (opt-in)
- Help → "Send Error Report" (also offered on caught errors).
- Dialog shows the **exact payload** (editable description + app version, browser, OS, error stack, feature/module, anonymous session id). User reviews → Submit.
- POST to same-origin `/api/report` (Cloudflare Pages Function) → store in D1 → email notification to the developer. Rate-limited per IP.
- **Hard rule: never include document content** — no page text, file names, paths, annotation text or screenshots.
- The top bar's **Report an issue** opens the repository's GitHub new-issue page in a new tab, prefilled with app version, commit, browser and OS only; the app itself sends nothing (D-35, ADR-021).

### 10.3 Local data
IndexedDB: profile, schemes, settings, recent-file handles, table templates, comment tool defaults and styles, saved visual signatures (ADR-021); the theme, accent colour and density choices (ADR-023, ADR-027, stored before first paint); the start-up choice and each file's last view by fingerprint (D-53); recently used comment fonts (D-52); comparison presets and ignore-zone sets (D-58, D-61). OPFS: recovery snapshots. Privacy page lists all of it; Settings → "Clear all local data".

---

## 11. Testing strategy

- **Unit (Vitest):** geometry, scale math, snapping index, table grid logic, CRS builder, scheme import/export, i18n completeness (no missing keys), format helpers.
- **E2E (Playwright, Chromium):** open/save/recover flows, annotation create/edit/delete/reply, measurement, CRS export, extraction, redaction verification, forms, protected PDFs, print dialog.
- **Performance (Playwright + `PerformanceObserver` longtask):** runs the §12 targets on the corpus; **any long task > 100 ms fails the build** for scripted scenarios (scroll, zoom, search, save). Exempt: cold app boot (bundle evaluation) and the browser's native print dialog (ADR-001 B4). Heavy-file scenarios are measured and reported, not gating (ADR-002).
- **Offline test:** context offline after first load → every Rev 0 feature must work; assert zero outbound requests during document work.
- **Round-trip (manual checklist, per milestone):** files created here opened/edited in Acrobat Reader and a second desktop PDF editor, and vice versa. Checklist lives in `/e2e/interop/CHECKLIST.md`. The agent prepares files and checklists; the owner runs them on Windows (ADR-001 B16).
- **Corpus:** public-domain sources (e.g. the US Federal Acquisition Regulation for the Contract profile; pdf.js test PDFs, veraPDF corpus, DARPA SafeDocs, checked per file) plus self-made files. Copyrighted standards (ASME, ISO) are never used. No synthetic generation of heavy files: the ~500 MB contract, dense drawings and P&IDs are **owner-supplied local files**, never committed and not listed by URL (ADR-001 B15, ADR-002). **Never company documents.** Large files are git-ignored and fetched by script.
- **Comparison corpus** (D-66, ADR-031): `Synthetic PDF Corpus/`, self-made revision pairs with manifests of the expected differences (drawings: shift, scale, rotation, inserted sheets, scans, layers, encryption, large and dense sheets; documents: numbers, tables, columns, renumbering, moves, scripts, OCR), rebuilt by a script in the repository. An acceptance suite in CI checks that every manifest difference is found, that control pages report nothing, that known transforms are recovered and that each pair finishes in time.

---

## 12. Acceptance targets (D-27)

Reference machine: Core i5-class, 16 GB RAM, Edge, installed PWA.

**Rev 0 scope of these targets (ADR-002):** they gate **typical files**. For **heavy files** (~500 MB contract, dense A0 drawings, P&IDs, large-file saves, deep zoom on dense sheets) results are **measured and reported** only. Memory is not limited during development (ADR-001 B10). The long-task rule exempts cold boot and the native print dialog (ADR-001 B4).

| Area | Target |
|---|---|
| App start (offline, installed) | usable UI < 2 s |
| Open 2,000-page contract | first page visible < 1.5 s; smooth scroll, no blank flashes |
| Search 2,000-page contract | first hits < 1 s; complete < 15 s |
| UI responsiveness | **no main-thread task > 100 ms, ever** |
| Dense A0 drawing | first view < 2 s; instant preview on pan/zoom; sharp tiles < 0.5 s; up to 6400 % |
| Save (incremental, 100 markups) | < 1 s |
| Memory (5 heavy tabs) | < 2 GB total |
| Round-trip | standard markups interoperate with Acrobat Reader + a second desktop PDF editor, both directions |
| Offline proof | network off → all Rev 0 features work; zero outbound requests during document work |
| Comparison (M12) | the corpus acceptance suite passes (§11); first sheet or page shown within about 3 s; the exact limits are fixed in ADR-032 after the M12 spikes |

---

## 13. Milestones

### M0 — Spikes (de-risk before building UI)
Each spike ends with a short ADR: works / workaround / blocker.
- **S1** Incremental save + full-rewrite save through EmbedPDF/PDFium.
- **S2** Writing Measure/Viewport dictionaries and reading them back in Acrobat Reader & a second desktop PDF editor.
- **S3** Two EmbedPDF/PDFium engine instances in two workers; memory with a 500 MB contract.
- **S4** PDF Oxide WASM: size, markdown/HTML/table quality on corpus, API availability in WASM build.
- **S5** Search in Work worker on a ~2,000-page public-domain doc (FAR) while scrolling — confirm no main-thread long tasks.
- **S6** Fluent Color icon coverage for the ribbon; list of custom icons required.
- **S7** Vector geometry extraction speed for snapping on a dense P&ID.
- **S8** CSP + WASM + workers + service worker coexistence on Cloudflare Pages with zero third-party requests (analytics server-side only, no beacon — ADR-001 B1).

### M1 — Foundation
App shell, ribbon framework, tabs, start screen, file open/handler/drag-drop, save (incremental + optimized + growth prompt), OPFS recovery, render worker + tiling + virtual scroll, zoom/view modes, PWA + offline precache + update flow, CSP, i18n scaffold, design tokens, CI (lint, types, tests, license gate, bundle-size report).

### M2 — Read
Advanced search + find bar, bookmarks/thumbnails/attachments panes, print dialog + print-ready export, protected PDFs, signature pane, form filling, error-report endpoint.

### M3 — Review
Full annotation set + round-trip, comments pane, reviewer profile, status schemes + stamps, measurement (scales, viewports, snapping), auto-numbering, CRS export.

### M4 — Extract
Text/images/MD/HTML, Word (beta), tables (beta: Express + Review), page operations, redaction with verification, annotation export and comment transfer (import, copy/paste).

**Public beta after M4** (D-32).

### M5 — OCR (Rev 1 item 1)
Convert → Recognize Text (OCR) per §7.14: spike S17 and ADR-020, the OCR worker and client, the raster and text-layer jobs, the dialog with languages and the re-recognize option, acceptance and interop (`docs/plan/M5.md`).

### M6 — Beta review (ADR-021)
The beta users' review (2026-11-01): top bar and full screen, context menus and page copy/paste, comment styles and defaults, Comments pane and property grid, adaptive ribbon with new Comment, Home and Form tabs, flatten, snapshot, attach file, bookmark editing, password security, visual signatures, form field creation; spikes S18–S22; acceptance (`docs/plan/M6.md`).

### M7 — Second beta review (ADR-023)
The second beta review (2026-11-04): the name Triya PDF, text comment editing and selection fixes (bugs B1–B14), right-click menu in text, sticky note popup (spike S23), 50 % highlights and a black Courier typewriter, pasting images, the Home tab layout, form highlight for check boxes and radio buttons, the dark theme; acceptance (`docs/plan/M7.md`).

### M8 — Lossless JSON comments (ADR-025)
Comment export and import keep every property: JSON v2 with the comments' own PDF objects, imported by object copy; a round-trip test of every interop file, key by key and pixel by pixel. XFDF/FDF deferred (`docs/plan/M8.md`).

### M9 — Help window (ADR-026)
Help becomes a separate page in its own window (`/help`): rewritten step-by-step topics, about 45 screenshots generated from the app by a Playwright script, search, print, deep links and "?" buttons, offline; the floating Help dialog is removed (`docs/plan/M9.md`).

### M10 — Visual refresh (ADR-027)
The "solid tool but basic UI" feedback (2026-11-16): design language v2 inside the existing layout (tokens, styled controls, ribbon, start screen, panes, dialogs, motion), the About page with in-app open-source licenses and the notices link fixed; command search, icon accents, loading placeholders and "What's new"; Help screenshots regenerated (`docs/plan/M10.md`).

### M11 — Tabs, fonts, comments in every mode (ADR-028)
The OCR text-selection fix; document tabs v2 (D-50); comments in every pointer mode (D-51); spike S26 and the font library for text comments (D-52); the selected-text menu, last view and session restore (D-53), Zoom to Area, copy page images, split, images to PDF, crop (D-55) (`docs/plan/M11.md`; system fonts, D-54, were withdrawn on 2026-11-18).

### M12 — PDF comparison (ADR-031)
PDF overlay for drawings and text comparison for documents (§7.16, D-58 … D-66), version 1.1.0: corpus additions; spikes S27 – S31 (several documents on screen, alignment, the overlay and the vector overlay PDF, text matching, the comparison file) with ADR-032 as a second owner gate; the Compare worker, the comparison tab and input window, pairing, alignment, the overlay view, the Review layout, differences, review across revisions, the vector overlay, the text comparison engine and view, saving, the change register, Help, acceptance and the owner's hand check (`docs/plan/M12.md`).

---

## 14. Roadmap after Rev 0

**Rev 1 (in order):** 1. OCR (scanned docs, search in scans, scanned tables) — **in progress as M5** (ADR-020) · 2. CRS round-trip import + custom column templates · 3. Protect: create certificate-based digital signatures from the user's certificate file (offline) (applying passwords and visual signatures moved to M6, ADR-021) · small items: stamp designer, shortcut remapping, poster tiling.

**Rev 2+:** PDF text editing · form design beyond M6's basic fields · advanced page tools (headers/footers, watermarks, Bates) · tablet UI · local folder search · native wrapper (.exe/.msi) (the dark theme moved to M7, ADR-023).

**Comparison (M12, ADR-030, ADR-031):** PDF overlay for drawings and text comparison for documents, planned as M12 (§7.16, §13). **Clean-room implementation from public techniques only** (CLAUDE.md rule 14). Left for later: more than two revisions at once, comparing an area, a side-by-side report, move distances.

**Extension points to reserve in Rev 0:** OCR text layer can be injected per page into the Work worker's text index; view layer supports a future two-document synchronized view (used by M12's comparison windows, spike S27).

---

## 15. Known risks

| Risk | Mitigation |
|---|---|
| EmbedPDF plugin doesn't meet a requirement | Replace that plugin only; drop to engine level for that subsystem (D-09) |
| Measure/Viewport interop varies between viewers | S2 spike; document observed behavior; Bluebeam unverified (D-33) |
| Incremental save not exposed | Direct `FPDF_SaveAsCopy` + narrow tail, verified with keep-all fallback (ADR-005); private EmbedPDF document accessor pinned and unit-tested |
| Memory with two engine instances | Evict idle docs from Work worker; respawn workers to release WASM memory (ADR-004); bounded tile caches |
| Table extraction quality | Beta label; review path + editable grid + templates |
| Accidental GPL/AGPL dependency via agent-added packages | CI license gate fails the build |
| Dev-only MPL tool drifting into the runtime bundle | Gate uses the lockfile `dev` flag; any runtime MPL fails the build (ADR-002) |
| EmbedPDF CDN defaults (`pdfium.wasm`, fonts on jsDelivr) | Always self-host; M0-S8 asserts zero third-party requests |
| EmbedPDF has no measurement tool / Measure fields | Own object layer in Render worker (ADR-007) |
| Font bundle size (CJK) | Background precache; measure in CI |
| Several live document windows do not fit the single view | Spike S27 before any comparison UI; fallback: Document A and B live, the overlay display-only with its own notes layer (ADR-031) |
| Automatic alignment picks a wrong match on repetitive drawings | Pairs are checked as they are first; a confidence score; low confidence asks for points; manual alignment on every sheet (D-60) |
| The vector overlay or the comparison file displays wrongly in another viewer | Spikes S29 and S31 with the owner's check in Acrobat Reader and other viewers; the vector display mode is beta; image fallback for export (D-59, D-65) |
