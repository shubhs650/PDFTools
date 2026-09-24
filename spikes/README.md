# M0 spikes

Throwaway spike code for [docs/plan/M0.md](../docs/plan/M0.md). Nothing here is imported by
`/src` or shipped. Each spike ends with an ADR in `docs/adr/`.

| Spike | Folder                               | ADR                                                  | Outcome               |
| ----- | ------------------------------------ | ---------------------------------------------------- | --------------------- |
| S8    | [`s8-csp/`](s8-csp/)                 | [ADR-003](../docs/adr/003-s8-csp-wasm-workers-sw.md) | Works with workaround |
| S3    | [`s3-two-engines/`](s3-two-engines/) | [ADR-004](../docs/adr/004-s3-two-engines.md)         | Works with workaround |

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
SPIKE=s3 npm run spikes -- --project=s3   # raw numbers → test-results/s3-results.json
npm run typecheck:spikes
```

### Owner runs with local files (S3)

```sh
npx vite build --config spikes/s3-two-engines/vite.config.ts
node spikes/shared/serve.ts --root spikes/s3-two-engines/dist --port 4181 --corpus corpus
# open http://localhost:4181/?src=/corpus/files/<file>   (mode=stock|hosted)
# or use the file picker: it runs deep zoom and the concurrency bench and prints JSON.
```
