# Spikes

Throwaway spike code for [docs/plan/M0.md](../docs/plan/M0.md) (S1–S8) and M1-01 (S9,
[docs/plan/M1.md](../docs/plan/M1.md)). Nothing here is imported by
`/src` or shipped. Each spike ends with an ADR in `docs/adr/`.

| Spike | Folder                                   | ADR                                                  | Outcome               |
| ----- | ---------------------------------------- | ---------------------------------------------------- | --------------------- |
| S8    | [`s8-csp/`](s8-csp/)                     | [ADR-003](../docs/adr/003-s8-csp-wasm-workers-sw.md) | Works with workaround |
| S3    | [`s3-two-engines/`](s3-two-engines/)     | [ADR-004](../docs/adr/004-s3-two-engines.md)         | Works with workaround |
| S1    | [`s1-save/`](s1-save/)                   | [ADR-005](../docs/adr/005-s1-incremental-save.md)    | Works with workaround |
| S5    | [`s5-search/`](s5-search/)               | [ADR-006](../docs/adr/006-s5-search-work-worker.md)  | Works with workaround |
| S2    | [`s2-measure/`](s2-measure/)             | [ADR-007](../docs/adr/007-s2-measure-viewport.md)    | Works with workaround |
| S7    | [`s7-snap/`](s7-snap/)                   | [ADR-008](../docs/adr/008-s7-snap-geometry.md)       | Works with workaround |
| S4    | [`s4-oxide/`](s4-oxide/)                 | [ADR-009](../docs/adr/009-s4-pdf-oxide.md)           | Works with workaround |
| S6    | [`s6-icons/`](s6-icons/)                 | [ADR-010](../docs/adr/010-s6-fluent-icons.md)        | Works with workaround |
| S9    | [`s9-plugins/`](s9-plugins/) (M1-01)     | [ADR-011](../docs/adr/011-m1-embedpdf-plugins.md)    | Works with workaround |
| S12   | [`s12-annotate/`](s12-annotate/) (M3-01) | [ADR-014](../docs/adr/014-m3-annotations.md)         | Works with workaround |

## Shared pieces (`shared/`)

- `public/_headers`: the ARCHITECTURE §10.1 CSP, **verbatim**, in Cloudflare Pages format.
- `serve.ts`: a static server that applies `_headers` like Pages does. `wrangler` is not used
  because it pulls in LGPL `sharp`/libvips (see ADR-003). Flags:
  - `--report`: adds a report-only copy of the CSP and collects violations at `/__csp-reports`;
  - `--corpus <dir>`: serves test PDFs under `/corpus/`;
  - `--coi`: adds COOP/COEP.
- `vite-assets.ts`: self-hosts `pdfium.wasm`, a Noto Sans SC fallback font, and the self-made
  fixtures.
- `mini-pdf.ts`: a tiny PDF writer for self-made fixtures, such as the non-embedded CJK font test
  page.
- `probe.ts`: main-thread `longtask` and `securitypolicyviolation` probes.

## Running

```sh
# All spikes (build, serve, Playwright). In the cloud container, add
# PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium.
npm run spikes
SPIKE=s8 npm run spikes -- --project=s8
SPIKE=s9 npm run spikes -- --project=s9   # M1-01: EmbedPDF plugins (ADR-011)
# M3-02 needs ExcelJS for the run only: see ADR-015 (npm install --no-save exceljs@4.4.0)
SPIKE=s13 npm run spikes -- --project=s13
SPIKE=s3 npm run spikes -- --project=s3   # raw numbers → test-results/s3-results.json
npm run typecheck:spikes

# S1 correctness matrix (needs the qpdf and openssl CLIs; qpdf: `apt-get install qpdf`)
node spikes/s1-save/make-fixtures.ts && node spikes/s1-save/run-node.ts   # → spikes/s1-save/out/
SPIKE=s1 npm run spikes -- --project=s1   # browser timings → test-results/s1-results.json
npx vitest run spikes                     # unit tests (narrow-tail writer, search core)

# S2 measurement structures (needs qpdf): writes, reads back, builds the interop pack
node spikes/s2-measure/run-node.ts
node spikes/s2-measure/read-measure.ts <file.pdf>   # owner: read a viewer-saved file

# S7 snapping geometry: correctness + performance (owner: pass local drawings as arguments)
node spikes/s7-snap/run-node.ts [drawing.pdf …]
SPIKE=s7 npm run spikes -- --project=s7

# S4 PDF Oxide: size, API, quality, throughput vs PDFium (owner: pass local files, e.g. the pipe chart)
node spikes/s4-oxide/run-node.ts [file.pdf …]   # → spikes/s4-oxide/out/s4-node.json, out/review/*.md
SPIKE=s4 npm run spikes -- --project=s4        # worker under CSP → test-results/s4-results.json

# S6 Fluent icon coverage: map doc, bundle cost, preview sheet (out/s6-preview.html)
node spikes/s6-icons/bundle.ts && node spikes/s6-icons/icon-map.ts   # → docs/plan/S6-icon-map.md

# S5 search while scrolling (self-made 2,000-page contract stand-in)
node spikes/s5-search/make-contract.ts && SPIKE=s5 npm run spikes -- --project=s5
```

### Owner run: real-disk Ctrl+S timing (S1)

Serve the S1 build as for S3 below (use `spikes/s1-save`). Click **Append-save test on a real
file** and pick a **copy** of a PDF: the tool appends 100 markups to it and reports the timings.

### Owner runs with local files (S3)

```sh
npx vite build --config spikes/s3-two-engines/vite.config.ts
node spikes/shared/serve.ts --root spikes/s3-two-engines/dist --port 4181 --corpus corpus
# open http://localhost:4181/?src=/corpus/files/<file>   (mode=stock|hosted)
# or use the file picker: it runs deep zoom and the concurrency bench and prints JSON.
```
