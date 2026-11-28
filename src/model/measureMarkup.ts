// One markup per measurement (M14-03, D-73, D-74, ADR-035 Amendment 1): the
// four length and area tools, what only Triya PDF needs to edit one again (the
// `measure` field of the annotation object, kept in the page's /PieceInfo on
// save, measureData.ts), and where its caption goes. The caption is the value
// (with the optional label in front) drawn inside the markup's own appearance
// by the Render worker (workers/render/measureAppearance.ts); the main thread
// uses the same placement, with an estimated text width, for the /Rect.
// Pure. Points are PDF user space (y up) or EmbedPDF's mirrored (see
// measureGeometry.ts).
import { dimensionGeometry, type Leader } from './dimension';
import {
  areaLabelPoint,
  bounds,
  corners,
  lineCaption,
  longestSegment,
  type Box,
  type CaptionBox,
  type Pt,
} from './measureGeometry';
import { curveDrawing, isCurveTool, type CurveShape, type CurveTool } from './measureCurve';
import {
  DEFAULT_DEPTH,
  isAreaUnit,
  isDecimals,
  isDepth,
  isVolumeUnit,
  type AreaUnit,
  type Depth,
  type VolumeUnit,
} from './measureQuantity';
import {
  countCaption,
  DEFAULT_COUNT_SIZE,
  isCountShape,
  MAX_COUNT_SIZE,
  MIN_COUNT_SIZE,
  cleanGroupName,
  type CountShape,
} from './measureCount';
import type { Kind } from './scale';

/**
 * Angle, Radius, Diameter (M14-05) and Count (M14-07) are Stamps; the rest
 * Line, PolyLine, Polygon (a Volume, M14-06, is a Polygon too).
 */
export type MeasureTool =
  'length' | 'polylength' | 'perimeter' | 'area' | 'volume' | CurveTool | 'count';

/** The tools whose markup is a Stamp with its points in `measure.pts`. */
export type StampTool = CurveTool | 'count';

export const isStampTool = (t: unknown): t is StampTool => isCurveTool(t) || t === 'count';

export const MEASURE_TOOL_IDS: readonly MeasureTool[] = [
  'length',
  'polylength',
  'perimeter',
  'area',
  'volume',
  'angle',
  'radius',
  'diameter',
  'count',
];

/** How each length and area tool's value is computed (model/scale.ts): a Perimeter repeats its first vertex. */
export const VALUE_KIND: Record<Exclude<MeasureTool, StampTool>, Kind> = {
  length: 'distance',
  polylength: 'perimeter',
  perimeter: 'perimeter',
  area: 'area',
  // A Volume's outline is an area (/IT /PolygonDimension); its depth is in its Triya data.
  volume: 'area',
};

/** An Area or a Volume (M14-06): a Polygon with net area, cutouts and its own units. */
export const isAreaTool = (t: MeasureTool | null | undefined): t is 'area' | 'volume' =>
  t === 'area' || t === 'volume';

/** The tool's name in the file (the Triya data's /T; never shown, never translated). */
export const TOOL_TOKEN: Record<MeasureTool, string> = {
  length: 'Length',
  polylength: 'Polylength',
  perimeter: 'Perimeter',
  area: 'Area',
  volume: 'Volume',
  angle: 'Angle',
  radius: 'Radius',
  diameter: 'Diameter',
  count: 'Count',
};

export const toolOfToken = (t: string | undefined): MeasureTool | null =>
  MEASURE_TOOL_IDS.find((k) => TOOL_TOKEN[k] === t) ?? null;

/** A Length's caption: Above (/CP /Top, the default) or In line (/CP /Inline) (Q20). */
export type CaptionPlace = 'top' | 'inline';

/** What Triya PDF keeps to edit a measurement again (the annotation object's `measure`). */
export interface MeasureMeta {
  tool: MeasureTool;
  /** Goes in front of the value ("Slab S1: 42.5 m²", Q27). */
  label?: string;
  /** Length only. */
  cap?: CaptionPlace;
  /** A dragged caption (Q40): along and across its reading direction, points. */
  capOffset?: Pt;
  /** Area: the see-through fill drawn in the appearance only (no /IC); absent: none. */
  fill?: string;
  /**
   * Angle, Radius and Diameter (M14-05): the clicked points, EmbedPDF page
   * points (a Stamp has no geometry of its own): an Angle's arm end, corner,
   * arm end; a Radius's or Diameter's centre and edge point, or three points
   * on the curve.
   */
  pts?: Pt[];
  /** A three-point Radius or Diameter drawn as its arc or the whole circle (absent: the tool's default). */
  shape?: CurveShape;
  /**
   * An Area's or Volume's cutouts (M14-06, Q8): each hole's points, EmbedPDF
   * page points, inside the outline and clear of each other.
   */
  holes?: Pt[][];
  /** A Volume's depth (Q7); always there on a Volume. */
  depth?: Depth;
  /** An Area's or Volume's own area unit and decimals (Q28); absent: from the scale. */
  areaUnit?: AreaUnit;
  areaDecimals?: number;
  /** A Volume's own unit and decimals (Q28); absent: from the scale. */
  volumeUnit?: VolumeUnit;
  volumeDecimals?: number;
  /** Count (M14-07, Q11, Q14): its group's name; `pts` holds its centre alone. */
  group?: string;
  /** Count: its number in its group (1, 2, 3 …; gaps kept, Q15). */
  n?: number;
  /** Count: its symbol's shape. */
  sym?: CountShape;
  /** Count: its symbol's size, points. */
  size?: number;
  /** Count: its number is not drawn beside the symbol (the Properties pane, Q11). */
  hideN?: true;
}

