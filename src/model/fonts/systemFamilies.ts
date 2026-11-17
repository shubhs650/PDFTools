// Fonts installed on this computer (M11-08·O5, D-54): Local Font Access lists
// one entry per face (family, style, PostScript name); the font list shows one
// entry per family, drawn in its regular, bold, italic and bold italic faces.
// Pure.
import {
  systemFontFile,
  systemFontId,
  type FaceKey,
  type LibraryFace,
  type LibraryFamily,
} from './library';

/** What Local Font Access tells about one face (its FontData, without the bytes). */
export interface LocalFace {
  family: string;
  style: string;
  postscriptName: string;
}

const WEIGHTS: readonly [RegExp, number][] = [
  [/\b(hairline|thin)\b/u, 100],
  [/\b(extra|ultra)[\s-]?light\b/u, 200],
  [/\b(light|lite)\b/u, 300],
  [/\b(semi|demi)[\s-]?bold\b/u, 600],
  [/\b(extra|ultra)[\s-]?bold\b/u, 800],
  [/\b(black|heavy)\b/u, 900],
  [/\bbold\b/u, 700],
  [/\bmedium\b/u, 500],
];
const WIDTH = /\b(condensed|narrow|compressed|expanded|extended|wide)\b/u;
const ITALIC = /\b(italic|oblique|slanted|kursiv)\b/u;

/** The weight a style name gives (400 when it names none). */
export function weightOf(style: string): number {
  const s = style.toLowerCase();
  for (const [re, w] of WEIGHTS) if (re.test(s)) return w;
  return 400;
}

export const isItalicStyle = (style: string): boolean => ITALIC.test(style.toLowerCase());

interface Candidate {
  face: LocalFace;
  weight: number;
  italic: boolean;
  /** A width other than normal (condensed, expanded, …): used only when nothing else fits. */
  width: boolean;
}

/** The best face for a slot: normal width first, then the weight nearest the target. */
function pick(cands: readonly Candidate[], italic: boolean, bold: boolean): Candidate | undefined {
  const pool = cands.filter(
    (c) => c.italic === italic && (bold ? c.weight >= 600 : c.weight < 600),
  );
  const target = bold ? 700 : 400;
  return [...pool].sort(
    (a, b) =>
      Number(a.width) - Number(b.width) ||
      Math.abs(a.weight - target) - Math.abs(b.weight - target) ||
      a.weight - b.weight ||
      a.face.postscriptName.localeCompare(b.face.postscriptName),
  )[0];
}

const face = (c: Candidate): LibraryFace => ({
  file: systemFontFile(c.face.postscriptName),
  // A variable font lists one entry per named instance, all the same file: draw it at this weight.
  wght: c.weight,
});

/**
 * One family per name, sorted by name (the user's language), with up to four
 * faces. Families whose name starts with "." are the system's private UI
 * fonts (macOS) and are left out. A family with only bold or italic faces
 * draws those (the rest is synthesized, as for the library).
 */
export function groupLocalFonts(faces: readonly LocalFace[], locale?: string): LibraryFamily[] {
  const byFamily = new Map<string, Candidate[]>();
  for (const f of faces) {
    const name = f.family.trim();
    if (!name || name.startsWith('.') || !f.postscriptName) continue;
    const s = f.style.toLowerCase();
    const list = byFamily.get(name) ?? [];
    list.push({ face: f, weight: weightOf(s), italic: ITALIC.test(s), width: WIDTH.test(s) });
    byFamily.set(name, list);
  }
  const out: LibraryFamily[] = [];
  for (const [name, cands] of byFamily) {
    const slots: [FaceKey, Candidate | undefined][] = [
      ['regular', pick(cands, false, false)],
      ['bold', pick(cands, false, true)],
      ['italic', pick(cands, true, false)],
      ['boldItalic', pick(cands, true, true)],
    ];
    const faces = Object.fromEntries(
      slots.filter((e): e is [FaceKey, Candidate] => !!e[1]).map(([k, c]) => [k, face(c)]),
    ) as LibraryFamily['faces'];
    out.push({ id: systemFontId(name), name, group: 'system', standard: 'helvetica', faces });
  }
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return out.sort((a, b) => collator.compare(a.name, b.name));
}

/** The face a family is checked with: its regular face, else the first it has. */
export function checkFace(family: LibraryFamily): LibraryFace | undefined {
  const f = family.faces;
  return f.regular ?? f.bold ?? f.italic ?? f.boldItalic;
}
