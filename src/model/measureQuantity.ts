// Areas and volumes with their own units and decimals, cutouts, and a
// Volume's depth (M14-06, D-73, ADR-035; plan M14 §6, Q7, Q8, Q28). Pure.
//
// - An Area's or Volume's value is its net area: the outline less its holes
//   (the cutouts, Q8). A Volume is that area times its Depth (Q7).
// - Units (Q28): the length unit comes from the scale; an area and a volume
//   have their own unit and decimals. Absent ("Automatic"), they follow the
//   scale: millimetres, centimetres or metres give m² and m³, inches, feet or
//   ft-in give sq ft and cu ft. A value at paper size (no scale, or 1 : 1)
//   stays in mm² and mm³, so a few millimetres of paper never read 0.00 m².
// - A hole lies inside the outline and clear of the other holes, so the net
//   area is a plain difference.
// Points are any one space (page points or user space); areas are in its units².
import { inside, signedArea, type Pt } from './measureGeometry';
import { MM_PER_POINT, MM_PER_UNIT, polygonArea, type Scale, type Unit } from './scale';

export type AreaUnit = 'mm2' | 'cm2' | 'm2' | 'in2' | 'ft2' | 'yd2';
export type VolumeUnit = 'mm3' | 'cm3' | 'm3' | 'in3' | 'ft3' | 'yd3';

export const AREA_UNITS: readonly AreaUnit[] = ['mm2', 'cm2', 'm2', 'in2', 'ft2', 'yd2'];
export const VOLUME_UNITS: readonly VolumeUnit[] = ['mm3', 'cm3', 'm3', 'in3', 'ft3', 'yd3'];

/** Square millimetres in one unit. */
export const MM2_PER: Record<AreaUnit, number> = {
  mm2: 1,
  cm2: 100,
  m2: 1e6,
  in2: 25.4 ** 2,
  ft2: 304.8 ** 2,
  yd2: 914.4 ** 2,
};

/** Cubic millimetres in one unit. */
export const MM3_PER: Record<VolumeUnit, number> = {
  mm3: 1,
  cm3: 1e3,
  m3: 1e9,
  in3: 25.4 ** 3,
  ft3: 304.8 ** 3,
  yd3: 914.4 ** 3,
};

/** The unit as written after the number, on the sheet and in the pane. */
export const AREA_SYMBOL: Record<AreaUnit, string> = {
  mm2: 'mm²',
  cm2: 'cm²',
  m2: 'm²',
  in2: 'sq in',
  ft2: 'sq ft',
  yd2: 'sq yd',
};
export const VOLUME_SYMBOL: Record<VolumeUnit, string> = {
  mm3: 'mm³',
  cm3: 'cm³',
  m3: 'm³',
  in3: 'cu in',
  ft3: 'cu ft',
  yd3: 'cu yd',
};

/** The area's label in a /Measure /A number format (the file's own words, never shown by us). */
export const AREA_LABEL: Record<AreaUnit, string> = {
  mm2: 'sq mm',
  cm2: 'sq cm',
  m2: 'sq m',
  in2: 'sq in',
  ft2: 'sq ft',
  yd2: 'sq yd',
};

export const isAreaUnit = (u: unknown): u is AreaUnit =>
  typeof u === 'string' && (AREA_UNITS as readonly string[]).includes(u);
export const isVolumeUnit = (u: unknown): u is VolumeUnit =>
  typeof u === 'string' && (VOLUME_UNITS as readonly string[]).includes(u);

/** Decimals of an area or volume when none were chosen (Q28, Q40: "42.50 m²", "12.75 m³"). */
export const QUANTITY_DECIMALS = 2;
/** Decimals offered: 0 … 4. */
export const MAX_DECIMALS = 4;

export const isDecimals = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_DECIMALS;

/** A Volume's depth: a real length in a length unit (Q7). */
export interface Depth {
  value: number;
  unit: Unit;
}

export const DEPTH_UNITS: readonly Unit[] = ['mm', 'cm', 'm', 'in', 'ft'];

export const isDepth = (d: unknown): d is Depth => {
  const o = d as Partial<Depth> | null;
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof o.value === 'number' &&
    Number.isFinite(o.value) &&
    o.value > 0 &&
    typeof o.unit === 'string' &&
    o.unit in MM_PER_UNIT
  );
};

/** The depth in millimetres. */
export const depthMm = (d: Depth): number => d.value * MM_PER_UNIT[d.unit];

