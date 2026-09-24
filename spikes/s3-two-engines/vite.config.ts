import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { spikeAssets } from '../shared/vite-assets.ts';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../shared/public', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  plugins: [spikeAssets()],
});
