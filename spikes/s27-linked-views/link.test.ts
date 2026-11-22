import { describe, expect, it } from 'vitest';
import {
  apply,
  compose,
  followerView,
  IDENTITY,
  invert,
  scaleOf,
  similarity,
  toPageCoords,
} from './link.ts';

const close = (a: number, b: number): void => {
  expect(Math.abs(a - b)).toBeLessThan(1e-9);
};

describe('S27 link transform', () => {
  it('inverts and composes', () => {
    const m = similarity(0.96, 0.6, 40, -25);
    const id = compose(invert(m), m);
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) close(id[k], IDENTITY[k]);
    close(scaleOf(m), 0.96);
  });

  it('maps top-left page points like the user-space transform maps user points', () => {
    const hA = 2383.94; // A0 landscape height in points
    const user = similarity(0.96, 0.6, 40, -25);
    const page = toPageCoords(user, hA, hA);
    const p = { x: 812.5, y: 401.25 }; // top-left
    const u = apply(user, { x: p.x, y: hA - p.y });
    const q = apply(page, p);
    close(q.x, u.x);
    close(q.y, hA - u.y);
  });

  it('corpus pair 15: an A1 point lands on the A3 copy and the zoom halves', () => {
    const mm = 72 / 25.4;
    const a1 = { w: 841 * mm, h: 594 * mm };
    const a3 = { w: 420 * mm, h: 297 * mm };
    const k = Math.min(a3.w / a1.w, a3.h / a1.h);
    const tx = (a3.w - a1.w * k) / 2;
    const ty = (a3.h - a1.h * k) / 2;
    const t = toPageCoords(similarity(k, 0, tx, ty), a1.h, a3.h);
    // The A1 page centre is the A3 page centre (fitted and centred).
    const v = followerView(t, { x: a1.w / 2, y: a1.h / 2 }, 1);
    close(v.centre.x, a3.w / 2);
    close(v.centre.y, a3.h / 2);
    close(v.scale, 1 / k);
  });
});
