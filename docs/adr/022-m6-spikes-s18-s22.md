# ADR-022: M6 spikes S18 – S22 — passwords, forms, signatures, bookmarks, attach file

- **Status:** Proposed (2026-11-01; decision 5 route B chosen by the owner 2026-11-02)
- **Date:** 2026-11-01
- **Deciders:** owner (Shubham); recorded by the coding agent (task M6-04)
- **Related decisions:** D-03, D-19, D-26, D-38 (d)(g), D-39, D-40 (ARCHITECTURE.md §2); ADR-005
  (narrow tail), ADR-007 (object layer), ADR-013 (forms, permissions), ADR-016 (reopen route),
  ADR-018 (object copy), ADR-021 (M6 scope); CLAUDE.md rules 1, 5, 6, 7, 9, 13
- **Related spike / milestone:** S18 – S22 (`spikes/s18-s22-m6/`), M6 (`docs/plan/M6.md`)
- **Outcome (spikes only):** **Works with workaround** for all five. Nothing is a blocker; three
  of ADR-021's mechanisms change (decisions 1, 2 and 5 below).

## Context

ADR-021 accepted five features that rest on EmbedPDF 2.15.1 capabilities we had not used
(D-38 d, g; D-39; D-40 a, b) and asked task M6-04 to spike each before building it (CLAUDE.md
workflow), with a verdict per spike and the plan's M6-10 … M6-14 adjusted where a verdict is
"workaround". The spikes ran in Node on the **same PDFium WASM** the app ships, through a
stand-in for the Render worker that makes every executor call exactly as
`src/workers/render.worker.ts` does (permission gate, stable names, `/EPDFCustom` dropped,
author kept, save tracker told what changed), with EmbedPDF's `PdfEngine` orchestrator and the
real plugins on top, and saved through the app's own flow (`prepareSave` → Work-worker
verification → keep-all fallback). Files are self-made (rule 13). Everything was checked again
by reopening in PDFium and with `qpdf --check` / `qpdf --json`.

## Decisions

