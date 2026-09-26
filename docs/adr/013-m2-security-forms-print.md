# ADR-013: M2-02 — Passwords, owner unlock, forms, flatten and the print route

- **Status:** Accepted (owner, 2026-09-26), including decision 7 (the §10.1 CSP gains
  `frame-src blob:` for M2-16's browser-viewer print route; ARCHITECTURE.md §10.1 is updated in
  M2-16 when the route lands).
- **Date:** 2026-09-26
- **Deciders:** Owner (decision 7); recorded by the coding agent
- **Related decisions:** D-19, D-25, D-26, §7.10, §7.12, §7.13, §10.1; ADR-001 B4, B13, B14;
  ADR-005; CLAUDE.md rules 1, 2, 6, 7 and 9
- **Related spike / milestone:** M2-02 (feeds M2-03, M2-14, M2-15, M2-16)
- **Outcome (spikes only):** **Works with workaround.** Passwords and owner unlock work on R2–R6,
  and encrypted files still save as a narrow, encrypted, qpdf-clean tail. Form filling works for
  every field type. Flattening a copy is exact and stays vector. Printing works under the current
  CSP as raster images in a same-origin iframe. Workarounds: a revision-aware permission map; our
  own read-only enforcement and tab order; a dirty-set fix for fields with kids; print renders
  with PDFium's print flag, in bands. Printing a vector PDF through the browser's viewer needs
  `frame-src blob:`.

## Context

