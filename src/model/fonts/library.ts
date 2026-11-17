// The font library for text comments (M11-07, D-52, ADR-028 and its S26
// amendment): 26 families from the Google Fonts library, all OFL-1.1, shipped
// with the app under /fonts/lib/ (rule 4: served from our own origin, never
// from Google) and precached in the background. Data only, read by the main
// thread (picker, editor CSS) and the Render worker (shaping and embedding).
//
// The files are built by `node scripts/fonts/build.ts` into vendor/fonts/
// (each face pinned to one instance and cut to the scripts it is used for);
// families whose license reserves their name (OFL §3: Carlito, IBM Plex) are
// the upstream files, unmodified, so their bold comes from a variation
// (`wght`) of the same file.

export type FontGroup =
  'office' | 'sans' | 'narrow' | 'technical' | 'serif' | 'mono' | 'hand' | 'hindi' | 'chinese';

/** The picker's group order (the plan's table). */
export const FONT_GROUPS: readonly FontGroup[] = [
  'office',
  'sans',
  'narrow',
  'technical',
  'serif',
  'mono',
  'hand',
  'hindi',
  'chinese',
];

export type FaceKey = 'regular' | 'bold' | 'italic' | 'boldItalic';

/** The standard font family a library family falls back to in /DA (PDFium's own appearance, other viewers' redraw). */
export type StandardFamily = 'helvetica' | 'times' | 'courier';

export interface LibraryFace {
  /** File name under /fonts/lib/. */
  file: string;
  /** For an unmodified variable file: the `wght` to draw this face with. */
  wght?: number;
}

export interface LibraryFamily {
  /** Stable id, stored with the comment's tool defaults and styles. */
  id: string;
  /** The family name, also written to /DS (other viewers use it when they redraw). */
  name: string;
  /** Picker group; `null` for the hidden symbol fallback. */
  group: FontGroup | null;
  standard: StandardFamily;
  faces: Partial<Record<FaceKey, LibraryFace>>;
  /** A few characters of its own script, shown after the name in the list. */
  sample?: string;
}

const cut = (id: string, keys: readonly FaceKey[]): LibraryFamily['faces'] =>
  Object.fromEntries(keys.map((k) => [k, { file: `${id}-${k}.ttf` }]));
const FOUR: readonly FaceKey[] = ['regular', 'bold', 'italic', 'boldItalic'];
const TWO: readonly FaceKey[] = ['regular', 'bold'];
/** An unmodified variable family (reserved name): upright and italic files, bold by `wght`. */
const variable = (id: string): LibraryFamily['faces'] => ({
  regular: { file: `${id}-upright.ttf`, wght: 400 },
  bold: { file: `${id}-upright.ttf`, wght: 700 },
  italic: { file: `${id}-italic.ttf`, wght: 400 },
  boldItalic: { file: `${id}-italic.ttf`, wght: 700 },
});

const fam = (
  id: string,
  name: string,
  group: FontGroup | null,
  standard: StandardFamily,
  faces: LibraryFamily['faces'] = cut(id, FOUR),
  sample?: string,
): LibraryFamily => ({ id, name, group, standard, faces, ...(sample ? { sample } : {}) });

export const FONT_LIBRARY: readonly LibraryFamily[] = [
  // Office-compatible: the same widths as Arial, Times New Roman, Courier New and Calibri.
  fam('arimo', 'Arimo', 'office', 'helvetica'),
  fam('tinos', 'Tinos', 'office', 'times'),
  fam('cousine', 'Cousine', 'office', 'courier'),
  fam('carlito', 'Carlito', 'office', 'helvetica'),
  fam('inter', 'Inter', 'sans', 'helvetica'),
  fam('roboto', 'Roboto', 'sans', 'helvetica'),
  fam('opensans', 'Open Sans', 'sans', 'helvetica'),
  fam('notosans', 'Noto Sans', 'sans', 'helvetica'),
  fam('ibmplexsans', 'IBM Plex Sans', 'sans', 'helvetica', variable('ibmplexsans')),
  fam('atkinson', 'Atkinson Hyperlegible', 'sans', 'helvetica'),
  fam('robotocondensed', 'Roboto Condensed', 'narrow', 'helvetica'),
  fam('barlowcondensed', 'Barlow Condensed', 'narrow', 'helvetica'),
  fam('b612', 'B612', 'technical', 'helvetica'),
  fam('overpass', 'Overpass', 'technical', 'helvetica'),
  fam('notoserif', 'Noto Serif', 'serif', 'times'),
  fam('sourceserif4', 'Source Serif 4', 'serif', 'times'),
  fam('robotomono', 'Roboto Mono', 'mono', 'courier'),
  fam('jetbrainsmono', 'JetBrains Mono', 'mono', 'courier'),
  fam('ibmplexmono', 'IBM Plex Mono', 'mono', 'courier'),
  fam(
    'architectsdaughter',
    'Architects Daughter',
    'hand',
    'helvetica',
    cut('architectsdaughter', ['regular']),
  ),
  fam('caveat', 'Caveat', 'hand', 'helvetica', cut('caveat', TWO)),
  fam('kalam', 'Kalam', 'hand', 'helvetica', cut('kalam', TWO), 'हिन्दी'),
  fam(
    'notosansdeva',
    'Noto Sans Devanagari',
    'hindi',
    'helvetica',
    cut('notosansdeva', TWO),
    'हिन्दी',
  ),
  fam(
    'notoserifdeva',
    'Noto Serif Devanagari',
    'hindi',
    'times',
    cut('notoserifdeva', TWO),
    'हिन्दी',
  ),
  fam('notosanssc', 'Noto Sans SC', 'chinese', 'helvetica', cut('notosanssc', TWO), '中文'),
  // Not in the picker: symbols no family has (⌀ U+2300 is in none of the above; S26).
  fam('notosansmath', 'Noto Sans Math', null, 'helvetica', cut('notosansmath', ['regular'])),
];

