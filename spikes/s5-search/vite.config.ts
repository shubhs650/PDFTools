import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { spikeAssets } from '../shared/vite-assets.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Emit the self-made contract stand-in (run make-contract.ts first) under /fixtures/. */
function contract(): Plugin {
  const file = join(here, 'out', 'contract-2000.pdf');
  return {
    name: 's5-contract',
    generateBundle() {
      if (existsSync(file)) {
        this.emitFile({
          type: 'asset',
          fileName: 'fixtures/contract-2000.pdf',
          source: readFileSync(file),
        });
      }
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('../shared/public', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  plugins: [spikeAssets(), contract()],
});
