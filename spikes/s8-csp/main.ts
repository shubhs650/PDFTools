// M0-S8: EmbedPDF's stock worker engine under the §10.1 CSP, self-hosted WASM
// and fonts, plus a vite-plugin-pwa service worker. See docs/adr/003-s8-csp.md.
//
// Query `?fonts=`:
//   local   (default) fallback fonts served from our origin
//   off     fontFallback: null — no font requests at all
//   default fontFallback left undefined — EmbedPDF's jsDelivr default. Negative
//           control: the CSP must block it and the probes must see it.

import { createPdfiumEngine } from '@embedpdf/engines/pdfium-worker-engine';
import { FontCharset } from '@embedpdf/models';
import type { FontFallbackConfig } from '@embedpdf/engines/pdfium';
import { countInk, installProbes, probe } from '../shared/probe.ts';

installProbes();

const statusEl = document.getElementById('status') as HTMLOutputElement;
const logEl = document.getElementById('log') as HTMLPreElement;
const imgEl = document.getElementById('page') as HTMLImageElement;
const fileEl = document.getElementById('file') as HTMLInputElement;

const results: Record<string, unknown> = { probe };
declare global {
  interface Window {
    __s8: Record<string, unknown>;
  }
}
window.__s8 = results;

function log(key: string, value: unknown): void {
  results[key] = value;
  logEl.textContent = JSON.stringify(results, null, 2);
}

const abs = (path: string): string => new URL(path, location.origin).href;
const fontsMode = new URLSearchParams(location.search).get('fonts') ?? 'local';

// Worker-side fetches run inside a blob: worker whose base URL cannot resolve
// relative paths, so every URL handed to the engine must be absolute.
const localFonts: FontFallbackConfig = {
  fonts: {
    [FontCharset.GB2312]: [{ url: abs('/fonts/sc/NotoSansHans-Regular.otf'), weight: 400 }],
  },
};

async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    log('sw', 'unsupported');
    return;
  }
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  log('sw', {
    controlled: navigator.serviceWorker.controller !== null,
    active: reg.active?.state ?? null,
  });
}

const engine = createPdfiumEngine(abs('/pdfium/pdfium.wasm'), {
  ...(fontsMode === 'default' ? {} : { fontFallback: fontsMode === 'off' ? null : localFonts }),
});

async function openAndRender(bytes: ArrayBuffer, id: string): Promise<void> {
  const t0 = performance.now();
  const doc = await engine.openDocumentBuffer({ id, content: bytes }).toPromise();
  const page = doc.pages[0];
  if (!page) throw new Error('no pages');
  const raw = await engine.renderPageRaw(doc, page, { scaleFactor: 0.5 }).toPromise();
  const blob = await engine.renderPage(doc, page, { scaleFactor: 0.5 }).toPromise();
  imgEl.src = URL.createObjectURL(blob);
  const text = await engine.extractText(doc, [0]).toPromise();
  log('render', {
    id,
    pageCount: doc.pageCount,
    ms: Math.round(performance.now() - t0),
    ink: countInk(raw.data),
    blobType: blob.type,
    text: text.slice(0, 200),
  });
  await engine.closeDocument(doc).toPromise();
}

fileEl.addEventListener('change', () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  statusEl.value = 'rendering local file';
  void f
    .arrayBuffer()
    .then((b) => openAndRender(b, `local-${String(Date.now())}`))
    .then(() => (statusEl.value = 'done'))
    .catch((e: unknown) => {
      log('error', String(e));
      statusEl.value = 'error';
    });
});

async function run(): Promise<void> {
  log('fontsMode', fontsMode);
  await registerServiceWorker();
  const res = await fetch('/fixtures/cjk-fallback.pdf');
  await openAndRender(await res.arrayBuffer(), 'cjk-fallback');
  statusEl.value = 'done';
}

run().catch((e: unknown) => {
  log('error', String(e));
  statusEl.value = 'error';
});