/** A scale of 1 : 1, or none: values at paper size. */
const atPaper = (s: Scale | null): boolean => !s || Math.abs(s.real / s.paper - 1) < 1e-9;
const imperial = (s: Scale): boolean => s.unit === 'in' || s.unit === 'ft';

/** The area unit when none was chosen: from the scale's length unit (Q28). */
export function autoAreaUnit(s: Scale | null): AreaUnit {
  if (atPaper(s)) return 'mm2';
  return s && imperial(s) ? 'ft2' : 'm2';
}

/** The volume unit when none was chosen: from the scale's length unit (Q28). */
export function autoVolumeUnit(s: Scale | null): VolumeUnit {
  if (atPaper(s)) return 'mm3';
  return s && imperial(s) ? 'ft3' : 'm3';
}

/** The area of the outline less its holes, in the points' units². */
export function netArea(outer: readonly Pt[], holes: readonly (readonly Pt[])[] = []): number {
  const gross = polygonArea([...outer]);
  const cut = holes.reduce((s, h) => s + polygonArea([...h]), 0);
  return Math.max(0, gross - cut);
}

/** Real square millimetres per square point of the page at `s` (paper size without one). */
export function mm2PerPoint2(s: Scale | null): number {
  const k = MM_PER_POINT * (s ? s.real / s.paper : 1);
  return k * k;
}

/** The net area in real square millimetres (paper mm² without a scale); points are page points. */
export const areaMm2 = (
  outer: readonly Pt[],
  holes: readonly (readonly Pt[])[] | undefined,
  s: Scale | null,
): number => netArea(outer, holes ?? []) * mm2PerPoint2(s);

/** A Volume's value in cubic millimetres: its net area times its depth. */
export const volumeMm3 = (areaMm2Value: number, depth: Depth): number =>
  areaMm2Value * depthMm(depth);

// ---- cutouts (Q8) -------------------------------------------------------------------

/** The orientation of c about the line a → b: >0 left, <0 right, 0 on it. */
const orient = (a: Pt, b: Pt, c: Pt): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Whether segments a–b and c–d meet (touching counts). */
export function segmentsMeet(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const eps = 1e-9;
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  )
    return true;
  const on = (p: Pt, q: Pt, r: Pt): boolean =>
    Math.min(p.x, q.x) - eps <= r.x &&
    r.x <= Math.max(p.x, q.x) + eps &&
    Math.min(p.y, q.y) - eps <= r.y &&
    r.y <= Math.max(p.y, q.y) + eps;
  return (
    (Math.abs(d1) <= eps && on(c, d, a)) ||
    (Math.abs(d2) <= eps && on(c, d, b)) ||
    (Math.abs(d3) <= eps && on(a, b, c)) ||
    (Math.abs(d4) <= eps && on(a, b, d))
  );
}

const edges = (pts: readonly Pt[]): [Pt, Pt][] =>
  pts.flatMap((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return q ? [[p, q] as [Pt, Pt]] : [];
  });

/** Whether two closed outlines' edges meet anywhere. */
function outlinesMeet(a: readonly Pt[], b: readonly Pt[]): boolean {
  const eb = edges(b);
  return edges(a).some(([p, q]) => eb.some(([r, s]) => segmentsMeet(p, q, r, s)));
}

/** Why a hole can't be cut: too few points or no area, outside the outline, over another hole. */
export type HoleProblem = 'tooSmall' | 'outside' | 'overlap';

/** The smallest hole worth keeping (square points): less is a slip of the pointer. */
const MIN_HOLE = 1;

/**
 * Whether `hole` can be cut from the area (Q8): three points or more with an
 * area, every point inside the outline and no edge meeting it, and clear of
 * the other holes (neither inside the other nor crossing it). `skip`: the
 * index of the hole being edited (it is not checked against itself).
 */
export function holeProblem(
  outer: readonly Pt[],
  holes: readonly (readonly Pt[])[],
  hole: readonly Pt[],
  skip = -1,
): HoleProblem | null {
  if (hole.length < 3 || Math.abs(signedArea(hole)) < MIN_HOLE) return 'tooSmall';
  if (!hole.every((p) => inside(p, outer)) || outlinesMeet(hole, outer)) return 'outside';
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    if (!h || i === skip) continue;
    if (outlinesMeet(hole, h) || hole.some((p) => inside(p, h)) || h.some((p) => inside(p, hole)))
      return 'overlap';
  }
  return null;
}

