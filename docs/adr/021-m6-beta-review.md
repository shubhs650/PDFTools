# ADR-021: M6 — beta review: UI polish, comment workflow, forms, passwords, signatures

- **Status:** Proposed
- **Date:** 2026-11-01
- **Deciders:** owner (Shubham) / agent planning session
- **Related decisions:** D-01, D-03, D-19, D-20, D-22, D-24, D-26, D-29, D-30 (ARCHITECTURE.md §2);
  new D-35 … D-40 below
- **Related spike / milestone:** M6 (plan: [docs/plan/M6.md](../plan/M6.md)); spikes S18 … S22
  (task M6-04)

## Context

The public beta (D-32) was tested by several users. Their observations were collected by the
owner in `PDF_Tools_review.docx` (2026-11-01; kept outside the repository). The plan in
[docs/plan/M6.md](../plan/M6.md) maps every observation to a task. Most of them are UI changes
inside the current design, but some conflict with ARCHITECTURE.md Rev 0.8 and need an ADR before
any code is written (CLAUDE.md: "Never change ARCHITECTURE.md without an approved ADR"):

| Observation                                                      | Conflict in Rev 0.8                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| C3 — add form fields (PDF-XChange Form tab)                      | §1.5 non-goal "form design"; §14 Rev 2+ "form design"; §8 tab list has no **Form** tab                                                 |
| C2 — password protect a PDF                                      | §1.5 non-goal "applying passwords"; §14 Rev 1 item 3                                                                                   |
| C1 — sign a document                                             | §1.5 non-goal "creating signatures"; §14 Rev 1 item 3                                                                                  |
| B7 — Attach File comment                                         | §7.1 "No custom appearance-stream generation in Rev 0" (EmbedPDF 2.15.1 cannot create a FileAttachment annotation)                     |
| A1 — brand, Home link to openengtools.com, GitHub issue button   | §10.2 has only the opt-in `/api/report`; rule 4 / D-22 must stay intact                                                                |
| A1 — maximize like a video player                                | not specified                                                                                                                          |
| B7, A2 — PDF-XChange-like Comment and Home ribbons at 1280 px    | §8 minimum width 1280 px; the requested Comment ribbon is ~1,850 px wide at full labels                                                |
| B5, B6 — style palette, new default styles                       | §7.1 lists styles only as per-annotation properties; no per-tool defaults or palettes; §10.3 local data list                           |
| B3 — right-click menus everywhere, copy/paste comments from page | §7.1 already has copy/paste (ADR-018) — needs context menus and a pointer paste position; a new Radix primitive (`react-context-menu`) |

Library facts checked on 2026-11-01 (npm, `node_modules/@embedpdf/*` 2.15.1 — the version the
app pins; `latest` on npm; 3.0.0-next.19 is a prerelease with a new engine split and is **not**
needed):

- `@embedpdf/plugin-form` 2.15.1 (MIT): tools that create Text, Check Box, Radio, Combo (dropdown)
  and List widget fields; the engine's `createPageAnnotation` writes them with `/DA`, `/MK`, flags
  and names. No creation of signature, push-button or barcode fields.
- `@embedpdf/plugin-signature` 2.15.1 (MIT): visual signatures and initials — drawn, typed or an
  uploaded image — placed as Ink or Stamp annotations. Not certificate (CMS) signing. Typed
  signatures use `@embedpdf/default-signature-fonts` (1.0.0-next.1; license to be checked).
- Engine: `setDocumentEncryption(user, owner, allowedFlags)` and `removeEncryption()` (applied by
  `saveAsCopy`, i.e. a full rewrite), `flattenAnnotation`, `flattenPage`, `setBookmarks`,
  `addAttachment`; annotation `flags` (`print`, `readOnly`, `locked`, `hidden`, …), `blendMode`,
  `rotation`, `created`/`modified`, review `state`/`stateModel` (incl. **Marked**).
- Fluent UI System Icons has `Signature`, `Screenshot`, `FullScreenMaximize`, `Form*`,
  `TextField`, `RadioButton`, `CheckboxChecked`, `Attach`, `LockClosed`, `Eraser`; it has **no
  magnet** (drawn in our style, rule 15).

## Options considered

1. **Keep Rev 0 non-goals; ship only the UI observations.** Least risk, but leaves the three
   features users asked for most (C1–C3) for a later revision although the engine already has
   them.
