// Copy or save an image on the page (M11-08·O6): the hit test's geometry. Pure.
import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  imageFileName,
  mul,
  onImage,
  toUserSpace,
  type Matrix,
} from '../../src/model/pageImageHit';

describe('onImage', () => {
  // 160 × 80 points at (200, 600), as `q 160 0 0 80 200 600 cm /Im Do Q`.
  const flat: Matrix = [160, 0, 0, 80, 200, 600];

  it('is inside the image’s placed rectangle, edges included', () => {
    expect(onImage(flat, 280, 640)).toBe(true);
    expect(onImage(flat, 200, 600)).toBe(true);
    expect(onImage(flat, 360, 680)).toBe(true);
    expect(onImage(flat, 199, 640)).toBe(false);
    expect(onImage(flat, 280, 681)).toBe(false);
  });

  it('takes slack in points along each side', () => {
    expect(onImage(flat, 197, 640, 4)).toBe(true);
    expect(onImage(flat, 280, 683, 4)).toBe(true);
    expect(onImage(flat, 195, 640, 4)).toBe(false);
  });

  it('follows a turned image (90°: x along the page’s y)', () => {
    // The unit square turned a quarter: 40 wide along x, 80 tall along y, at (300, 300).
    const turned: Matrix = [0, 80, -40, 0, 300, 300];
    expect(onImage(turned, 280, 340)).toBe(true);
    expect(onImage(turned, 310, 340)).toBe(false);
    expect(onImage(turned, 280, 390)).toBe(false);
  });

  it('follows a 45° turn, so a point inside the bounds but outside the image misses', () => {
    const c = Math.SQRT1_2 * 100;
    const diamond: Matrix = [c, c, -c, c, 100, 100]; // corners (100,100) (170.7,170.7) (100,241.4) (29.3,170.7)
    expect(onImage(diamond, 100, 170)).toBe(true);
    expect(onImage(diamond, 40, 115)).toBe(false); // inside the bounding box, outside the image
  });

  it('never hits a flat (zero-area) image', () => {
    expect(onImage([0, 0, 0, 0, 10, 10], 10, 10)).toBe(false);
    expect(onImage([100, 0, 200, 0, 0, 0], 50, 0)).toBe(false);
  });
});

describe('mul', () => {
  it('places a form’s image: the image’s matrix then the form’s', () => {
    const image: Matrix = [120, 0, 0, 60, 0, 0];
    const form: Matrix = [1, 0, 0, 1, 100, 500];
    const m = mul(image, form);
    expect(m).toEqual([120, 0, 0, 60, 100, 500]);
    expect(onImage(m, 160, 530)).toBe(true);
    expect(onImage(m, 90, 530)).toBe(false);
  });

  it('keeps a matrix under the identity', () => {
    const m: Matrix = [2, 1, -1, 3, 4, 5];
    expect(mul(m, IDENTITY)).toEqual(m);
    expect(mul(IDENTITY, m)).toEqual(m);
  });

  it('scales and turns nested forms in order', () => {
    // A form scaled ×2, inside a form turned 90° and moved to (300, 0).
    const inner: Matrix = [2, 0, 0, 2, 0, 0];
    const outer: Matrix = [0, 1, -1, 0, 300, 0];
    const image: Matrix = [10, 0, 0, 10, 0, 0];
    const m = mul(mul(image, inner), outer);
    // (1, 1) in the image → (20, 20) in the inner form → (280, 20) on the page.
    expect(m[0] + m[2] + m[4]).toBeCloseTo(280);
    expect(m[1] + m[3] + m[5]).toBeCloseTo(20);
  });
});

describe('toUserSpace', () => {
  it('turns a top-left page point into PDF user space', () => {
    expect(toUserSpace({ x: 10, y: 20 }, { left: 0, top: 792 })).toEqual({ x: 10, y: 772 });
    // A crop box that starts at (36, 36) and ends at 756.
    expect(toUserSpace({ x: 10, y: 20 }, { left: 36, top: 756 })).toEqual({ x: 46, y: 736 });
  });
});

describe('imageFileName', () => {
  it('names the image after the document and the page', () => {
    expect(imageFileName('Site plan.pdf', 0)).toBe('Site plan-page-1-image.png');
    expect(imageFileName('scan.PDF', 11)).toBe('scan-page-12-image.png');
    expect(imageFileName('', 2)).toBe('document-page-3-image.png');
  });
});
