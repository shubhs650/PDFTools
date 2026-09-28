// Measurement logic (ARCHITECTURE §7.4, D-14; ported from the M0-S2 spike,
// ADR-007): scales, viewports, distance / perimeter / area, the ISO 32000
// /Measure (RL) number formats and page /VP viewports, and — since M3-15 —
// ft-in parsing and locale formatting. Coordinates are PDF default user space
// (points, origin bottom-left). Pure.
import type { PdfJson } from './pdf/wire';

export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export const MM_PER_UNIT: Record<Unit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
export const MM_PER_POINT = 25.4 / 72;

export interface Scale {
  /** Paper length : real length, e.g. 1:100 → paper 1, real 100 (same unit). */
  paper: number;
  real: number;
  /** Unit results are shown in. */
  unit: Unit;
  /** Decimal places. */
  precision: number;
  /** Feet shown as ft-in, to 1/`ftIn` inch (2 … 64); `unit` is then 'ft'. */
  ftIn?: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface ScaleViewport {
  name: string;
  /** [x1, y1, x2, y2] in user space (normalised on use). */
  bbox: [number, number, number, number];
  scale: Scale;
}

/** Real-world `unit` per PDF point for a scale. */
export function unitsPerPoint(s: Scale): number {
  return (MM_PER_POINT * (s.real / s.paper)) / MM_PER_UNIT[s.unit];
}

/** Calibration: two points on the page and the real length they represent. */
export function calibrate(a: Pt, b: Pt, realLength: number, unit: Unit, precision = 2): Scale {
  const paperMm = Math.hypot(b.x - a.x, b.y - a.y) * MM_PER_POINT;
  if (paperMm === 0) throw new Error('calibration points coincide');
  return { paper: 1, real: (realLength * MM_PER_UNIT[unit]) / paperMm, unit, precision };
}

export function polylineLength(pts: Pt[], closed = false): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b) d += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (closed && first && last && pts.length > 2)
    d += Math.hypot(first.x - last.x, first.y - last.y);
  return d;
}

/** Shoelace area in square points (always positive). */
export function polygonArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a && b) s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export type Kind = 'distance' | 'perimeter' | 'area';

export function measure(kind: Kind, pts: Pt[], s: Scale): number {
  const k = unitsPerPoint(s);
  if (kind === 'area') return polygonArea(pts) * k * k;
  return polylineLength(pts, kind === 'perimeter') * k;
}

export function format(value: number, s: Scale, kind: Kind): string {
  const unit = kind === 'area' ? `${s.unit}²` : s.unit;
  return `${value.toFixed(s.precision)} ${unit}`;
}

/** ft-in display (§7.4 "ft-in"), rounded to 1/`denominator` inch. */
export function formatFtIn(feet: number, denominator = 16): string {
  const sign = feet < 0 ? '-' : '';
  let totalIn = Math.round(Math.abs(feet) * 12 * denominator) / denominator;
  const ft = Math.floor(totalIn / 12);
  totalIn -= ft * 12;
  const whole = Math.floor(totalIn);
  const frac = Math.round((totalIn - whole) * denominator);
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = frac ? g(frac, denominator) : 1;
  return `${sign}${String(ft)}'-${String(whole)}${frac ? ` ${String(frac / d)}/${String(denominator / d)}` : ''}"`;
}

const inside = (p: Pt, [x1, y1, x2, y2]: [number, number, number, number]): boolean =>
  p.x >= Math.min(x1, x2) &&
  p.x <= Math.max(x1, x2) &&
  p.y >= Math.min(y1, y2) &&
  p.y <= Math.max(y1, y2);

export type ScaleChoice =
  | { kind: 'viewport'; viewport: ScaleViewport }
  | { kind: 'page'; scale: Scale }
  | { kind: 'spanning'; viewports: string[]; fallback: Scale | null }
  | { kind: 'uncalibrated' };

/**
 * §7.4: the viewport containing the measurement; outside all → page default;
 * crossing a viewport boundary → spanning (flag a warning); nothing → uncalibrated.
 * Later viewports in the list are on top (checked first), like PDF /VP order.
 */