/** Caption size (Q40: 10 pt in the app's own font). */
export const CAPTION_SIZE = 10;
/** Line height of a caption, as the comment fonts use. */
export const CAPTION_LINE_HEIGHT = 1.18;
/** Space around a caption's text inside its box. */
export const CAPTION_PAD = 1;
/** An area's see-through fill: this much of the fill colour (Q31). */
export const FILL_ALPHA = 0.2;

const HEX = /^#[0-9A-Fa-f]{6}$/u;
const TOOLS = new Set<string>(MEASURE_TOOL_IDS);

const isPt = (p: unknown): p is Pt =>
  typeof p === 'object' &&
  p !== null &&
  Number.isFinite((p as Pt).x) &&
  Number.isFinite((p as Pt).y);

/** Well-formed holes: lists of three or more points (copied), or undefined when none. */
function holesOf(v: unknown): Pt[][] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((h): h is unknown[] => Array.isArray(h) && h.length >= 3 && h.every(isPt))
    .map((h) => (h as Pt[]).map((p) => ({ x: p.x, y: p.y })));
  return out.length ? out : undefined;
}

/** metaOf's answers by `measure` object: read for every markup on every change (1,000 counts on a sheet). */
const READ = new WeakMap<object, MeasureMeta | null>();

/**
 * The well-formed `measure` field of an annotation object, or null. The same
 * field gives the same object back: treat it as read-only (copy to change it).
 */
export function metaOf(a: unknown): MeasureMeta | null {
  const m = (a as { measure?: unknown } | null)?.measure;
  if (typeof m !== 'object' || m === null) return null;
  const known = READ.get(m);
  if (known !== undefined) return known;
  const out = readMeta(m as Record<string, unknown>);
  READ.set(m, out);
  return out;
}

function readMeta(r: Record<string, unknown>): MeasureMeta | null {
  const tool = r['tool'];
  if (typeof tool !== 'string' || !TOOLS.has(tool)) return null;
  const out: MeasureMeta = { tool: tool as MeasureTool };
  if (typeof r['label'] === 'string' && r['label'].trim()) out.label = r['label'];
  if (r['cap'] === 'inline' || r['cap'] === 'top') out.cap = r['cap'];
  const o = r['capOffset'] as Partial<Pt> | undefined;
  if (
    o &&
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    Number.isFinite(o.x) &&
    Number.isFinite(o.y) &&
    (o.x !== 0 || o.y !== 0)
  )
    out.capOffset = { x: o.x, y: o.y };
  if (typeof r['fill'] === 'string' && HEX.test(r['fill'])) out.fill = r['fill'];
  if (isCurveTool(tool)) {
    const pts = r['pts'];
    if (
      Array.isArray(pts) &&
      pts.length >= 2 &&
      pts.length <= 3 &&
      pts.every(
        (p: unknown) =>
          typeof p === 'object' &&
          p !== null &&
          Number.isFinite((p as Pt).x) &&
          Number.isFinite((p as Pt).y),
      )
    )
      out.pts = (pts as Pt[]).map((p) => ({ x: p.x, y: p.y }));
    if (r['shape'] === 'arc' || r['shape'] === 'circle') out.shape = r['shape'];
  }
  if (isAreaTool(out.tool)) {
    const holes = holesOf(r['holes']);
    if (holes) out.holes = holes;
    if (isAreaUnit(r['areaUnit'])) out.areaUnit = r['areaUnit'];
    if (isDecimals(r['areaDecimals'])) out.areaDecimals = r['areaDecimals'];
  }
  if (out.tool === 'volume') {
    const d = r['depth'];
    out.depth = isDepth(d) ? { value: d.value, unit: d.unit } : { ...DEFAULT_DEPTH };
    if (isVolumeUnit(r['volumeUnit'])) out.volumeUnit = r['volumeUnit'];
    if (isDecimals(r['volumeDecimals'])) out.volumeDecimals = r['volumeDecimals'];
  }
  if (out.tool === 'count') {
    const p = Array.isArray(r['pts']) ? (r['pts'] as unknown[])[0] : undefined;
    if (
      typeof p === 'object' &&
      p !== null &&
      Number.isFinite((p as Pt).x) &&
      Number.isFinite((p as Pt).y)
    )
      out.pts = [{ x: (p as Pt).x, y: (p as Pt).y }];
    const group = typeof r['group'] === 'string' ? cleanGroupName(r['group']) : '';
    if (group) out.group = group;
    const n = r['n'];
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) out.n = n;
    if (isCountShape(r['sym'])) out.sym = r['sym'];
    const size = r['size'];
    if (typeof size === 'number' && Number.isFinite(size))
      out.size = Math.min(MAX_COUNT_SIZE, Math.max(MIN_COUNT_SIZE, size));
    if (r['hideN'] === true) out.hideN = true;
  }
  return out;
}