/**
 * Characters a face lacks are drawn from these, in order (S26): symbols,
 * Devanagari, Chinese. On screen (the editor's CSS) and in the appearance.
 */
export const FALLBACK_CHAIN: readonly string[] = ['notosansmath', 'notosansdeva', 'notosanssc'];

/** Where the files are served (scripts/vite-assets.ts) and precached (src/sw/precacheSplit.ts). */
export const FONT_LIBRARY_DIR = 'fonts/lib';
export const fontLibraryPath = (file: string): string => `${FONT_LIBRARY_DIR}/${file}`;

const BY_ID = new Map(FONT_LIBRARY.map((f) => [f.id, f]));
const BY_NAME = new Map(FONT_LIBRARY.map((f) => [f.name.toLowerCase(), f]));

export const libraryFamily = (id: string | undefined): LibraryFamily | undefined =>
  id ? BY_ID.get(id) : undefined;

/** Families the picker lists, in group order. */
export const PICKER_FAMILIES: readonly LibraryFamily[] = FONT_GROUPS.flatMap((g) =>
  FONT_LIBRARY.filter((f) => f.group === g),
);

/** A library family by the family name /DS gives (quotes and case ignored), or undefined. */
export function libraryFamilyByName(name: string): LibraryFamily | undefined {
  return BY_NAME.get(
    name
      .trim()
      .replace(/^['"]|['"]$/gu, '')
      .trim()
      .toLowerCase(),
  );
}

export interface ResolvedFace {
  family: LibraryFamily;
  face: LibraryFace;
  /** Drawn bold with a stroke / italic with a slant: the family has no such face (S26). */
  fakeBold: boolean;
  fakeItalic: boolean;
}

/** The face that draws `family` bold and/or italic, and what is synthesized. */
export function resolveFace(family: LibraryFamily, bold: boolean, italic: boolean): ResolvedFace {
  const f = family.faces;
  const want: FaceKey = bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular';
  const exact = f[want];
  if (exact) return { family, face: exact, fakeBold: false, fakeItalic: false };
  // Keep what exists of the style, synthesize the rest.
  if (bold && f.bold) return { family, face: f.bold, fakeBold: false, fakeItalic: italic };
  if (italic && f.italic) return { family, face: f.italic, fakeBold: bold, fakeItalic: false };
  const regular = f.regular ?? Object.values(f)[0];
  if (!regular) throw new Error(`${family.id}: no faces`);
  return { family, face: regular, fakeBold: bold, fakeItalic: italic };
}

/** Every file of the library, once (the build, the precache test, the license check). */
export function libraryFiles(): string[] {
  const out = new Set<string>();
  for (const f of FONT_LIBRARY) for (const face of Object.values(f.faces)) out.add(face.file);
  return [...out].sort();
}

/** The CSS family a face is registered under on the main thread (never a system font's name). */
export const cssFamilyName = (family: LibraryFamily): string => `Triya ${family.name}`;

// ------------------------------------------------------------ the standard fallback in /DA

/** PdfStandardFont's first id of each family: Courier 0 … 3, Helvetica 4 … 7, Times 8 … 11. */
const STANDARD_BASE: Record<StandardFamily, number> = { courier: 0, helvetica: 4, times: 8 };

/**
 * Bold and italic of a PdfStandardFont (0 … 11; each family is regular, bold,
 * bold italic, italic). Anything else is regular, as PDFium draws it.
 */
export function standardStyle(font: number | undefined): { bold: boolean; italic: boolean } {
  if (font === undefined || !Number.isInteger(font) || font < 0 || font > 11)
    return { bold: false, italic: false };
  const o = font % 4;
  return { bold: o === 1 || o === 2, italic: o === 2 || o === 3 };
}

/** The PdfStandardFont of `family` with bold and italic. */
export function standardFont(family: StandardFamily, bold: boolean, italic: boolean): number {
  return STANDARD_BASE[family] + (bold ? (italic ? 2 : 1) : italic ? 3 : 0);
}
