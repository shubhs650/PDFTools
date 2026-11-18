// The font library on the main thread (M11-07, D-52): its faces are added to
// the document's font set under our own names ("Triya Roboto", never a system
// font's), so the on-page editor and the font list draw text in them. Adding
// a FontFace loads nothing: the browser fetches a file (from our origin, or
// the service worker's cache offline) only when text is drawn in it, so the
// list's previews load only when the list opens.
import {
  cssFamilyName,
  FALLBACK_CHAIN,
  FONT_LIBRARY,
  fontLibraryPath,
  libraryFamily,
  type FaceKey,
  type LibraryFamily,
} from '../../../model/fonts/library';

const STANDARD_CSS: Record<string, string> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};

let registered = false;

const descriptors = (key: FaceKey, variable: boolean): FontFaceDescriptors => ({
  weight: variable ? '100 900' : key === 'bold' || key === 'boldItalic' ? '700' : '400',
  style: key === 'italic' || key === 'boldItalic' ? 'italic' : 'normal',
  display: 'swap',
});

/** Adds every face of the library to `document.fonts` (once; nothing is downloaded). */
export function registerCommentFonts(): void {
  if (registered || typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  registered = true;
  for (const family of FONT_LIBRARY) {
    const seen = new Set<string>();
    for (const [key, face] of Object.entries(family.faces) as [
      FaceKey,
      { file: string; wght?: number },
    ][]) {
      if (seen.has(face.file)) continue;
      seen.add(face.file);
      const url = new URL(fontLibraryPath(face.file), location.origin).href;
      document.fonts.add(
        new FontFace(
          cssFamilyName(family),
          `url("${url}")`,
          descriptors(key, face.wght !== undefined),
        ),
      );
    }
  }
}

const quoted = (f: LibraryFamily): string => `"${cssFamilyName(f)}"`;

/**
 * The CSS font-family of a comment font: the library face, then the same
 * fallbacks the saved appearance uses (symbols, Devanagari, Chinese), then
 * the standard family's.
 */
export function cssFontStack(font: string): string {
  const lib = libraryFamily(font);
  if (!lib?.group) return STANDARD_CSS[font] ?? STANDARD_CSS['helvetica'] ?? 'sans-serif';
  const chain = FALLBACK_CHAIN.map((id) => libraryFamily(id))
    .filter((f): f is LibraryFamily => !!f && f.id !== lib.id)
    .map(quoted);
  return [quoted(lib), ...chain, STANDARD_CSS[lib.standard] ?? 'sans-serif'].join(', ');
}