/** Two point lists say the same (to 0.001 pt). */
const samePts = (a: readonly Pt[] | undefined, b: readonly Pt[] | undefined): boolean =>
  (a?.length ?? 0) === (b?.length ?? 0) &&
  (a ?? []).every(
    (p, i) =>
      Math.abs(p.x - (b?.[i]?.x ?? NaN)) < 1e-3 && Math.abs(p.y - (b?.[i]?.y ?? NaN)) < 1e-3,
  );

/** Two metas say the same. */
export function sameMeta(a: MeasureMeta | null, b: MeasureMeta | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.tool === b.tool &&
    (a.label ?? '') === (b.label ?? '') &&
    (a.cap ?? 'top') === (b.cap ?? 'top') &&
    (a.capOffset?.x ?? 0) === (b.capOffset?.x ?? 0) &&
    (a.capOffset?.y ?? 0) === (b.capOffset?.y ?? 0) &&
    (a.fill ?? '') === (b.fill ?? '') &&
    samePts(a.pts, b.pts) &&
    (a.shape ?? '') === (b.shape ?? '') &&
    (a.holes?.length ?? 0) === (b.holes?.length ?? 0) &&
    (a.holes ?? []).every((h, i) => samePts(h, b.holes?.[i])) &&
    (a.depth?.value ?? 0) === (b.depth?.value ?? 0) &&
    (a.depth?.unit ?? '') === (b.depth?.unit ?? '') &&
    (a.areaUnit ?? '') === (b.areaUnit ?? '') &&
    (a.areaDecimals ?? -1) === (b.areaDecimals ?? -1) &&
    (a.volumeUnit ?? '') === (b.volumeUnit ?? '') &&
    (a.volumeDecimals ?? -1) === (b.volumeDecimals ?? -1) &&
    (a.group ?? '') === (b.group ?? '') &&
    (a.n ?? 0) === (b.n ?? 0) &&
    (a.sym ?? '') === (b.sym ?? '') &&
    (a.size ?? 0) === (b.size ?? 0) &&
    !!a.hideN === !!b.hideN
  );
}

/** The caption's size: the text's width (measured or estimated) plus padding. */
export function captionSize(textWidth: number, lines = 1, size = CAPTION_SIZE) {
  return {
    width: textWidth + 2 * CAPTION_PAD,
    height: lines * size * CAPTION_LINE_HEIGHT + 2 * CAPTION_PAD,
  };
}

/**
 * The width of `text` in the app's font (Inter) at `size`, estimated from
 * character classes: never narrower than the shaped text for Latin, digits and
 * the measurement signs, so the /Rect the main thread sets holds the caption
 * the Render worker draws (which grows /Rect if it ever does not).
 */
