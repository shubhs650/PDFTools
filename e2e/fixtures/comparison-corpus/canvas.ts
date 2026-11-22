// Content-stream builder in millimetres (drawings) with a self-drawn stroke
// font for "text as curves" (no text objects, like CAD text exported as
// geometry). Points are converted to PDF units on output.

import { textWidth, winAnsi } from './fonts.ts';
import { MM, num, type FontKey } from './pdf.ts';

export type Pt = readonly [number, number];
export type Align = 'left' | 'center' | 'right';

export class Canvas {
  private readonly ops: string[] = [];
  /** Multiplies every line width: keeps plotted line weights absolute under a `cm` scale. */
  lineScale = 1;

  raw(s: string): this {
    this.ops.push(s);
    return this;
  }
  save(): this {
    return this.raw('q');
  }
  restore(): this {
    return this.raw('Q');
  }
  /** Line width in millimetres; 0 is the thinnest line the device can draw. */
  width(mm: number): this {
    return this.raw(`${num(mm * MM * this.lineScale)} w`);
  }
  stroke(gray: number): this {
    return this.raw(`${num(gray)} G`);
  }
  fillGray(gray: number): this {
    return this.raw(`${num(gray)} g`);
  }
  strokeRgb(r: number, g: number, b: number): this {
    return this.raw(`${num(r)} ${num(g)} ${num(b)} RG`);
  }
  fillRgb(r: number, g: number, b: number): this {
    return this.raw(`${num(r)} ${num(g)} ${num(b)} rg`);
  }
  dash(pattern: number[]): this {
    return this.raw(`[${pattern.map((d) => num(d * MM)).join(' ')}] 0 d`);
  }
  solid(): this {
    return this.raw('[] 0 d');
  }
  capRound(): this {
    return this.raw('1 J 1 j');
  }

  moveTo(x: number, y: number): this {
    return this.raw(`${num(x * MM)} ${num(y * MM)} m`);
  }
  lineTo(x: number, y: number): this {
    return this.raw(`${num(x * MM)} ${num(y * MM)} l`);
  }
  line(x1: number, y1: number, x2: number, y2: number): this {
    return this.moveTo(x1, y1).lineTo(x2, y2);
  }
  polyline(pts: readonly Pt[], close = false): this {
    pts.forEach(([x, y], i) => (i === 0 ? this.moveTo(x, y) : this.lineTo(x, y)));
    return close ? this.raw('h') : this;
  }
  rect(x: number, y: number, w: number, h: number): this {
    return this.raw(`${num(x * MM)} ${num(y * MM)} ${num(w * MM)} ${num(h * MM)} re`);
  }
  circle(cx: number, cy: number, r: number): this {
    const k = 0.5523 * r;
    const p = (x: number, y: number): string => `${num(x * MM)} ${num(y * MM)}`;
    return this.raw(
      `${p(cx + r, cy)} m ${p(cx + r, cy + k)} ${p(cx + k, cy + r)} ${p(cx, cy + r)} c ` +
        `${p(cx - k, cy + r)} ${p(cx - r, cy + k)} ${p(cx - r, cy)} c ` +
        `${p(cx - r, cy - k)} ${p(cx - k, cy - r)} ${p(cx, cy - r)} c ` +
        `${p(cx + k, cy - r)} ${p(cx + r, cy - k)} ${p(cx + r, cy)} c h`,
    );
  }
  /** Quarter-to-half arcs as one Bézier each: a swing of a door, angles in degrees. */
  arc(cx: number, cy: number, r: number, from: number, to: number): this {
    const steps = Math.max(1, Math.ceil(Math.abs(to - from) / 90));
    const d = ((to - from) / steps) * (Math.PI / 180);
    let a = from * (Math.PI / 180);
    const k = (4 / 3) * Math.tan(d / 4);
    const pt = (ang: number): Pt => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    const [sx, sy] = pt(a);
    this.moveTo(sx, sy);
    for (let i = 0; i < steps; i++) {
      const b = a + d;
      const [x0, y0] = pt(a);
      const [x3, y3] = pt(b);
      const c1: Pt = [x0 - k * r * Math.sin(a), y0 + k * r * Math.cos(a)];
      const c2: Pt = [x3 + k * r * Math.sin(b), y3 - k * r * Math.cos(b)];
      this.raw(
        `${num(c1[0] * MM)} ${num(c1[1] * MM)} ${num(c2[0] * MM)} ${num(c2[1] * MM)} ${num(x3 * MM)} ${num(y3 * MM)} c`,
      );
      a = b;
    }
    return this;
  }
  strokePath(): this {
    return this.raw('S');
  }
  fillPath(): this {
    return this.raw('f');
  }
  fillStrokePath(): this {
    return this.raw('B');
  }

  /** Real text; `h` is the cap height in millimetres. */
  text(
    font: FontKey,
    h: number,
    x: number,
    y: number,
    s: string,
    align: Align = 'left',
    angle = 0,
  ): this {
    const size = (h * MM) / 0.72;
    const w = textWidth(s, font, size) / MM;
    const shift = align === 'left' ? 0 : align === 'center' ? w / 2 : w;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const tx = x - shift * cos;
    const ty = y - shift * sin;
    return this.raw(
      `BT /${font} ${num(size)} Tf ${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(tx * MM)} ${num(ty * MM)} Tm ${winAnsi(s)} Tj ET`,
    );
  }

