// One annotation per EmbedPDF 2.15.1 default annotation tool (plugin-annotation
// `id`s), built with the same defaults the tools use, plus the "cloud" markup
// (square/polygon with cloudyBorderIntensity). Used by the S1 harnesses.

import {
  PdfActionType,
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype,
  PdfBlendMode,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfAnnotationObject,
  type Rect,
} from '@embedpdf/models';

export interface ToolAnnotation {
  tool: string;
  annotation: PdfAnnotationObject;
  /** Only for the image stamp: PNG bytes. */
  stampPng?: boolean;
}

const r = (x: number, y: number, w: number, h: number): Rect => ({
  origin: { x, y },
  size: { width: w, height: h },
});

const AUTHOR = 'PDFTools S1';
const RED = '#E44234';
const YELLOW = '#FFCD45';

/** Page coordinates are top-left origin in points (EmbedPDF convention). */
export function everyToolAnnotation(pageIndex: number): ToolAnnotation[] {
  const base = (tool: string, i: number) => ({
    id: `s1-${tool}-${String(i)}`,
    pageIndex,
    author: AUTHOR,
    contents: `S1 ${tool}`,
    created: new Date('2026-09-24T12:00:00Z'),
    modified: new Date('2026-09-24T12:00:00Z'),
    flags: ['print'] as const,
  });
  // Text lines of the fixtures start at y≈62 (top-left) with 16 pt pitch.
  const line = (n: number): Rect => r(60, 62 + n * 16 + 40, 300, 12);
  const list: ToolAnnotation[] = [
    {
      tool: 'highlight',
      annotation: {
        ...base('highlight', 0),
        type: PdfAnnotationSubtype.HIGHLIGHT,
        rect: line(0),
        segmentRects: [line(0)],
        color: YELLOW,
        opacity: 1,
        blendMode: PdfBlendMode.Multiply,
      },
    },
    {
      tool: 'underline',
      annotation: {
        ...base('underline', 1),
        type: PdfAnnotationSubtype.UNDERLINE,
        rect: line(1),
        segmentRects: [line(1)],
        color: RED,
        opacity: 1,
      },
    },
    {
      tool: 'strikeout',
      annotation: {
        ...base('strikeout', 2),
        type: PdfAnnotationSubtype.STRIKEOUT,
        rect: line(2),
        segmentRects: [line(2)],
        color: RED,
        opacity: 1,
      },
    },
    {
      tool: 'squiggly',
      annotation: {
        ...base('squiggly', 3),
        type: PdfAnnotationSubtype.SQUIGGLY,
        rect: line(3),
        segmentRects: [line(3)],
        color: RED,
        opacity: 1,
      },
    },
    {
      tool: 'insertText',
      annotation: {
        ...base('insertText', 4),
        type: PdfAnnotationSubtype.CARET,
        rect: r(200, 62 + 4 * 16 + 40, 10, 12),
        strokeColor: RED,
        opacity: 1,
        intent: 'Insert',
      },
    },
    {
      tool: 'replaceText',
      annotation: {
        ...base('replaceText', 5),
        type: PdfAnnotationSubtype.STRIKEOUT,
        rect: line(5),
        segmentRects: [line(5)],
        color: RED,
        opacity: 1,
        intent: 'StrikeOutTextEdit',
      },
    },
    {
      tool: 'ink',
      annotation: {
        ...base('ink', 6),
        type: PdfAnnotationSubtype.INK,
        rect: r(380, 180, 120, 60),
        inkList: [
          {
            points: Array.from({ length: 20 }, (_, i) => ({
              x: 385 + i * 5.5,
              y: 210 + Math.sin(i / 2) * 20,
            })),
          },
        ],
        color: RED,
        strokeColor: RED,
        opacity: 1,
        strokeWidth: 6,
      },
    },
    {
      tool: 'inkHighlighter',
      annotation: {
        ...base('inkHighlighter', 7),
        type: PdfAnnotationSubtype.INK,
        intent: 'InkHighlight',
        rect: r(380, 260, 150, 30),
        inkList: [
          {
            points: [
              { x: 390, y: 275 },
              { x: 520, y: 275 },
            ],
          },
        ],
        color: YELLOW,
        strokeColor: YELLOW,
        opacity: 1,
        strokeWidth: 14,
        blendMode: PdfBlendMode.Multiply,
      },
    },
    {
      tool: 'circle',
      annotation: {
        ...base('circle', 8),
        type: PdfAnnotationSubtype.CIRCLE,
        rect: r(60, 520, 120, 80),
        flags: ['print'],
        color: 'transparent',
        strokeColor: RED,
        opacity: 1,
        strokeWidth: 6,
        strokeStyle: PdfAnnotationBorderStyle.SOLID,
      },
    },
    {
      tool: 'square',
      annotation: {
        ...base('square', 9),
        type: PdfAnnotationSubtype.SQUARE,
        rect: r(200, 520, 120, 80),
        flags: ['print'],
        color: 'transparent',
        strokeColor: RED,
        opacity: 1,
        strokeWidth: 6,
        strokeStyle: PdfAnnotationBorderStyle.SOLID,
      },
    },
    {
      tool: 'cloud (square, cloudy border)',
      annotation: {
        ...base('cloud', 10),
        type: PdfAnnotationSubtype.SQUARE,
        rect: r(340, 520, 160, 90),
        flags: ['print'],
        color: 'transparent',
        strokeColor: RED,
        opacity: 1,
        strokeWidth: 2,
        strokeStyle: PdfAnnotationBorderStyle.CLOUDY,
        cloudyBorderIntensity: 2,
      },
    },
    {
      tool: 'line',
      annotation: {
        ...base('line', 11),
        type: PdfAnnotationSubtype.LINE,
        rect: r(60, 620, 200, 20),
        linePoints: { start: { x: 65, y: 630 }, end: { x: 255, y: 630 } },
        color: 'transparent',
        strokeColor: RED,
        opacity: 1,
        strokeWidth: 6,
        strokeStyle: PdfAnnotationBorderStyle.SOLID,
      },
    },
    {
      tool: 'lineArrow',
      annotation: {
        ...base('lineArrow', 12),
        type: PdfAnnotationSubtype.LINE,
        intent: 'LineArrow',
        rect: r(280, 610, 220, 40),
        linePoints: { start: { x: 290, y: 630 }, end: { x: 490, y: 630 } },
        lineEndings: {
          start: PdfAnnotationLineEnding.None,
          end: PdfAnnotationLineEnding.OpenArrow,
        },
        color: 'transparent',
        strokeColor: RED,
        opacity: 1,
        strokeWidth: 6,
        strokeStyle: PdfAnnotationBorderStyle.SOLID,
      },
    },
    {
      tool: 'polyline',
      annotation: {
        ...base('polyline', 13),
        type: PdfAnnotationSubtype.POLYLINE,
        rect: r(60, 660, 200, 60),
        vertices: [
          { x: 65, y: 715 },
          { x: 120, y: 665 },
          { x: 180, y: 715 },
          { x: 255, y: 665 },
        ],
        color: 'transparent',
        strokeColor: RED,
        opacity: 1,
        strokeWidth: 6,
        strokeStyle: PdfAnnotationBorderStyle.SOLID,
      },
    },
    {
      tool: 'polygon',
      annotation: {
        ...base('polygon', 14),
        type: PdfAnnotationSubtype.POLYGON,
        rect: r(280, 660, 120, 70),
        vertices: [
          { x: 285, y: 725 },
          { x: 340, y: 665 },
          { x: 395, y: 725 },
        ],
        color: 'transparent',
        strokeColor: RED,
        opacity: 1,
        strokeWidth: 6,
        strokeStyle: PdfAnnotationBorderStyle.SOLID,
      },
    },
    {
      tool: 'cloud (polygon, cloudy border)',
      annotation: {
        ...base('cloudPolygon', 15),
        type: PdfAnnotationSubtype.POLYGON,
        rect: r(420, 650, 130, 90),
        vertices: [
          { x: 430, y: 730 },
          { x: 485, y: 660 },
          { x: 540, y: 730 },
        ],
        color: 'transparent',
        strokeColor: RED,
        opacity: 1,
        strokeWidth: 2,
        strokeStyle: PdfAnnotationBorderStyle.CLOUDY,
        cloudyBorderIntensity: 2,
      },
    },
    {
      tool: 'textComment',
      annotation: {
        ...base('textComment', 16),
        type: PdfAnnotationSubtype.TEXT,
        rect: r(520, 40, 24, 24),
        contents: 'S1 sticky note',
        color: YELLOW,
        opacity: 1,
      },
    },
    {
      tool: 'freeText',
      annotation: {
        ...base('freeText', 17),
        type: PdfAnnotationSubtype.FREETEXT,
        rect: r(60, 750, 220, 40),
        contents: 'S1 free text (typewriter)',
        fontFamily: PdfStandardFont.Helvetica,
        fontSize: 14,
        fontColor: RED,
        textAlign: PdfTextAlignment.Left,
        verticalAlign: PdfVerticalAlignment.Top,
        color: 'transparent',
        opacity: 1,
      },
    },
    {
      tool: 'freeTextCallout',
      annotation: {
        ...base('freeTextCallout', 18),
        type: PdfAnnotationSubtype.FREETEXT,
        intent: 'FreeTextCallout',
        rect: r(300, 740, 250, 70),
        contents: 'S1 callout',
        fontFamily: PdfStandardFont.Helvetica,
        fontSize: 14,
        fontColor: '#000000',
        textAlign: PdfTextAlignment.Left,
        verticalAlign: PdfVerticalAlignment.Top,
        color: '#FFFFFF',
        opacity: 1,
        calloutLine: [
          { x: 310, y: 800 },
          { x: 360, y: 780 },
          { x: 400, y: 780 },
        ],
        lineEnding: PdfAnnotationLineEnding.OpenArrow,
        strokeColor: '#000000',
        strokeWidth: 1,
      },
    },
    {
      tool: 'stamp (image)',
      stampPng: true,
      annotation: {
        ...base('stamp', 19),
        type: PdfAnnotationSubtype.STAMP,
        rect: r(440, 380, 96, 96),
      },
    },
    {
      tool: 'link',
      annotation: {
        ...base('link', 20),
        type: PdfAnnotationSubtype.LINK,
        rect: line(8),
        target: {
          type: 'action',
          action: { type: PdfActionType.URI, uri: 'https://example.org/' },
        },
        strokeColor: '#0000FF',
        strokeWidth: 1,
        strokeStyle: PdfAnnotationBorderStyle.UNDERLINE,
      },
    },
  ] as ToolAnnotation[];
  return list;
}

/** `n` square markups spread over a page, for the timing test. */
export function manyMarkups(pageIndex: number, n: number): PdfAnnotationObject[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s1-bulk-${String(pageIndex)}-${String(i)}`,
    pageIndex,
    author: AUTHOR,
    contents: `bulk ${String(i)}`,
    type: PdfAnnotationSubtype.SQUARE,
    rect: r(40 + (i % 10) * 50, 60 + Math.floor(i / 10) * 70, 40, 50),
    flags: ['print'],
    color: 'transparent',
    strokeColor: RED,
    opacity: 1,
    strokeWidth: 2,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
  }));
}
