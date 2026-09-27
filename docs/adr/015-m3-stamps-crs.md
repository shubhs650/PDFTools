# ADR-015: M3-02 — Dynamic stamps, the CRS workbook (ExcelJS) and markup snapshots

- **Status:** Accepted (owner, 2026-09-27): decision 1 option 1 (PNG image stamps at 4×),
  decision 2 option 2a (ExcelJS 4.4.0 with the `unzipper@0.12.3` override, added in M3-19).
- **Date:** 2026-09-27
- **Deciders:** Owner (decisions 1 and 2, accepted 2026-09-27); recorded by the coding agent
- **Related decisions:** D-12, D-15, D-23, §3.1, §3.2, §7.3, §7.5; ADR-001 B7; ADR-002; ADR-003;
  ADR-013 decision 6 (Work copy with unsaved edits); ADR-014 decision 3 (annotation tiles);
  CLAUDE.md rules 1, 2, 4, 5 and 10; M3-Q4, M3-Q9
- **Related spike / milestone:** M3-02 (feeds M3-14, M3-19)
- **Outcome (spikes only):** **Works with workaround.** Stamps drawn into a PNG in a worker are
  as sharp as vector text up to 400 % and softer beyond. ExcelJS's browser bundle builds a
  1,000-row CRS with 1,000 images in a worker under the §10.1 CSP with no long task, but its
  installed dependency tree contains a package with **no license** (`buffers@0.1.1`), so it
  can't be adopted as is. Snapshots are fast only with the ADR-014 annotation-tile route.

## Context

- §7.3 / D-23: dynamic stamps from the active status scheme (code, label, reviewer, date, doc
  number/rev), written as Stamp annotations **with appearance streams**; B7 forbids appearance
  code of ours, and EmbedPDF's stamp tool takes images (M3-Q4).
- §7.5 / D-15: CRS export to Excel with an optional snapshot of each markup region per row; CSV
  without images. §3.1 puts XLSX building in the Work worker; §3.2 names ExcelJS (MIT).
- M3-Q9 (approved): add ExcelJS in this spike and run the license gate; if any package fails,
  stop and report.

## Setup

