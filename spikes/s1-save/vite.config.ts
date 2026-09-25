import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { spikeAssets } from '../shared/vite-assets.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Emit the generated S1 fixtures (run make-fixtures.ts first) under /fixtures/. */
function s1Fixtures(): Plugin {
  const dir = join(here, 'out', 'fixtures');
  return {
    name: 's1-fixtures',
    generateBundle() {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.pdf'))) {
        this.emitFile({
          type: 'asset',
          fileName: `fixtures/${f}`,
          source: readFileSync(join(dir, f)),
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
  plugins: [spikeAssets(), s1Fixtures()],
});