/** The holes that still fit an outline after its points moved (the others are dropped). */
export function holesThatFit(outer: readonly Pt[], holes: readonly (readonly Pt[])[]): Pt[][] {
  const kept: Pt[][] = [];
  for (const h of holes) if (!holeProblem(outer, kept, h)) kept.push(h.map((p) => ({ ...p })));
  return kept;
}

/**
 * The affine map that takes three points of `from` to the same points of `to`
 * (the first three not in a line), or null: how an area's holes follow its
 * outline when it is moved, resized or turned.
 */
export function affineFrom(from: readonly Pt[], to: readonly Pt[]): ((p: Pt) => Pt) | null {
  if (from.length !== to.length || from.length < 3) return null;
  const a = from[0];
  const a2 = to[0];
  if (!a || !a2) return null;
  for (let i = 1; i < from.length; i++)
    for (let j = i + 1; j < from.length; j++) {
      const b = from[i];
      const c = from[j];
      const b2 = to[i];
      const c2 = to[j];
      if (!b || !c || !b2 || !c2) continue;
      const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (Math.abs(det) < 1e-6) continue;
      // Solve [u v] for the new frame: p = a + s (b − a) + t (c − a).
      return (p: Pt): Pt => {
        const s = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
        const t = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
        return {
          x: a2.x + s * (b2.x - a2.x) + t * (c2.x - a2.x),
          y: a2.y + s * (b2.y - a2.y) + t * (c2.y - a2.y),
        };
      };
    }
  return null;
}

// ---- values -------------------------------------------------------------------------

/** A Volume's depth when none was set yet (Q7: the Properties pane sets it before drawing). */
export const DEFAULT_DEPTH: Depth = { value: 1, unit: 'm' };

/** What an Area's or Volume's value needs besides its outline (its `measure` field). */
export interface QuantityMeta {
  tool?: string;
  /** The cutouts, in the outline's space. */
  holes?: readonly (readonly Pt[])[] | undefined;
  depth?: Depth | undefined;
  /** Absent: Automatic (from the scale). */
  areaUnit?: AreaUnit | undefined;
  areaDecimals?: number | undefined;
  volumeUnit?: VolumeUnit | undefined;
  volumeDecimals?: number | undefined;
}

export interface AreaValue {
  /** In `unit`. */
  value: number;
  /** In mm². */
  base: number;
  unit: AreaUnit;
  decimals: number;
}

export interface VolumeValue {
  value: number;
  /** In mm³. */
  base: number;
  unit: VolumeUnit;
  decimals: number;
}

/** The net area in its own unit (page points in, scale `s`; paper size without one). */
export function areaValue(outer: readonly Pt[], q: QuantityMeta, s: Scale | null): AreaValue {
  const base = areaMm2(outer, q.holes, s);
  const unit = q.areaUnit ?? autoAreaUnit(s);
  return {
    value: base / MM2_PER[unit],
    base,
    unit,
    decimals: isDecimals(q.areaDecimals) ? q.areaDecimals : QUANTITY_DECIMALS,
  };
}

/** A Volume's value: its net area times its depth, in its own unit. */
export function volumeValue(outer: readonly Pt[], q: QuantityMeta, s: Scale | null): VolumeValue {
  const base = volumeMm3(areaMm2(outer, q.holes, s), q.depth ?? DEFAULT_DEPTH);
  const unit = q.volumeUnit ?? autoVolumeUnit(s);
  return {
    value: base / MM3_PER[unit],
    base,
    unit,
    decimals: isDecimals(q.volumeDecimals) ? q.volumeDecimals : QUANTITY_DECIMALS,
  };
}

interface Fixed {
  fixed(value: number, digits: number): string;
}

/** "42.50 m²", "250.00 sq ft". */
export const areaText = (v: Pick<AreaValue, 'value' | 'unit' | 'decimals'>, f: Fixed): string =>
  `${f.fixed(v.value, v.decimals)} ${AREA_SYMBOL[v.unit]}`;

/** "12.75 m³", "3.00 cu yd". */
export const volumeText = (v: Pick<VolumeValue, 'value' | 'unit' | 'decimals'>, f: Fixed): string =>
  `${f.fixed(v.value, v.decimals)} ${VOLUME_SYMBOL[v.unit]}`;

/** "250 mm", "1.5 m" (no trailing zeros: the depth as typed). */
export const depthText = (d: Depth, f: { number(v: number, max?: number): string }): string =>
  `${f.number(d.value, 4)} ${d.unit}`;
