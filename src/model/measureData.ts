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
//
// An Angle, Radius or Diameter (M14-05) is a Stamp, which has no geometry of
// its own, so its entry also holds /P its clicked points (user space), /Rc the
// Stamp's /Rect when saved, /Sh a three-point curve's arc or circle, /C and /W
// its colour and line width (a Stamp has neither), and /Sc the scale its value
// was taken in ([paper real (unit)], as spike S34 proposed; no /Measure on a
// Stamp). Its fingerprint is of /Rect. Moved elsewhere (same size), its points
// move with it; resized or redrawn there, they are dropped and it stays a
// plain stamp with its value as its text.
//
// An Area or Volume (M14-06) also holds /Ho its cutouts (each a flat list of
// user-space numbers; shape-bound, so dropped when another editor reshaped
// the outline), /Dp a Volume's depth [value (unit)], and /Au /Ad, /Vu /Vd the
// area's and volume's own unit and decimals when chosen (Q28).
// A Count (M14-07, D-75) is a Stamp too: /P holds its centre alone, and its
// entry adds /G its group's name, /N its number, /Sy its symbol's shape, /Sz
// its size and /Hn true when its number is not drawn.
// Pure; values are the wire form (PdfJson) the object layer stages.
import { fingerprint, type Box, type Pt } from './measureGeometry';
import { isStampTool, TOOL_TOKEN, toolOfToken, type MeasureMeta } from './measureMarkup';
import { cleanGroupName, isCountShape, MAX_COUNT_SIZE, MIN_COUNT_SIZE } from './measureCount';
import { isAreaUnit, isDecimals, isDepth, isVolumeUnit } from './measureQuantity';
import type { Scale } from './scale';
import { fromJson, type PdfJson } from './pdf/wire';
import { PdfString } from './pdf/objects';

export const APP_KEY = 'TriyaPDF';

/** An Angle's, Radius's or Diameter's own data in its entry (user space). */
export interface CurveEntry {
  pts: Pt[];
  /** The Stamp's /Rect when saved. */
  rect: Box;
  color?: string;
  width?: number;
  scale?: Pick<Scale, 'paper' | 'real' | 'unit'> | null;
}

/** One measurement's entry, read or to be written. */
export interface MeasureEntry {
  /** A curve's `pts` are in `curve`, an area's `holes` in `holes` (user space), never here. */
  meta: MeasureMeta;
  /** The geometry fingerprint it was saved with. */
  fp: string;
  curve?: CurveEntry;
  /** An Area's or Volume's cutouts in user space (M14-06). */
  holes?: Pt[][];
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
  if (e.meta.shape) d['Sh'] = { name: e.meta.shape === 'arc' ? 'Arc' : 'Circle' };
  if (e.holes?.length) d['Ho'] = e.holes.map((h) => h.flatMap((p) => [round(p.x), round(p.y)]));
  if (e.meta.depth) d['Dp'] = [round(e.meta.depth.value), { text: e.meta.depth.unit }];
  if (e.meta.areaUnit) d['Au'] = { name: e.meta.areaUnit };
  if (e.meta.areaDecimals !== undefined) d['Ad'] = e.meta.areaDecimals;
  if (e.meta.volumeUnit) d['Vu'] = { name: e.meta.volumeUnit };
  if (e.meta.volumeDecimals !== undefined) d['Vd'] = e.meta.volumeDecimals;
  if (e.meta.group) d['G'] = { text: e.meta.group };
  if (e.meta.n) d['N'] = e.meta.n;
  if (e.meta.sym) d['Sy'] = { name: e.meta.sym };
  if (e.meta.size) d['Sz'] = round(e.meta.size);
  if (e.meta.hideN) d['Hn'] = true;
  const c = e.curve;
  if (c) {
    d['P'] = c.pts.flatMap((p) => [round(p.x), round(p.y)]);
    d['Rc'] = c.rect.map(round);
    if (c.color) d['C'] = { text: c.color };
    if (typeof c.width === 'number') d['W'] = round(c.width);
    if (c.scale) d['Sc'] = [c.scale.paper, c.scale.real, { text: c.scale.unit }];
  }
  d['F'] = { text: e.fp };
  return { dict: d };
}

