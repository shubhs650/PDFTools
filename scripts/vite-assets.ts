// Vite plugin: self-hosts the fallback fonts (ADR-003 decision 3) under
// /fonts/<package>/<file>, each with its OFL-1.1 license text, in the build and
// in the dev server. Regular weight only; which fonts are core vs background
// precache is decided in M1-25 (CORE_FONT_PACKAGES).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { FONT_FILES, fontPath, type FontPackage } from '../src/engine/fonts.ts';
import { NOTICES_FILE, collectNotices, renderNotices } from './notices.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = (pkg: FontPackage): string =>
  join(root, 'node_modules', '@embedpdf', `fonts-${pkg}`);

export function selfHostedAssets(): Plugin {
  const files = new Map<string, () => Uint8Array>();
  for (const pkg of Object.keys(FONT_FILES) as FontPackage[]) {
    files.set(fontPath(pkg), () => readFileSync(join(pkgDir(pkg), 'fonts', FONT_FILES[pkg])));
    files.set(`fonts/${pkg}/LICENSE`, () => readFileSync(join(pkgDir(pkg), 'LICENSE')));
  }
  return {
    name: 'pdftools-self-hosted-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        const make = files.get(key);
        if (!make) {
          next();
          return;
        }
        res.end(make());
      });
    },
    generateBundle() {
      for (const [fileName, make] of files)
        this.emitFile({ type: 'asset', fileName, source: make() });
    },
  };
}

/**
 * Third-party notices (M1-26): `third-party-notices.txt` next to index.html,
 * generated from the installed runtime packages at build time (and served by
 * the dev server), so it can never be stale. Linked from File → About.
 */
export function thirdPartyNotices(): Plugin {
  const make = (): string => renderNotices(collectNotices(root));
  return {
    name: 'pdftools-third-party-notices',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== `/${NOTICES_FILE}`) {
          next();
          return;
        }
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(make());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: make() });
    },
  };
}
