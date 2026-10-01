# PDFTools — Architecture & Product Specification (Rev 0.7)

**App:** PDFTools · **URL:** `pdf-tools.openengtools.com` · **Platform:** Open Engineering Tools (OET)
**Status:** Approved for implementation · **Last updated:** 01-Oct-2026 (Rev 0.7)
**Companion file:** `CLAUDE.md` (standing rules for the coding agent — read it first)

> This document is the single source of truth. Where code and this document disagree, this document wins until it is deliberately amended. Decisions are numbered (D-xx) so commits, issues and ADRs can reference them.

> **Rev 0.1 amendments** — applied from [ADR-001](docs/adr/001-session-1-clarifications.md) (session-1 clarifications B1–B16) and [ADR-002](docs/adr/002-license-policy-and-heavy-file-targets.md) (license policy, heavy-file targets). Amended passages cite the ADR item.

> **Rev 0.2 amendment** — [ADR-008](docs/adr/008-s7-snap-geometry.md) (owner-approved): a PDFium-free **Snap worker** answers pointer-time snap queries (§3.1, D-10, §7.4).

> **Rev 0.3 amendments** — M0 spike results, owner-approved: [ADR-003](docs/adr/003-s8-csp-wasm-workers-sw.md) (explicit font fallback, font split — §9), [ADR-004](docs/adr/004-s3-two-engines.md) (hosted Render worker, render cancellation, memory policy, COOP/COEP — §3.1, §10.1), [ADR-005](docs/adr/005-s1-incremental-save.md) (narrow-tail Ctrl+S — §4.2, §4.3), [ADR-006](docs/adr/006-s5-search-work-worker.md) (background indexing, context cap — §6), [ADR-007](docs/adr/007-s2-measure-viewport.md) (own object layer, encrypted files — §7.4) and [ADR-009](docs/adr/009-s4-pdf-oxide.md) (PDF Oxide gating, stream tables — §7.6, §7.7).

> **Rev 0.4 amendment** — [ADR-010](docs/adr/010-s6-fluent-icons.md) (owner-approved): Fluent **Regular** icons (Filled for active states) replace the deprecated Color style (D-20, §8).

