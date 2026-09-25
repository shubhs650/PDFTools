import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { spikeAssets } from '../shared/vite-assets.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Emit the S7 self-made fixtures (run make-fixtures.ts first) under /fixtures/. */
function s7Fixtures(): Plugin {
  return {
    name: 's7-fixtures',
    generateBundle() {
      for (const f of ['test-sheet.pdf', 'dense-1m.pdf']) {
        const p = join(here, 'out', f);
        if (existsSync(p))
          this.emitFile({ type: 'asset', fileName: `fixtures/${f}`, source: readFileSync(p) });
      }
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('../shared/public', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  plugins: [spikeAssets(), s7Fixtures()],
});