1. **Attach File (D-38 d, changes the mechanism).** EmbedPDF's `createPageAnnotation` has no
   `/FileAttachment` case, but the PDFium build it ships exports `FPDFAnnot_AddFileAttachment`,
   `FPDFAttachment_SetFile`, `EPDFAnnot_SetName` and `FPDFAnnot_SetAP`. The Render worker
   creates the annotation, its `/FS` filespec and `/EmbeddedFile` stream, `/Name /Paperclip`,
   `/C`, `/T`, `/NM`, `/Contents` and **our paperclip appearance** with direct calls (ADR-001
   B14) — not with our object layer. PDFium writes and encrypts the objects; the narrow tail
   keeps them (new objects + the page's `/Annots`). Our own appearance stays the one exception to
   §7.1's "no custom appearance streams". **Move / resize** need their own Render call
   (`FPDFAnnot_SetRect`): EmbedPDF's `updatePageAnnotation` moves it but then rejects the subtype
   (error 20). Delete is EmbedPDF's `removePageAnnotation`. The fallback (document attachment)
   is not needed.
2. **Password security (D-40 a, adds a route and a gate).** `setDocumentEncryption` writes
   **AES-256, `/V 5 /R 6`, `/AESV3`**, `/P` exactly as asked. It must not run on the open
   document:
   - it only takes effect in a full rewrite — a Ctrl+S afterwards writes an **unencrypted** file
     (incremental tail of 0 bytes, no `/Encrypt`);
   - our object layer's staged keys (`/Measure`, `/IT`, …) are encrypted with the **old** file
     key by `saveRewrite`, so they come out garbled under the new key (and the other way round
     for removal).

   **Route:** `saveRewrite` of the current state (our keys under the file's own key) → open that
   copy as a second document in the Render worker (with the owner password when removing) →
   `setDocumentEncryption` or `removeEncryption` → `FPDF_SaveAsCopy` without the incremental
   flag → close the copy → verify in the Work worker → Save As. The open document is never
   touched. **Gate:** Remove Security and changing passwords need **owner rights** (unencrypted,
   opened with the owner password, or owner-unlocked); PDFium itself removes encryption from a
   document opened with the user password only, and our `modify` check is not enough (a file
   with all permissions allowed passes it). **Passwords** are limited to **127 UTF-8 bytes**
   (R6): PDFium accepts longer ones, but other readers (qpdf) then cannot open the file. Unicode
   passwords work (SASLprep'd UTF-8). A signed file comes out with its signature no longer
   covering the file (our checker: `modified`), so the warning stays.

3. **Visual signatures (D-40 b, confirmed).** `@embedpdf/plugin-signature` 2.15.1 works as
   planned: drawn → Ink, typed and uploaded → Stamp with the PNG as an image XObject **with a
   soft mask** (transparency kept), `/Subj (Signature)`, print flag, `/AP`. The typed pad renders
   on a canvas with a CSS font family (its default `'Dancing Script'` is not bundled): M6-13
   loads a handwriting font with `FontFace` from our own origin and passes it as `fontFamily`.
   **Fonts:** `@embedpdf/default-signature-fonts` 1.0.0-next.1, `(Apache-2.0 AND OFL-1.1)`,
   passes our license gate; three subset fonts, 81 / 159 / 125 KB. It is a prerelease: pin the
   exact version and precache the font files (offline). Saved entries serialize to JSON
   (`serializeEntries`) for IndexedDB: three entries 36 KB.
4. **Form field creation (D-39, adds a gate and two workarounds).** `@embedpdf/plugin-form`
   2.15.1's five tools create real AcroForm fields (merged field/widget, `/DA`, `/MK`, `/AP` for
   every widget, `/AcroForm /Fields` and `/DR` created when missing, no `/NeedAppearances`);
   `shareField` makes a radio group and `renameField` renames; properties (required, font size,
   colours, options) go through the annotation plugin's update. **Workarounds:**
   - the package declares **no license** in `package.json` (its `LICENSE` file is MIT):
     `scripts/license-exceptions.json` gets a reviewed entry in M6-14;
   - the **tooltip** (`alternateName` → `/TU`) and a radio's **export value** are not written:
     the export value is the widget's id (a UUID from the tool). M6-14 gives radio widgets
     readable ids (`Choice1`, `Choice2`, …, unique on the page) and writes `/TU` through our
     object layer (new allowed key on merged widgets);
   - **gate:** creating, renaming, sharing, changing properties of and deleting fields need
     **modify + annotate** (ISO 32000-1 table 22, bits 4 and 6). Today the tracker lets
     `createPageAnnotation` through with annotate and `renameWidgetField` / `shareWidgetField`
     with fill-forms only.
5. **Bookmark editing (D-38 g, changes the mechanism — owner chose route B, 2026-11-02).** `setBookmarks`
   rebuilds the whole outline and **loses** every item's colour (`/C`), bold/italic (`/F`) and
   open/closed state (`/Count`, also missing on the root), and turns named destinations into
   explicit ones. Worse, it **fails mid-way on any action it can't write** (GoToR, JavaScript,
   Named, …): the tree is already cleared, so the open document is left with a truncated
   outline that Ctrl+S then saves. Two routes:
   - **A — `setBookmarks` with a guard:** refuse edits (with a reason) when the outline has
     actions it cannot write; accept the loss of colour, style and open state.
   - **B — our own outline writer (chosen):** the Work worker reads the outline with our
     reader, applies the edit and writes a fresh set of outline objects keeping **every key** of
     every item; the Render worker applies them with the existing reopen route (`applyObjects`,
     ADR-016 / ADR-018) and Ctrl+S saves them in the semantic narrow tail. Prototyped in the
     spike: all keys, GoToR / JavaScript actions and the named destination kept, `/Count` signs
     right; encrypted files need the object layer's string encryption (as comment transfer
     does).

   Either way the save must mark the catalog and the outline root dirty: unmarked, "delete all
   bookmarks" saves **nothing** (empty tail) and the bookmarks come back on reopen.

## Consequences

- Plan changes (M6.md, this commit): M6-10 uses direct PDFium calls plus its own move/resize
  call; M6-11 uses route B (our own outline writer); M6-12 uses the copy route, the owner-rights gate and
  the 127-byte limit; M6-13 bundles a font and passes it to the type pad; M6-14 adds the license
  exception, readable radio ids, `/TU` via the object layer and the modify + annotate gate.
- ARCHITECTURE.md changes **after this ADR is accepted** (not in this commit): §3.2 add
  `@embedpdf/default-signature-fonts` (Apache-2.0 AND OFL-1.1, exact pin) and note the
  plugin-form license exception; §7.1 Attach File "created by direct PDFium calls in the Render
  worker" instead of "written by our object layer"; §7.10 the modify + annotate gate and `/TU`;
  §7.11 the bundled handwriting font; §7.12 the copy route, the owner-rights gate and the
  127-byte limit; §7.16 the bookmark route B (our own outline writer).