> **Rev 0.5 amendment** — [ADR-017](docs/adr/017-m4-redaction.md) decisions 3 and 5 (owner-approved 2026-09-29): §7.9 steps 0 and 3 (crossing paths re-cut through PDFium's page-object API; wider sanitize list).

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
Document-centric desktop editor in the style of PDF-XChange Editor / Acrobat: PDFs open into **tabs**, every ribbon command acts on the **active document**, multi-file jobs (e.g. merge) open as dialogs.

### 1.4 Two reference document profiles (D-02)
All performance work and acceptance tests target both:

| Profile | Shape | What must be fast |
|---|---|---|
| **Contract** | A4, text-heavy, 1,000–2,000+ pages | open, scroll, search, outline navigation, thumbnails |
| **Drawing** | CAD-exported (AutoCAD / SmartPlant / E3D), < 100 MB, A0, dense vectors | pan, deep zoom to 6400 %, crisp tiled re-render, never freezes |

### 1.5 Non-goals for Rev 0
Tablet/phone UI · Safari parity · OCR · scanned-table extraction · PDF text/content editing · form design · XFA forms · revision compare (**parked, see §14**) · applying passwords / creating signatures · certificate trust validation · any server-side processing · any analytics beyond Cloudflare's server-side request counts (no analytics script; ADR-001 B1).

---

## 2. Decision log (summary)

| ID | Decision |
|---|---|
| D-01 | Document-centric editor, PDF-XChange-style layout (ribbon, tabs, left rail + panes, right Properties pane, status bar) |
| D-02 | Two reference document profiles — **Contract** and **Drawing** — drive all performance work and acceptance tests (§1.4) |
| D-03 | **Full annotation round-trip**: standard PDF annotation objects, readable/editable by Acrobat and PDF-XChange, and theirs by us |
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
| D-20 | Fluent UI System Icons (MIT), **Regular** style (Filled for active/toggled states; Color style is deprecated upstream — ADR-010); custom engineering icons drawn to match. Light theme default, token-based colors |
| D-21 | Installable PWA, `.pdf` file handler, single window (new files → new tabs) |
| D-22 | Network: zero from app except update checks + opt-in error report; strict CSP; analytics = Cloudflare **server-side** request counts only — no analytics script, no CSP exception (ADR-001 B1) |
| D-23 | Status schemes (presets + custom, export/import) drive stamps and CRS status; image stamps |
| D-24 | Signature panel with **offline integrity check**; trust shown as "not verified" |
| D-25 | Custom print dialog + "Export Print-Ready PDF" (flattened) |
| D-26 | Fill & save AcroForms; XFA → banner |
| D-27 | Acceptance targets in §12 are contractual for typical files; **heavy files are measure-and-report for Rev 0** (ADR-002) |
| D-28 | Standalone subdomain `pdf-tools.openengtools.com` |
| D-29 | Acrobat/PDF-XChange shortcut conventions; Windows alternates for browser-reserved keys |
| D-30 | English only at launch, fully i18n-ready; baseline keyboard + screen-reader accessibility |
| D-31 | Redaction in Rev 0 with strict safety rules (§7.9), using EmbedPDF's redaction engine (ADR-001 B8) |
| D-32 | Public beta only after M1–M4 complete; solo internal testing with **public or self-made PDFs only** |
| D-33 | Interop verified against **Acrobat Reader + PDF-XChange**. Bluebeam "expected, not verified" — never claimed publicly until confirmed |

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
| License gate | own script `scripts/check-licenses.ts` + `scripts/license-policy.ts` in CI | MIT (ours) |

**Forbidden:** GPL, LGPL-with-static-link concerns, AGPL (incl. PyMuPDF, Ghostscript, CoherentPDF, BentoPDF source), SSPL, "non-commercial" licenses, any runtime CDN dependency. MPL-2.0 is forbidden in anything that ships; it is allowed only for dev-only tooling that npm marks `dev` in the lockfile (e.g. Vite's lightningcss, axe-core) (ADR-002).

### 3.3 Repository layout

```
/src
  /app            shell: AppFrame, Ribbon, TabStrip, LeftRail, Panes, PropertiesPane, StatusBar, StartScreen
  /features       one folder per feature (view, search, annotate, measure, stamps, crs, extract,
                  tables, convert, pages, redact, forms, signatures, print, protect, settings, recovery)
  /engine         typed RPC clients for workers (renderClient.ts, workClient.ts), job/cancel/progress infra
  /workers        render.worker.ts, work.worker.ts
  /model          domain types: Annotation, StatusScheme, ScaleViewport, TableGrid, ReviewerProfile …
  /storage        opfs.ts, idb.ts, fileAccess.ts (FSA API + fallback)
  /i18n           en.json (+ future locales), format helpers (dates, numbers, units)
  /ui             design tokens, shared components, icon registry
/public           manifest assets, bundled fonts, _headers (CSP)
/functions/api    Cloudflare Pages Function: error-report endpoint
/tests            unit tests (Vitest)
/e2e              Playwright: functional, perf, offline, interop-prep
/corpus           manifest + download script for PUBLIC test PDFs (files git-ignored); owner-supplied local files
/scripts          tooling (license gate, corpus download)
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
- Status bar: page nav, zoom, view mode, **Enable Snapping**, "✓ Ready offline" / "Preparing offline… n %", "Update ready".

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
Types: **every annotation type/tool supported by EmbedPDF** (ADR-001 B7). No custom appearance-stream generation in Rev 0. Mapping from the required set (EmbedPDF v2.15.1 tool ids):

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
- **Comment transfer:** import comments from another PDF (e.g. an earlier revision; page range, filters, page mapping, duplicates skipped by `/NM`) or from our JSON export, and copy/paste comments between documents; imported comments are standard annotation objects saved by the next Ctrl+S (ADR-018).
- **Auto-numbering**: each markup gets a sequence number shown in the comments pane and optionally on-page; used by the CRS export.

### 7.2 Reviewer profile (D-16)
First markup triggers a dialog: name, initials, discipline, company (optional). Stored in IndexedDB. Editable in Settings. Fills annotation author, stamps, CRS columns.

### 7.3 Status schemes & stamps (D-23)
- `StatusScheme = { id, name, codes: [{ code, label, color }] }`. Presets (e.g. 1/2/3/4; A/B/C/D; Approved / Approved as Noted / Revise & Resubmit / Rejected / For Information).
- Custom schemes; export/import as `.pdftools-scheme.json`.
- Dynamic stamps generated from active scheme: code, label, reviewer, date, doc number/rev. Written as Stamp annotations with appearance streams.
- Image stamps: import PNG/JPG/PDF page.

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
| Annotations | own serializer → CSV / XLSX / JSON (JSON also imports, §7.1) | — |

PDF Oxide runs in the Work worker, lazy-loaded (non-core) from a self-hosted WASM URL and warmed up in the background after init. **Every Oxide call is gated by PDFium's permission check** — Oxide itself ignores permission flags (D-19, ADR-009). Search keeps PDFium text extraction (§6).

### 7.7 Table extraction (beta)
- Text-layer PDFs only (scanned → message "requires OCR — planned").
- Detection candidates: (1) **lattice** — ruling lines from vector paths (PDF Oxide's table output is exact here); (2) **stream** — our own text alignment/whitespace-column detector (PDF Oxide does not detect unruled tables — ADR-009). Merge/score candidates. Merged header cells come from the grid model, not the engine.
- **Express Extract**: Find Tables → auto-detect selected pages → Save… as XLSX/CSV, no review (two clicks: the save picker needs a fresh click, and nothing is created when no table is found — [ADR-019](docs/adr/019-m4-express-extract-two-steps.md)).
- **Review & Extract**: proposed outlines as overlays → accept / adjust grid (drag/add/remove row & column dividers, mark header rows, merged cells) / draw manually → preview → export. Saved **templates** apply the same grid to other pages.
- Test fixture of record: a public pipe dimension chart style table (side-by-side tables, merged headers, multi-row cells, dual units).

### 7.8 Page operations
Rotate, delete, insert (blank / from file), extract to new PDF, merge files, reorder via thumbnails drag. Page ops that rewrite content streams mark the doc as "optimize recommended".

### 7.9 Redaction (D-31)
0. Engine: EmbedPDF redaction (`plugin-redaction`; engine `redactTextInRects` / `applyRedaction` / `applyAllRedactions`) — no custom content-stream rewriter; the geometry of path objects crossing a redacted rectangle may be re-cut through PDFium's page-object API (ADR-001 B8, ADR-017 decision 3). Steps 2–5 wrap it.
1. Mark (text selection or area) → pending list → review → **Apply**.
2. Apply **always** produces a **new file via Save As** with a **full rewrite**; never incremental; never overwrites the original by default.
3. Sanitize: document Info + XMP metadata, embedded page thumbnails, structure tree (tagging), JavaScript, embedded files and private application data; annotations / form values / bookmarks / links intersecting redacted areas (ADR-017 decision 5).
4. Signed document → warn that signatures will be invalidated.
5. **Post-redaction verification** (by location — ADR-001 B3): reopen the output in the Work worker and confirm that **no text, image pixels or vector content remain inside any redacted rectangle**; additionally search for each redacted string that does not also occur outside the redacted areas. Success is reported only if both checks pass; otherwise fail loudly.

### 7.10 Forms (D-26)
Fill & save AcroForm text, checkbox, radio, combo, list; tab order; reset form. Saved incrementally. XFA → banner "XFA forms are not supported."

### 7.11 Signatures (D-24)
Signature pane: signer, time, reason, location, covered revision. Integrity: hash of byte ranges vs CMS message digest (PKI.js) → "Unchanged since signing" / "Modified after signing". Trust: always "Not verified (offline)". Never contacts OCSP/CRL.

### 7.12 Protected PDFs (D-19)
Open-password prompt; read permission flags; disable restricted commands with an explanatory banner; owner password grants full access. Never bypass restrictions.

### 7.13 Print (D-25)
Own dialog: range (all, current page, current view, selected area, custom), fit / actual / custom %, markups on / off / only, quality (standard / high DPI for drawings), orientation auto. Renders pages in the Work worker (refreshed to the current revision first, annotations included) at the chosen DPI into a print iframe. **Export Print-Ready PDF**: copy with annotations flattened (vector-quality elsewhere). For large/high-DPI jobs, printing the flattened print-ready PDF through the browser's built-in PDF viewer is acceptable; the required narrowly scoped `frame-src blob:` CSP addition is designed in M2 (ADR-001 B13).

---

## 8. UI specification

- Ribbon tabs (Rev 0) — this list is authoritative; `docs/ui-reference/` images are layout-only, and out-of-scope commands are omitted rather than shown disabled (ADR-001 B6): **File** (backstage: open, recent, save, save as, save optimized, print, properties, settings, about/privacy), **Home**, **View**, **Comment**, **Measure**, **Organize**, **Convert**, **Protect** (redact, security info, signatures), **Help**.
- Large (32 px) and small (16/20 px) buttons, groups with labels, split buttons and dropdowns, collapsible ribbon, keyboard access (Alt key tips — nice-to-have).
- Icons: Fluent System Icons **Regular** style (Filled for active/toggled states), colored via design tokens (`currentColor`); small buttons use 20 px glyphs, large (32 px) buttons use the native 32 px glyph or the 28/24 px glyph scaled up. The 23 missing icons listed in [ADR-010](docs/adr/010-s6-fluent-icons.md) and [S6-icon-map.md](docs/plan/S6-icon-map.md) (incl. cloud, calibrate, scale viewport, CRS export, stamp; express extract uses Fluent `TableLightning`) are drawn in the same grid/line style in `/src/ui/icons`. Fluent icons are imported per icon by path, via one registry (ADR-010).
- Design tokens (color, spacing, type, radius, elevation) as CSS variables; light theme default; dark theme deferred but tokens must support it.
- Layout minimum 1280 px wide.
- Start screen: open file, drop zone, recent files (clearable).
- **Do not copy PDF-XChange artwork or proprietary visual assets.** Layout conventions only.

### 8.1 Keyboard (D-29)
Ctrl+O/S/P, Ctrl+Shift+S, Ctrl+Z/Y, Ctrl+F, Ctrl+Shift+F, Ctrl+0/1/2 (fit page / actual / fit width), Ctrl+= / Ctrl+-, H (hand), V (select), single-letter tool keys, **Ctrl+F4** close tab, **Ctrl+PageUp/PageDown** switch tabs, Esc cancels tool. Help → printable shortcut sheet. Ctrl+F4 and Ctrl+PageUp/PageDown are reserved by Chrome in a normal tab (may work in the installed PWA window); alternates are defined in M1 (ADR-001 B5).

### 8.2 i18n & accessibility (D-30)
No user-visible string literals in components — all via i18n keys in `en.json`. Locale-aware dates/numbers/units via `Intl`. Layouts tolerate +40 % label length. Every control keyboard-reachable with visible focus and an accessible name.

---

## 9. Offline, PWA & updates (D-17, D-18)

- Service worker precaches the **core** (shell, UI, Render worker, PDFium WASM, base fonts) first; after first render, background-precaches the rest (Work worker, PDF Oxide WASM, CJK/extra fonts, ExcelJS, docx). Status bar shows progress then "✓ Ready offline".
- A feature used before its module is cached triggers a priority fetch with a spinner.
- Fonts bundled; **EmbedPDF CDN font fallback disabled** (`fontFallback: null` or local config with absolute same-origin URLs — never `undefined`, ADR-003). Fallback fonts: Regular weight only; Latin, Arabic and Hebrew in core, SC/TC/JP/KR in the background precache (ADR-003). No runtime CDN anything. EmbedPDF defaults both `pdfium.wasm` and `@embedpdf/fonts-*` to `cdn.jsdelivr.net`; both must be overridden with self-hosted copies (verified in M0-S8).
- Updates: new SW installs in the background; app shows "Update ready" and activates only on user click or next launch; never while documents are open.
- Total install budget ≤ 60 MB (measure and report per module in CI).

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

### 10.3 Local data
IndexedDB: profile, schemes, settings, recent-file handles, table templates. OPFS: recovery snapshots. Privacy page lists all of it; Settings → "Clear all local data".

---

## 11. Testing strategy

- **Unit (Vitest):** geometry, scale math, snapping index, table grid logic, CRS builder, scheme import/export, i18n completeness (no missing keys), format helpers.
- **E2E (Playwright, Chromium):** open/save/recover flows, annotation create/edit/delete/reply, measurement, CRS export, extraction, redaction verification, forms, protected PDFs, print dialog.
- **Performance (Playwright + `PerformanceObserver` longtask):** runs the §12 targets on the corpus; **any long task > 100 ms fails the build** for scripted scenarios (scroll, zoom, search, save). Exempt: cold app boot (bundle evaluation) and the browser's native print dialog (ADR-001 B4). Heavy-file scenarios are measured and reported, not gating (ADR-002).
- **Offline test:** context offline after first load → every Rev 0 feature must work; assert zero outbound requests during document work.
- **Round-trip (manual checklist, per milestone):** files created here opened/edited in Acrobat Reader and PDF-XChange (free mode), and vice versa. Checklist lives in `/e2e/interop/CHECKLIST.md`. The agent prepares files and checklists; the owner runs them on Windows (ADR-001 B16).
- **Corpus:** public-domain sources (e.g. the US Federal Acquisition Regulation for the Contract profile; pdf.js test PDFs, veraPDF corpus, DARPA SafeDocs, checked per file) plus self-made files. Copyrighted standards (ASME, ISO) are never used. No synthetic generation of heavy files: the ~500 MB contract, dense drawings and P&IDs are **owner-supplied local files**, never committed and not listed by URL (ADR-001 B15, ADR-002). **Never company documents.** Large files are git-ignored and fetched by script.

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
| Round-trip | standard markups interoperate with Acrobat Reader + PDF-XChange, both directions |
| Offline proof | network off → all Rev 0 features work; zero outbound requests during document work |

---

## 13. Milestones

### M0 — Spikes (de-risk before building UI)
Each spike ends with a short ADR: works / workaround / blocker.
- **S1** Incremental save + full-rewrite save through EmbedPDF/PDFium.
- **S2** Writing Measure/Viewport dictionaries and reading them back in Acrobat Reader & PDF-XChange.
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

---

## 14. Roadmap after Rev 0

**Rev 1 (in order):** 1. OCR (scanned docs, search in scans, scanned tables) · 2. CRS round-trip import + custom column templates · 3. Protect: apply password/permissions, create digital signatures from user's certificate file (offline) · small items: stamp designer, shortcut remapping, poster tiling.

**Rev 2+:** PDF text editing · form design · advanced page tools (headers/footers, watermarks, Bates) · tablet UI · local folder search · native wrapper (.exe/.msi) · dark theme.

**Parked:** Revision compare for drawings — **blocked pending the owner's employment-agreement / IP clearance.** Do not design or build until explicitly unblocked. If later cleared: clean-room implementation from public techniques only.

**Extension points to reserve in Rev 0:** OCR text layer can be injected per page into the Work worker's text index; view layer supports a future two-document synchronized view.

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