- **Browser spike** [`spikes/s13-stamps-crs/`](../../spikes/s13-stamps-crs/) (`main.ts`,
  `stamp.worker.ts`, `xlsx.worker.ts`, `s13.spec.ts`): served by `spikes/shared/serve.ts` with the
  §10.1 CSP verbatim, a Report-Only copy, and COOP/COEP.
  - `stamp.worker.ts`: `OffscreenCanvas` + `FontFace` with the self-hosted **Noto Sans Regular**
    (ADR-003: Regular weight only), a 170 × 60 pt stamp (frame, "B Approved as Noted", reviewer ·
    date, document · revision) at 1, 2, 4 and 8 px per point, PNG. The Playwright side creates it
    as an EmbedPDF image stamp in PDFium and renders it at 100 %, 400 % and 1600 %, next to the
    same text as a FreeText annotation (PDFium's vector appearance).
  - `xlsx.worker.ts`: ExcelJS 4.4.0's browser bundle (`dist/exceljs.min.js`) in a module worker:
    a CRS-shaped sheet (merged title and header block, the §7.5 columns, one 300 × 200 PNG per row
    anchored in the Snapshot column), a cancel check between rows, `writeBuffer`, bytes
    transferred to the page; read back in Node with ExcelJS.
- **Node harness** [`spikes/s13-stamps-crs/run-node.ts`](../../spikes/s13-stamps-crs/run-node.ts):
  256-px snapshots around markups on `markedContractPdf` and `markedSheetPdf` (ADR-014), by
  PDFium's annotation flag vs content crop + ADR-014 annotation tile.
- ExcelJS was installed **for the spike run only** (`npm install --no-save exceljs@4.4.0`, with
  the override in option 2a); `package.json` and the lockfile are unchanged.
- **Environment:** cloud container, 4 cores, Node 22, headless Chromium 151. Informative numbers.

## Findings

### 1. Stamps as PNG image stamps (M3-Q4)

| Stamp bitmap (px per pt) | Draw in worker | PNG     | File growth | Edge softness at 100 % / 400 % / 1600 % |
| ------------------------ | -------------- | ------- | ----------- | --------------------------------------- |
| 1×                       | 26 ms (cold)   | 8.5 KB  | 10.7 KB     | 0.69 / 0.69 / 0.69                      |
| 2×                       | 4 ms           | 21.9 KB | 20.3 KB     | 0.72 / 0.67 / 0.42                      |
| **4×**                   | 6 ms           | 48 KB   | **42 KB**   | 0.69 / **0.23** / 0.23                  |
| 8×                       | 12 ms          | 100 KB  | 89 KB       | 0.69 / 0.24 / 0.24                      |
| FreeText (vector)        | —              | —       | —           | 0.82 / 0.24 / **0.07**                  |

Edge softness = share of pixels between page white and full ink among all ink pixels (lower is
crisper; 100 % is anti-aliasing for every route). A 4× PNG matches vector text up to 400 % and
is visibly softer at 1600 %; 8× buys nothing more here. The font loads from our origin (0 CSP
violations, 0 long tasks); only the Regular weight exists, so "bold" stamp text would be
synthesized. The spike sets the stamp's `contents` to its text so it stays searchable and listed
in other viewers' comment panes; M3-14 checks that it lands in `/Contents`.

### 2. ExcelJS in a worker

| Case (1,000 rows)         | Build rows | Snapshots (synthetic canvas) | `writeBuffer` (zip) | File                 |
| ------------------------- | ---------- | ---------------------------- | ------------------- | -------------------- |
| Text only                 | 12 ms      | —                            | 85 ms               | 48 KB                |
| One 300 × 200 PNG per row | 32 ms      | 1.8 s                        | **606 ms**          | 3.1 MB               |
| Cancelled at row 300      | —          | —                            | —                   | stopped after 0.54 s |

- 0 main-thread long tasks and 0 CSP violations reported to the page; only the finished
  bytes reach the page (transferred). The bundle's one `new Function` is a `setImmediate` polyfill path
  for string callbacks, never taken.
- `writeBuffer` is one uninterruptible step (0.6 s for 1,000 images): cancel works between rows,
  and again after the zip.
- Read back: title merged across A1:K1, the 11 §7.5 headers, 50 of 50 images anchored at the
  Snapshot column of their rows.
- Worker chunk: **934 KB raw, 258 KB gzip, 202 KB brotli** (non-core, background precache; well
  inside the 60 MB budget).

### 3. The license gate

`npm install exceljs@4.4.0` adds 97 packages; the gate fails on three, all under
`exceljs → unzipper@0.10.14 → binary@0.3.0`:

| Package          | Declared    | License text                                    |
| ---------------- | ----------- | ----------------------------------------------- |
| `traverse@0.3.9` | "MIT/X11"   | MIT text in `LICENSE`                           |
| `chainsaw@0.1.0` | "MIT/X11"   | none shipped                                    |
| `buffers@0.1.1`  | **nothing** | **none** (no field, no file; last release 2011) |

`unzipper` is used only by ExcelJS's **Node streaming reader** (`lib/stream/xlsx/workbook-reader.js`);
the browser bundle we would import contains none of the four packages. `buffers` has no license
at all, so a reasoned exception (CLAUDE.md rule 5) is not possible for it.

With an npm `overrides` entry `{"exceljs": {"unzipper": "0.12.3"}}` (unzipper 0.12 no longer
uses `binary`; its dependencies are `bluebird`, `duplexer2`, `fs-extra`, `graceful-fs`,
`node-int64`, all permissive), the tree loses 16 packages and the gate passes: **709 packages
comply**. The spike's numbers above were taken with this override.

### 4. Snapshots of markup regions

256-px snapshots with the markups drawn, on the Work worker's copy (the ADR-013 route that
includes unsaved edits):

| Document                      | Snapshots | PDFium annotation flag     | Content crop + ADR-014 annotation tile |
| ----------------------------- | --------- | -------------------------- | -------------------------------------- |
| Contract stand-in, 5 per page | 1,000     | p50 2.9 ms, total 3.1 s    | **p50 1.3 ms, total 1.3 s**            |
| Dense A0, 1,000 markups       | 200       | p50 364 ms, **total 72 s** | **p50 2.3 ms, total 0.5 s**            |

Encoding adds about 2 ms per image in a worker canvas (the xlsx run: 1.8 s for 1,000 drawn and
encoded snapshots).

### 5. CSV

