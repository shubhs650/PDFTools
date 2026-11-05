import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype as S,
  PdfStandardFont,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  applyStyle,
  flagPatch,
  fontOf,
  fontParts,
  gateOf,
  isFixed,
  MIXED,
  patchFor,
  propsOf,
  readFlag,
  readProps,
  styleOf,
  TOOL_PROPS,
  toolStyleOf,
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
      'fill',
      'stroke',
      'style',
      'width',
      'opacity',
      'blendMode',
      'rotation',
      'subject',
      'contents',
    ]);
    expect(propsOf(line())).toContain('lineEnd');
    expect(propsOf(highlight)).toEqual(['stroke', 'opacity', 'blendMode', 'subject', 'contents']);
    expect(propsOf(freeText)).toEqual([
      'fill',
      'opacity',
      'blendMode',
      'rotation',
      'fontFamily',
      'bold',
      'italic',
      'fontSize',
      'fontColor',
      'textAlign',
      'verticalAlign',
      'subject',
      'contents',
    ]);
    // A callout is not turned (EmbedPDF has no rotate handle for it).
    expect(propsOf({ ...freeText, intent: 'FreeTextCallout' })).not.toContain('rotation');
    // ADR-024: a text box with a border and a callout have a Border color; a typewriter has none.
    const bordered = { ...freeText, strokeColor: '#ff0000' } as PdfAnnotationObject;
    expect(propsOf(bordered).slice(0, 2)).toEqual(['fill', 'border']);
    expect(propsOf({ ...freeText, intent: 'FreeTextCallout' })).toContain('border');
    expect(propsOf({ ...bordered, intent: 'FreeTextTypeWriter' })).not.toContain('border');
    expect(readProps([bordered]).border).toBe('#ff0000');
    expect(patchFor(bordered, 'border', '#00ff00')).toEqual({ strokeColor: '#00ff00' });
    // The text colour changes the text only.
    expect(patchFor(bordered, 'fontColor', '#0000ff')).toEqual({ fontColor: '#0000ff' });
    expect(patchFor(square(), 'border', '#00ff00')).toBeNull();
  });

  it('shows shared properties only, with mixed values', () => {
    const r = readProps([square(), line()]);
    expect(Object.keys(r)).toEqual([
      'fill',
      'stroke',
      'style',
      'width',
      'opacity',
      'blendMode',
      'rotation',
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
      blendMode: 0,
      strokeColor: '#123456',
      color: 'transparent',
      opacity: 0.5,
      strokeWidth: 4,
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
      strokeDashArray: [],
      cloudyBorderIntensity: 0,
    });
    expect(applyStyle(style, highlight)).toEqual({
      blendMode: 0,
      strokeColor: '#123456',
      color: '#123456',
      opacity: 0.5,
    });
  });
});

