// Spike S27 (M12-02): the real view layer (src/features/view) mounted two and
// three times in one window. Built like the app (`--mode e2e` keeps the test
// probes), served by spikes/shared/serve.ts with the app's own _headers.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { selfHostedAssets, thirdPartyNotices } from '../../scripts/vite-assets.ts';

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: at('.'),
  publicDir: at('../../public'),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  plugins: [react(), selfHostedAssets(), thirdPartyNotices()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify('spike-s27'),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify('2026-11-22'),
  },
  resolve: {
    alias: [
      {
        find: /^pdf-oxide-wasm\/wasm(\?url)?$/,
        replacement: `${at('../../node_modules/pdf-oxide-wasm/web/pdf_oxide_bg.wasm')}$1`,
      },
      {
        find: /^decode-named-character-reference$/,
        replacement: at('../../node_modules/decode-named-character-reference/index.js'),
      },
    ],
  },
});
