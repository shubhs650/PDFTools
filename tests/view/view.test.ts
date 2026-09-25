import { describe, expect, it } from 'vitest';
import { PREVIEW_MAX_PX, previewScale } from '../../src/features/view/preview';
import { renderKey } from '../../src/features/view/renderStats';
import { TileCache } from '../../src/features/view/tileCache';
import { rankTask } from '../../src/features/view/tileScheduler';

const blob = (bytes: number): Blob => new Blob([new Uint8Array(bytes)]);

describe('TileCache (M1-14, §5)', () => {
  it('evicts least recently used first and stays within its byte budget', () => {
    const c = new TileCache(300);
    c.setActive('A');
    c.set('a1', 'A', 0, blob(100));
    c.set('a2', 'A', 0, blob(100));
    c.set('a3', 'A', 1, blob(100));
    expect(c.get('a1')).toBeDefined(); // a1 is now the most recent
    c.set('a4', 'A', 1, blob(100));
    expect(c.get('a2')).toBeUndefined(); // oldest unused went first
    expect(c.get('a1')).toBeDefined();
    expect(c.size).toBeLessThanOrEqual(300);
  });

  it('evicts inactive documents before the active one, even if they were used later', () => {
    const c = new TileCache(400);
    c.setActive('A');
    c.set('a1', 'A', 0, blob(100));
    c.set('a2', 'A', 0, blob(100));
    c.set('b1', 'B', 0, blob(100));
    c.set('b2', 'B', 0, blob(100));
    c.set('a3', 'A', 0, blob(100)); // over budget by 100
    expect(c.get('b1')).toBeUndefined();
    expect(c.get('a1')).toBeDefined();
    c.set('a4', 'A', 0, blob(200)); // over by 200: the rest of B, then the oldest of A
    expect(c.docBytes('B')).toBe(0);
    expect(c.get('a2')).toBeUndefined();
    expect(c.size).toBeLessThanOrEqual(400);
  });

  it('switching tabs changes which document is evicted first', () => {
    const c = new TileCache(300);
    c.setActive('A');
    c.set('a1', 'A', 0, blob(100));
    c.set('b1', 'B', 0, blob(100));
    c.setActive('B');
    c.set('b2', 'B', 0, blob(100));
    c.set('b3', 'B', 0, blob(100));
    expect(c.docBytes('A')).toBe(0);
    expect(c.docBytes('B')).toBe(300);
  });

  it('drops a document or a page, counts hits, ignores blobs larger than the budget', () => {
    const c = new TileCache(1000);
    c.set('a1', 'A', 0, blob(10));
    c.set('a2', 'A', 1, blob(10));
    c.set('b1', 'B', 0, blob(10));
    c.dropPage('A', 1);
    expect(c.get('a2')).toBeUndefined();
    c.dropDoc('B');
    expect(c.count).toBe(1);
    expect(c.get('a1')).toBeDefined();
    expect(c.hits).toBe(1);
    c.set('huge', 'A', 0, blob(2000));
    expect(c.get('huge')).toBeUndefined();
    // Re-setting a key replaces it without double counting.
    c.set('a1', 'A', 0, blob(30));
    expect(c.size).toBe(30);
  });
});

describe('rankTask: visible first (M1-14)', () => {
  const focus = { docId: 'A', pageIndex: 10 };
  it('ranks the active document by distance from the page in view', () => {
    const r = (docId: string, pageIndex: number) => rankTask({ meta: { docId, pageIndex } }, focus);
    expect(r('A', 10)).toBeGreaterThan(r('A', 11));
    expect(r('A', 11)).toBe(r('A', 9));
    expect(r('A', 12)).toBeGreaterThan(r('A', 50));
    expect(r('A', 1999)).toBeGreaterThan(r('B', 10)); // other documents last
  });
  it('leaves tasks without page metadata neutral', () => {
    expect(rankTask({}, focus)).toBe(0);
    expect(rankTask({ meta: { docId: 'A' } }, focus)).toBe(0);
  });
});

describe('previewScale: bounded base image (ADR-011 decision 3)', () => {
  const a0 = { width: 3370, height: 2384 };
  const letter = { width: 612, height: 792 };

  it('never exceeds 1024 device px on the longest side, at any zoom', () => {
    for (const scale of [0.01, 0.1, 1, 8, 64]) {
      for (const dpr of [1, 1.5, 2, 3]) {
        for (const size of [a0, letter]) {
          const s = previewScale(size, scale, dpr);
          expect(Math.max(size.width, size.height) * s).toBeLessThanOrEqual(PREVIEW_MAX_PX + 1e-9);
        }
      }
    }
  });

  it('follows the zoom below the cap, in half-octave steps', () => {
    expect(previewScale(letter, 0.5, 1)).toBeCloseTo(0.5);
    expect(previewScale(letter, 0.6, 1)).toBeCloseTo(0.5); // stepped down, never up
    expect(previewScale(letter, 0.75, 1)).toBeCloseTo(Math.SQRT1_2);
    expect(previewScale(letter, 0.5, 2)).toBeCloseTo(1); // device pixels
    expect(previewScale(letter, 64, 1)).toBeCloseTo(1024 / 792);
  });

  it('is 0 for degenerate input', () => {
    expect(previewScale({ width: 0, height: 0 }, 1, 1)).toBe(0);
    expect(previewScale(letter, 0, 1)).toBe(0);
  });
});

describe('renderKey', () => {
  const doc = { id: 'D' };
  const page = { index: 3 };
  it('keys the exact request', () => {
    const a = renderKey('renderPageRect', [doc, page, { x: 0 }, { scaleFactor: 2 }]);
    const b = renderKey('renderPageRect', [doc, page, { x: 256 }, { scaleFactor: 2 }]);
    const c = renderKey('renderPageRect', [doc, page, { x: 0 }, { scaleFactor: 4 }]);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(renderKey('renderPage', [doc, page, { scaleFactor: 1 }])).not.toBe(
      renderKey('renderPage', [{ id: 'E' }, page, { scaleFactor: 1 }]),
    );
    expect(renderKey('renderPage', [null, page])).toBeNull();
  });
});
