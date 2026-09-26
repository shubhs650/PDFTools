# PDFTools — Progress

_Last updated: 2026-09-25 (session 8: M1 plan drafted and approved)_

**Current milestone:** M1 — Foundation (plan: [docs/plan/M1.md](plan/M1.md)). M0 owner runs are
still open.

## Done

- **Session 12 — M1-24 (OPFS crash recovery).** Branch `m1/24-recovery`. Debounced snapshots
  (original once + committed tails + an unsaved narrow tail from a new non-pending Render RPC +
  view state) cleared on save or close; launch dialog with Recover / Discard; recovered documents
  open dirty without a handle or re-linked to their unchanged file; `beforeunload` only while
  dirty. Unit (lifecycle, debounce with fake timers, re-link) and e2e (reload → Recover restores
  edit and page; Discard; save clears; re-link + Ctrl+S).

- **Session 12 — M1-23 (Save Optimized, growth prompt, large-save progress).** Branch
  `m1/23-save-optimized`. Full rewrite as a new file or over the original (signature-count
  warning), becoming the save base for later Ctrl+S; growth prompt at > 30 % with per-session
  dismissal; chunked writes with progress and cancel before commit. Also fixed the tail
  trailer's `/Size` (spec value, not PDFium's allocator).

- **Session 12 — M1-22 (Ctrl+S and Save As).** Branch `m1/22-save`. Ctrl+S appends the verified
  tail to the file's handle; Save As writes original + all tails to a new file that becomes the
  document's (download on the fallback path); save state machine with cancel before commit;
  status-bar phase and localized error dialog offering Save As; tab dirty mark driven by the
  engine proxy. 100 markups save in 134 ms locally.

- **Session 12 — M1-21 (save verification and Work-worker refresh).** Branch `m1/21-save-verify`.
  Read-only per-page digest (raw PDFium) computed by the Render worker with each save; the Work
  worker reopens original + tail and compares; keep-all fallback with a content-free local log;
  committed tails refresh the Work copy lazily. Unit (comparison, fallback selection, real
  two-PDFium path) and e2e (Work sees the annotation; forced mismatch → keep-all, qpdf-clean).

- **Session 11 — M1-20 (save core in the Render worker).** Branch `m1/20-save-core`. Ported S1 save
  core (own FPDF_FILEWRITE, narrow tail, xref table/stream writer) with a committed _save base_ so
  repeated Ctrl+S appends only new changes; dirty tracking and permission checks (rule 9) around
  every mutating engine call; save RPCs (`saveIncremental`, `commitSave`, `saveRewrite`,
  `saveState`) returning bytes by transfer. 8-input real-PDFium matrix (prefix, /Prev, /ID,
  encryption, signature, qpdf) and an e2e save probe for later save/recovery tests.

- **Session 11 — M1-19 (PWA manifest, file handler, launchQueue).** Branch `m1/19-pwa`. Installable
  manifest with a PDF file handler and focus-existing launch handling; own app icons (SVG source +
  generated PNGs); launchQueue consumer opening launched files as tabs; favicon and theme color in
  index.html. Owner check (Explorer → installed app) queued for the M1-28 pack.

- **Session 11 — M1-18 (start screen and recent files).** Branch `m1/18-recent`. Recent list of file
  handles in IndexedDB (dedupe by fingerprint and by same file on disk, cap 20), shown on the start
  screen and in the backstage; keyboard-reachable entries with remove buttons and "Clear recent";
  reopen re-requests permission; missing or denied files explain themselves and can be removed;
  hidden without the File System Access API. E2E uses OPFS handles as stand-ins for disk files.

