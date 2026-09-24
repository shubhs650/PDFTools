# ADR-003: S8 — CSP, WASM, module workers and service worker coexist

- **Status:** Accepted. The owner approved decisions 3–5 on 2026-09-24; decision 3 is applied in ARCHITECTURE.md Rev 0.3 (§9).
- **Date:** 2026-09-24
- **Deciders:** Owner (approved 2026-09-24); recorded by the coding agent
- **Related decisions:** D-09, D-17, D-22 (ARCHITECTURE.md §9, §10.1), CLAUDE.md rules 4 and 5
- **Related spike / milestone:** M0-S8
- **Outcome (spikes only):** **Works with workaround.** The CSP needs no change. The workarounds are
  an explicit font configuration and a local stand-in for `wrangler pages dev`.

## Context

§10.1 fixes a strict CSP. §9 requires self-hosted `pdfium.wasm` and fonts, with EmbedPDF's jsDelivr
defaults overridden. S8 has to prove that the real CSP, WASM, module workers, the service worker and
the EmbedPDF engine work together with zero third-party requests. See
[M0 plan §S8](../plan/M0.md#s8--csp--cloudflare-analytics--wasm-coexistence).

## Findings

1. **The §10.1 CSP works unchanged.**
   - EmbedPDF's stock worker engine (`@embedpdf/engines/pdfium-worker-engine`) starts its PDFium
     worker from a **`blob:` module worker** with inlined code. The optional encoder pool is started
     the same way. `worker-src 'self' blob:` covers both.
   - PDFium is compiled with `WebAssembly.instantiate` from fetched bytes. `'wasm-unsafe-eval'`
     covers that, and nothing needs `eval`.
   - vite-plugin-pwa's generated `sw.js` and `workbox-*.js` are same-origin scripts.
   - Across all four checks, violations were collected three ways: document events, a server-side
     report-only copy of the policy (which also covers workers and the service worker), and a
     request log. The result was **0 violations and 0 third-party requests**.
2. **The EmbedPDF font default is a trap.** If `fontFallback` is left `undefined`, the worker
   silently uses `cdnFontConfig` (jsDelivr). The code is
   `fontFallback === null ? undefined : fontFallback ?? cdnFontConfig`. The negative-control test
   proves it: the default config tries `cdn.jsdelivr.net`, the CSP blocks it (`connect-src`), and the
   probe records the violation.
   - `fontFallback: null`: no font requests. Non-embedded CJK text renders **without glyphs**
     (502 dark pixels on the fixture).
   - Local config: the self-hosted Noto Sans SC font is fetched from our origin, and the CJK glyphs
     render (5,735 dark pixels).
3. **Engine URLs must be absolute.** The engine worker is a `blob:` URL, so relative URLs for the
   WASM file and fonts cannot resolve inside it. Pass `new URL(path, location.origin).href`.
4. **Offline works.** After the first visit, the service worker controls the page. With the context
   offline, a reload opens and renders the fixture, CJK fallback included. Two settings are needed:
   - Workbox's default `maximumFileSizeToCacheInBytes` is 2 MB and `pdfium.wasm` is 4.6 MB, so the
     limit must be raised.
   - The font is served from the precache.
5. **Timing (container, Chromium 141, headless):** open and render the one-page fixture in 95–102 ms
   with local fonts and 40–50 ms with `null`. There were **no long tasks**, including cold boot.
6. **`wrangler` cannot be installed.** `wrangler` → `miniflare` → `sharp` pulls in
   `@img/sharp-libvips` (**LGPL-3.0**). The license gate rejects it, and it is not dev-only MPL, so
   ADR-002 does not cover it. `spikes/shared/serve.ts` stands in for it: it applies
   `_headers` the way Pages does (path rules, SPA fallback, `_headers` itself not served).
7. **Install budget (§9, 60 MB).** `pdfium.wasm` is 4.6 MB (2.2 MB gzip). The fallback font
   packages are much larger:

   | Package        | All weights | Regular only |
   | -------------- | ----------: | -----------: |
   | fonts-sc       |       41 MB |       8.4 MB |
   | fonts-tc       |       38 MB |       5.7 MB |
   | fonts-jp       |       31 MB |       4.5 MB |
   | fonts-kr       |       31 MB |       4.6 MB |
   | fonts-latin    |       11 MB |       0.6 MB |
   | arabic, hebrew |      0.3 MB |       0.1 MB |
   | **Total**      | **≈122 MB** |   **≈24 MB** |

## Options considered

For fonts:

1. **Bundle every weight.** This is about 122 MB and breaks the 60 MB budget.
2. **Regular only for every script, with CJK as a background-precached non-core module (D-17).**
   Adds about 24 MB. PDFium synthesizes bold from Regular, which is the usual behavior when a font is
   missing. This fits the budget.
3. **No fallback (`null`).** Adds 0 MB. Non-embedded CJK, Arabic and Hebrew text would be invisible.

For local Pages emulation:

1. **`wrangler pages dev`.** Blocked by LGPL.
2. **Run `npx wrangler` ad hoc, outside the dependency tree.** It still downloads LGPL code, and the
   rule's intent is unclear.
3. **Our own `_headers` server for local and CI checks, plus a one-off check on a real Pages preview
   deployment.** This is the recommended option.

## Decision

1. **The §10.1 CSP stays unchanged.** S8 proves it.
2. **The engine is always created with an explicit `fontFallback`.** It is either `null` or a
   local config with absolute same-origin URLs. `/src/engine` will wrap engine creation so that
   `undefined` cannot be passed, and an e2e test keeps the negative control.
3. _(Owner)_ **Fallback fonts: option 2.** Ship the Regular weight of each `@embedpdf/fonts-*`
   package, self-hosted. Latin, Arabic and Hebrew (≈0.7 MB) go in core. SC, TC, JP and KR (≈23 MB)
   go in the non-core background precache (§9), so the core stays small.
4. _(Owner)_ **Local and CI Pages emulation uses `spikes/shared/serve.ts`** (to be promoted to
   `/scripts` in M1). `wrangler` is not added.
5. _(Owner)_ When a Cloudflare Pages project exists, the owner runs the remaining preview-deployment
   checks listed under Consequences.

No ARCHITECTURE.md wording change is required. Decision 3 only makes the §9 "base fonts" / "CJK
fonts" split concrete.

## Consequences

- **M1 engine setup:**
  - raise Workbox `maximumFileSizeToCacheInBytes` to at least 6 MB for the WASM file;
  - copy the fonts with a small Vite plugin (as `spikes/shared/vite-assets.ts` does) and pass
    absolute URLs;
  - keep the `?fonts=default` negative-control test in e2e.
- **Owner follow-ups, not required to close S8:**
  - with a real Pages preview: confirm that Web Analytics automatic injection is **off**, that no
    beacon script appears in responses, and that server-side request counts are visible;
  - repeat the S8 checks against the preview URL;
  - run the smoke check in **Firefox**. Only Chromium is installed in this container. Firefox has
    supported module workers since v114, and there is no `longtask` API there, which the probe
    tolerates.
- **Remaining risks:**
  - the EmbedPDF font default could change in a later version (pinned at 2.15.1; the negative
    control catches a regression);
  - CJK-heavy documents opened offline before the non-core precache finishes render without glyphs
    until the fonts arrive.

## Evidence

- Code: [`spikes/s8-csp/`](../../spikes/s8-csp/), [`spikes/shared/`](../../spikes/shared/)
  (`_headers` with the §10.1 CSP verbatim, `serve.ts`, `mini-pdf.ts`, `vite-assets.ts`).
- Fixture: a self-made one-page PDF (`cjkFallbackPdf()` in `spikes/shared/mini-pdf.ts`). It has
  Helvetica text plus a **non-embedded** `STSong-Light` / Adobe-GB1 CID font, so PDFium must ask
  for a GB2312 fallback.
- Command: `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium SPIKE=s8 npm run spikes`. All 4
  pass:
  1. local fonts: CJK rendered, font fetched same-origin, 0 CSP violations, 0 third-party requests;
  2. `fontFallback: null`: no font request, glyphs missing, 0 violations;
  3. negative control: the default config tries `cdn.jsdelivr.net` and gets a `connect-src` report;
  4. offline reload through the service worker precache renders with CJK glyphs.
- Environment: cloud container, Linux, Chromium 141.0.7390.37 headless, Playwright 1.63, EmbedPDF
  2.15.1, vite-plugin-pwa 1.3.0, Vite 8.3.
- Chromium's own background connections to `www.google.com` (component updates) showed up in the
  proxy log. They are not page traffic, and the page's request log was empty.
