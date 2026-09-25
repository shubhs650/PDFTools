import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { selfHostedAssets } from './scripts/vite-assets.ts';

export default defineConfig({
  plugins: [react(), selfHostedAssets()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