- **Session 11 — M1-17 (progressive render for heavy renders).** Branch `m1/17-progressive`. Cost model
  (objects, path segments, pixels) routes heavy previews to PDFium's progressive path in the Render
  worker, cancellable between 10 ms slices; the page comes from EmbedPDF's page cache via a second
  accessor next to `docPtrOf`; pixels are encoded in the encoder worker and cached. Unit tests run
  real PDFium in Node (pixel-equal to EmbedPDF's render, multi-slice, cancel at a slice boundary).
  The accepted in-flight tile exception is documented in code. Dense A0 thrash: 7 of 8
  progressive renders cancelled, longest slice 13 ms, no long tasks.

- **Session 11 — M1-16 (view modes and rotate view).** Branch `m1/16-view-modes`. Four view modes
  from the View tab and a status-bar switch, per document in the store; the current page stays in
  view across mode and rotation changes; previous/next move by spread in facing modes; rotate view
  clockwise/counterclockwise is view state only (never dirty). Found and fixed: rotated pages kept
  their unrotated box (the layout's `rotatedWidth`/`rotatedHeight` are the box), and page jumps
  used the scroll plugin's default smooth scrolling. Owner decisions recorded (zoom 100 %, PR #13
  closed, single-core not a target).

- **Session 10 — M1-15 (zoom, page navigation, hand tool).** Branch `m1/15-zoom-nav`. Zoom In/Out
  stops, Ctrl+0/1/2, Ctrl+wheel at the pointer, a zoom box ("150", "150 %", localized decimals) with
  a level menu (fit page / width / visible, actual size, presets), clamp 1 %–6400 %; status-bar page
  navigation with a validated, localized page box; Home/End/PageUp/PageDown in the document; Hand
  (H, drag-pans), Space for Hand while held, Esc back to Select; view commands on the ribbon.
  Also fixed a race in M1-11's key-probe test (merged up the stack). CI follow-ups: closing a tab no
  longer starts the engine or Work worker (M1-13 bug); Home/End navigate explicitly; long-task
  checks moved from the parallel e2e project into perf scenarios (\`e2e/perf/open|scroll|zoom\`),
  and `npm run perf` runs one test at a time. CI (e2e runs 1 worker) had measured a 639 ms task
  on the first open: the app's own Render/encoder workers and PDFium start-up competing with the
  main thread on a small runner (reproduced pinned to one core, even without the Work worker; clean
  on two cores). Worth re-checking on the owner's low-end machine (open issue). Test server
  keep-alive raised to stop a teardown ECONNRESET. Sharp tiles 150–170 ms after
  zoom on the A0 sheet.

- **Session 10 — M1-14 (viewer: virtual scroll and tiling).** Branch `m1/14-viewer`. Plugin stack per
  ADR-011 (viewport, scroll, render, tiling 256 px, zoom 1 %–6400 % with fit width by default);
  bounded preview layer; visible-first render ranking; byte-bounded LRU image cache across tabs;
  render counters (requested / done / aborted / cached, latency) for tests; focusable, named
  document region. Found and fixed: EmbedPDF's Viewport adds 10 px padding inline, which overflowed
  the document area by 20 px (now border-box). Perf: first preview 886 ms cold, 0 blank frames at
  900 and 3,000 px/s, no long tasks.

- **Session 10 — M1-13 (open pipeline and document tabs).** Branch `m1/13-open`. Ctrl+O (FSA
  picker or `<input type=file>`), window-level drop (Explorer files, Outlook attachments via
  `DataTransferItem`), one tab per file in order, duplicates focus the existing tab (`isSameEntry`
  for two handles, else fingerprint). Open state machine with localized errors (not a PDF, damaged,
  password-protected "not supported yet", unreadable, too many). Permission flags stored in the
  document record; no per-document overrides. Tabs: busy placeholders while opening, overflow menu,
  close with Save / Don't save / Cancel, start screen when the last tab closes. Found and fixed: the
  engine needed `ready` before the document manager's first open, the open buffer was being
  copied (now transferred) and the start screen's muted text failed contrast on the canvas.

- **Session 10 — M1-12 (storage layer).** Branch `m1/12-storage`. IndexedDB (`settings`, `recent`
  capped at 20, versioned migrations with an upgrade test on fake-indexeddb 6.2.5, Apache-2.0,
  dev-only); OPFS recovery store (original once + narrow tail in A/B slots + UI state, list, read,
  discard, clear) in a new pure-JS storage worker; SHA-256 fingerprint of size + `/ID` + first/last
  64 KB reading only those slices; file access with FSA pickers, append-in-place that refuses if the
  file changed on disk and leaves it untouched on abort, and the `<input type=file>` + download
  fallback. E2E proves the main thread cannot create sync access handles.

- **Session 10 — M1-11 (keyboard shortcut manager).** Branch `m1/11-keys`. Central keymap with
  global/document scopes (H/V only when the document has focus), no shortcuts while typing except
  Esc, Mac Cmd mapping, alternates for browser-reserved chords (Ctrl+Alt+W, Ctrl+Alt+PageUp/Down),
  printable shortcut sheet from Help generated from the keymap, and an e2e key-probe page for the
  owner to confirm which reserved keys reach the page in real browsers. Ribbon's local Ctrl+F1
  listener moved into the keymap.

- **Session 9 — M1-10 (ribbon framework and File backstage).** Branch `m1/10-ribbon`. Ribbon layout
  derived from the command table (M1 shows File, Home, View, Help; unavailable commands omitted;
  Home repeats its reuses); quick access toolbar; command dispatch with enabled/pressed state and
  reasons (disabled buttons stay focusable via `aria-disabled` with the reason announced); tablist
  → toolbar with roving focus, Esc to the document, Ctrl+F1 collapse; full-window File backstage
  (modal, keyboard section list, focus back to File). Found and fixed: the backstage did not return
  focus to File (same Radix trigger issue as the Dialog), and a wide ribbon in the pseudo-locale
  made the whole page scroll (frame grid column now `minmax(0, 1fr)`). Axe-clean; 65/65 stable
  over 5 repeats.

- **Session 9 — M1-09 (app frame, stores, status bar, error boundary).** Branch `m1/09-frame`. Zustand
  5.0.15 (MIT). Frame with named landmarks (banner, main, two complementary panes, contentinfo), a
  document tablist with roving focus and separate close buttons, collapsible left rail, Properties
  pane, status-bar slots; vanilla stores with pure transitions and selector hooks (a render-count
  test proves view changes don't re-render tab readers); error boundary that records only
  `{code, stack}` locally and offers Reload. Axe asked for a page-level heading (added, visually
  hidden). No horizontal scroll at 1280 px, including the pseudo-locale.

- **Session 9 — M1-08 (Work worker and memory policy).** Branch `m1/08-work-worker`. PDFium #2 with
  read-only copies (original transferred in, kept in the worker; tails applied lazily by reopening
  original + tail, never re-serialized); cooperative priority scheduler (interactive > save-verify >
  background, preemption at page boundaries, background parked during saves, cancel at checkpoints);
  `WorkClient` respawns the worker when idle above 256 MB or after an eviction and reloads open
  documents from a `reload()` source plus their tails. Found and fixed a race where two jobs
  finishing together started two memory checks and the first respawn killed the second's call
  (now single-flight). E2E: 2,000-page text pass peaks ~31 MB from an ~18 MB baseline on the
  stand-in, respawn returns to baseline and the document keeps working; perf gate: 0 main-thread
  long tasks during the job.

- **Session 9 — M1-07 (Render worker and engine factory).** Branch `m1/07-render-worker`. Hosted Render
  worker (`PdfiumNative` behind our RPC; the main-thread proxy maps RPC errors back to
  `PdfErrorCode` and task aborts to RPC cancels); encoder worker for all image encoding (ADR-011);
  `createRenderEngine` rejects an undefined `fontFallback` at type level and at runtime; seven
  Regular-weight fallback fonts self-hosted with their OFL licenses (packages pinned as direct
  dependencies); one `pdfium.wasm` in the build; `docPtrOf()` is the single private accessor and
  fails loudly if EmbedPDF internals change; permission flags and signature count come with every
  opened document; `needs-password` error (prompt in M2). `qpdf` added to the CI e2e job (fixture
  encryption only).

- **Session 9 — M1-06 (icon registry and command table).** Branch `m1/06-icons`. Command table ported
  from S6 (127 commands, milestone per command; only M1 is shown, M1-Q2) with English labels in
  `en.json`; `scripts/gen-icons.ts` generates per-icon path imports (a renamed Fluent icon breaks
  typecheck; a test keeps the file in sync); registry `iconFor(id, {large, pressed})` with Filled
  glyphs for toggles; custom **Save Optimized** and **Continuous Facing** icons built with Fluent's
  own `createFluentIcon` on the 20/32 px grid (the first badge design read as an "x" in review and
  was redrawn). Root-barrel imports banned by test.

- **Session 9 — M1-05 (design tokens and UI primitives).** Branch `m1/05-tokens-ui`. `src/ui/tokens.css`
  (colors, spacing, sizes, radius, type, elevation, motion; light default; dark set and
  `forced-colors` mapping override every color token). Radix-based primitives with required
  accessible names; component CSS uses tokens only (enforced by a test). Findings fixed: dark-theme
  primary button failed WCAG contrast (axe); the Dialog did not return focus to an opener outside
  Radix's own Trigger. Added Radix dialog/dropdown-menu/tooltip/toggle (MIT); dev: Testing Library,
  jsdom, `@axe-core/playwright` (MPL, dev-only per ADR-002). Gallery e2e: axe clean in light, dark
  and pseudo-locale; keyboard-only traversal, menus and dialog; focus ring in forced-colors.

- **Session 9 — M1-04 (i18n).** Branch `m1/04-i18n`. i18next 26.4.2 + react-i18next 17.0.15 (MIT), strings
  bundled and initialised synchronously; typed keys (unknown key = type error); `msg()` marker for
  keys in data; `Intl`-only formatters (number, percent, zoom, bytes, date, relative time) in the
  user's locale; pseudo-locale (+40 %, accented, bracketed) behind `?locale=pseudo` in dev/e2e.
  Completeness test: every referenced key exists and every key is used. Document title from i18n.

- **Session 9 — M1-03 (typed RPC).** Branch `m1/03-rpc`. `src/engine/{protocol,errors,rpc}.ts` and
  `src/workers/rpc-host.ts`: one typed API spec per worker (wrong argument or result types don't
  compile); every call is a `Job` with `cancel()` and progress; cancel rejects with `AbortError`
  exactly once and drops late results; progress throttled to 1 per 100 ms (trailing edge); a dev
  warning when a job runs > 300 ms without progress (rule 2); zero-copy transfers both ways; errors
  cross as `{code, message, stack}`, and non-`RpcError`s lose their message (rule 10); a lost
  worker rejects every pending call with `WorkerLostError`. 14 unit tests over a real
  `MessageChannel`.

- **Session 9 — M1-02 (e2e harness under production headers).** Branch `m1/02-e2e-harness`.
  - `public/_headers`: the §10.1 CSP verbatim plus COOP/COEP (ADR-004 decision 5).
    `scripts/serve.ts` + `scripts/headers.ts` promoted from the S8 spike (ADR-003 decision 4).
  - Playwright builds the app once in `e2e` mode (`dist-e2e/`); every worker serves it with the
    production headers, and every page is cross-origin isolated.
  - Shared `guard` fixture (`e2e/support/fixtures.ts`): fails any test on a CSP violation (document
    or Report-Only endpoint, so workers are covered), a request leaving the origin, or, in `perf`,
    a main-thread task > 100 ms after `guard.startMeasuring()`. Negative controls prove each check
    fires. Finding: a busy loop inside Playwright's own `evaluate` is not reported as a long task;
    the control runs it as a page task.
  - Test-only hook (M1-Q3) behind `import.meta.env.MODE === 'e2e'`; `npm run check:dist` (CI)
    fails if its marker reaches a production build, verified against both builds.
  - Self-made fixture generators in `e2e/fixtures/generate.ts` (simple, 2,000-page contract, A0
    sheets, CJK fallback), all opened by PDFium in unit tests. CI now also runs `npm run perf`.

- **Session 8 — M1-01 (EmbedPDF plugin layer).** _Works with workaround._ See
  [ADR-011](adr/011-m1-embedpdf-plugins.md) (accepted).
  - Core, document manager, viewport, scroll, render, tiling, zoom, spread and rotate plugins run on
    the hosted Render worker. Pinned to exactly 2.15.1; the license gate passes (546 packages).
  - Self-made files: 2,000-page contract first preview 231 ms; dense A0 first view 0.4–0.7 s;
    sharp tiles 148–328 ms at 100 %–6400 %; 0 blank-page frames at 900 and 3,000 px/s; **0 long
    tasks**, 0 CSP violations, 0 third-party requests.
  - Workarounds: our own bounded `PreviewLayer` (the stock page layer renders the whole page at the
    current zoom); our own **encoder worker** (the stock converter encodes on the main thread,
    against rule 1; the worker is also faster: scroll tile p95 91 vs 132 ms); our own paged mode for
    single page and facing (the plugins are continuous only).
  - Stale tiles are aborted by the stock `TilingLayer` (311–331 of ~370 in zoom thrash).

- **Session 1 — spec review.** Reviewed ARCHITECTURE.md, CLAUDE.md and the UI reference images.
  Raised 16 items (B1–B16) and got owner answers, recorded in
  [ADR-001](adr/001-session-1-clarifications.md).
- **Session 1 — scaffold** (D-11, D-12):
  - Vite 8 + React 19 + TypeScript 6 (strict, `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes`); an empty app shell with no features.
  - The folder layout from ARCHITECTURE.md §3.3, plus `/scripts`.
  - ESLint 9 with typescript-eslint strict-type-checked, react-hooks, **jsx-a11y strict**
    (CLAUDE.md rule 12) and `i18next/no-literal-string` for JSX (rule 11). Prettier.
  - Vitest unit tests (`tests/`) and a Playwright smoke e2e (`e2e/`) that asserts zero
    cross-origin requests.
  - The license gate `npm run licenses`:
    - it walks every installed package, parses SPDX expressions, and fails on copyleft or unknown
      licenses;
    - MPL-2.0 is allowed only for packages npm marks dev-only in the lockfile (ADR-002);
    - OFL-1.1 is allowed for fonts;
    - the policy has 52 unit tests;
    - fake runtime packages licensed GPL-3.0 and MPL-2.0 both fail the gate.
  - GitHub Actions CI: typecheck, lint, format, unit tests, license gate, build, and Playwright e2e.
- **Session 1 — docs:**
  - [ADR template](adr/000-template.md);
  - [ADR-001](adr/001-session-1-clarifications.md) and
    [ADR-002](adr/002-license-policy-and-heavy-file-targets.md);
  - the [M0 plan](plan/M0.md) with S1–S8, including an EmbedPDF v2.15.1 capability snapshot;
  - **ARCHITECTURE.md Rev 0.1**, with ADR-001 and ADR-002 applied;
  - CLAUDE.md rule 5 now points to the allowlist in `scripts/license-policy.ts`.
- **Session 2 — M0-S8 (CSP, WASM, workers, service worker).** _Works with workaround._ See
  [ADR-003](adr/003-s8-csp-wasm-workers-sw.md).
  - The §10.1 CSP works **unchanged** with EmbedPDF's `blob:` worker engine, WASM and a
    vite-plugin-pwa service worker. Result: 0 violations and 0 third-party requests, and an
    offline reload works.
  - EmbedPDF falls back to jsDelivr fonts whenever `fontFallback` is `undefined`. A negative-control
    test shows that the CSP blocks this. The engine must always get `null` or a local config with
    absolute URLs.
  - `wrangler` was dropped because it pulls in LGPL `sharp`/libvips. `spikes/shared/serve.ts`
    applies `_headers` like Pages does.
- **Session 2 — M0-S3 (two engines in two workers).** _Works with workaround._ See
  [ADR-004](adr/004-s3-two-engines.md).
  - The Render and Work PDFium instances run concurrently. The Work job adds about 5–9 % to tile
    p50/p95. No main-thread long tasks. Extraction runs at ~200 pages/s and cancels in 3–9 ms.
  - WASM memory never shrinks: the Work worker reached 129 MB after one full-text pass. Respawning
    the worker returns it to 18.6 MB.
  - Queued renders can be cancelled; in-flight EmbedPDF renders cannot. Direct PDFium progressive
    rendering works in our own worker and cancels in < 0.1 ms, but its slices run 37–45 ms.
  - Recommendation: host EmbedPDF's `PdfiumNative` in our own Render worker module (the "hosted"
    variant) so that direct PDFium calls are available (ADR-001 B14, needed by S1).
- **Session 7 — ADR approvals.** The owner accepted ADR-003 to ADR-007 and ADR-009. They are
  applied as **ARCHITECTURE.md Rev 0.3**:
  - hosted Render worker, render cancellation and the respawn memory policy; COOP/COEP headers;
  - narrow-tail Ctrl+S; background search indexing with a 5,000-hit context cap;
  - own Measure object layer, with encrypted files handled in M3;
  - PDFium permission gate before PDF Oxide; own stream-table detector; the font split.
- **Session 7 — M0-S6 (Fluent icon coverage).** _Fails as specified, works with workaround._
  ADR-010 accepted (ARCHITECTURE.md Rev 0.4: Regular icons; CLAUDE.md rule 15). See
  [ADR-010](adr/010-s6-fluent-icons.md) and the generated
  [icon map](plan/S6-icon-map.md).
  - 126 Rev 0 commands inventoried: the quick access toolbar, the nine §8 tabs, the rail panes and
    the status bar.
  - **Fluent Color covers only 24 (19 %)**, and upstream has **deprecated** all Color icons: no
    High Contrast support, global gradient IDs, and failing dark-theme contrast. **Regular and
    Filled cover all 126.**
  - Large buttons: only 25 of 50 have a native 32 px glyph; the rest scale up from 28 or 24 px.
  - 23 custom icons are needed, including the four named in §8 (cloud, calibrate, scale
    viewport, CRS export) and Stamp, which exists only in the Light style. Express extract fits
    Fluent's `TableLightning`.
  - Bundle: about 22 kB brotli for the whole set plus 5.6 kB of runtime. It tree-shakes, and
    per-icon path imports build about 4× faster than the root barrel.
  - Added dependency `@fluentui/react-icons` 2.0.341 (MIT). The license gate passes (536
    packages).
- **Session 7 — M0-S4 (PDF Oxide WASM).** _Works with workaround._ See
  [ADR-009](adr/009-s4-pdf-oxide.md).
  - The WASM build has every API needed for §7.6 and §7.7: text, Markdown, HTML, tables with cell
    boxes, images, words and paths. It is **4.45 MB brotli** (17.6 MB raw).
  - Licenses: `MIT OR Apache-2.0`, and all 394 Rust crates compiled into the WASM are permissive.
  - In a module worker under the §10.1 CSP: 0 violations, 0 third-party requests, and the only
    fetch is the self-hosted `.wasm`. Init takes 0.7 s in the browser. Cancel between pages takes
    11 ms. No main-thread long tasks.
  - The **first extraction per instance takes ~0.7 s** (a one-time warm-up), so it should run in
    the background right after init.
  - 2,000 pages: text at 215–286 pages/s, Markdown at 109–140 pages/s, and PDFium text at 459
    pages/s. Memory is about 47 MB.
  - Tables: **lattice 100 %**, merged-header data 100 % (the merged header text is dropped), and
    **stream 0 %**. There are no useful tables in the public corpus. Unruled catalogue tables come
    out as jumbled text. So an own stream detector is needed (§7.7).
  - Structure: H1, lists and two-column reading order are correct; the H2 comes out as bold text.
  - **Oxide has no permission API.** It extracted from the encrypted catalogue without checks, so
    it must be gated by PDFium's permission flags (rule 9).
  - Added dependency `pdf-oxide-wasm` 0.3.77. The license gate passes.
- **Session 6 — M0-S7 (vector geometry for snapping).** _Works with workaround._ See
  [ADR-008](adr/008-s7-snap-geometry.md).
  - Extraction goes straight through PDFium (EmbedPDF has no public API):
    - paths and forms, with composed matrices;
    - Bézier flattening and implicit closes;
    - raw WASM exports, 2.3–4.6× faster than `cwrap`.
  - Correct on a known-geometry sheet (11 unit tests plus an integration check): exact endpoint,
    intersection and midpoint snaps, and the circle within 0.2 pt.
  - Dense public A1 page (174k segments): extraction ~0.35 s (Node) / 0.56 s (browser), grid
    ~30 ms, queries p95 < 0.5 ms. Synthetic 1M segments: ~0.9 s + 0.2–0.3 s, 36 MB.
  - `FPDF_LoadPage` is 75–90 % of the extraction time and can't be interrupted, so region
    extraction doesn't help: extract whole pages once and cache them.
  - While PDFium parses, snap queries that go to the Work worker wait **~272 ms** each. A
    **pure-JS snap worker** fed by transferred indexes answers at **p95 0.5 ms** even during
    extraction. This is proposed as a new worker (ADR-008 decision 2).
  - Tiles are unaffected, and there are no main-thread long tasks.
- **Session 5 — M0-S2 (measurement and viewport dictionaries).** _Works with workaround._ See
  [ADR-007](adr/007-s2-measure-viewport.md).
  - Neither EmbedPDF nor PDFium can write or read nested `/Measure` dictionaries or page `/VP`.
  - Built our own layer (19 unit tests):
    - a minimal PDF object reader (xref tables and streams, object streams, predictors);
    - a serializer;
    - an incremental patch-revision writer;
    - scale math: ratio, calibration, ft-in, and the §7.4 viewport choice including "spanning";
    - a reader CLI for files saved by the viewers.
  - On a self-made A1 sheet (1:100, plus Detail A at 1:5):
    - EmbedPDF creates the geometry annotations; we add `/IT`, `/Measure`, `/Cap`, `/Contents` and
      page `/VP`;
    - qpdf is clean and the values read back exactly;
    - the data survives later EmbedPDF edits.
  - PDFium appearances draw geometry only, with no value text. Label variants (`/Cap`, grouped
    FreeText, no appearance) went into an interop pack for the owner.
  - **Encrypted files are not handled.** Writing or reading measurement strings needs our own
    security handler; this is an owner decision.
- **Session 4 — M0-S5 (search in the Work worker while scrolling).** _Works with workaround._ See
  [ADR-006](adr/006-s5-search-work-worker.md).
  - Design: the Work worker extracts text with raw `FPDFText_*` into a session cache, then:
    - matches with JS `RegExp` (case, whole word, wildcards, regex);
    - searches in viewport order;
    - streams batches no more often than every 50 ms;
    - cancels between pages.
  - Results on a self-made 2,000-page contract stand-in, with continuous auto-scroll:
    - Enter-only is verified: typing never searches;
    - cold search: first hit **53–71 ms**, done **4.0–5.6 s**;
    - a new query cancels the old one in **19–21 ms**, with 0 stale results;
    - **0 main-thread long tasks**;
    - warm index: 6–110 ms.
  - Needed mitigations:
    - stream at most **5,000 hits with context** and counts beyond that. Without the cap, a
      910k-hit regex caused 66–68 ms long tasks and 150 ms frames;
    - **background indexing after open**, so rare terms far from the viewport also get first hits
      in under 1 s (≈1.8 s cold otherwise).
  - EmbedPDF `plugin-search` runs in the **Render engine**, in 25-page uninterruptible chunks, and
    doubles tile p50/p95. It is not used, which confirms D-10.
  - Real text (the 1,152-page catalogue): first hit 55 ms, done 5.6 s, 0 long tasks.
- **Session 3 — M0-S1 (incremental save + full rewrite).** _Works with workaround._ See
  [ADR-005](adr/005-s1-incremental-save.md).
  - EmbedPDF's `saveAsCopy()` is a **full rewrite**, and it copies bytes out one at a time (1.1 s
    for 23 MB). A direct `FPDF_SaveAsCopy(doc, writer, flags)` through our own `FPDF_FILEWRITE`
    works in both modes. It needs EmbedPDF's private document pointer.
  - PDFium's incremental save keeps the original prefix, signatures and encryption, but it:
    - appends **every loaded object**: +22 MB on a 23 MB file for one annotation;
    - **damages files with xref streams**;
    - replaces the permanent `/ID`.
  - Proposed fix, the **narrow tail**: keep PDFium's object serialization, append only changed
    objects, and write our own xref and trailer in the original's form.
    - Result: a 1,044-byte tail on the 23 MB file, qpdf-clean on all 8 inputs, and signatures and
      encryption preserved.
    - qpdf shows every dropped object is unchanged (26k checked); PDFium's differences are float
      rounding, `/NM` and `/P` noise.
    - When nothing changed, no revision is appended.
    - Keep-all fallback: every appended object with our xref.
  - All 21 EmbedPDF tool annotations are created with appearance streams and survive every mode.
    Form values persist. Annotate-denied files are not edited (rule 9).
  - Ctrl+S timing: **12–42 ms** end to end for 100 markups on small files (target < 1 s). On
    23 MB, ~0.5–0.6 s, of which `createWritable(keepExistingData)` takes 166–285 ms because it
    copies the whole file. An OPFS sync-handle tail write takes ~1.5 ms.
  - Interop pack (33 self-made files) in `e2e/fixtures/self-made/s1-interop/`; owner checklist in
    `e2e/interop/CHECKLIST.md`.
  - Tooling: `qpdf` CLI installed with apt (verification only, not a dependency). Added `pkijs` and
    `asn1js` (BSD-3, planned for D-24). Spike unit tests now run in `npm run test`.
- **Session 2 — tooling:**
  - `spikes/` with a shared `_headers` server, fixture writer and probes;
  - `npm run spikes`, `npm run typecheck:spikes` and `npm run corpus`;
  - `corpus/manifest.json`, listing the FAR;
  - spikes are now covered by ESLint.
  - Dependencies added: `@embedpdf/engines`, `@embedpdf/pdfium`, `@embedpdf/models` 2.15.1
    (runtime), and `vite-plugin-pwa` 1.3.0, `workbox-window` and `workbox-build` (dev). The license
    gate passes (521 packages).

## In progress

- M0: the agent part of all eight spikes is done and all spike ADRs are accepted. Owner runs are
  still open. The owner checks listed under Next are pending.
- **M1 plan approved:** [docs/plan/M1.md](plan/M1.md). 28 one-session tasks (M1-01 … M1-28),
  each with goal, files, acceptance criteria, tests and dependencies. It starts with an EmbedPDF
  plugin-layer spike (M1-01 → ADR-011), because M0 only exercised the engine. The owner accepted
  all proposals for M1-Q1 to M1-Q8 (see the Decisions log).

## Session log

- **Session 9 (2026-09-25):** M1-02. Local checks all pass: typecheck (app and spikes), lint,
  format, unit tests, license gate, production build + `check:dist`, e2e (6/6) and perf (2/2).

- **Session 8 (2026-09-25):** Read PROGRESS, ARCHITECTURE Rev 0.4 and ADR-001 to ADR-010; wrote
  the M1 plan; the owner approved it and accepted M1-Q1 to M1-Q8. Then M1-01 on branch
  `m1/01-plugin-spike`: typecheck (app and spikes), lint, format, unit tests, license gate (546
  packages) and the S9 Playwright spec (3/3) pass.

- **Session 7 (2026-09-24):**
  - ADR-008 accepted (ARCHITECTURE.md Rev 0.2).
  - S4 done: 102 unit tests, license gate (529 packages), and 20/20 spike Playwright tests.
  - ADR-003 to ADR-007 and ADR-009 accepted (ARCHITECTURE.md Rev 0.3).
  - S6 done. Local checks all pass: typecheck (app and spikes), lint, format, 106 unit tests,
    license gate (536 packages), and the app e2e smoke. S6 has no Playwright part, and the other
    spikes are unchanged.

- **Session 6 (2026-09-24):** S7. Local checks all pass: typecheck (app and spikes), lint, format,
  unit tests (11 new S7 tests), license gate, app e2e smoke, and all spike Playwright tests.

- **Session 5 (2026-09-24):** S2. Local checks all pass: typecheck (app and spikes), lint, format,
  unit tests (19 new S2 tests), license gate, app e2e smoke, and all spike Playwright tests. The S2
  Node harness passes: qpdf clean, all values match, survival check OK.

- **Session 4 (2026-09-24):** S5. Local checks all pass: typecheck (app and spikes), lint, format,
  unit tests (including 10 search-core tests), license gate, app e2e smoke, and all spike
  Playwright tests (15/15).

- **Session 3 (2026-09-24):** S1. Local checks all pass: typecheck (app and spikes), lint, format,
  62 unit tests (including 10 narrow-tail tests), license gate (528 packages), app e2e smoke, and
  11/11 spike Playwright tests. The S1 Node matrix has 0 problems.

- **Session 2 (2026-09-24):** S8 → S3 as planned. Branch `claude/bold-galileo-1jyn9y`, based on
  PR #1's branch because PR #1 is not merged yet. Local checks all pass: typecheck (app and
  spikes), lint, format, 52 unit tests, license gate, app e2e smoke, and 8/8 spike Playwright
  tests.

- **Session 1 (2026-09-24):** Spec review, scaffold, and M0 docs. Commits: `b0bb839` (scaffold),
  `82956ef` (docs), `8806dc8` (PROGRESS).
- **Session 1 follow-up (2026-09-24):** Applied the owner's decisions.
  - `99e12db`: license gate treats MPL as dev-only and allows OFL; moved to Vite 8; added jsx-a11y.
  - `87e0885`: ADR-002, ARCHITECTURE.md Rev 0.1, CLAUDE.md rule 5.
  - The M0, corpus and PROGRESS updates are in the follow-up commit.
  - Local checks all pass: typecheck, lint, format, 52 unit tests, license gate (307 packages,
    3 dev-only MPL), build, and Playwright smoke.

## Next

1. **Owner decisions:** none open on the spikes. ADR-003 to ADR-010 are accepted
   (ARCHITECTURE.md Rev 0.4). ADR-007 decisions 2–3 are accepted as defaults, to be confirmed by
   the S2 interop run below.
2. **Owner runs:**
   - **S1 interop checklist** (`e2e/interop/CHECKLIST.md`) in Acrobat Reader and PDF-XChange;
   - S1 FSA button on the 500 MB contract;
   - **S5 search on the FAR and the 500 MB contract** (ADR-006, "Owner runs");
   - **S2 interop checklist** §D and §F (`e2e/fixtures/self-made/s2-interop/`);
   - **S7 on the four local CAD drawings and the dense P&ID**
     (`node spikes/s7-snap/run-node.ts <files>`, plus the browser page; see ADR-008);
   - **S4 on the local pipe-chart fixture and a parts-list drawing**
     (`node spikes/s4-oxide/run-node.ts <files>`; dumps in `out/review/`, see ADR-009);
   - FAR, 500 MB and A0 through the S3 harness;
   - S8 Firefox check and Pages preview.
3. **Owner:** review and merge each new M1 PR (one per task) with "Create a merge commit". M1-01 to
   M1-15 are merged into `main`; M1-16 to M1-20 are open as stacked PRs.
4. **Agent:** M1-21 (save verification and Work-worker refresh), then M1-22 (Ctrl+S and Save As)
   on top of the M1-20 save core, each on its own `m1/<task>` branch.

## Open issues

- **Chromium 153 headless crash on stored file handles (M1-18).** Reading a
  `FileSystemFileHandle` back from IndexedDB crashes the whole browser in headless Chromium and
  Google Chrome 153 (OPFS and on-disk handles alike; CI diagnostic, PR #21). Chromium 141/151 and
  headed Chrome/Edge 154 (owner check) are fine. `@playwright/test` is pinned to 1.62.1
  (Chromium 151) with an override for `playwright-core`; re-test the recent-files e2e specs before
  bumping Playwright.
- **Committed corpus PDFs vs ADR-002.** Commit `cd52644` added six PDFs directly to `corpus/`,
  including CAD drawings. ADR-002 says drawings stay local and are never committed, and
  `.gitignore` excludes `*.pdf`, so these were force-added. S3 uses `bearing catalogue.pdf` and
  `PRESSURE-VESSEL-SAMPLE.pdf` from there. The owner needs to decide (see "Decisions needed").
- **PDF Oxide ignores permission flags** (ADR-009). It must never receive a document before
  PDFium's permission check allows copying or extraction (D-19, rule 9).
- **Oxide finds no unruled (stream) tables** (ADR-009). §7.7's stream candidate has to be our own
  detector. The pipe-chart fixture of record is still to be run by the owner.
- **FAR not fetchable from the cloud container.** The environment's network policy denies
  `www.acquisition.gov` (HTTP 403 from the proxy). To allow it, add that host under the
  environment's Network access settings; otherwise run `npm run corpus` locally.
- **PDFium incremental save needs our narrow-tail post-processing** (ADR-005). Used raw, it
  bloats files and damages xref-stream files. The narrow tail depends on EmbedPDF's private
  `PdfiumNative.cache` for the document pointer (pinned 2.15.1; upstream request proposed).
- **Chrome's `createWritable(keepExistingData)` copies the whole file**, so Ctrl+S on very large
  files is O(file size). The owner measures it on 500 MB; it needs a progress UI (ADR-005).
- **Measurement data in encrypted PDFs** can be neither written nor read without our own
  security handler (ADR-007). The public catalogue in `corpus/` is RC4-encrypted, so this is a
  real case.
- **In-flight EmbedPDF renders cannot be cancelled** (ADR-004). This needs the small-tiles and
  progressive-rendering policy; see CLAUDE.md rule 2.
- **Font install budget.** All weights of the `@embedpdf/fonts-*` packages come to ~122 MB against a
  60 MB budget. Regular weights only come to ~24 MB (ADR-003).

- **EmbedPDF defaults use jsDelivr.** S8 resolved this: the spikes self-host the WASM file and
  fonts, and the CSP blocks the default (ADR-003). M1 must keep `fontFallback` explicit.
- **EmbedPDF has no incremental-save option in its engine API.** S1 will call `FPDF_SaveAsCopy`
  with the incremental flag directly (ADR-001 B14).
- **EmbedPDF has no measurement annotation tool or Measure fields.** S2 decides the writing
  route, and how measurement labels render without custom appearance streams (ADR-001 B7).
- **Playwright and the container's Chromium differ in version.** In the cloud container, run e2e
  with `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`. CI installs the matching browser.
- **ESLint 9 is marked end-of-support upstream.** ESLint 10 is blocked until
  `eslint-plugin-jsx-a11y` supports it.
- **The container's network policy blocks the owner's drawing hosts** and the EmbedPDF docs site.
  Drawings are supplied locally by the owner anyway (ADR-002).

## Decisions needed (owner)

1. **Committed corpus PDFs.** Either confirm that all six files in `corpus/` are public domain and
   may stay in git, and amend ADR-002 to say so, or move them to the git-ignored `corpus/files/`
   (drawings to `corpus/files/drawings/`) and remove them from history. The S3 spec skips if they
   are missing. Note: `bearing catalogue.pdf` is a commercial manufacturer catalogue under
   copyright, not public domain (found during S4). It should move out of git either way.
2. **Cloudflare Pages project for S8.** Until one exists, S8 runs locally with
   `spikes/shared/serve.ts`, because `wrangler` is blocked by LGPL (ADR-003). The analytics and
   injection checks wait for the project.
3. **More test drawings (optional).** Item 5 in the drawing list was blank. Add more whenever you
   like; they stay local only.

## Decisions log

| Date       | Ref      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-25 | M1-15    | Owner: zoom 100 % = one PDF point per CSS pixel (EmbedPDF scale 1, ADR-011's range), so Actual Size is not physical size. PR #13 (main → M0 branch) closed. Single-core machines are not a target; the one-core first-open contention from M1-13/15 CI needs no work.                                                                                                                                                                                     |
| 2026-09-26 | M1-18    | Owner: headed Chrome/Edge 154 read stored file handles fine, so the Chromium 153 crash is headless/153-only; pin Playwright to 1.62.1 (Chromium 151) for CI rather than change the recent-files design (option 3).                                                                                                                                                                                                                                        |
| 2026-09-24 | ADR-001  | Session-1 clarifications B1–B16. Key ones: server-side analytics only; broader permissive allowlist; location-based redaction verification; EmbedPDF annotation and redaction sets; OPFS original + tail recovery; public-domain corpus only.                                                                                                                                                                                                             |
| 2026-09-24 | scaffold | Vite 7 instead of 8, and no jsx-a11y, because of MPL-2.0 dependencies. Superseded by ADR-002.                                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-24 | ADR-002  | MPL-2.0 allowed for dev-only tooling only (lockfile `dev` flag). OFL-1.1 allowed for fonts. Heavy files are measure and report for Rev 0. Test drawings are owner-supplied local files, with no URLs in the repo. Moved to Vite 8 and enabled jsx-a11y.                                                                                                                                                                                                   |
| 2026-09-24 | Rev 0.1  | ARCHITECTURE.md amended per ADR-001 and ADR-002 (owner-approved).                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-09-24 | ADR-003  | S8: CSP unchanged; `fontFallback` always explicit; Regular-weight fallback fonts, CJK non-core; local `_headers` server instead of `wrangler` (LGPL). **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                                                                                                              |
| 2026-09-24 | ADR-004  | S3: hosted Render worker (our module + EmbedPDF `PdfiumNative`/`PdfEngine`); small tiles + queue abort + direct progressive render; respawn-based memory policy; optional COOP/COEP. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                                                                               |
| 2026-09-24 | ADR-005  | S1: Ctrl+S = PDFium `FPDF_INCREMENTAL` + narrow tail (changed objects only, our own xref/trailer), verified in the Work worker with keep-all fallback; Save Optimized = `FPDF_NO_INCREMENTAL` via our writer. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                                                      |
| 2026-09-24 | ADR-006  | S5: search in the Work worker (raw FPDFText extraction + session text cache + JS RegExp, viewport order, 50 ms batches, cancel between pages); ≤ 5,000 hits streamed with context; background indexing after open; EmbedPDF plugin-search not used. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                |
| 2026-09-24 | ADR-007  | S2: own PDF object layer (reader, serializer, patch revision) writes `/Measure`, `/IT` and page `/VP`; label strategy and viewport semantics after owner interop; encrypted files need our own security handler (M3) or measurements are not saved there. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                          |
| 2026-09-24 | ADR-008  | S7: geometry extracted whole-page in the Work worker via raw PDFium exports and cached; snap queries answered by a new pure-JS snap worker holding transferred indexes (queries never wait for PDFium). **Accepted**; ARCHITECTURE.md Rev 0.2.                                                                                                                                                                                                            |
| 2026-09-24 | Rev 0.3  | ARCHITECTURE.md amended per ADR-003 to ADR-007 and ADR-009 (owner-approved): hosted Render worker, render cancellation and memory policy, COOP/COEP, narrow-tail Ctrl+S, background search indexing and context cap, own Measure object layer, Oxide permission gate and own stream-table detector, font split.                                                                                                                                           |
| 2026-09-24 | ADR-010  | S6: Fluent **Regular** icons (Filled for active states) instead of the deprecated, 19 %-coverage Color style; large buttons use native 32 px or scaled 28/24 px glyphs; 23 custom icons in the same line style; icon registry with per-icon path imports. **Accepted**; ARCHITECTURE.md Rev 0.4, CLAUDE.md rule 15.                                                                                                                                       |
| 2026-09-24 | ADR-009  | S4: adopt PDF Oxide for text/Markdown/HTML (lazy, background warm-up); PDFium permission gate before every Oxide call; Oxide tables as the lattice candidate only, own stream detector; search stays on PDFium; pin 0.3.x and add notices. **Accepted**; ARCHITECTURE.md Rev 0.3.                                                                                                                                                                         |
| 2026-09-25 | M1 plan  | M1 plan approved. M1-Q1: Ctrl+Alt+W / Ctrl+Alt+F4 close tab and Ctrl+Alt+PageUp/PageDown switch tab, alongside the §8.1 keys (ADR-001 B5). Q2: ribbon tabs hidden until they have a working command. Q3: test hook only in the `e2e` build mode. Q4: dependency list accepted. Q5: Select without text selection until M2. Q6: File → Properties in M2. Q7: CI uses generated self-made fixtures only. Q8: merge PR #1 and M0, then `m1/<task>` branches. |
| 2026-09-25 | ADR-011  | M1-01: adopt the EmbedPDF plugin stack (pinned 2.15.1, one registry + document manager, no per-document permission overrides); own bounded PreviewLayer, own encoder worker, own paged mode for single/facing. **Accepted**; no ARCHITECTURE.md change.                                                                                                                                                                                                   |
