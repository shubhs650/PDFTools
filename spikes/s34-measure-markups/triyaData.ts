// Spike S34 (M14-01, D-74): what only Triya PDF needs to edit a measurement
// again, kept in the page's /PieceInfo (ISO 32000-1 §14.5, "page-piece
// dictionaries"), never as extra keys on the annotation (rule 6):
//
//   page /PieceInfo << /TriyaPDF << /LastModified (D:…)
//                                   /Private << /Type /TriyaMeasurements /V 1
//                                               /Items << /<annotation /NM> << … >> … >> >> >> >>
//   page /LastModified (D:…)   (required by §14.5 when /PieceInfo is present)
//
// One entry per measurement, keyed by its /NM. /F is a fingerprint of the
// geometry as saved: when another editor moves or reshapes the markup, the
// fingerprint no longer matches, and the entry's shape-bound data (holes, arc,
// caption place) is dropped while its shape-free data (tool, label, count
// group and number, depth) is kept. A markup with no entry at all is read back
// from its own subtype, /IT, /Measure and geometry (readback below).
import {
  isDict,
  nameOf,
  numOf,
  PdfName,
  PdfString,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects.ts';
import { fingerprint, netArea, pathLength, type Pt } from './geometry.ts';

export const APP_KEY = 'TriyaPDF';

export type Tool =
  | 'Length'
  | 'Polylength'
  | 'Perimeter'
  | 'Area'
  | 'Volume'
  | 'Cutout'
  | 'Angle'
  | 'Radius'
  | 'Diameter'
  | 'Count'
  | 'Summary';

export interface TriyaEntry {
  tool: Tool;
  label?: string;
  /** Count (D-75). */
  group?: string;
  number?: number;
  shape?: string;
  /** Volume: depth in the scale's unit. */
  depth?: number;
  /** Area, Volume: their own unit and decimals (Q28). */
  unit?: string;
  decimals?: number;
  /** Cutout holes, user space. */
  holes?: Pt[][];
  /** Radius and Diameter: centre, radius (points), the arc's start and end (radians; full circle: 0, 2π), how it was drawn. */
  arc?: { c: Pt; r: number; a0: number; a1: number; by: 'centre' | 'three' };
  /** Scale of a kind whose subtype has no /Measure (Circle, Square): paper:real and unit. */
  scale?: { paper: number; real: number; unit: string };
  /** The geometry fingerprint when saved. */
  fp: string;
}

const N = (n: string): PdfName => new PdfName(n);
const S = (t: string): PdfString => PdfString.of(t);
const pts = (p: readonly Pt[]): number[] => p.flatMap((q) => [round(q.x), round(q.y)]);
const round = (n: number): number => Math.round(n * 1000) / 1000;

export function entryToPdf(e: TriyaEntry): PdfDict {
  const d: PdfDict = new Map<string, PdfValue>([['T', N(e.tool)]]);
  if (e.label) d.set('Lb', S(e.label));
  if (e.group) d.set('G', S(e.group));
  if (e.number !== undefined) d.set('No', e.number);
  if (e.shape) d.set('Sh', N(e.shape));
  if (e.depth !== undefined) d.set('Dp', e.depth);
  if (e.unit) d.set('U', S(e.unit));
  if (e.decimals !== undefined) d.set('Dc', e.decimals);
  if (e.holes?.length) d.set('H', e.holes.map(pts));
  if (e.arc)
    d.set(
      'Arc',
      new Map<string, PdfValue>([
        ['C', pts([e.arc.c])],
        ['R', round(e.arc.r)],
        ['A', [round(e.arc.a0), round(e.arc.a1)]],
        ['By', N(e.arc.by === 'centre' ? 'Centre' : 'ThreePoints')],
      ]),
    );
  if (e.scale) d.set('Sc', [e.scale.paper, e.scale.real, S(e.scale.unit)]);
  d.set('F', S(e.fp));
  return d;
}

/** The page's /PieceInfo and /LastModified values for its measurements. */
export function pageEntries(
  items: ReadonlyMap<string, TriyaEntry>,
  modified: string,
): Map<string, PdfValue> {
  const list: PdfDict = new Map();
  for (const [nm, e] of items) list.set(nm, entryToPdf(e));
  const priv: PdfDict = new Map<string, PdfValue>([
    ['Type', N('TriyaMeasurements')],
    ['V', 1],
    ['Items', list],
  ]);
  const app: PdfDict = new Map<string, PdfValue>([
    ['LastModified', S(modified)],
    ['Private', priv],
  ]);
  return new Map<string, PdfValue>([
    ['PieceInfo', new Map<string, PdfValue>([[APP_KEY, app]])],
    ['LastModified', S(modified)],
  ]);
}

const text = (v: PdfValue | undefined): string | undefined =>
  v instanceof PdfString ? v.text() : undefined;
const numbers = (v: PdfValue | undefined): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
const toPts = (a: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i] ?? 0, y: a[i + 1] ?? 0 });
  return out;
};