const nums = (j: PdfJson | undefined): number[] | null =>
  Array.isArray(j) && j.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (j as number[])
    : null;

/**
 * A Stamp measurement's own data from its entry (a curve's 2 or 3 points, a
 * count's 1); null when it has no points this version can use.
 */
function curveFromPdf(d: Dict, count: boolean): CurveEntry | null {
  const p = nums(d['P']);
  const r = nums(d['Rc']);
  const [lo, hi] = count ? [2, 2] : [4, 6];
  if (!p || r?.length !== 4 || p.length % 2 !== 0 || p.length < lo || p.length > hi) return null;
  const pts: Pt[] = [];
  for (let i = 0; i < p.length; i += 2) pts.push({ x: p[i] ?? 0, y: p[i + 1] ?? 0 });
  const out: CurveEntry = { pts, rect: r as Box };
  const color = textOf(d['C']);
  if (color && /^#[0-9A-Fa-f]{6}$/u.test(color)) out.color = color;
  if (typeof d['W'] === 'number' && d['W'] >= 0) out.width = d['W'];
  return out;
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
  const sh = nameOf(d['Sh']);
  if (sh === 'Arc') meta.shape = 'arc';
  else if (sh === 'Circle') meta.shape = 'circle';
  const au = nameOf(d['Au']);
  if (isAreaUnit(au)) meta.areaUnit = au;
  if (isDecimals(d['Ad'])) meta.areaDecimals = d['Ad'];
  const vu = nameOf(d['Vu']);
  if (isVolumeUnit(vu)) meta.volumeUnit = vu;
  if (isDecimals(d['Vd'])) meta.volumeDecimals = d['Vd'];
  const dp = d['Dp'];
  const depth = Array.isArray(dp) ? { value: dp[0], unit: textOf(dp[1]) } : null;
  if (isDepth(depth)) meta.depth = { value: depth.value, unit: depth.unit };
  if (tool === 'count') {
    const group = cleanGroupName(textOf(d['G']) ?? '');
    if (group) meta.group = group;
    const n = d['N'];
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) meta.n = n;
    const sym = nameOf(d['Sy']);
    if (isCountShape(sym)) meta.sym = sym;
    const size = d['Sz'];
    if (typeof size === 'number' && Number.isFinite(size))
      meta.size = Math.min(MAX_COUNT_SIZE, Math.max(MIN_COUNT_SIZE, size));
    if (d['Hn'] === true) meta.hideN = true;
  }
  const out: MeasureEntry = { meta, fp: textOf(d['F']) ?? '' };
  const ho = d['Ho'];
  if (Array.isArray(ho)) {
    const holes = ho
      .map(nums)
      .filter((h): h is number[] => !!h && h.length >= 6 && h.length % 2 === 0)
      .map((h) => {
        const pts: Pt[] = [];
        for (let i = 0; i < h.length; i += 2) pts.push({ x: h[i] ?? 0, y: h[i + 1] ?? 0 });
        return pts;
      });
    if (holes.length) out.holes = holes;
  }
  if (isStampTool(tool)) {
    const curve = curveFromPdf(d, tool === 'count');
    if (curve) out.curve = curve;
  }
  return out;
}

/**
 * A curve's points now (user space): as saved while its Stamp is where it was
 * saved; moved with it when another editor moved it (same size, to 0.01 pt);
 * null when it was resized or its points are missing (its shape is unknown).
 */
export function curvePointsNow(saved: CurveEntry | undefined, rect: Box): Pt[] | null {
  if (!saved) return null;
  const [a0, b0, a1, b1] = saved.rect;
  const same = (x: number, y: number): boolean => Math.abs(x - y) < 0.01;
  if (!same(a1 - a0, rect[2] - rect[0]) || !same(b1 - b0, rect[3] - rect[1])) return null;
  const dx = rect[0] - a0;
  const dy = rect[1] - b0;
  return saved.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
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