  /** Text as curves: stroke-font polylines, no text object. `h` is the cap height. */
  curveText(h: number, x: number, y: number, s: string, align: Align = 'left', angle = 0): this {
    const u = h / 6;
    const width = curveTextWidth(h, s);
    const shift = align === 'left' ? 0 : align === 'center' ? width / 2 : width;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let pen = -shift;
    for (const ch of s.toUpperCase()) {
      for (const stroke of GLYPHS[ch] ?? []) {
        this.polyline(
          stroke.map(([gx, gy]) => {
            const lx = pen + gx * u;
            const ly = gy * u;
            return [x + lx * cos - ly * sin, y + lx * sin + ly * cos] as Pt;
          }),
        );
      }
      pen += ADVANCE * u;
    }
    return this;
  }

  /** Parallel hatch lines across a rectangle, clipped by hand (as CAD exports them). */
  hatch(x: number, y: number, w: number, h: number, angle: number, spacing: number): this {
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // Normal to the hatch direction; lines are offsets along it.
    const nx = -dy;
    const ny = dx;
    const corners: Pt[] = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ];
    const offs = corners.map(([cx, cy]) => cx * nx + cy * ny);
    const lo = Math.min(...offs);
    const hi = Math.max(...offs);
    const start = Math.ceil(lo / spacing) * spacing;
    for (let o = start; o <= hi; o += spacing) {
      const seg = clipLine(o * nx, o * ny, dx, dy, x, y, x + w, y + h);
      if (seg) this.line(seg[0], seg[1], seg[2], seg[3]);
    }
    return this;
  }

  toString(): string {
    return this.ops.join('\n');
  }
}

/** Liang–Barsky: the part of the infinite line p + t·d inside the box. */
function clipLine(
  px: number,
  py: number,
  dx: number,
  dy: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const test = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    return t0 <= t1;
  };
  if (!test(-dx, px - x0) || !test(dx, x1 - px) || !test(-dy, py - y0) || !test(dy, y1 - py))
    return null;
  if (t1 - t0 < 1e-6) return null;
  return [px + t0 * dx, py + t0 * dy, px + t1 * dx, py + t1 * dy];
}

const ADVANCE = 5.5;

export function curveTextWidth(h: number, s: string): number {
  return s.length > 0 ? ((s.length * ADVANCE - 1.5) * h) / 6 : 0;
}

// The stroke font: our own single-line glyphs on a 4 × 6 grid (x, y), one
// polyline per ';'-separated stroke.
const GLYPH_SRC: Record<string, string> = {
  A: '0,0 2,6 4,0; 1,3 3,3',
  B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3; 3,3 4,2 4,1 3,0 0,0',
  C: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1',
  D: '0,0 0,6 3,6 4,5 4,1 3,0 0,0',
  E: '4,0 0,0 0,6 4,6; 0,3 3,3',
  F: '0,0 0,6 4,6; 0,3 3,3',
  G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3',
  H: '0,0 0,6; 4,0 4,6; 0,3 4,3',
  I: '1,0 3,0; 2,0 2,6; 1,6 3,6',
  J: '0,1 1,0 3,0 4,1 4,6',
  K: '0,0 0,6; 4,6 0,2; 1,3 4,0',
  L: '0,6 0,0 4,0',
  M: '0,0 0,6 2,3 4,6 4,0',
  N: '0,0 0,6 4,0 4,6',
  O: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0',
  P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3',
  Q: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0; 2,2 4,0',
  R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3; 2,3 4,0',
  S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1',
  T: '0,6 4,6; 2,6 2,0',
  U: '0,6 0,1 1,0 3,0 4,1 4,6',
  V: '0,6 2,0 4,6',
  W: '0,6 1,0 2,4 3,0 4,6',
  X: '0,0 4,6; 0,6 4,0',
  Y: '0,6 2,3 4,6; 2,3 2,0',
  Z: '0,6 4,6 0,0 4,0',
  '0': '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0; 0,1 4,5',
  '1': '1,5 2,6 2,0; 1,0 3,0',
  '2': '0,5 1,6 3,6 4,5 4,4 0,0 4,0',
  '3': '0,5 1,6 3,6 4,5 4,4 3,3 1,3; 3,3 4,2 4,1 3,0 1,0 0,1',
  '4': '3,0 3,6 0,2 4,2',
  '5': '4,6 0,6 0,3 3,3 4,2 4,1 3,0 0,0',
  '6': '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3',
  '7': '0,6 4,6 1,0',
  '8': '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
  '9': '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,4 1,3 4,3',
  '-': '1,3 3,3',
  '.': '2,0 2,0.5',
  ',': '2,0.5 1.5,-1',
  '/': '0,0 4,6',
  ':': '2,1 2,1.5; 2,4 2,4.5',
  '(': '3,6 2,5 2,1 3,0',
  ')': '1,6 2,5 2,1 1,0',
  '+': '2,1 2,5; 0,3 4,3',
  '=': '0,2 4,2; 0,4 4,4',
  Ø: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0; 0,-0.5 4,6.5',
  '°': '1,5 1,6 2,6 2,5 1,5',
  '"': '1,6 1,4.5; 3,6 3,4.5',
  ' ': '',
};

const GLYPHS: Record<string, Pt[][]> = Object.fromEntries(
  Object.entries(GLYPH_SRC).map(([ch, src]) => [
    ch,
    src
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((stroke) =>
        stroke.split(/\s+/).map((pair) => {
          const [a, b] = pair.split(',').map(Number);
          return [a ?? 0, b ?? 0] as Pt;
        }),
      ),
  ]),
);
