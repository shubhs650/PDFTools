import { describe, expect, it } from 'vitest';
import { parseLocaleNumber } from '../../src/i18n/format';
import { clampPage, movePage, parsePageInput } from '../../src/features/view/navigation';
import {
  ZOOM_STEPS,
  clampZoom,
  fitVisibleZoom,
  parseZoomInput,
  rotateBox,
  stepZoom,
  wheelZoom,
  zoomAtPoint,
} from '../../src/features/view/zoom';

describe('zoom steps (M1-15)', () => {
  it('span exactly 1 %–6400 % in increasing order', () => {
    expect(ZOOM_STEPS[0]).toBe(0.01);
    expect(ZOOM_STEPS.at(-1)).toBe(64);
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1] ?? 0);
    }
    expect(ZOOM_STEPS).toContain(1);
  });

  it('step to the next stop strictly above or below', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(1.1, 1)).toBe(1.25); // from between stops
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(1.2500001, 1)).toBe(1.5); // float noise is "on" the stop
  });

  it('clamp at both ends', () => {
    expect(stepZoom(64, 1)).toBe(64);
    expect(stepZoom(0.01, -1)).toBe(0.01);
    expect(clampZoom(100)).toBe(64);
    expect(clampZoom(0.001)).toBe(0.01);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('Ctrl+wheel zooms in on negative delta and stays within range', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(60, -10_000)).toBe(64);
    expect(wheelZoom(0.02, 10_000)).toBe(0.01);
  });
});

describe('zoom box input', () => {
  it('parses percent in the user locale', () => {
    expect(parseZoomInput('150', 'en')).toBe(1.5);
    expect(parseZoomInput('150%', 'en')).toBe(1.5);
    expect(parseZoomInput(' 150 % ', 'en')).toBe(1.5);
    expect(parseZoomInput('12.5', 'en')).toBe(0.125);
    expect(parseZoomInput('12,5 %', 'de')).toBe(0.125);
    expect(parseZoomInput('9000', 'en')).toBe(64); // clamped
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '-5', '0', '1.2.3', '%'])
      expect(parseZoomInput(bad, 'en')).toBeNull();
  });
});

describe('parseLocaleNumber', () => {
  it('handles grouping, decimals and native digits', () => {
    expect(parseLocaleNumber('1,234.5', 'en')).toBe(1234.5);
    expect(parseLocaleNumber('1.234,5', 'de')).toBe(1234.5);
    expect(parseLocaleNumber('١٢', 'ar-EG')).toBe(12);
    expect(parseLocaleNumber('x1', 'en')).toBeNull();
  });
});

describe('fit visible and rotation', () => {
  const page = { width: 600, height: 800 };
  const box = { left: 50, top: 100, right: 550, bottom: 700 }; // 500 × 600 content

  it('rotates a content box with the page', () => {
    expect(rotateBox(box, page, 0)).toEqual(box);
    expect(rotateBox(box, page, 90)).toEqual({ left: 100, top: 50, right: 700, bottom: 550 });
    expect(rotateBox(box, page, 180)).toEqual({ left: 50, top: 100, right: 550, bottom: 700 });
    expect(rotateBox(box, page, 270)).toEqual({ left: 100, top: 50, right: 700, bottom: 550 });
    const off = { left: 10, top: 20, right: 110, bottom: 220 };
    expect(rotateBox(off, page, 90)).toEqual({ left: 580, top: 10, right: 780, bottom: 110 });
    expect(rotateBox(off, page, 180)).toEqual({ left: 490, top: 580, right: 590, bottom: 780 });
    expect(rotateBox(off, page, 270)).toEqual({ left: 20, top: 490, right: 220, bottom: 590 });
    expect(rotateBox(off, page, -90)).toEqual(rotateBox(off, page, 270));
  });

  it('fits the content width, not the page width (rotated pages use the rotated box)', () => {
    expect(fitVisibleZoom(box, 1020, 10)).toBeCloseTo(2);
    expect(fitVisibleZoom(rotateBox(box, page, 90), 1220, 10)).toBeCloseTo(2);
  });

  it('mixed page sizes: each page fits by its own content', () => {
    const a0 = { left: 0, top: 0, right: 3370, bottom: 2384 };
    const letter = { left: 72, top: 72, right: 540, bottom: 720 };
    expect(fitVisibleZoom(a0, 1000, 0)).toBeCloseTo(1000 / 3370);
    expect(fitVisibleZoom(letter, 1000, 0)).toBeCloseTo(1000 / 468);
  });

  it('empty pages have no fit, and the result is clamped', () => {
    expect(fitVisibleZoom({ left: 5, top: 5, right: 5, bottom: 9 }, 1000, 0)).toBeNull();
    expect(fitVisibleZoom({ left: 0, top: 0, right: 1, bottom: 1 }, 1000, 0)).toBe(64);
  });
});

describe('zoomAtPoint', () => {
  it('keeps the document point under the cursor', () => {
    const scroll = { left: 100, top: 400 };
    const point = { vx: 300, vy: 200 };
    const docX = (scroll.left + point.vx) / 1;
    const docY = (scroll.top + point.vy) / 1;
    const next = zoomAtPoint(scroll, point, 1, 2.5);
    expect((next.left + point.vx) / 2.5).toBeCloseTo(docX);
    expect((next.top + point.vy) / 2.5).toBeCloseTo(docY);
    expect(zoomAtPoint(scroll, point, 2, 2)).toEqual(scroll);
  });
});

describe('page navigation', () => {
  it('parses 1-based, localized page numbers within range', () => {
    expect(parsePageInput('1', 10, 'en')).toBe(0);
    expect(parsePageInput(' 10 ', 10, 'en')).toBe(9);
    expect(parsePageInput('1,000', 2000, 'en')).toBe(999);
    expect(parsePageInput('١٢', 20, 'ar-EG')).toBe(11);
    for (const bad of ['0', '11', '2.5', 'x', '', '-1'])
      expect(parsePageInput(bad, 10, 'en')).toBeNull();
  });

  it('moves and clamps', () => {
    expect(movePage(5, 'first', 10)).toBe(0);
    expect(movePage(5, 'prev', 10)).toBe(4);
    expect(movePage(0, 'prev', 10)).toBe(0);
    expect(movePage(9, 'next', 10)).toBe(9);
    expect(movePage(5, 'last', 10)).toBe(9);
    expect(clampPage(3.7, 10)).toBe(3);
    expect(clampPage(5, 0)).toBe(0);
  });
});
