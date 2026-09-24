// Vite plugin shared by the M0 spikes: self-hosts PDFium WASM and the fallback
// font we test with, and emits the self-made fixtures. Nothing is fetched from
// a CDN at runtime (CLAUDE.md rule 4).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import { cjkFallbackPdf } from './mini-pdf.ts';

const require = createRequire(import.meta.url);
const pdfiumWasm = require.resolve('@embedpdf/pdfium/pdfium.wasm');
const fontsScDir = join(dirname(require.resolve('@embedpdf/fonts-sc')), '..', 'fonts');

export const SELF_HOSTED = {
  wasm: 'pdfium/pdfium.wasm',
  fontSc: 'fonts/sc/NotoSansHans-Regular.otf',
  cjkFixture: 'fixtures/cjk-fallback.pdf',
} as const;

export function spikeAssets(): Plugin {
  const files: Record<string, () => Uint8Array> = {
    [SELF_HOSTED.wasm]: () => readFileSync(pdfiumWasm),
    [SELF_HOSTED.fontSc]: () => readFileSync(join(fontsScDir, 'NotoSansHans-Regular.otf')),
    [SELF_HOSTED.cjkFixture]: () => cjkFallbackPdf(),
  };
  return {
    name: 'pdftools-spike-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        const make = files[key];
        if (!make) {
          next();
          return;
        }
        res.end(make());
      });
    },
    generateBundle() {
      for (const [fileName, make] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source: make() });
      }
    },
  };
}