export function entryFromPdf(d: PdfDict): TriyaEntry | null {
  const tool = nameOf(d.get('T')) as Tool | undefined;
  if (!tool) return null;
  const e: TriyaEntry = { tool, fp: text(d.get('F')) ?? '' };
  const lb = text(d.get('Lb'));
  if (lb) e.label = lb;
  const g = text(d.get('G'));
  if (g) e.group = g;
  const no = numOf(d.get('No'));
  if (no !== undefined) e.number = no;
  const sh = nameOf(d.get('Sh'));
  if (sh) e.shape = sh;
  const dp = numOf(d.get('Dp'));
  if (dp !== undefined) e.depth = dp;
  const u = text(d.get('U'));
  if (u) e.unit = u;
  const dc = numOf(d.get('Dc'));
  if (dc !== undefined) e.decimals = dc;
  const h = d.get('H');
  if (Array.isArray(h)) e.holes = h.map((x) => toPts(numbers(x)));
  const arc = d.get('Arc');
  if (isDict(arc)) {
    const [c] = toPts(numbers(arc.get('C')));
    const [a0 = 0, a1 = 2 * Math.PI] = numbers(arc.get('A'));
    if (c)
      e.arc = {
        c,
        r: numOf(arc.get('R')) ?? 0,
        a0,
        a1,
        by: nameOf(arc.get('By')) === 'Centre' ? 'centre' : 'three',
      };
  }
  const sc = d.get('Sc');
  if (Array.isArray(sc) && typeof sc[0] === 'number' && typeof sc[1] === 'number')
    e.scale = { paper: sc[0], real: sc[1], unit: text(sc[2]) ?? 'mm' };
  return e;
}

/** The page's Triya entries by /NM (empty when it has none, or another app's only). */
export function readPageEntries(
  page: PdfDict,
  resolve: (v: PdfValue | undefined) => PdfValue | undefined = (v) => v,
): Map<string, TriyaEntry> {
  const out = new Map<string, TriyaEntry>();
  const pi = resolve(page.get('PieceInfo'));
  if (!isDict(pi)) return out;
  const app = resolve(pi.get(APP_KEY));
  if (!isDict(app)) return out;
  const priv = resolve(app.get('Private'));
  if (!isDict(priv) || numOf(priv.get('V')) !== 1) return out;
  const items = resolve(priv.get('Items'));
  if (!isDict(items)) return out;
  for (const [nm, v] of items) {
    const d = resolve(v);
    const e = isDict(d) ? entryFromPdf(d) : null;
    if (e) out.set(nm, e);
  }
  return out;
}

// ------------------------------------------------------------------ geometry and readback

/** What an annotation itself says (from the file, any viewer's). */
export interface MarkupFacts {
  nm: string;
  subtype: string;
  intent?: string | undefined;
  contents?: string | undefined;
  subject?: string | undefined;
  /** Line /L, PolyLine and Polygon /Vertices, else /Rect corners. */
  points: Pt[];
  rect: [number, number, number, number];
  hasMeasure: boolean;
  hasAppearance: boolean;
  /** /IRT and /RT: a reply or a group member (a v1.1.0 Distance label). */
  irt: boolean;
  group: boolean;
}

/** The fingerprint of an annotation's geometry: what the Triya entry was saved against. */
export function geometryFingerprint(
  subtype: string,
  points: readonly Pt[],
  rect: readonly number[],
): string {
  return fingerprint(
    subtype === 'Line' || subtype === 'PolyLine' || subtype === 'Polygon'
      ? points.flatMap((p) => [p.x, p.y])
      : [...rect],
  );
}

export type ReadState = 'full' | 'moved elsewhere' | 'no Triya data' | 'not a measurement';

export interface ReadBack {
  nm: string;
  tool: Tool | null;
  state: ReadState;
  /** The value Triya PDF would compute again, in points (length) or square points (area); null: none. */
  geometryValue: number | null;
  /** What survived: the keys of the Triya entry used. */
  kept: string[];
  /** Shape-bound data dropped because the geometry changed. */
  dropped: string[];
}

const SHAPE_BOUND = ['holes', 'arc'] as const;

/** Classifies one markup with its Triya entry (or none): what Triya PDF can edit again. */
export function readBack(m: MarkupFacts, entry: TriyaEntry | undefined): ReadBack {
  const fp = geometryFingerprint(m.subtype, m.points, m.rect);
  const fromShape = toolFromShape(m);
  if (!entry) {
    return {
      nm: m.nm,
      tool: fromShape,
      state: fromShape ? 'no Triya data' : 'not a measurement',
      geometryValue: fromShape ? valueOf(fromShape, m.points, []) : null,
      kept: [],
      dropped: [],
    };
  }
  const same = entry.fp === fp;
  const kept = Object.keys(entry).filter(
    (k) => k !== 'fp' && (same || !(SHAPE_BOUND as readonly string[]).includes(k)),
  );
  const dropped = same
    ? []
    : SHAPE_BOUND.filter((k) => entry[k] !== undefined).map((k) => k as string);
  const holes = same ? (entry.holes ?? []) : [];
  return {
    nm: m.nm,
    tool: entry.tool,
    state: same ? 'full' : 'moved elsewhere',
    geometryValue: valueOf(entry.tool, m.points, holes),
    kept,
    dropped,
  };
}

/** A measurement read from its own standard data, with no Triya entry. */
export function toolFromShape(m: MarkupFacts): Tool | null {
  const it = m.intent;
  if (m.subtype === 'Line' && it === 'LineDimension') return 'Length';
  if (m.subtype === 'PolyLine' && it === 'PolyLineDimension') {
    const a = m.points[0];
    const b = m.points[m.points.length - 1];
    return a && b && m.points.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) < 0.01
      ? 'Perimeter'
      : 'Polylength';
  }
  if (m.subtype === 'Polygon' && it === 'PolygonDimension') return 'Area';
  return null;
}

function valueOf(tool: Tool, p: readonly Pt[], holes: readonly Pt[][]): number | null {
  switch (tool) {
    case 'Length':
    case 'Polylength':
    case 'Perimeter':
      return pathLength(p, false);
    case 'Area':
    case 'Volume':
    case 'Cutout':
      return netArea(p, holes);
    default:
      return null;
  }
}
