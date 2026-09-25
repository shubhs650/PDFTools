import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { s4Fixture } from './fixtures.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const oxideDir = dirname(require.resolve('pdf-oxide-wasm/web'));

/** Self-host the Oxide WASM under /oxide/ and emit the self-made fixtures under /fixtures/. */
function s4Assets(): Plugin {
  const contract = join(here, '..', 's5-search', 'out', 'contract-2000.pdf');
  return {
    name: 's4-assets',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'oxide/pdf_oxide_bg.wasm',
        source: readFileSync(join(oxideDir, 'pdf_oxide_bg.wasm')),
      });
      this.emitFile({ type: 'asset', fileName: 'fixtures/s4-fixture.pdf', source: s4Fixture() });
      if (existsSync(contract))
        this.emitFile({
          type: 'asset',
          fileName: 'fixtures/contract-2000.pdf',
          source: readFileSync(contract),
        });
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('../shared/public', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  plugins: [s4Assets()],
});