- Risks: all three EmbedPDF additions are on the pinned 2.15.1; an upgrade must re-run these
  spikes. The fonts package is a prerelease (pinned). Interop with Acrobat / PDF-XChange
  (forms, signatures, attach file, edited outlines) joins the owner's M6-15 checklist.

## Evidence

Run: `npm install --no-save @embedpdf/plugin-form@2.15.1 @embedpdf/plugin-signature@2.15.1
@embedpdf/default-signature-fonts@1.0.0-next.1`, then
`PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium node --import ./spikes/shared/ts-ext.ts
spikes/s18-s22-m6/run-node.ts` (all five, about 12 s; one spike: add `s18` … `s22`; timings below vary ±30 % between runs). Needs the
`qpdf` CLI. Output: `spikes/s18-s22-m6/out/<spike>.json`. Cloud container, Node 22.23,
PDFium from `@embedpdf/pdfium` 2.15.1, qpdf 11, Chromium (Playwright 1.62.1) for the typed
signature only. Self-made fixtures from `e2e/fixtures/generate.ts` and the spike files.

**S18 — passwords** (`s18-encryption.ts`)

| Check                                                           | Result                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Algorithm written                                               | `/Filter /Standard /V 5 /R 6 /Length 256`, `/CF /StdCF /AESV3`       |
| Open + permissions password, no password / wrong password       | refused (PDFium error 4, password)                                   |
| … user password                                                 | opens, permissions as asked (print, high-quality print, annotate, …) |
| … owner password                                                | opens with full rights; `qpdf --check` ok with either password       |
| Permissions password only                                       | opens without a password, restricted as asked                        |
| Each permission bit alone (8 + none)                            | `/P` and PDFium's bits match the request; our `allows()` agrees      |
| Page / annotation counts, a form's 9 field values               | unchanged                                                            |
| Remove (owner), change passwords (owner)                        | no `/Encrypt` / new passwords only; `qpdf --check` ok                |
| Remove with the **user** password: our gate / PDFium            | gate refuses (`modify` denied here) / **PDFium removes it anyway**   |
| Ctrl+S after `setDocumentEncryption`                            | keep-all, **0-byte tail, file stays unencrypted**                    |
| Our `/Measure` string after encrypting / decrypting in place    | **garbled** (`u:` / `b:c107…`)                                       |
| … through the copy route                                        | `1 mm = 1 mm` both ways, `qpdf --check` ok, 10–28 ms each            |
| Passwords `pässwörd`, `パスワード`, `pass word`, 127 bytes      | PDFium and qpdf open                                                 |
| 128 ASCII bytes, 64 × `é` (128 UTF-8 bytes)                     | PDFium opens, **qpdf: invalid password**                             |
| Signed file encrypted                                           | signature `unchanged` → `modified`                                   |
| 2,000-page stand-in (3.5 MB): encrypt + rewrite / plain rewrite | 150–200 ms, 3.53 MB / 80–85 ms (two runs)                            |

**S19 — forms** (`s19-forms.ts`, plugin tools driven through their own pointer handlers)

| Check                                                                | Result                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tools registered                                                     | `formTextField`, `formCheckbox`, `formRadioButton`, `formCombobox`, `formListbox`          |
| Drag and click (default size, e.g. 150 × 24 text)                    | all create; names `TextField_xxxxxxxx` etc.                                                |
| `shareField` (radio group), `renameField`, properties update         | true / `renamed` / flags, font size, colours, options applied                              |
| Ctrl+S (no AcroForm before): mode, verification, tail                | **narrow**, verified, 6.2 KB; `qpdf --check` ok                                            |
| Structure                                                            | `/AcroForm << /Fields [6] /DR >>`, every widget `/AP`, `/DA`, `/MK`; no `/NeedAppearances` |
| Fill (the `setFormFieldValue` calls FormLayer makes), Ctrl+S, reopen | narrow 5.1 KB, all five values back; `/V` and `/AS` right                                  |
| Add a field to an existing AcroForm (`fullFormPdf`)                  | narrow 2 KB; 9 → 10 widgets, 9 fields, old values kept                                     |
| `/TU` from `alternateName` (create or update)                        | **absent**                                                                                 |
| Radio export value                                                   | **the widget id** (UUID from the tool; `exportValue` ignored)                              |
| Gate on a file with bits 6, 9, 11 but not 4                          | create / rename / share **allowed** (should be refused)                                    |
| `npm run licenses` with the plugin installed                         | **`@embedpdf/plugin-form@2.15.1 [unknown] no license declared`**                           |
| Size (ESM, gzip): core + React entry                                 | 8.3 + 6.6 KB; no network calls in the code                                                 |