2. **Upgrade to EmbedPDF 3.0 (next) for forms/signatures.** Prerelease, a new engine/runtime split,
   every plugin renamed or reworked — a large migration with no capability we need that 2.15.1
   lacks. Rejected.
3. **Bring the three features into scope on EmbedPDF 2.15.1, each behind a spike** (chosen), and
   amend the UI sections for the shell, ribbon, comments, styles and context menus.

## Decision

**D-35 — App shell (top bar, full screen, status bar).**
The banner gets, left of the quick access toolbar, the product mark (our existing app icon,
`public/icons/icon.svg`) and the name "PDFTools"; at the right end of the tab row: **OpenEngTools
home** (opens `https://www.openengtools.com` in a new tab), **Report an issue on GitHub** (opens
the repository's new-issue page in a new tab, prefilled only with app version, commit, browser
and OS — never document content, rule 10), and **Full screen** (Fullscreen API on the whole app
root — ribbon, panes and status bar together; toggle button plus `F11`-style shortcut defined in
the keymap; Esc leaves). Both links are user-initiated top-level navigations with
`rel="noopener noreferrer"`, not requests made by the app: rule 4, D-22 and the CSP are
unchanged (`connect-src 'self'` is untouched). The in-app opt-in error report (§10.2) stays.
The status bar's "Enable Snapping" text button becomes a magnet icon toggle (drawn custom icon;
the accessible name and tooltip stay "Enable snapping"; pressed state = Filled variant).

**D-36 — Adaptive ribbon.**
Groups keep a priority. When the window is narrower than the tab's full layout, groups step down
one at a time: full labels → small icons with labels → icon-only grid → a single group button
that opens the group as a dropdown (Office behaviour). 1280 px stays the minimum (§8) and every
command stays reachable with the keyboard and keeps its accessible name. Split buttons may open a
**style palette** (D-37). §8's tab list gains **Form** (between Comment and Measure, as in the
review's reference).

