import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { MANIFEST } from './src/app/manifest.ts';
import { selfHostedAssets } from './scripts/vite-assets.ts';

export default defineConfig({
  plugins: [
    react(),
    selfHostedAssets(),
    // M1-19: the web app manifest only. The service worker's precache and
    // update flow come in M1-25; until then it is built but never registered.
    VitePWA({
      injectRegister: null,
      registerType: 'prompt',
      manifest: MANIFEST as never,
      includeManifestIcons: false,
      workbox: { globPatterns: ['index.html'] },
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
