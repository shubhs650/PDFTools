import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { MANIFEST } from './src/app/manifest.ts';
import { PRECACHE_EXTENSIONS } from './src/sw/precacheSplit.ts';
import { selfHostedAssets, thirdPartyNotices } from './scripts/vite-assets.ts';
import { appVersion } from './scripts/app-version.ts';

/**
 * Help (M9, ADR-026 D-46) is its own page, `help.html`, served at `/help` as
 * Cloudflare does; the dev server would otherwise give `/help` the app.
 */
function helpRoute(): Plugin {
  return {
    name: 'pdftools-help-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/help' || req.url?.startsWith('/help?')) req.url = `/help.html${req.url.slice(5)}`;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    helpRoute(),
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
        // pdfium.wasm is 4.6 MB, the largest CJK font 8.4 MB (ADR-003) and PDF
        // Oxide's WASM 17.6 MB raw (4.5 MB brotli on the wire, ADR-009).
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
    }),
  ],
  define: {
    // File → About (M1-26): package version and the commit it was built from.
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
  resolve: {
    alias: [
      // PDF Oxide's WASM (ADR-009 decision 1): the package exports no path to
      // it, and the Work worker passes its URL explicitly (M4-04).
      {
        find: /^pdf-oxide-wasm\/wasm(\?url)?$/,
        replacement: `${fileURLToPath(new URL('./node_modules/pdf-oxide-wasm/web/pdf_oxide_bg.wasm', import.meta.url))}$1`,
      },
      // The Markdown parser's entity decoder (M4-07) has a DOM build for the
      // "browser" condition (document.createElement); the Work worker has no
      // document, and Vite's worker build does not prefer the package's own
      // "worker" condition, so the plain build is used everywhere.
      {
        find: /^decode-named-character-reference$/,
        replacement: fileURLToPath(
          new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url),
        ),
      },
    ],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      // The app and the Help window (M9, ADR-026 D-46).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        help: fileURLToPath(new URL('./help.html', import.meta.url)),
      },
    },
  },
});