**D-37 — Comment styles and defaults.**
Every comment tool has **default properties** (owner-set, stored per tool in IndexedDB, editable
through the Properties pane while the tool is active, "Make current properties default" from a
comment's context menu). Shipped defaults (B6): text color red, font size 10 pt, line/border
color red, line/border width 1 pt for text box, typewriter, callout, line, arrow, polyline,
polygon, rectangle, oval, cloud and pencil; highlight and sticky note keep yellow. A **style
palette** per tool (split-button dropdown) offers presets — Red, Purple, Indigo, Blue, Green,
Yellow, Black, plus Cloudy variants for closed shapes and text boxes — and the user's own saved
styles; **Comment Styles Palette** manages them (add, rename, delete, export/import as
`.pdftools-styles.json`). Styles are plain property sets applied through the existing
annotation-property path — appearances stay PDFium's (§7.1 unchanged).

**D-38 — Comment workflow additions.**
(a) **Context menus** (Radix `@radix-ui/react-context-menu`, MIT) on: a comment on the page; a
comment card in the Comments pane; the page background; bookmarks; thumbnails (exists). Every
menu is also opened by Shift+F10 / the Menu key, and every item is a command from the command
table (same handler, same disabled reason). (b) **Cut / Copy / Paste** of comments from the page:
Ctrl+X/C/V and the context menu; **Paste** from the page's context menu puts the comments at the
pointer position; the clipboard stays in-app (ADR-018 d5). (c) **Flatten** selected or all
comments (page range) into page content via the engine's `flattenAnnotation` / `flattenPage` in
the Render worker: one undo step, capability **modify** (rule 9), marks the document "optimize
recommended" like other content changes (§7.8). (d) **Attach File** comment: a standard
`/FileAttachment` annotation with an embedded file, written by our object layer (ADR-007) because
EmbedPDF cannot create it; its appearance is a small paperclip drawn by us — the one exception to
§7.1's "no custom appearance streams", subject to spike S22; fallback: a document-level
attachment (`addAttachment`) shown in the Attachments pane. (e) **Snapshot** (Home): drag a
rectangle, the Render worker renders it at screen × 2 resolution, the PNG goes to the system
clipboard (`navigator.clipboard.write`); needs the **copy** permission (rule 9). (f) **Annotation
flags and review marks** in the Properties pane and the context menu: Locked, Printable, Read
only, Marked (review state model `Marked`), Review history (read-only list of state replies).
(g) Bookmark editing (new, rename, delete, delete but keep children, set destination from the
current view, cut/copy/paste within the document, drag to reorder) through the engine's
`setBookmarks` in the Render worker, saved in the incremental revision (spike S21 confirms the
narrow tail).

**D-39 — Form field creation (basic AcroForm).**
A **Form** ribbon tab: Select Fields, Text, Check Box, Radio, List, Dropdown, Highlight Fields,
Reset Form; field properties in the Properties pane (name, tooltip, required, read-only, default
value, options for list/dropdown, font, size, border and fill colors); tab order follows field
creation order and can be changed; saved incrementally. Built on `@embedpdf/plugin-form` 2.15.1
(spike S19). Not in M6: signature fields, push buttons, barcode, image and date fields with
format scripts, calculation, **any JavaScript** (none is ever run — §10.1), XFA design, form-data
import/export.

**D-40 — Password security and visual signatures.**
(a) **Protect → Password Security**: set an open password and/or a permissions password with
permission tick boxes (print, high-quality print, modify, copy, annotate, fill forms, assemble,
accessibility); **Remove Security** when the document is open with full rights (owner password
or no restriction). Uses the engine's `setDocumentEncryption` / `removeEncryption`. The output is
always a **new file via Save As with a full rewrite** (never Ctrl+S, never the original by default
— the redaction pattern, §7.9 step 2); signed documents warn that signatures will be invalidated;
the result is reopened in the Work worker and verified (opens with the password, permissions as
set, page count and annotation count unchanged) before success is reported. The algorithm must be
AES-256 (spike S18; if the engine only writes RC4/AES-128, stop and report). Passwords are never
stored. (b) **Protect → Sign Document**: visual signatures and initials (draw, type, image) via
`@embedpdf/plugin-signature`, placed as standard Stamp/Ink annotations (round-trip with Acrobat
and PDF-XChange, D-03), optionally flattened on placement; saved signatures live in IndexedDB on
this device only (Privacy page and Clear all local data cover them). The UI says plainly that this
is **not** a certificate-based digital signature. Certificate signing (PKCS#12, CMS) stays Rev 1
item 3.

### ARCHITECTURE.md changes (Rev 0.9, after acceptance)

- Header: Rev 0.9 amendment note citing this ADR.
- §1.5: drop "form design" (basic AcroForm fields are in, per D-39) and "applying passwords"; keep
  "creating certificate signatures" and "XFA forms"; add "JavaScript in forms".
- §2: add D-35 … D-40.
- §3.2: add `@radix-ui/react-context-menu`, `@embedpdf/plugin-form`, `@embedpdf/plugin-signature`
  (and the typed-signature fonts if their license passes, OFL-1.1).
- §5: status bar "snapping (magnet toggle)"; Comments pane wording (cards, toolbar, find on
  Enter).
- §7.1: style defaults and palettes (D-37); context menus, cut/copy/paste on the page, flatten,
  attach file, snapshot, flags (D-38).
- §7.10: form field creation (D-39).
- §7.11: visual signatures (D-40 b), with the "not a certificate signature" note.
- §7.12: password security apply/remove (D-40 a).
- §7.16 (new): bookmark editing (D-38 g).
- §8: top bar (D-35); adaptive ribbon (D-36); tab list gains **Form**.
- §10.2: the GitHub issue link (D-35) next to the opt-in report.
- §10.3: local data gains comment styles, tool defaults and saved signatures.
- §13: M6 — Beta review. §14: Rev 1 item 3 narrows to certificate signing.

## Consequences

- Three new runtime dependencies (all MIT, EmbedPDF ones at the pinned 2.15.1); the license gate
  must stay green; install budget impact measured per task (60 MB, §9).
- The Comments pane loses its fixed 44 px rows: cards have variable height, so the list needs a
  measured (variable-size) virtualizer that keeps 10,000 comments smooth (rule 1).
- Search-like inputs added by M6 (Find in the Comments pane) run on Enter only (rule 3).
- Password security and flatten are new content-changing paths: both have verification or undo,
  and both honor permission flags (rules 8, 9 spirit).
- Interop: forms, flattened comments, attach-file annotations and visual signatures join the
  owner's Acrobat / PDF-XChange checklist (`e2e/interop/CHECKLIST.md`, D-33).
- Risks: spike results may narrow D-38 (d) and D-40 (a); the plan says what happens then.

## Evidence

To be filled by task M6-04 (spikes S18 – S22): commands, numbers, files (self-made only, rule 13).