No dependency: UTF-8 with BOM (Excel opens it as UTF-8), CRLF, RFC 4180 quoting, and a
formula-injection guard (a cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`).

## Options considered

**Stamps (decision 1)**

1. **PNG image stamp at 4× the placed size** (default proposal). No appearance code of ours;
   sharp up to 400 %; ~40 KB per stamp.
2. **Vector stamp appearance** written by our object layer (a fixed form XObject: frame and text
   with a standard font). Crisp at every zoom, ~1 KB per stamp; it is appearance-stream code
   of our own, so it needs a B7 exception.

**The workbook library (decision 2)**

1. ExcelJS as installed. Fails the gate (`buffers` has no license). Not possible.
2. **a) ExcelJS 4.4.0 + `overrides: { exceljs: { unzipper: "0.12.3" } }`.** Gate passes (709
   packages). The override only touches a Node-only reader we never import; a unit test can
   assert that the built worker chunk contains no `unzipper`. Risk: ExcelJS's last release is
   4.4.0 (2023), and an override is one more thing to re-check on upgrades. **Recommended.**
   b) As 2a, plus reviewed exceptions for `chainsaw`/`traverse`: unnecessary once the override
   removes them.
3. **Our own minimal XLSX writer** (SpreadsheetML + DrawingML for images, zipped with
   `CompressionStream`): no dependency, full control, roughly 400–600 lines plus tests; §3.2 names
   ExcelJS, so this changes ARCHITECTURE.md (ADR needed).
4. CSV only. Loses the snapshots §7.5 requires. Rejected.

**Snapshots**

1. PDFium's annotation flag on each crop. Fine for typical files, **72 s** for 200 snapshots on a
   markup-heavy sheet.
2. **Content crop + annotation tile** (ADR-014 decision 3's renderer, reused in the Work worker).
   **Recommended.**

## Decision

1. _(Owner)_ **Stamps:** option 1, PNG image stamps at 4× the placed size, drawn in a worker with
   the bundled Regular font; `/Contents` holds the stamp text. Choose option 2 instead if crisp
   stamps at 1600 % matter more than B7 (then a follow-up ADR amends B7 for stamps only).
2. _(Owner)_ **Workbook:** option 2a, ExcelJS 4.4.0 with the `unzipper` override, added in M3-19
   with the license gate, lazy-loaded in the Work worker, non-core. If you prefer no override,
   option 3.
3. **Snapshots:** content crop + annotation tile in the Work worker, on the copy with unsaved
   edits, encoded there with `OffscreenCanvas`; progress per row and cancel between rows (rule 2).
4. **CSV:** our own writer (UTF-8 BOM, CRLF, RFC 4180, formula guard).

No ARCHITECTURE.md change for decisions 1 (option 1), 2 (option 2a), 3 and 4.

## Consequences

- **M3-14:** stamp worker (or the encoder worker) draws the PNG; the scheme preview uses the same
  code; sizes and the 4× factor live in one place.
- **M3-19:** `exceljs` pinned exactly with the override in `package.json`; a test asserts the
  built Work-worker chunk has no `unzipper`/`binary`; the annotation-tile renderer moves to
  shared worker code (`src/workers/shared/`) for the Render and Work workers; the bundle report's
  reserved ExcelJS line gets its number (~0.2 MB brotli).
- **Risks:** ExcelJS maintenance (4.4.0, 2023); `writeBuffer` holds the whole workbook in memory
  (3 MB for 1,000 snapshots; the Work worker's respawn policy covers the peak); stamps in scripts
  outside Latin need the matching fallback font in the stamp worker (CJK is background-precached,
  ADR-003).

## Evidence

- Code: [`spikes/s13-stamps-crs/`](../../spikes/s13-stamps-crs/); the annotation-tile renderer
  from [`spikes/s12-annotate/annot-tiles.ts`](../../spikes/s12-annotate/annot-tiles.ts).
- Commands:
  - `npm install --no-save exceljs@4.4.0` after adding the override to `package.json` (then
    restore it), and
    `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium SPIKE=s13 npm run spikes -- --project=s13`:
    2/2 pass → `spikes/test-results/s13-results.json`;
  - `node --import ./spikes/shared/ts-ext.ts spikes/s13-stamps-crs/run-node.ts` →
    `spikes/s13-stamps-crs/out/s13-node.json`;
  - `npm run licenses` with ExcelJS installed: 3 violations (table above); with the override:
    "All 709 packages comply".
- Source reading: ExcelJS 4.4.0 `package.json` (`browser: dist/exceljs.min.js`),
  `lib/stream/xlsx/workbook-reader.js` (the only `unzipper` user), the bundle's `new Function`
  (`setImmediate` polyfill); `unzipper@0.12.3` dependencies.
