import { PdfAnnotationReplyType, PdfAnnotationSubtype, PdfBlendMode } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  buildMarkups,
  caretRect,
  isMarkupTool,
  textsPerPage,
  type PageSelection,
} from '../../src/features/annotate/tools/markupModel';

const r = (x: number, y: number, width: number, height: number) => ({
  origin: { x, y },
  size: { width, height },
});

// Two columns on page 0 (a line in each), one line on page 2.
const twoColumns: PageSelection = {
  pageIndex: 0,
  rect: r(72, 100, 400, 28),
  segmentRects: [r(72, 100, 180, 12), r(292, 116, 180, 12)],
};
const nextPage: PageSelection = {
  pageIndex: 2,
  rect: r(72, 72, 90, 12),
  segmentRects: [r(72, 72, 90, 12)],
};

const opts = (texts: string[] | null = null) => {
  let n = 0;
  return { now: new Date(0), newId: () => `id-${String(++n)}`, texts };
};

describe('text markups from a selection (M3-08)', () => {
  it('one markup per page, a segment rect (quad) per selected line', () => {
    const made = buildMarkups('highlight', [twoColumns, nextPage], opts(['a b', 'c']));
    expect(made).toHaveLength(2);
    expect(made[0]).toMatchObject({
      type: PdfAnnotationSubtype.HIGHLIGHT,
      id: 'id-1',
      pageIndex: 0,
      rect: twoColumns.rect,
      segmentRects: twoColumns.segmentRects,
      blendMode: PdfBlendMode.Multiply,
      contents: 'a b',
      flags: ['print'],
    });
    expect(made[1]).toMatchObject({ pageIndex: 2, contents: 'c' });
    expect(made.every((a) => !('custom' in a))).toBe(true);
  });

  it('makes the markup without text when copying is denied (rule 9)', () => {
    for (const tool of ['underline', 'strikeout', 'squiggly'] as const) {
      const [a] = buildMarkups(tool, [nextPage], opts(null));
      expect(a).not.toHaveProperty('contents');
      expect(a).not.toHaveProperty('blendMode');
    }
  });

  it('Insert Text: a caret at the end of the last line', () => {
    const [caret, ...rest] = buildMarkups('insertText', [twoColumns], opts(['a b']));
    expect(rest).toEqual([]);
    expect(caret).toMatchObject({
      type: PdfAnnotationSubtype.CARET,
      intent: 'Insert',
      rect: caretRect(r(292, 116, 180, 12)),
    });
    expect(caret).not.toHaveProperty('contents');
    expect(caretRect(r(292, 116, 180, 12))).toEqual(r(469, 122, 6, 6));
  });

  it('Replace Text: a caret, and a strikeout grouped with it (/IRT, /RT /Group)', () => {
    const [caret, strike] = buildMarkups('replaceText', [twoColumns], opts(['old']));
    expect(caret).toMatchObject({
      type: PdfAnnotationSubtype.CARET,
      intent: 'Replace',
      id: 'id-1',
    });
    expect(strike).toMatchObject({
      type: PdfAnnotationSubtype.STRIKEOUT,
      intent: 'StrikeOutTextEdit',
      inReplyToId: 'id-1',
      replyType: PdfAnnotationReplyType.Group,
      segmentRects: twoColumns.segmentRects,
      contents: 'old',
    });
  });

  it('matches the selected text to pages, or repeats it when the counts differ', () => {
    expect(textsPerPage([twoColumns, nextPage], ['a', 'b'])).toEqual(['a', 'b']);
    expect(textsPerPage([twoColumns, nextPage], ['a'])).toEqual(['a', 'a']);
    expect(textsPerPage([twoColumns], undefined)).toBeNull();
  });

  it('knows its tools', () => {
    expect(isMarkupTool('squiggly')).toBe(true);
    expect(isMarkupTool('hand')).toBe(false);
  });
});