export function estimateWidth(text: string, size = CAPTION_SIZE): number {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.28;
    else if (/[.,:;'’|!iIjl]/u.test(ch)) em += 0.32;
    else if (/[0-9]/u.test(ch)) em += 0.64;
    else if (/[MWmw@%²³°]/u.test(ch)) em += 0.98;
    else if (/[A-Z]/u.test(ch)) em += 0.76;
    else if ((ch.codePointAt(0) ?? 0) <= 0x24f) em += 0.62;
    else em += 1.05;
  }
  return Math.ceil(em * size);
}

/** Moves a caption box by its dragged offset, in its own reading direction. */
export function offsetBox(c: CaptionBox, o: Pt | undefined): CaptionBox {
  if (!o) return c;
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  return {
    ...c,
    at: { x: c.at.x + o.x * cos - o.y * sin, y: c.at.y + o.x * sin + o.y * cos },
  };
}

/**
 * Where a measurement's caption goes (Q40): a Length's along its dimension
 * line (Above or In line), a Polylength's or Perimeter's on its longest
 * segment, an Area's or Volume's in the middle of the shape, clear of its
 * cutouts; then its dragged offset. `pts`: a line's two points or the
 * vertices (a Perimeter's last repeats its first), in user space (y up);
 * `holes` in the same space.
 */
export function captionPlace(
  meta: Pick<MeasureMeta, 'tool' | 'cap' | 'capOffset' | 'shape' | 'size'>,
  pts: readonly Pt[],
  leader: Leader | null | undefined,
  width: number,
  height: number,
  holes: readonly (readonly Pt[])[] = [],
): CaptionBox {
  const zero = { x: 0, y: 0 };
  let box: CaptionBox;
  if (meta.tool === 'count') {
    // Beside the symbol, to the right (M14-07, Q11).
    box = countCaption(pts[0] ?? zero, meta.size ?? DEFAULT_COUNT_SIZE, width, height);
  } else if (meta.tool === 'length') {
    const a = pts[0] ?? zero;
    const g = dimensionGeometry(a, pts[1] ?? a, leader, false);
    box = lineCaption(g.start, g.end, meta.cap ?? 'top', width, height);
  } else if (isCurveTool(meta.tool)) {
    // An Angle's outside its arc; a Radius's or Diameter's above its line (measureCurve.ts).
    const d = curveDrawing(meta.tool, pts, { ...(meta.shape ? { shape: meta.shape } : {}) });
    box = d ? d.caption(width, height) : { at: pts[0] ?? zero, angle: 0, width, height };
  } else if (isAreaTool(meta.tool)) {
    box = { at: areaLabelPoint(pts, width, height, holes), angle: 0, width, height };
  } else {
    const [a, b] = longestSegment(pts, false);
    box = lineCaption(a, b, 'top', width, height);
  }
  return offsetBox(box, meta.capOffset);
}

/** EmbedPDF's page points (y down) ↔ the mirror the caption geometry works in (y up). */
export const mirror = (p: Pt): Pt => ({ x: p.x, y: -p.y });

/** An area's cutouts mirrored as its points are (EmbedPDF page points → y up). */
export const mirroredHoles = (meta: Pick<MeasureMeta, 'holes'>): Pt[][] =>
  (meta.holes ?? []).map((h) => h.map(mirror));

/**
 * The caption box's bounds in EmbedPDF's page points (y down), for the
 * measurement's /Rect: the caption placed on the mirrored points with an
 * estimated width (`text` empty: none).
 */
export function captionBoundsEP(
  meta: MeasureMeta,
  ptsEP: readonly Pt[],
  leader: Leader | null | undefined,
  text: string,
): Box | null {
  if (!text.trim() || ptsEP.length === 0) return null;
  const lines = text.split('\n');
  const { width, height } = captionSize(
    Math.max(...lines.map((l) => estimateWidth(l))),
    lines.length,
  );
  const box = captionPlace(meta, ptsEP.map(mirror), leader, width, height, mirroredHoles(meta));
  return bounds(corners(box).map(mirror), 1);
}

/** The text on the sheet: the value, with the label in front when there is one (Q27). */
export function captionText(
  label: string | undefined,
  value: string,
  labelled: (label: string, value: string) => string,
): string {
  const l = label?.trim();
  return l ? labelled(l, value) : value;
}

/**
 * A measurement's tool from its own standard data, with no Triya data (ADR-035
 * Amendment 1 decision 4): a LineDimension is a Length; a PolyLineDimension
 * whose last vertex repeats its first (four or more) is a Perimeter, else a
 * Polylength; a PolygonDimension is an Area.
 */
export function toolFromShape(kind: Kind, pts: readonly Pt[]): MeasureTool {
  if (kind === 'distance') return 'length';
  if (kind === 'area') return 'area';
  const a = pts[0];
  const b = pts[pts.length - 1];
  return a && b && pts.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) < 0.01
    ? 'perimeter'
    : 'polylength';
}

/**
 * A caption's offset after a drag of `d` (EmbedPDF page points, y down; Q40):
 * the offset lives in the caption's own frame (along its baseline, then up),
 * so it follows the measurement when its points move.
 */
export function dragOffset(
  meta: MeasureMeta,
  ptsEP: readonly Pt[],
  leader: Leader | null | undefined,
  d: Pt,
): Pt {
  const box = captionPlace(meta, ptsEP.map(mirror), leader, 0, 0, mirroredHoles(meta));
  const u = mirror(d);
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const o = meta.capOffset ?? { x: 0, y: 0 };
  const r = (n: number): number => Math.round(n * 100) / 100;
  return { x: r(o.x + u.x * cos + u.y * sin), y: r(o.y - u.x * sin + u.y * cos) };
}
