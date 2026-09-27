// Geometry for our custom icons (ADR-010 decision 3, rule 15): Fluent's
// Regular line style is 1-unit strokes on a 20-unit grid, drawn as filled
// outlines. Every shape here is emitted with the same (clockwise) winding, so
// overlapping pieces union under the nonzero fill rule; holes use the opposite
// winding. Coordinates are given on the 20 grid and scaled by `k` (1.6 for the
// 32 px glyphs), so no path is rescaled after the fact.

export type Pt = readonly [number, number];

const f = (n: number): string => String(Math.round(n * 100) / 100);

/** Signed area (screen coordinates, y down: > 0 is clockwise). */
function area(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i] ?? [0, 0];
    const [x2, y2] = pts[(i + 1) % pts.length] ?? [0, 0];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** A closed polygon, clockwise (or counter-clockwise for a hole). */
export function poly(pts: readonly Pt[], k: number, hole = false): string {
  const cw = area(pts) > 0;
  const ordered = cw !== hole ? pts : [...pts].reverse();
  return (
    ordered.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f(x * k)} ${f(y * k)}`).join(' ') + 'Z'
  );
}

/** A straight stroke of width `w` from a to b, with square caps. */
export function bar(a: Pt, b: Pt, k: number, w = 1): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const h = w / 2;
  const [nx, ny] = [-uy * h, ux * h];
  const [ex, ey] = [ux * h, uy * h];
  return poly(
    [
      [a[0] - ex + nx, a[1] - ey + ny],
      [b[0] + ex + nx, b[1] + ey + ny],
      [b[0] + ex - nx, b[1] + ey - ny],
      [a[0] - ex - nx, a[1] - ey - ny],
    ],
    k,
  );
}

/** A polyline (or closed polygon) of strokes; joints are covered by the square caps. */
export function strokes(pts: readonly Pt[], k: number, closed = false, w = 1): string {
  const out: string[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a && b) out.push(bar(a, b, k, w));
  }
  return out.join(' ');
}

/** Rectangle outline, 1 unit, as an outer shape and an inner hole. */
export function frame(x: number, y: number, w: number, h: number, k: number): string {
  return (
    poly(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      k,
    ) +
    ' ' +
    poly(
      [
        [x + 1, y + 1],
        [x + w - 1, y + 1],
        [x + w - 1, y + h - 1],
        [x + 1, y + h - 1],
      ],
      k,
      true,
    )
  );
}

export function box(x: number, y: number, w: number, h: number, k: number): string {
  return poly(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    k,
  );
}

/** Points on a circle (or ellipse), clockwise from 3 o'clock. */
export function circlePts(cx: number, cy: number, rx: number, ry = rx, n = 32): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as const;
  });
}

export function disc(cx: number, cy: number, r: number, k: number): string {
  return poly(circlePts(cx, cy, r), k);
}

export function ring(cx: number, cy: number, r: number, k: number, w = 1): string {
  return poly(circlePts(cx, cy, r), k) + ' ' + poly(circlePts(cx, cy, r - w), k, true);
}

/** A dashed straight line: dashes of `on`, gaps of `off`. */
export function dashed(a: Pt, b: Pt, k: number, on = 2, off = 1.5): string {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out: string[] = [];
  for (let s = 0; s < len; s += on + off) {
    const e = Math.min(len, s + on);
    const p = (t: number): Pt => [
      a[0] + ((b[0] - a[0]) * t) / len,
      a[1] + ((b[1] - a[1]) * t) / len,
    ];
    // bar() adds half a unit of cap on both ends; trim so dashes keep their length.
    if (e - s > 1) out.push(bar(p(s + 0.5), p(e - 0.5), k));
  }
  return out.join(' ');
}
