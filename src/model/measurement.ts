// Measurement annotations (M3-16, §7.4, ADR-007, M3-Q2): which annotations
// are measurements (/IT LineDimension, PolyLineDimension, PolygonDimension on a
// line, polyline or polygon), their geometry and value, the keys the object
// layer adds (/IT, /Measure, /Cap, /CP) and where the grouped FreeText label
// goes. Pure; coordinates are EmbedPDF's (page points, top-left origin) unless
// a function says otherwise — lengths and areas don't depend on the origin.
import type { PdfJson } from './pdf/wire';
import {
  formatLength,
  measure,
  measureToPdf,
  type Kind,
  type LengthFormat,
  type Pt,
  type Scale,
} from './scale';

export type { Kind as MeasureKind };

/** /IT per kind (ISO 32000-1 §12.5.6.7, 12.5.6.9). */
export const MEASURE_INTENT: Record<Kind, string> = {
  distance: 'LineDimension',
  perimeter: 'PolyLineDimension',
  area: 'PolygonDimension',
};

/**
 * M3-Q2 / ADR-007 decision 2: a grouped FreeText label carries the value for
 * other viewers (PDFium's line/polygon appearance draws geometry only). The one
 * switch: false leaves the value to /Contents and /Cap.
 */
export const LABEL: { freeText: boolean } = { freeText: true };

/** Font size of the label (points). */
export const LABEL_FONT_SIZE = 10;

/** The subset of an EmbedPDF annotation object this module reads. */
export interface MeasureShape {
  /** EmbedPDF's PdfAnnotationSubtype: LINE 4, POLYGON 7, POLYLINE 8. */
  type: number;
  intent?: string;
  linePoints?: { start: Pt; end: Pt };
  vertices?: Pt[];
}

const LINE = 4;
const POLYGON = 7;
const POLYLINE = 8;

/** The measurement kind of an annotation, or null when it isn't one. */
export function measureKind(a: MeasureShape): Kind | null {
  const it = a.intent?.replace(/^\//u, '');
  if (a.type === LINE && it === MEASURE_INTENT.distance) return 'distance';
  if (a.type === POLYLINE && it === MEASURE_INTENT.perimeter) return 'perimeter';
  if (a.type === POLYGON && it === MEASURE_INTENT.area) return 'area';
  return null;
}

/** The measured points: a line's two ends, a polyline's or polygon's vertices. */
export function measurePoints(a: MeasureShape): Pt[] {
  if (a.linePoints) return [a.linePoints.start, a.linePoints.end];
  return a.vertices ? [...a.vertices] : [];
}

/**
 * The value in the scale's unit (area: unit²); without a scale, in paper
 * millimetres (mm²) — shown as uncalibrated. A perimeter is the polyline as
 * drawn (open, as in Acrobat): clicking the first vertex again closes it.
 */
export function measuredValue(kind: Kind, pts: readonly Pt[], scale: Scale | null): number {
  return measure(kind === 'perimeter' ? 'distance' : kind, [...pts], scale ?? PAPER);
}

/** 1:1 in millimetres: the paper length, for measurements without a scale. */
export const PAPER: Scale = { paper: 1, real: 1, unit: 'mm', precision: 1 };

export interface ValueText {
  /** "20.00 m", "80,000.0 mm²"; uncalibrated: the paper length. */
  value: string;
  calibrated: boolean;
}

/** The formatted value (the caller adds "uncalibrated" in the UI's words). */
export function valueText(
  kind: Kind,
  pts: readonly Pt[],
  scale: Scale | null,
  f: LengthFormat,
): ValueText {
  const s = scale ?? PAPER;
  return { value: formatLength(measuredValue(kind, pts, scale), s, f, kind), calibrated: !!scale };
}

/**
 * What the object layer stages on the annotation: /IT always; /Measure RL when
 * there is a scale (removed when there isn't); /Cap and /CP /Top on lines, so
 * viewers that draw captions show /Contents on the line.
 */
export function measureKeys(
  kind: Kind,
  scale: Scale | null,
): { set: Record<string, PdfJson>; remove: string[] } {
  const set: Record<string, PdfJson> = { IT: { name: MEASURE_INTENT[kind] } };
  if (scale) set['Measure'] = measureToPdf(scale);
  if (kind === 'distance') {
    set['Cap'] = true;
    set['CP'] = { name: 'Top' };
  }
  return { set, remove: scale ? [] : ['Measure'] };
}

export interface Rect {
  origin: Pt;
  size: { width: number; height: number };
}

/** A label's box for `text`: a rough Helvetica width, never narrower than 24 pt. */
export function labelSize(text: string, fontSize = LABEL_FONT_SIZE): Rect['size'] {
  return {
    width: Math.max(24, Math.ceil(text.length * fontSize * 0.56 + fontSize)),
    height: Math.ceil(fontSize * 1.8),
  };
}

/** Where a label sits: above a line's midpoint, at a polygon's centre, by a polyline's last vertex. */
export function labelAnchor(kind: Kind, pts: readonly Pt[]): Pt {
  const first = pts[0] ?? { x: 0, y: 0 };
  if (kind === 'distance') {
    const b = pts[1] ?? first;
    return { x: (first.x + b.x) / 2, y: (first.y + b.y) / 2 };
  }
  if (kind === 'area') {
    const n = pts.length || 1;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return pts[pts.length - 1] ?? first;
}

/**
 * The label's rectangle (top-left origin), kept on the page: centred on the
 * anchor for areas, just above it otherwise.
 */
export function labelRect(
  kind: Kind,
  pts: readonly Pt[],
  text: string,
  page: { width: number; height: number },
  fontSize = LABEL_FONT_SIZE,
): Rect {
  const size = labelSize(text, fontSize);
  const a = labelAnchor(kind, pts);
  const x = a.x - size.width / 2;
  const y = kind === 'area' ? a.y - size.height / 2 : a.y - size.height - 2;
  const clamp = (v: number, max: number): number => Math.min(Math.max(0, v), Math.max(0, max));
  return {
    origin: { x: clamp(x, page.width - size.width), y: clamp(y, page.height - size.height) },
    size,
  };
}

/** EmbedPDF points (top-left origin in the page box) → PDF user space. */
export function toUserSpace(
  pts: readonly Pt[],
  frame: { height: number; originX: number; originY: number },
): Pt[] {
  return pts.map((p) => ({ x: frame.originX + p.x, y: frame.originY + frame.height - p.y }));
}
