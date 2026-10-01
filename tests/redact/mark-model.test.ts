// M4-16 (§7.9 step 1, M4-Q3): redaction marks as standard /Redact annotations.
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  areaMark,
  clampToPage,
  markAreas,
  markKind,
  rectFrom,
  REDACT_FILL,
  REDACT_OUTLINE,
  textMarks,
} from '../../src/features/redact/markModel';

const r = (x: number, y: number, w: number, h: number) => ({
  origin: { x, y },
  size: { width: w, height: h },
});
const now = new Date(0);
let n = 0;
const newId = () => `m${String(++n)}`;

describe('redaction marks', () => {
  it('text: one /Redact per page with a quad per selected line; text only if copying is allowed', () => {
    const marks = textMarks(
      [
        {
          pageIndex: 0,
          rect: r(10, 10, 200, 30),
          segmentRects: [r(10, 10, 200, 12), r(10, 28, 80, 12)],
        },
        { pageIndex: 1, rect: r(5, 5, 40, 12), segmentRects: [r(5, 5, 40, 12)] },
        { pageIndex: 2, rect: r(0, 0, 0, 0), segmentRects: [] },
      ],
      { now, newId, texts: ['  Secret line\nand more ', 'B'] },
    );
    expect(marks).toHaveLength(2);
    expect(marks[0]).toMatchObject({
      type: PdfAnnotationSubtype.REDACT,
      pageIndex: 0,
      color: REDACT_FILL,
      strokeColor: REDACT_OUTLINE,
      contents: 'Secret line\nand more',
    });
    expect(marks[0]?.segmentRects).toHaveLength(2);
    expect(markKind(marks[0] ?? { segmentRects: [] })).toBe('text');
    const denied = textMarks(
      [{ pageIndex: 0, rect: r(1, 1, 9, 9), segmentRects: [r(1, 1, 9, 9)] }],
      { now, newId, texts: null },
    );
    expect(denied[0]?.contents).toBeUndefined();
  });

  it('area: corners in any order, clamped to the page, too small → none', () => {
    expect(rectFrom({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual(r(10, 20, 40, 60));
    expect(clampToPage(r(-10, -10, 50, 50), 100, 100)).toEqual(r(0, 0, 40, 40));
    expect(clampToPage(r(98, 10, 50, 50), 100, 100)).toBeNull();
    const m = areaMark(3, r(10, 20, 40, 60), { width: 595, height: 842 }, { now, newId });
    expect(m).toMatchObject({ pageIndex: 3, rect: r(10, 20, 40, 60) });
    expect(m?.segmentRects).toEqual([r(10, 20, 40, 60)]);
    expect(m && markKind(m)).toBe('area');
    expect(areaMark(0, r(0, 0, 2, 50), { width: 595, height: 842 }, { now, newId })).toBeNull();
  });

  it('a mark covers its quads, else its rectangle (marks from other viewers may lack quads)', () => {
    expect(markAreas({ rect: r(0, 0, 5, 5) })).toEqual([r(0, 0, 5, 5)]);
    expect(markAreas({ rect: r(0, 0, 5, 5), segmentRects: [r(1, 1, 2, 2)] })).toEqual([
      r(1, 1, 2, 2),
    ]);
  });
});