export function chooseScale(
  pts: Pt[],
  viewports: ScaleViewport[],
  pageDefault: Scale | null,
): ScaleChoice {
  const vpOf = (p: Pt): ScaleViewport | undefined =>
    [...viewports].reverse().find((v) => inside(p, v.bbox));
  const hits = pts.map(vpOf);
  const names = [...new Set(hits.map((v) => v?.name ?? '(page)'))];
  if (names.length > 1) return { kind: 'spanning', viewports: names, fallback: pageDefault };
  const v = hits[0];
  if (v) return { kind: 'viewport', viewport: v };
  if (pageDefault) return { kind: 'page', scale: pageDefault };
  return { kind: 'uncalibrated' };
}

// ---- ISO 32000-1 §12.9 rectilinear measure dictionary -------------------------

export interface NumberFormat {
  U: string;
  C: number;
  D: number;
}

export interface MeasureRL {
  R: string;
  X: NumberFormat[];
  D: NumberFormat[];
  A: NumberFormat[];
}

/**
 * The /Measure <</Subtype /RL>> content for a scale, in the shape Acrobat
 * writes: X converts user-space units to real units; D and A then apply
 * factor 1 (distance) and 1 (area, in X units squared).
 */
export function toMeasureRL(s: Scale): MeasureRL {
  const d = 10 ** s.precision;
  const fmt = (n: number): string =>
    Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(6)));
  return {
    R: `${fmt(s.paper)} ${s.unit} = ${fmt(s.real)} ${s.unit}`,
    X: [{ U: s.unit, C: unitsPerPoint(s), D: d }],
    D: [{ U: s.unit, C: 1, D: d }],
    A: [{ U: `sq ${s.unit}`, C: 1, D: d }],
  };
}

const UNIT_ALIASES: Record<string, Unit> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  in: 'in',
  '"': 'in',
  ft: 'ft',
  "'": 'ft',
};

/** Recover our Scale from a /Measure RL (ours or a viewer's). Unknown unit → null. */
export function fromMeasureRL(m: { X?: { U?: string; C?: number; D?: number }[] }): Scale | null {
  const x = m.X?.[0];
  if (!x?.U || !x.C) return null;
  const unit = UNIT_ALIASES[x.U.trim().toLowerCase()];
  if (!unit) return null;
  const ratio = (x.C * MM_PER_UNIT[unit]) / MM_PER_POINT;
  const precision = x.D && x.D > 1 ? Math.round(Math.log10(x.D)) : 0;
  return { paper: 1, real: Number(ratio.toPrecision(10)), unit, precision };
}

// ---- M3-15: parsing, locale formatting, page viewports -------------------------

/** Denominators offered for ft-in (1/2" … 1/64"). */
export const FT_IN_STEPS = [2, 4, 8, 16, 32, 64] as const;

/**
 * Feet from ft-in text: `12'-6 1/2"`, `12' 6"`, `12'`, `6"`, `6 1/2"`,
 * `12.5'`, `1/2"`. null when it isn't a length.
 */
export function parseFtIn(text: string): number | null {
  const s = text
    .trim()
    .replace(/\u2032/gu, "'")
    .replace(/\u2033/gu, '"');
  const m =
    /^(?:(\d+(?:\.\d+)?)\s*')?\s*-?\s*(?:(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?\s*")?$/u.exec(
      s,
    );
  if (!m || s === '' || (!m[1] && !m[2] && !m[3])) return null;
  const ft = m[1] ? Number(m[1]) : 0;
  const inch = (m[2] ? Number(m[2]) : 0) + (m[3] && m[4] ? Number(m[3]) / Number(m[4]) : 0);
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return ft + inch / 12;
}

export interface LengthFormat {
  number(value: number, maximumFractionDigits?: number): string;
}

