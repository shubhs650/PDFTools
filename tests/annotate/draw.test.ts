import { PdfActionType } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  centred,
  constrain,
  DRAW_COMMANDS,
  isDrawTool,
  snapAngle,
  snapSquare,
} from '../../src/features/annotate/tools/drawModel';
import { linkTarget, normalizeUrl } from '../../src/features/annotate/tools/linkTarget';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('Shift-constrained drawing (M3-09)', () => {
  it('snaps a line to the nearest 45° ray, keeping its reach along it', () => {
    close(snapAngle({ x: 0, y: 0 }, { x: 100, y: 10 }), { x: 100, y: 0 });
    close(snapAngle({ x: 0, y: 0 }, { x: 10, y: -100 }), { x: 0, y: -100 });
    const d = snapAngle({ x: 10, y: 10 }, { x: 60, y: 55 });
    expect(d.x - 10).toBeCloseTo(d.y - 10, 6); // 45°
    close(snapAngle({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 5, y: 5 });
  });

  it('squares a box in the pointer’s quadrant, the larger side winning', () => {
    expect(snapSquare({ x: 0, y: 0 }, { x: 40, y: 10 })).toEqual({ x: 40, y: 40 });
    expect(snapSquare({ x: 0, y: 0 }, { x: -10, y: 30 })).toEqual({ x: -30, y: 30 });
    expect(snapSquare({ x: 0, y: 0 }, { x: -50, y: -20 })).toEqual({ x: -50, y: -50 });
  });

  it('applies the right constraint per tool, none without an anchor', () => {
    expect(constrain('square', { x: 0, y: 0 }, { x: 30, y: 10 })).toEqual({ x: 30, y: 30 });
    close(constrain('polygon', { x: 0, y: 0 }, { x: 30, y: 2 }), { x: 30, y: 0 });
    expect(constrain('ink', { x: 0, y: 0 }, { x: 30, y: 2 })).toEqual({ x: 30, y: 2 });
    expect(constrain('line', null, { x: 30, y: 2 })).toEqual({ x: 30, y: 2 });
  });

  it('maps every drawing command to a drawing tool', () => {
    expect(Object.values(DRAW_COMMANDS).every(isDrawTool)).toBe(true);
    expect(centred({ width: 600, height: 800 }, { width: 200, height: 24 })).toEqual({
      origin: { x: 200, y: 388 },
      size: { width: 200, height: 24 },
    });
  });
});

describe('link targets (M3-09)', () => {
  it('accepts web and mail addresses, adds https://, refuses other schemes', () => {
    expect(normalizeUrl('example.com/a b')).toBeNull();
    expect(normalizeUrl('example.com/spec')).toBe('https://example.com/spec');
    expect(normalizeUrl('HTTP://Example.com')).toBe('http://example.com/');
    expect(normalizeUrl('mailto:a@example.com')).toBe('mailto:a@example.com');
    for (const bad of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,x',
      'intranet',
      '',
    ])
      expect(normalizeUrl(bad), bad).toBeNull();
  });

  it('makes a GoTo for a page in range and a URI action for an address', () => {
    expect(linkTarget({ kind: 'page', page: '0' }, 3)).toEqual({
      target: null,
      error: 'pageRange',
    });
    expect(linkTarget({ kind: 'page', page: '2.5' }, 3).error).toBe('pageRange');
    const go = linkTarget({ kind: 'page', page: ' 3 ' }, 3).target;
    expect(
      go?.type === 'action' &&
        go.action.type === PdfActionType.Goto &&
        go.action.destination.pageIndex,
    ).toBe(2);
    expect(linkTarget({ kind: 'url', url: 'example.com' }, 3).target).toEqual({
      type: 'action',
      action: { type: PdfActionType.URI, uri: 'https://example.com/' },
    });
    expect(linkTarget({ kind: 'url', url: 'javascript:x' }, 3).error).toBe('url');
  });
});