describe('property grid (M6-06)', () => {
  const text = (o: Record<string, unknown> = {}) =>
    ({
      ...freeText,
      fontFamily: PdfStandardFont.Helvetica,
      textAlign: 0,
      verticalAlign: 0,
      ...o,
    }) as unknown as PdfAnnotationObject;

  it('splits a standard font into family, bold and italic, and back', () => {
    expect(fontParts(PdfStandardFont.Times_BoldItalic)).toEqual({
      family: 'times',
      bold: true,
      italic: true,
    });
    expect(fontParts(PdfStandardFont.Courier_Oblique)).toEqual({
      family: 'courier',
      bold: false,
      italic: true,
    });
    // Unknown, Symbol and missing fonts read as Helvetica (PDFium draws them so).
    expect(fontParts(PdfStandardFont.Unknown).family).toBe('helvetica');
    expect(fontParts(undefined)).toEqual({ family: 'helvetica', bold: false, italic: false });
    expect(fontOf({ family: 'helvetica', bold: true, italic: true })).toBe(
      PdfStandardFont.Helvetica_BoldOblique,
    );
  });

  it('reads and changes the font, bold and italic of a text box', () => {
    const a = text({ fontFamily: PdfStandardFont.Times_Bold });
    expect(readProps([a])).toMatchObject({ fontFamily: 'times', bold: true, italic: false });
    expect(patchFor(a, 'italic', true)).toEqual({ fontFamily: PdfStandardFont.Times_BoldItalic });
    expect(patchFor(a, 'bold', false)).toEqual({ fontFamily: PdfStandardFont.Times_Roman });
    expect(patchFor(a, 'fontFamily', 'courier')).toEqual({
      fontFamily: PdfStandardFont.Courier_Bold,
    });
    expect(patchFor(a, 'fontFamily', 'comic')).toBeNull();
    expect(patchFor(a, 'textAlign', 2)).toEqual({ textAlign: 2 });
    expect(patchFor(a, 'verticalAlign', 7)).toEqual({ verticalAlign: 2 });
    // Mixed across a selection.
    expect(readProps([a, text()]).bold).toBe(MIXED);
    expect(readProps([a, text()]).italic).toBe(false);
  });

  it('blend mode and rotation', () => {
    expect(readProps([square()])).toMatchObject({ blendMode: 0, rotation: 0 });
    expect(patchFor(square(), 'blendMode', 1)).toEqual({ blendMode: 1 });
    expect(patchFor(square(), 'blendMode', 40)).toEqual({ blendMode: 15 });
    expect(patchFor(square(), 'rotation', 370)).toEqual({ rotation: 10 });
    expect(patchFor(square(), 'rotation', -90)).toEqual({ rotation: 270 });
    expect(patchFor(highlight, 'rotation', 90)).toBeNull();
    // Rotation is placement, not style: Copy Style leaves it.
    expect(styleOf(square({ rotation: 45 }))).not.toHaveProperty('rotation');
  });

  it('flags: read with Mixed, patched with the other flags kept', () => {
    const locked = square({ flags: ['print', 'locked'] });
    expect(readFlag([locked], 'locked')).toBe(true);
    expect(readFlag([locked, square()], 'locked')).toBe(MIXED);
    expect(readFlag([locked, square()], 'print')).toBe(true);
    expect(readFlag([], 'print')).toBe(false);
    expect(flagPatch(locked, 'locked', false)).toEqual({ flags: ['print'] });
    expect(flagPatch(square({ flags: undefined }), 'readOnly', true)).toEqual({
      flags: ['readOnly'],
    });
    expect(flagPatch(locked, 'print', false)).toEqual({ flags: ['locked'] });
  });

  it('Locked and Read only fix a comment; the gate says what may change', () => {
    expect(isFixed(square())).toBe(false);
    expect(isFixed(square({ flags: ['locked'] }))).toBe(true);
    expect(isFixed(square({ flags: ['readOnly'] }))).toBe(true);
    expect(gateOf([square()])).toBe('open');
    expect(gateOf([square(), square({ flags: ['locked'] })])).toBe('locked');
    expect(gateOf([square({ flags: ['locked'] }), square({ flags: ['readOnly'] })])).toBe(
      'readOnly',
    );
  });

  it('a comment’s style as tool defaults ("Make current properties default")', () => {
    expect(toolStyleOf(square({ strokeColor: '#00ff00', strokeWidth: 3, rotation: 30 }))).toEqual({
      color: 'transparent',
      strokeColor: '#00ff00',
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
      strokeDashArray: [],
      cloudyBorderIntensity: 0,
      strokeWidth: 3,
      opacity: 1,
    });
    expect(toolStyleOf(text({ fontFamily: PdfStandardFont.Courier_Bold, fontSize: 9 }))).toEqual({
      color: 'transparent',
      opacity: 1,
      fontFamily: PdfStandardFont.Courier_Bold,
      fontSize: 9,
      fontColor: '#000000',
      textAlign: 0,
      verticalAlign: 0,
    });
    // The pencil keeps its deprecated `color` alias in step (M6-03).
    const ink = {
      ...base,
      type: S.INK,
      strokeColor: '#0000ff',
      strokeWidth: 2,
      opacity: 1,
      inkList: [],
    } as unknown as PdfAnnotationObject;
    expect(toolStyleOf(ink)).toMatchObject({ strokeColor: '#0000ff', color: '#0000ff' });
    expect(TOOL_PROPS).not.toContain('blendMode');
    expect(TOOL_PROPS).not.toContain('rotation');
  });
});