The [M2 plan](../plan/M2.md#m2-02--spike-security-forms-flatten-and-print-route-adr-013) asks six
questions before building protected PDFs (M2-03), forms (M2-14) and printing (M2-15, M2-16), and
ADR-001 B13 left the `frame-src blob:` design to M2.

## Setup

- **Fixtures** ([`make-fixtures.ts`](../../spikes/s11-secure-print/make-fixtures.ts), self-made,
  generated at run time):
  - an AcroForm page with text (plus read-only and required), checkbox, a two-button radio group,
    combo and list fields; `/Tabs /R` with `/Annots` deliberately out of row order;
  - XFA markers: a hybrid AcroForm + `/XFA` packet, and the same with `/NeedsRendering true`;
  - two squares with appearance streams, one with the Print flag and one screen-only;
  - the form encrypted by **qpdf** as R2 (RC4-40), R3 (RC4-128), R4 (AES-128) and R6 (AES-256),
    each with user and owner passwords, print/copy/modify/annotate/fill denied; plus an R6
    owner-password-only file.
- **Node harness** ([`run-node.ts`](../../spikes/s11-secure-print/run-node.ts)): real PDFium via
  `PdfiumNative`, our M1 save core (`SaveTracker`, narrow tail, writer, digest and verification),
  `qpdf --check`. Spike scripts that import `/src` run with a small resolve hook
  (`node --import ./spikes/shared/ts-ext.ts …`).
- **Browser** ([`s11.spec.ts`](../../spikes/s11-secure-print/s11.spec.ts)): a spike page served by
  `spikes/shared/serve.ts` with the §10.1 CSP verbatim, a Report-Only copy and COOP/COEP (as in
  production), and a second copy whose CSP adds only `frame-src blob:`.
- **Environment:** cloud container, Node 22, headless Chromium 151, qpdf 11.9. Informative numbers.

## Findings

### 1. Opening with a password

- `openDocumentBuffer(file, { password })` opens all four revisions with the user password.
- **No password and a wrong password fail the same way**: `PdfErrorCode.Password` (4),
  "FPDF_LoadMemDocument failed". The UI tells "enter a password" from "incorrect password" by
  whether it sent one.
- The owner-password-only file opens without a password, restricted.

### 2. Permissions and owner unlock

| After                        | `FPDF_GetDocPermissions` | `…UserPermissions` | `doc.permissions` (EmbedPDF object) |
| ---------------------------- | ------------------------ | ------------------ | ----------------------------------- |
| open with user password (R6) | `0xfffff2c0`             | `0xfffff2c0`       | `0xfffff2c0`                        |
| `unlockOwnerPermissions(ok)` | **`0xfffffffc`**         | `0xfffff2c0`       | **still `0xfffff2c0`** (stale)      |
| open with the owner password | `0xfffffffc`             | `0xfffff2c0`       | `0xfffffffc`                        |

- `unlockOwnerPermissions` works on an **already open** document in every revision: `true` with
  the owner password, `false` with a wrong one, and `isOwnerUnlocked` turns true. No reopen, so
  tiles, recovery and dirty state are untouched.
- EmbedPDF's `PdfDocumentObject.permissions` is a snapshot from open time. After an unlock the
  app must re-read the permissions (`FPDF_GetDocPermissions`, as the M1 save tracker already
  does).
- **R2 needs its own mapping.** In R2 only bits 3–6 exist. qpdf's R2 file has `P = -64`
  (`0xffffffc0`): bit 9 (fill forms) is set only because undefined bits are 1. Our M1
  tracker therefore allowed form filling on an R2 file that denies annotation — wrong under
  ISO 32000-1 Table 22, where R2 form filling follows bit 6. R3+ files were mapped correctly.
- **Saving after an unlock** (fill a field, Ctrl+S core): narrow tail of 2.1–2.8 KB, the value
  reads back, and `qpdf --check` is clean with R and P unchanged, for R2, R3, R4 and R6.

### 3. Forms

- `FPDF_GetFormType`: AcroForm **1**, hybrid XFA **3** (foreground), full XFA **2**. XFA
  detection works in this non-XFA build.
- `getPageAnnoWidgets` returns every widget with name, type, flags, value, options (combo, list),
  export value (checkbox, radio) and rect. **The order is the `/Annots` order**, not the page's
  `/Tabs` order.
- `setFormFieldValue` works for text, checkbox, radio, combo and list (0.3–2.9 ms each), and
  **PDFium regenerates the appearance** each time (changed pixels in every widget; the list box
  had no appearance and got one).
- **`setFormFieldValue` ignores the read-only flag**: the read-only field was changed. Read-only
  must be enforced by our UI and by the Render worker's mutation check.
- **Radio groups and the narrow tail.** After selecting the second radio button and saving, the
  narrow tail reopened with the _old_ value. The tail kept the clicked widget but not the parent
  field (which holds `/V`) or the sibling widget (whose `/AS` changed). Keep-all reopened
  correctly, and **M1-21's save verification reports the mismatch** (`form`, page 0), so in the
  app this falls back to keep-all: a larger tail, never a lost value. The fix is to add each
  changed widget's `/Parent` chain and its siblings (`/Kids`) to the dirty set.

### 4. Flatten

- On a separately opened copy: `flattenPage(…, Print)` then a full rewrite through our writer
  (`FPDF_NO_INCREMENTAL`, ADR-005 decision 3) took **3.8 ms** for the form page.
- The output has **0 annotations and 0 widgets**, renders **pixel-identical** to the original's
  render with annotations and forms, is **vector** (13 form XObjects, 0 images) and is
  qpdf-clean.
- The catalog still has `/AcroForm`, so the original field objects and values stay in the file
  as unreachable data. The print-ready export should drop it.
- EmbedPDF's `preparePrintDocument` is not usable: its copy (via `FPDF_ImportPages`) had **0
  annotations and 0 widgets** even with `includeAnnotations: true`, and it uses the
  byte-by-byte copy-out (ADR-005 finding 1).

### 5. Print rasters

- **EmbedPDF renders ignore the Print flag**: the screen-only square is drawn. A raw
  `FPDF_RenderPageBitmap` with `FPDF_ANNOT | FPDF_PRINTING` drops it and keeps the printable
  one. Printing must use the raw call (B14).
- Banded rendering (1,024-px bands, raw call, Node):

  | Page             | DPI | Pixels        | Raw size | Time             | Longest band |
  | ---------------- | --- | ------------- | -------- | ---------------- | ------------ |
  | Stand-in A4-ish  | 150 | 1275 × 1754   | 9 MB     | 27 ms            | 18 ms        |
  | Stand-in A4-ish  | 300 | 2550 × 3508   | 34 MB    | 96 ms            | 31 ms        |
  | Stand-in A4-ish  | 600 | 5100 × 7017   | 137 MB   | 233 ms           | 39 ms        |
  | A0, 20k segments | 150 | 7021 × 4967   | 133 MB   | 183 ms           | 49 ms        |
  | A0, 20k segments | 300 | 14042 × 9933  | 532 MB   | 506 ms           | 61 ms        |
  | A0, 20k segments | 600 | 28083 × 19867 | 2.1 GB   | ~2.4 s (extrap.) | 126 ms       |

  A whole-page bitmap at 300 DPI on A0 would not fit comfortably in WASM memory; bands do.

### 6. The print route under the CSP

- **Raster route, §10.1 CSP unchanged** (with COOP/COEP, cross-origin isolated): 20 A4 pages at
  300 DPI (made as PNGs in a worker) placed as `blob:` images in a hidden same-origin
  `about:blank` iframe loaded in **30 ms**, with **0 CSP violations** and **0 long tasks**; then
  `print()` on the iframe.
  - `HTMLImageElement.decode()` rejects with `EncodingError` for these large images in a hidden
    iframe; waiting for `load` works (printing needs nothing more).
  - Headless Chromium has no print dialog: `print()` returned in 3 ms. The real dialog is an owner
    check (and is exempt from the long-task rule, B4).
- **Viewer route**: a `blob:` PDF in an iframe is **blocked by the §10.1 CSP** (`frame-src` falls
  back to `default-src 'self'`). With only **`frame-src blob:`** added, it loads with no
  violation, and `data:` and cross-origin frames are still blocked.

## Options considered

**Printing large or high-DPI jobs** (drawings at A0/A1, or 600 DPI):

1. Raster only, with a pixel cap per page (e.g. ~100 MP: A0 at ≤ 200 DPI). No CSP change, but
   drawings print softer than vector.
2. **Raster by default, plus the browser-viewer route** for large/high-DPI jobs: the flattened
   copy (finding 4) in a `blob:` iframe, printed at vector quality by the browser's PDF viewer.
   Needs `frame-src blob:`. **Recommended** (ADR-001 B13 foresaw it).
3. Download the print-ready PDF and let the user print it elsewhere. Always available as a
   fallback, but a poor default.

**Where to flatten:** the Render worker holds the authoritative document and must not be
modified; the Work worker holds a read-only copy. A **separate temporary document in the Work
worker** (original + tail, opened under a new id, flattened, saved, closed) touches neither.

## Decision

1. **Passwords (M2-03):** open with the password in both workers; code 4 means "password needed"
   on the first try and "incorrect password" after one was sent. Passwords stay in worker memory
   only (M2-Q7), including for the Work worker's respawn reloads.
2. **Permissions (M2-03):** one revision-aware mapping from `FPDF_GetDocPermissions` to our
   capabilities (print, high-quality print, copy, annotate, fill forms, modify, assemble), with
   R2's rules (fill forms, assemble, accessibility and high-quality print follow bits 6, 4, 5 and
   3). The Render worker's tracker uses the same mapping (fixing its R2 case). Permissions are
   re-read after every unlock, never taken from `PdfDocumentObject.permissions` afterwards.
