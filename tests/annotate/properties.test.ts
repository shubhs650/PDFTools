import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype as S,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  applyStyle,
  MIXED,
  patchFor,
  propsOf,
  readProps,
  styleOf,
} from '../../src/features/annotate/properties/model';

const base = {
  id: 'a',
  pageIndex: 0,
  rect: { origin: { x: 0, y: 0 }, size: { width: 10, height: 10 } },
};
const square = (o: Record<string, unknown> = {}) =>
  ({
    ...base,
    type: S.SQUARE,
    strokeColor: '#ff0000',
    color: 'transparent',
    opacity: 1,
    strokeWidth: 2,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
    flags: ['print'],
    ...o,
  }) as unknown as PdfAnnotationObject;
const line = (o: Record<string, unknown> = {}) =>
  ({
    ...base,
    id: 'l',
    type: S.LINE,
    strokeColor: '#0000ff',
    color: 'transparent',
    opacity: 0.5,
    strokeWidth: 1,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
    linePoints: { start: { x: 0, y: 0 }, end: { x: 5, y: 5 } },
    lineEndings: { start: PdfAnnotationLineEnding.None, end: PdfAnnotationLineEnding.OpenArrow },
    ...o,
  }) as unknown as PdfAnnotationObject;
const highlight = {
  ...base,
  id: 'h',
  type: S.HIGHLIGHT,
  strokeColor: '#ffe14d',
  color: '#ffe14d',
  opacity: 1,
  segmentRects: [],
} as unknown as PdfAnnotationObject;
const freeText = {
  ...base,
  id: 'f',
  type: S.FREETEXT,
  contents: 'x',
  fontSize: 12,
  fontColor: '#000000',
  opacity: 1,
} as unknown as PdfAnnotationObject;

describe('annotation properties (M3-10)', () => {
  it('knows which properties each type has', () => {
    expect(propsOf(square())).toEqual([
      'stroke',
      'fill',
      'opacity',
      'width',
      'style',
      'subject',
      'contents',
    ]);
    expect(propsOf(line())).toContain('lineEnd');
    expect(propsOf(highlight)).toEqual(['stroke', 'opacity', 'subject', 'contents']);
    expect(propsOf(freeText)).toEqual([
      'fill',
      'opacity',
      'fontSize',
      'fontColor',
      'subject',
      'contents',
    ]);
  });

  it('shows shared properties only, with mixed values', () => {
    const r = readProps([square(), line()]);
    expect(Object.keys(r)).toEqual([
      'stroke',
      'fill',
      'opacity',
      'width',
      'style',
      'subject',
      'contents',
    ]);
    expect(r.stroke).toBe(MIXED);
    expect(r.fill).toBe('transparent');
    expect(r.opacity).toBe(MIXED);
    expect(r.style).toBe('solid');
    expect(readProps([])).toEqual({});
  });

  it('reads the line style, cloudy included', () => {
    expect(readProps([square({ cloudyBorderIntensity: 2 })]).style).toBe('cloudy');
    expect(readProps([square({ strokeStyle: PdfAnnotationBorderStyle.DASHED })]).style).toBe(
      'dashed',
    );
  });

  it('turns a property change into the annotation’s own patch', () => {
    expect(patchFor(square(), 'stroke', '#00ff00')).toEqual({ strokeColor: '#00ff00' });
    expect(patchFor(highlight, 'stroke', '#00ff00')).toEqual({
      strokeColor: '#00ff00',
      color: '#00ff00',
    });
    expect(patchFor(square(), 'style', 'cloudy')).toEqual({
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
      strokeDashArray: [],
      cloudyBorderIntensity: 2,
    });
    expect(patchFor(square({ cloudyBorderIntensity: 2 }), 'style', 'dashed')).toEqual({
      strokeStyle: PdfAnnotationBorderStyle.DASHED,
      strokeDashArray: [3, 3],
      cloudyBorderIntensity: 0,
    });
    expect(patchFor(line(), 'lineEnd', PdfAnnotationLineEnding.ClosedArrow)).toEqual({
      lineEndings: {
        start: PdfAnnotationLineEnding.None,
        end: PdfAnnotationLineEnding.ClosedArrow,
      },
    });
    expect(patchFor(highlight, 'width', 3)).toBeNull(); // not a highlight property
    expect(patchFor(square(), 'opacity', 1.4)).toEqual({ opacity: 1 }); // clamped
  });

  it('copies a style and applies what the target shares', () => {
    const style = styleOf(line({ strokeColor: '#123456', strokeWidth: 4 }));
    expect(style).toMatchObject({ stroke: '#123456', width: 4, opacity: 0.5 });
    expect(style).not.toHaveProperty('contents');
    expect(applyStyle(style, square())).toEqual({
      strokeColor: '#123456',
      color: 'transparent',
      opacity: 0.5,
      strokeWidth: 4,
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
      strokeDashArray: [],
      cloudyBorderIntensity: 0,
    });
    expect(applyStyle(style, highlight)).toEqual({
      strokeColor: '#123456',
      color: '#123456',
      opacity: 0.5,
    });
  });
});
