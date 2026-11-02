// Self-hosted fallback fonts (ADR-003 decision 3, §9): Regular weight only,
// served from our origin. EmbedPDF's default config fetches from jsDelivr, so
// the engine is always given either this config or null (never undefined).
import type { FontFallbackConfig } from '@embedpdf/engines/pdfium';
import { FontCharset } from '@embedpdf/models';

/** Published path (under /fonts/) → source file in node_modules. Also read by scripts/vite-assets.ts. */
export const FONT_FILES = {
  latin: 'NotoSans-Regular.ttf',
  arabic: 'NotoNaskhArabic-Regular.ttf',
  hebrew: 'NotoSansHebrew-Regular.ttf',
  sc: 'NotoSansHans-Regular.otf',
  tc: 'NotoSansHant-Regular.otf',
  jp: 'NotoSansJP-Regular.otf',
  kr: 'NotoSansKR-Regular.otf',
} as const;

export type FontPackage = keyof typeof FONT_FILES;

/** Core fonts ship with the first load; CJK is background-precached (ADR-003 d3, M1-25). */
export const CORE_FONT_PACKAGES: readonly FontPackage[] = ['latin', 'arabic', 'hebrew'];

export const fontPath = (pkg: FontPackage): string => `fonts/${pkg}/${FONT_FILES[pkg]}`;

/**
 * Local font config with absolute same-origin URLs (ADR-003 finding 3: the
 * engine resolves URLs inside a worker, so relative URLs are not safe).
 */
export function localFontConfig(origin: string): FontFallbackConfig {
  const url = (pkg: FontPackage): string => new URL(fontPath(pkg), origin).href;
  return {
    fonts: {
      [FontCharset.SHIFTJIS]: url('jp'),
      [FontCharset.HANGEUL]: url('kr'),
      [FontCharset.GB2312]: url('sc'),
      [FontCharset.CHINESEBIG5]: url('tc'),
      [FontCharset.ARABIC]: url('arabic'),
      [FontCharset.HEBREW]: url('hebrew'),
      [FontCharset.CYRILLIC]: url('latin'),
      [FontCharset.GREEK]: url('latin'),
      [FontCharset.VIETNAMESE]: url('latin'),
    },
  };
}

/**
 * Handwriting fonts for typed signatures (M6-13, ADR-022 decision 3): from
 * `@embedpdf/default-signature-fonts` (OFL-1.1), self-hosted under
 * /fonts/<id>/<file> with their licence (scripts/vite-assets.ts) and
 * background-precached (src/sw/precacheSplit.ts). Read by the dialog (to show
 * the name in the font) and the encoder worker (to draw it).
 */
export const SIGNATURE_FONTS = [
  {
    id: 'sig-allura',
    family: 'PDFTools Allura',
    file: 'Allura-Regular.ttf',
    license: 'Allura-OFL.txt',
  },
  {
    id: 'sig-great-vibes',
    family: 'PDFTools Great Vibes',
    file: 'GreatVibes-Regular.ttf',
    license: 'GreatVibes-OFL.txt',
  },
  {
    id: 'sig-caveat',
    family: 'PDFTools Caveat',
    file: 'Caveat-Regular.ttf',
    license: 'Caveat-OFL.txt',
  },
] as const;

export type SignatureFont = (typeof SIGNATURE_FONTS)[number];
export type SignatureFontId = SignatureFont['id'];

export const signatureFontPath = (f: SignatureFont): string => `fonts/${f.id}/${f.file}`;