3. **Owner unlock (M2-03):** `unlockOwnerPermissions` on the open document in the Render worker
   **and** on the Work worker's copy (and again after each Work-worker reload).
4. **Forms (M2-14):** EmbedPDF's widget API; our own tab order (`/Tabs` `/R`, `/C`, and `/S` falling
   back to `/Annots` order); read-only enforced by us (UI and a Render-worker check);
   XFA detected with `FPDF_GetFormType` (2 or 3 → banner; 3 still fills the AcroForm part). The
   save tracker marks each changed widget's `/Parent` chain and sibling widgets dirty, so radio
   groups and multi-widget fields stay narrow.
5. **Print rasters (M2-15):** raw `FPDF_RenderPageBitmap` with `FPDF_ANNOT | FPDF_PRINTING`
   (markups on) or without `FPDF_ANNOT` (markups off) in the Work worker, in bands, encoded in the
   encoder worker; a page is a stack of band images. Printed through a hidden same-origin
   `about:blank` iframe, waiting for image `load`, never `decode()`. Raster pages capped at about
   100 MP each.
6. **Print-ready export (M2-16):** a temporary copy in the Work worker, `flattenPage(Print)` per
   page, full rewrite through our writer, `/AcroForm` removed from the output. Not
   `preparePrintDocument`.
7. _(Owner)_ **CSP:** add exactly **`frame-src blob:`** to §10.1 for the browser-viewer print
   route (option 2), used only by one helper that frames a `blob:` of type `application/pdf`
   made from our own flattened copy. Proposed §10.1 line:

   ```
   default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
   connect-src 'self'; img-src 'self' blob: data:; font-src 'self'; style-src 'self' 'unsafe-inline';
   frame-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
   ```

   If not approved, M2-16 ships option 1 + 3 (capped raster, and "Export Print-Ready PDF" to print
   elsewhere).

## Consequences

- **M2-03:** revision-aware permission map + tests for every bit and revision; the tracker uses it;
  unlock in both workers; password retry state machine.
- **M2-14:** dirty-set fix for `/Parent` and `/Kids` (the S11 radio case becomes a unit test that
  must save narrow and verify); read-only enforcement; tab-order function.
- **M2-15:** raw banded print renders (new Work-worker RPC with progress and cancel between bands);
  `load`-based iframe printing; the per-page pixel cap.
- **M2-16:** flatten-copy RPC in the Work worker; drop `/AcroForm` (small object-layer patch or
  PDFium dictionary call, decided in M2-16); the `frame-src blob:` change in `public/_headers`,
  `scripts/headers.ts`, ARCHITECTURE.md §10.1 and the CSP tests, only after approval.
- **Owner:** real print dialog in Chrome/Edge and Firefox (raster route), and, if decision 7 is
  approved, the viewer route on a physical or PDF printer.
- **Risks:** `frame-src blob:` allows any `blob:` frame our own code creates; a test keeps the one
  helper as its only user. Browsers without a built-in PDF viewer (or with it disabled) fall back
  to the raster route.

## Evidence

- Code: [`spikes/s11-secure-print/`](../../spikes/s11-secure-print/): `make-fixtures.ts`,
  `run-node.ts`, `main.ts`, `page.worker.ts`, `s11.spec.ts`, `frame-variant.ts`; resolve hook
  `spikes/shared/ts-ext.ts`.
- Commands:
  - `node --import ./spikes/shared/ts-ext.ts spikes/s11-secure-print/run-node.ts` →
    `spikes/s11-secure-print/out/s11-node.json` (needs qpdf);
  - `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium SPIKE=s11 npm run spikes -- --project=s11`:
    2/2 pass → `test-results/s11-results.json`.
- Source reading (2.15.1): `PdfiumNative.preparePrintDocument` (`FPDF_ImportPages`, byte-by-byte
  save), `renderRectEncoded` flags (no `FPDF_PRINTING`), `isOwnerUnlocked` / `unlockOwnerPermissions`.
