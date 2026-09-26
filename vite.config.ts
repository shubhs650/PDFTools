import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { MANIFEST } from './src/app/manifest.ts';
import { PRECACHE_EXTENSIONS } from './src/sw/precacheSplit.ts';
import { selfHostedAssets, thirdPartyNotices } from './scripts/vite-assets.ts';
import { appVersion } from './scripts/app-version.ts';

export default defineConfig({
  plugins: [
    react(),
    selfHostedAssets(),
    thirdPartyNotices(),
    // M1-19 manifest; M1-25 service worker (src/sw/sw.ts, our own code:
    // core precache at install, background precache after first render,
    // updates only on the user's click). Registered by src/features/offline.
    VitePWA({
      injectRegister: null,
      registerType: 'prompt',
      manifest: MANIFEST as never,
      includeManifestIcons: false,
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: [`**/*.{${PRECACHE_EXTENSIONS.join(',')}}`],
        // pdfium.wasm is 4.6 MB and the largest CJK font 8.4 MB (ADR-003).
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
  define: {
    // File → About (M1-26): package version and the commit it was built from.
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