/** A length in the scale's unit, in the user's locale (ft-in when the scale says so). */
export function formatLength(
  value: number,
  s: Scale,
  f: LengthFormat,
  kind: Kind = 'distance',
): string {
  if (kind !== 'area' && s.ftIn && s.unit === 'ft') return formatFtIn(value, s.ftIn);
  const unit = kind === 'area' ? `${s.unit}²` : s.unit;
  const rounded = Math.round(value * 10 ** s.precision) / 10 ** s.precision;
  return `${f.number(rounded, s.precision)} ${unit}`;
}

/** "1 : 100" (numbers in the user's locale). */
export function ratioLabel(s: Scale, f: LengthFormat): string {
  const k = s.real / s.paper;
  return `1 : ${f.number(k, k >= 100 ? 0 : 2)}`;
}

/** A page's default scale: a viewport over the whole page (ADR-007). */
export const PAGE_VIEWPORT_NAME = 'Page';

export interface PageViewport {
  name: string;
  bbox: [number, number, number, number];
  scale: Scale | null;
}

const num = (j: PdfJson | undefined): number | null => (typeof j === 'number' ? j : null);
const text = (j: PdfJson | undefined): string | null =>
  j && typeof j === 'object' && !Array.isArray(j)
    ? 'text' in j
      ? j.text
      : 'name' in j
        ? j.name
        : null
    : null;
const dict = (j: PdfJson | undefined): Record<string, PdfJson> | null =>
  j && typeof j === 'object' && !Array.isArray(j) && 'dict' in j ? j.dict : null;

/** One /VP entry as the object layer writes it. */
export function viewportToPdf(vp: {
  name: string;
  bbox: [number, number, number, number];
  scale: Scale;
}): PdfJson {
  const m = toMeasureRL(vp.scale);
  const nf = (f: NumberFormat): PdfJson => ({
    dict: { Type: { name: 'NumberFormat' }, U: { text: f.U }, C: f.C, D: f.D },
  });
  return {
    dict: {
      Type: { name: 'Viewport' },
      BBox: vp.bbox,
      Name: { text: vp.name },
      Measure: {
        dict: {
          Type: { name: 'Measure' },
          Subtype: { name: 'RL' },
          R: { text: m.R },
          X: m.X.map(nf),
          D: m.D.map(nf),
          A: m.A.map(nf),
        },
      },
    },
  };
}

/** A page's /VP array (ours or a viewer's) read back; entries it can't read are skipped. */
export function viewportsFromPdf(vp: PdfJson | undefined): PageViewport[] {
  if (!Array.isArray(vp)) return [];
  const out: PageViewport[] = [];
  for (const entry of vp) {
    const d = dict(entry);
    const bb = d?.['BBox'];
    if (!d || !Array.isArray(bb) || bb.length !== 4) continue;
    const box = bb.map(num);
    if (box.some((n) => n === null)) continue;
    const m = dict(d['Measure']);
    const x = Array.isArray(m?.['X']) ? m['X'].map((e) => dict(e)) : [];
    const xs = x
      .filter((e): e is Record<string, PdfJson> => e !== null)
      .map((e) => ({ U: text(e['U']) ?? '', C: num(e['C']) ?? 0, D: num(e['D']) ?? 1 }));
    out.push({
      name: text(d['Name']) ?? '',
      bbox: box as [number, number, number, number],
      scale: m && text(m['Subtype']) === 'RL' ? fromMeasureRL({ X: xs }) : null,
    });
  }
  return out;
}

/** The page's own default scale: the viewport covering the whole page, if any. */
export function pageScale(
  vps: readonly PageViewport[],
  mediaBox: [number, number, number, number],
): Scale | null {
  const [x1, y1, x2, y2] = mediaBox;
  const whole = vps.find(
    (v) =>
      v.scale &&
      Math.min(v.bbox[0], v.bbox[2]) <= x1 + 0.5 &&
      Math.min(v.bbox[1], v.bbox[3]) <= y1 + 0.5 &&
      Math.max(v.bbox[0], v.bbox[2]) >= x2 - 0.5 &&
      Math.max(v.bbox[1], v.bbox[3]) >= y2 - 0.5,
  );
  return whole?.scale ?? null;
}
