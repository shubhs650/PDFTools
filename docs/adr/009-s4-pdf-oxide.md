# ADR-009: S4 — PDF Oxide WASM for extraction and conversion

- **Status:** Proposed (agent part of the spike done; owner decisions and owner-file runs pending)
- **Date:** 2026-09-24
- **Deciders:** Owner; recorded by the coding agent
- **Related decisions:** D-10, D-17, D-19, D-12 (ARCHITECTURE.md §3.1, §7.6, §7.7, §9); ADR-002;
  ADR-004; ADR-006; CLAUDE.md rules 1, 2, 4, 5 and 9
- **Related spike / milestone:** M0-S4 (feeds M2 extraction and M3 tables)
- **Outcome (spikes only):** **Works with workaround.** The WASM build has every API §7.6 needs. It
  is small enough, runs cleanly in a worker under the CSP, and cancels between pages. Ruled
  (lattice) tables are extracted exactly. Unruled (stream) tables are not detected at all, so our
  own stream detector (§7.7 candidate 2) is required. Oxide does not enforce PDF permission flags,
  so we must gate it with PDFium first.

## Context

§7.6 plans PDF Oxide (`pdf-oxide-wasm`) as the engine for plain text, Markdown, HTML and images.
§7.7 lists its table output as one of three table candidates. The architecture puts it in the Work
worker next to PDFium #2, loaded after core precache (D-17). S4 has to confirm the WASM build's API,
size, licensing, network behavior, speed and quality. See
[M0 plan §S4](../plan/M0.md#s4--pdf-oxide-wasm-size-markdownhtmltable-quality-wasm-api-availability).

## Setup

- **Package:** `pdf-oxide-wasm` 0.3.77 from npm (`MIT OR Apache-2.0`), web build
  (`pdf-oxide-wasm/web`). It has no npm dependencies.
- **Node harness** (`spikes/s4-oxide/run-node.ts`): size, init, quality on self-made fixtures,
  throughput against a PDFium baseline, and the public corpus.
- **Self-made fixture** (`fixtures.ts`, 4 pages, fictional values; no standard is reproduced):
  1. a fully ruled **lattice** table in the style of a pipe chart (5 × 9, 45 cells);
  2. an unruled **stream** parts list (5 × 9, 45 cells);
  3. a ruled table with **merged header** cells ("Mark" spans two rows, "Dimensions mm" spans three
     columns);
  4. a **structure** page: H1 at 22 pt, H2 at 15 pt bold, two text columns, a bullet list and a
     numbered list.
- **Throughput input:** the self-made 2,000-page contract stand-in from S5. The FAR can't be fetched
  from the container (see PROGRESS open issues).
- **Browser check** (`oxide.worker.ts`, `main.ts`, `s4.spec.ts`): Oxide in a module worker under
  the §10.1 CSP, verbatim. The WASM is self-hosted at `/oxide/pdf_oxide_bg.wasm` and passed as an
  explicit URL.
- **Environment:** Node 22 and headless Chromium on a 4-core container. The numbers are
  informative.

## Findings

1. **API.** The WASM build exposes everything §7.6 and §7.7 need, per page:
   - `toPlainText`, `toMarkdown(page, detectHeadings, includeImages, includeFormFields)` and
     `toHtml`;
   - `extractTables(page, region?)`, which returns cells with bounding boxes, header flags, and row
     and column counts;
   - `extractImages`, `extractWords`, `extractLines`, `extractPaths`, `extractRects`,
     `extractStructured` and `search`;
   - `toDocxBytes` and `toXlsxBytes`, plus editing, form and signing APIs we don't plan to use.

   A document opens from bytes with an optional password. Results come back as JS `Map`s, not plain
   objects, so a small converter is needed.

   **There is no permission API.** Oxide opened the RC4-encrypted public catalogue in `corpus/`
   and extracted its text without any check. It exposes only `authenticate(password)` and
   encryption on save.

2. **Size.** `pdf_oxide_bg.wasm` is 17.64 MB raw, **6.48 MB gzip** and **4.45 MB brotli**. The
   glue JS is 283 KB (25 KB brotli). This meets the ≤ 10 MB brotli target and the 60 MB install
   budget (§9).
3. **Licensing.**
   - The npm package declares `MIT OR Apache-2.0`, but it ships no LICENSE file. The crate
     repository has `LICENSE-MIT`, `LICENSE-APACHE`, a `NOTICE` and `TRADEMARKS.md`.
   - **The Rust dependency tree compiled into the WASM is all permissive.** The audit ran
     `cargo tree` for `wasm32-unknown-unknown` with the published feature set. It found 394
     packages and 19 distinct SPDX expressions, and every one passes
     `scripts/license-policy.ts`. A GPL-3.0 negative control was flagged.
   - `npm run licenses` passes.
   - The trademark policy allows descriptive use only, such as "uses PDF Oxide". We must not use
     the name or logo as our own branding.
4. **Network.** The only fetch in the default web build is the glue loading its own `.wasm`. By
   default that is `new URL('pdf_oxide_bg.wasm', import.meta.url)`, which we replace with an
   explicit same-origin URL. OCR is a separate build and isn't included.

   In the browser test:
   - the only `.wasm` request was `/oxide/pdf_oxide_bg.wasm`;
   - **0 CSP violations**, both enforced and report-only;
   - **0 third-party requests**.

5. **Init and memory.**

   | Measure                                       | Node    | Browser worker                  |
   | --------------------------------------------- | ------- | ------------------------------- |
   | Init (compile and instantiate)                | 39 ms   | 704 ms (fetch + compile, local) |
   | Memory right after init                       | —       | 5.9 MB                          |
   | Memory after 2,000 pages of text and Markdown | 47.3 MB | 45.9–46.9 MB                    |

   **The first extraction call per instance costs ~0.7 s** (682 ms in Node, 839 ms in the
   browser), whatever the page. Every call after that takes 1–3 ms per page, and the first page of
   a second document took 14 ms. This is a one-time warm-up. It is one synchronous WASM call, so
   it can't be cancelled.

6. **Throughput** on the 2,000-page contract stand-in, per page, with a cancel check between
   pages:

   | Engine and output | Node                 | Browser worker         |
   | ----------------- | -------------------- | ---------------------- |
   | Oxide plain text  | 286 pages/s (7.0 s)  | 215 pages/s (9.3 s)    |
   | Oxide Markdown    | 140 pages/s (14.3 s) | 109 pages/s (18.3 s)   |
   | PDFium `FPDFText` | 459 pages/s (4.4 s)  | ~200 pages/s (ADR-004) |
   | Open 2,000 pages  | 11 ms                | 17 ms                  |

   Cancel: aborting a Markdown run 1.5 s in took **11 ms** (189 of 2,000 pages done). There were
   **no main-thread long tasks**, and progress was posted about every 100 ms.

7. **Quality** on the self-made fixture:

   | Check                               | Result                                                                     |
   | ----------------------------------- | -------------------------------------------------------------------------- |
   | Lattice table (45 cells)            | **100 %** from both `extractTables` and Markdown                           |
   | Stream table (45 cells)             | **0 %**: no table detected; Markdown gives lines of text                   |
   | Merged-header table (34 data cells) | Data **100 %**; the merged "Dimensions mm" header is left out of the table |
   | H1 (22 pt)                          | `#` heading                                                                |
   | H2 (15 pt bold)                     | Bold paragraph (`**1.1 Purpose**`), not a heading                          |
   | Two-column reading order            | Correct in Markdown (left column, then right)                              |
   | Bullets and numbered list           | Correct (`- …`, `1. …`)                                                    |
   | Plain text                          | Keeps the layout: the two columns are interleaved line by line             |
   | HTML                                | `<table>` and `<h1>` present                                               |

8. **Public corpus.**
   - All 6 files open, including the RC4-encrypted catalogue.
   - Markdown plus tables takes 16–42 ms per page on drawings and the motor catalogue, and about
     650 ms per page on the dense A1 pressure-vessel sheet (174k path segments).
   - **No tables were found on any sampled page.** The drawings' title blocks and parts lists
     aren't detected. In a scan of the 1,152-page bearing catalogue:
     - pages 21–411, every 10th page: 4 "tables" in about 74 ms per page;
     - pages 501–1,126, every 25th page: 4 "tables" in about 10 ms per page.

     The detected ones are wrong (for example, a 2 × 6 grid of "4 1 | 4 2 …"). The real product
     dimension tables, which are unruled, come out as jumbled text in Markdown.

   - Review dumps go to `spikes/s4-oxide/out/review/` (git-ignored).

## Options considered

1. **Adopt Oxide as planned in §7.6 and §7.7.**
   - For: all the APIs exist, it is small and permissive, and it works in a worker with no network.
   - Against: the stream-table gap, the first-call warm-up, no permission checks, and it is pre-1.0.
2. **Use PDFium only, with our own Markdown, HTML and table heuristics.**
   - For: one engine, and PDFium text is 1.6× faster.
   - Against: we would rebuild reading order, headings, lists and HTML, which Oxide already does
     well. That is a lot of work for no quality gain.
3. **Build our own `wasm-bindgen` wrapper around the crate.**
   - Not needed, because the published build already exposes every API we use. We keep it as the
     fallback if the npm package falls behind.

## Decision (proposed)

1. **Adopt PDF Oxide** in the Work worker for plain text, Markdown, HTML and images (§7.6). Load
   it as a non-core module, background-precached after first render (D-17).
   - Self-host `pdf_oxide_bg.wasm` and always pass its URL explicitly.
   - Start only one instance per Work worker.
2. **Warm up in the background.** Right after init, run one throwaway extraction on a tiny built-in
   PDF, so the ~0.7 s first-call cost never lands on a user action. The status bar's
   "Ready offline" step can cover it.
3. _(Owner)_ **Gate every Oxide call with PDFium's permission check** (D-19, rule 9). The Work
   worker reads `FPDF_GetDocPermissions` (or the security handler state) from its own PDFium
   instance before any Oxide extraction or conversion. When copying or extraction is denied, it
   refuses with the standard message. Oxide gets only documents that PDFium has already
   authenticated, with the same password.
4. **Tables (§7.7):** Oxide's `extractTables` stays as the **lattice** candidate. It is exact on
   ruled tables with cell bounding boxes.
   - The **stream** candidate must be our own detector, built on word boxes (`extractWords` or
     PDFium `FPDFText` rectangles) with whitespace-column analysis. Oxide contributes nothing
     there.
   - Merged header cells come from our grid model (mark header rows and merged cells in Review &
     Extract), not from Oxide.
   - The feature stays **Beta**.
   - Before M3 table work, the owner runs the local pipe-chart fixture and a parts-list drawing
     through `run-node.ts`.
5. **Markdown to Word stays Beta** (§7.6). Heading detection finds large headings but can treat
   smaller bold headings as bold text.
6. **Search is unchanged** (ADR-006). It keeps PDFium `FPDFText`, which is faster and already
   feeds the session text cache. Oxide is used only for export and conversion.
7. **Version and notices.** Pin `pdf-oxide-wasm` to 0.3.x with lockfile review on every bump,
   because it is pre-1.0 and output can change. Add the crate's `NOTICE` and the MIT license text
   to the app's third-party notices, and refer to it only descriptively.

## Consequences

- **M2:**
  - an Oxide module in the Work worker: lazy init, warm-up, and a per-page cancellable loop with
    progress (the pattern in `oxide.worker.ts`);
  - the permission gate;
  - a `Map`-to-object converter;
  - an install-budget line for the 4.45 MB WASM.
- **Work-worker memory** grows by about 47 MB with Oxide on a 2,000-page document, on top of
  PDFium #2 (ADR-004's 129 MB). Include Oxide in the ADR-004 respawn policy: after large exports,
  dispose the instance or respawn the worker.
- **Large conversions take time:** a 2,000-page Markdown export takes about 18 s in the browser.
  It needs the progress UI (rule 2) and must not run in the background.
- **M3:**
  - build our own stream-table detector and the Review & Extract grid;
  - measure the pipe-chart fixture of record there, since Oxide alone won't meet it for unruled
    tables.
- **Corpus note:** `corpus/bearing catalogue.pdf` is a commercial manufacturer catalogue under
  copyright, not public domain. This ADR records only counts and timings from it. It adds to the
  open decision about committed corpus files (PROGRESS, "Decisions needed").

## Evidence

- Code: [`spikes/s4-oxide/`](../../spikes/s4-oxide/)
  - `fixtures.ts` and `run-node.ts`;
  - `oxide.worker.ts`, `main.ts`, `index.html`, `vite.config.ts` and `s4.spec.ts`.
- Commands:
  - `node spikes/s4-oxide/run-node.ts [owner-file.pdf …]`: writes `out/s4-node.json` and review
    dumps to `out/review/`;
  - `SPIKE=s4 npm run spikes -- --project=s4`: 1/1 pass; raw numbers go to
    `test-results/s4-results.json`;
  - dependency audit: `cargo tree -e normal --target wasm32-unknown-unknown -F
"wasm,rendering,signatures,barcodes,jpeg2000,cjk-form-fonts,cjk-render-fallback" -f "{p}|{l}"`
    on the 0.3.77 crate source, with each license checked by `evaluateLicense`.
