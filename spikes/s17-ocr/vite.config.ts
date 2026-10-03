import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

/** Self-host the English data under /ocr/ and the Node spike's page raster under /fixtures/. */
function s17Assets(): Plugin {
  return {
    name: 's17-assets',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'ocr/eng.traineddata.gz',
        source: readFileSync(
          require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
        ),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'fixtures/page1.pgm',
        source: readFileSync(join(here, 'out', 'page1.pgm')),
      });
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('../shared/public', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  plugins: [s17Assets()],
});
