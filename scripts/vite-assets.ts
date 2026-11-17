// Vite plugin: self-hosts the fallback fonts (ADR-003 decision 3) under
// /fonts/<package>/<file>, each with its OFL-1.1 license text, in the build and
// in the dev server (since M6-13 also the typed-signature fonts). Regular weight only; which fonts are core vs background
// precache is decided in M1-25 (CORE_FONT_PACKAGES). Since M5 (ADR-020 d2) also
// the OCR language data under /ocr/ (English in the background precache, the rest on demand),
// and since M11-07 (D-52) the comment font library under /fonts/lib/ from vendor/fonts/.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import {
  FONT_FILES,
  fontPath,
  SIGNATURE_FONTS,
  signatureFontPath,
  type FontPackage,
} from '../src/engine/fonts.ts';
import { OCR_LANGUAGES, ocrDataPath } from '../src/model/ocr/languages.ts';
import { FONT_LIBRARY, fontLibraryPath, libraryFiles } from '../src/model/fonts/library.ts';
import { fontFile, fontLicense } from './fonts/manifest.ts';
import { NOTICES_FILE, builtWith, collectNotices, licenseData, renderNotices } from './notices.ts';
import { BUILT_WITH_PACKAGES } from '../src/app/about/components.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = (pkg: FontPackage): string =>
  join(root, 'node_modules', '@embedpdf', `fonts-${pkg}`);

export function selfHostedAssets(): Plugin {
  const files = new Map<string, () => Uint8Array>();
  for (const pkg of Object.keys(FONT_FILES) as FontPackage[]) {
    files.set(fontPath(pkg), () => readFileSync(join(pkgDir(pkg), 'fonts', FONT_FILES[pkg])));
    files.set(`fonts/${pkg}/LICENSE`, () => readFileSync(join(pkgDir(pkg), 'LICENSE')));
  }
  // Typed signatures (M6-13, ADR-022 d3): the three handwriting fonts and their OFL texts.
  const sigDir = join(root, 'node_modules', '@embedpdf', 'default-signature-fonts');
  for (const f of SIGNATURE_FONTS) {
    files.set(signatureFontPath(f), () => readFileSync(join(sigDir, 'fonts', f.file)));
    files.set(`fonts/${f.id}/LICENSE`, () => readFileSync(join(sigDir, 'licenses', f.license)));
  }
  // The comment font library (M11-07, D-52): vendor/fonts/ (scripts/fonts/build.ts), each
  // family's license next to its files; background precache (src/sw/precacheSplit.ts).
  for (const file of libraryFiles())
    files.set(fontLibraryPath(file), () => readFileSync(fontFile(file)));
  for (const fam of FONT_LIBRARY)
    files.set(`${fontLibraryPath(fam.id)}/LICENSE`, () => readFileSync(fontLicense(fam.id)));
  for (const { code } of OCR_LANGUAGES)
    files.set(ocrDataPath(code), () =>
      readFileSync(
        join(
          root,
          'node_modules',
          '@tesseract.js-data',
          code,
          '4.0.0_best_int',
          `${code}.traineddata.gz`,
        ),
      ),
    );
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

/** About's in-app license list (M10-01, D-48), loaded lazily: see src/app/about/licenseData.ts. */
export const LICENSES_MODULE = 'virtual:open-source-licenses';
/** About's "Built with" versions and licenses (M10-01), a few hundred bytes. */
export const BUILT_WITH_MODULE = 'virtual:built-with';

/**
 * Third-party notices (M1-26): `third-party-notices.txt` next to index.html,
 * generated from the installed runtime packages at build time (and served by
 * the dev server), so it can never be stale. Linked from File → About. Since
 * M10-01 (ADR-027 D-48) the same data is also an app module, so About lists
 * every package and its license text in the app without a network call (rule 4).
 */
export function thirdPartyNotices(): Plugin {
  // A UTF-8 byte order mark: Cloudflare serves .txt as `text/plain` with no
  // charset, and without it the browser shows "—" and other non-ASCII text as
  // windows-1252 mojibake when the notices open in a tab (M10-01).
  const make = (): string => `\uFEFF${renderNotices(collectNotices(root))}`;
  const resolved = (id: string): string => `\0${id}`;
  return {
    name: 'pdftools-third-party-notices',
    resolveId(id) {
      return id === LICENSES_MODULE || id === BUILT_WITH_MODULE ? resolved(id) : null;
    },
    load(id) {
      if (id === resolved(LICENSES_MODULE))
        return `export default ${JSON.stringify(licenseData(collectNotices(root)))};`;
      if (id === resolved(BUILT_WITH_MODULE))
        return `export default ${JSON.stringify(builtWith(collectNotices(root), BUILT_WITH_PACKAGES))};`;
      return null;
    },
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