**S20 — signatures** (`s20-signatures.ts`)

| Check                                                          | Result                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Draw → place (signature and initials)                          | `signatureInk` tool → Ink, 2 strokes, `/Subj (Signature)`, `/F 4`, `/AP`      |
| Type (Allura via `FontFace` in Chromium, 600 × 160 PNG, 23 KB) | `signatureStamp` → Stamp `/Name /Custom`, image 600 × 160 RGB + `/SMask`      |
| Upload (300 × 100 PNG, transparent)                            | Stamp, image + `/SMask`                                                       |
| Ctrl+S, verification, qpdf                                     | **narrow**, verified, 23 KB; ok                                               |
| Rendered (annotation only)                                     | 517 / 739 / 495 / 517 px drawn                                                |
| Flatten on placement (`flattenAnnotation`)                     | the stamp becomes page content (2 page objects), keep-all save, qpdf ok       |
| Saved entries → JSON → back                                    | 3 entries, 36 KB, round trip ok                                               |
| `@embedpdf/default-signature-fonts`                            | 1.0.0-next.1, `(Apache-2.0 AND OFL-1.1)` (passes the gate); 81 / 159 / 125 KB |
| Size (ESM, gzip): core + React entry                           | 3.9 + 3.8 KB; no network calls                                                |

**S21 — bookmarks** (`s21-bookmarks.ts`)

| Check                                                                                                                  | Result                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Get → set the same rich outline (named dest, URI, GoToR, JS, red bold closed parent)                                   | **rejected mid-way**; memory and the saved file keep 3 of 6 items                                                   |
| Same without GoToR / JS                                                                                                | ok; `/C`, `/F`, `/Count` **gone**, `(chap2)` → explicit destination                                                 |
| 500-item outline: rename (Unicode), new child (XYZ 36 600 1.25), delete keeping children, delete subtree, reorder, URI | `setBookmarks` 12–14 ms; reopened = wanted (401 items)                                                              |
| … saved as tracked today / narrow (catalog + root marked)                                                              | keep-all 91.8 KB / **narrow 76.7 KB**, both verified, qpdf ok                                                       |
| First bookmark in a file without outline                                                                               | narrow 461 B (catalog, root, item, destination)                                                                     |
| Delete all: tracked today / narrow unmarked / narrow marked                                                            | 15 KB, 0 left / **nothing saved, 500 back** / 259 B, 0 left                                                         |
| Undo (set the old tree again)                                                                                          | 12 ms, identical                                                                                                    |
| Route B prototype (our outline objects + `applyObjects` + semantic Ctrl+S)                                             | build 1 ms, apply 2.5 ms; narrow 1.4 KB; every key kept, `/Count -2` on the closed parent, root `/Count 5`; qpdf ok |

**S22 — attach file** (`s22-attach.ts`)

| Check                                           | Result                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Create (8-byte CSV) by direct calls             | 11 ms; EmbedPDF reads it as `FILEATTACHMENT` with contents and author                                       |
| Annotation keys                                 | `/AP /C /CA /Contents /FS /NM /Name /Paperclip /Rect /Subtype /T /Type`                                     |
| Filespec                                        | `/Type /Filespec /F /UF (calc-sheet.csv) /EF << /F … >>`                                                    |
| Ctrl+S, verification, qpdf                      | **narrow**, verified, 1.7 KB; ok                                                                            |
| Extract (our Attachments-pane code), appearance | byte-identical; paperclip drawn (1,387 px)                                                                  |
| 20 MB file                                      | create 80–190 ms; narrow save 290–345 ms (Flate-compressed; this test data compresses to 0.3 MB); identical |
| AES-256 file opened with the owner password     | narrow 1.3 KB, file encrypted (no plaintext in the tail), identical                                         |
| Move with `updatePageAnnotation`                | rect moved, appearance follows, but the call **rejects** (error 20)                                         |
| Delete with `removePageAnnotation`              | narrow, 0 annotations left                                                                                  |
