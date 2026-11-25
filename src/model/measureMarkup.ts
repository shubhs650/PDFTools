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
import type { Kind } from './scale';

export type MeasureTool = 'length' | 'polylength' | 'perimeter' | 'area';

export const MEASURE_TOOL_IDS: readonly MeasureTool[] = [
  'length',
  'polylength',
  'perimeter',
  'area',
];

/** How each tool's value is computed (model/scale.ts): a Perimeter repeats its first vertex. */
export const VALUE_KIND: Record<MeasureTool, Kind> = {
  length: 'distance',
  polylength: 'perimeter',
  perimeter: 'perimeter',
  area: 'area',
};

/** The tool's name in the file (the Triya data's /T; never shown, never translated). */
export const TOOL_TOKEN: Record<MeasureTool, string> = {
  length: 'Length',
  polylength: 'Polylength',
  perimeter: 'Perimeter',
  area: 'Area',
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

/** The well-formed `measure` field of an annotation object, or null. */
export function metaOf(a: unknown): MeasureMeta | null {
  const m = (a as { measure?: unknown } | null)?.measure;
  if (typeof m !== 'object' || m === null) return null;
  const r = m as Record<string, unknown>;
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
  return out;
}

/** Two metas say the same. */
export function sameMeta(a: MeasureMeta | null, b: MeasureMeta | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.tool === b.tool &&
    (a.label ?? '') === (b.label ?? '') &&
    (a.cap ?? 'top') === (b.cap ?? 'top') &&
    (a.capOffset?.x ?? 0) === (b.capOffset?.x ?? 0) &&
    (a.capOffset?.y ?? 0) === (b.capOffset?.y ?? 0) &&
    (a.fill ?? '') === (b.fill ?? '')
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
 * segment, an Area's in the middle of the shape; then its dragged offset.
 * `pts`: a line's two points or the vertices (a Perimeter's last repeats its
 * first), in user space (y up).
 */
export function captionPlace(
  meta: Pick<MeasureMeta, 'tool' | 'cap' | 'capOffset'>,
  pts: readonly Pt[],
  leader: Leader | null | undefined,
  width: number,
  height: number,
): CaptionBox {
  const zero = { x: 0, y: 0 };
  let box: CaptionBox;
  if (meta.tool === 'length') {
    const a = pts[0] ?? zero;
    const g = dimensionGeometry(a, pts[1] ?? a, leader, false);
    box = lineCaption(g.start, g.end, meta.cap ?? 'top', width, height);
  } else if (meta.tool === 'area') {
    box = { at: areaLabelPoint(pts, width, height), angle: 0, width, height };
  } else {
    const [a, b] = longestSegment(pts, false);
    box = lineCaption(a, b, 'top', width, height);
  }
  return offsetBox(box, meta.capOffset);
}

/** EmbedPDF's page points (y down) ↔ the mirror the caption geometry works in (y up). */
export const mirror = (p: Pt): Pt => ({ x: p.x, y: -p.y });

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
  const box = captionPlace(meta, ptsEP.map(mirror), leader, width, height);
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
  const box = captionPlace(meta, ptsEP.map(mirror), leader, 0, 0);
  const u = mirror(d);
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const o = meta.capOffset ?? { x: 0, y: 0 };
  const r = (n: number): number => Math.round(n * 100) / 100;
  return { x: r(o.x + u.x * cos + u.y * sin), y: r(o.y - u.x * sin + u.y * cos) };
}
