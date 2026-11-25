// The Triya data of measurements (M14-03, D-74, ADR-035 Amendment 1 decision
// 3; format from spike S34's triyaData.ts): what only Triya PDF needs to edit a
// measurement again, kept in the page's /PieceInfo (ISO 32000-1 §14.5), keyed
// by the annotation's /NM, never as extra keys on the annotation (rule 6):
//
//   page /PieceInfo << /TriyaPDF << /LastModified (D:…)
//                                   /Private << /Type /TriyaMeasurements /V 1
//                                               /Items << /<NM> << /T /Length … /F (…) >> … >> >> >> >>
//   page /LastModified (D:…)   (required by §14.5 with /PieceInfo)
//
// Keys of an entry: /T tool, /Lb label, /Fc an area's fill colour, /Co a
// dragged caption's offset, /F the geometry's fingerprint when saved. When
// another editor moved or reshaped the markup the fingerprint differs, and the
// shape-bound data (/Co) is dropped while the rest is kept. Other applications'
// /PieceInfo entries, and entries this version does not write, are kept as read.
// Pure; values are the wire form (PdfJson) the object layer stages.
import { fingerprint, type Pt } from './measureGeometry';
import { TOOL_TOKEN, toolOfToken, type MeasureMeta } from './measureMarkup';
import { fromJson, type PdfJson } from './pdf/wire';
import { PdfString } from './pdf/objects';

export const APP_KEY = 'TriyaPDF';

/** One measurement's entry, read or to be written. */
export interface MeasureEntry {
  meta: MeasureMeta;
  /** The geometry fingerprint it was saved with. */
  fp: string;
}

type Dict = Record<string, PdfJson>;

const dictOf = (j: PdfJson | undefined): Dict | null =>
  j && typeof j === 'object' && !Array.isArray(j) && 'dict' in j ? j.dict : null;
const nameOf = (j: PdfJson | undefined): string | undefined =>
  j && typeof j === 'object' && !Array.isArray(j) && 'name' in j ? j.name : undefined;

/** A string's text (plain, or UTF-16 as the reader gives it in hex). */
export function textOf(j: PdfJson | undefined): string | undefined {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined;
  if (!('text' in j) && !('hex' in j)) return undefined;
  try {
    const v = fromJson(j);
    return v instanceof PdfString ? v.text() : undefined;
  } catch {
    return undefined;
  }
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** The fingerprint of a measurement's points in user space (a line's two, or the vertices). */
export const geometryFingerprint = (pts: readonly Pt[]): string => fingerprint(pts);

export function entryToPdf(e: MeasureEntry): PdfJson {
  const d: Dict = { T: { name: TOOL_TOKEN[e.meta.tool] } };
  if (e.meta.label) d['Lb'] = { text: e.meta.label };
  if (e.meta.fill) d['Fc'] = { text: e.meta.fill };
  if (e.meta.capOffset) d['Co'] = [round(e.meta.capOffset.x), round(e.meta.capOffset.y)];
  d['F'] = { text: e.fp };
  return { dict: d };
}

/** An entry read from the file; null when it is not one this version knows. */
export function entryFromPdf(j: PdfJson | undefined): MeasureEntry | null {
  const d = dictOf(j);
  const tool = toolOfToken(nameOf(d?.['T']));
  if (!d || !tool) return null;
  const meta: MeasureMeta = { tool };
  const label = textOf(d['Lb']);
  if (label?.trim()) meta.label = label;
  const fill = textOf(d['Fc']);
  if (fill && /^#[0-9A-Fa-f]{6}$/u.test(fill)) meta.fill = fill;
  const co = d['Co'];
  if (
    Array.isArray(co) &&
    typeof co[0] === 'number' &&
    typeof co[1] === 'number' &&
    (co[0] !== 0 || co[1] !== 0)
  )
    meta.capOffset = { x: co[0], y: co[1] };
  return { meta, fp: textOf(d['F']) ?? '' };
}

/** The page's entries by /NM, as read (raw, so ones this version cannot read are kept). */
export function readItems(pieceInfo: PdfJson | undefined): Map<string, PdfJson> {
  const out = new Map<string, PdfJson>();
  const app = dictOf(dictOf(pieceInfo)?.[APP_KEY]);
  const priv = dictOf(app?.['Private']);
  if (priv?.['V'] !== 1) return out;
  const items = dictOf(priv['Items']);
  if (!items) return out;
  for (const [nm, v] of Object.entries(items)) out.set(nm, v);
  return out;
}

/**
 * The meta to edit a measurement with, from its entry: everything when its
 * geometry is still the one saved, else without the shape-bound caption offset.
 */
export function metaFromEntry(e: MeasureEntry, fp: string): MeasureMeta {
  const meta = { ...e.meta };
  if (e.fp !== fp) delete meta.capOffset;
  return meta;
}

/**
 * The page's /PieceInfo and /LastModified with `items` as Triya PDF's entries:
 * the rest of the file's /PieceInfo (other applications') is kept. No items:
 * our entry goes, and with nothing else /PieceInfo goes too (`remove`).
 */
export function pageData(
  filePieceInfo: PdfJson | undefined,
  items: ReadonlyMap<string, PdfJson>,
  modified: string,
): { set: Record<string, PdfJson>; remove: string[] } {
  const others: Dict = Object.fromEntries(
    Object.entries(dictOf(filePieceInfo) ?? {}).filter(([k]) => k !== APP_KEY),
  );
  if (items.size === 0) {
    return Object.keys(others).length
      ? { set: { PieceInfo: { dict: others }, LastModified: { text: modified } }, remove: [] }
      : { set: {}, remove: ['PieceInfo'] };
  }
  const app: Dict = {
    LastModified: { text: modified },
    Private: {
      dict: {
        Type: { name: 'TriyaMeasurements' },
        V: 1,
        Items: { dict: Object.fromEntries(items) },
      },
    },
  };
  return {
    set: {
      PieceInfo: { dict: { ...others, [APP_KEY]: { dict: app } } },
      LastModified: { text: modified },
    },
    remove: [],
  };
}
