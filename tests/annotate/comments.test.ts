import { PdfAnnotationSubtype as S, type PdfAnnotationObject } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  buildRows,
  commentsOf,
  numberComments,
  type CommentFilter,
} from '../../src/features/annotate/comments/commentsModel';

let n = 0;
const a = (o: Partial<PdfAnnotationObject> & { type: S }): PdfAnnotationObject =>
  ({
    id: `id-${String(++n)}`,
    pageIndex: 0,
    rect: { origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
    ...o,
  }) as PdfAnnotationObject;

const d = (s: string) => new Date(s);

describe('auto-numbering (M3-Q5)', () => {
  it('numbers by page, then creation date, then /NM; replies, links and popups excluded', () => {
    const list = [
      a({ id: 'p2', type: S.SQUARE, pageIndex: 1, created: d('2026-01-01') }),
      a({ id: 'late', type: S.TEXT, pageIndex: 0, created: d('2026-03-01') }),
      a({ id: 'early-b', type: S.HIGHLIGHT, pageIndex: 0, created: d('2026-02-01') }),
      a({ id: 'early-a', type: S.INK, pageIndex: 0, created: d('2026-02-01') }),
      a({ id: 'nodate', type: S.LINE, pageIndex: 0, modified: d('2026-01-15') }),
      a({ id: 'none', type: S.CIRCLE, pageIndex: 0 }),
      a({ id: 'reply', type: S.TEXT, pageIndex: 0, inReplyToId: 'late' }),
      a({ id: 'link', type: S.LINK, pageIndex: 0 }),
      a({ id: 'pop', type: S.POPUP, pageIndex: 0 }),
      a({ id: 'field', type: S.WIDGET, pageIndex: 0 }),
    ];
    const nums = numberComments(list);
    expect([...nums.entries()]).toEqual([
      ['nodate', 1],
      ['early-a', 2],
      ['early-b', 3],
      ['late', 4],
      ['none', 5], // no date: after the dated ones on its page
      ['p2', 6],
    ]);
  });

  it('renumbers the rest after a delete, and is stable otherwise', () => {
    const list = [
      a({ id: 'x', type: S.SQUARE, created: d('2026-01-01') }),
      a({ id: 'y', type: S.SQUARE, created: d('2026-01-02') }),
      a({ id: 'z', type: S.SQUARE, created: d('2026-01-03') }),
    ];
    expect(numberComments([...list].reverse()).get('z')).toBe(3);
    expect(numberComments(list.filter((o) => o.id !== 'x')).get('z')).toBe(2);
  });
});

describe('comments list (M3-11)', () => {
  const list = [
    a({
      id: 'c1',
      type: S.SQUARE,
      pageIndex: 0,
      author: 'Ana',
      contents: 'Move\nthis',
      created: d('2026-01-01'),
    }),
    a({ id: 'c2', type: S.HIGHLIGHT, pageIndex: 0, author: 'Bo', created: d('2026-01-02') }),
    a({ id: 'c3', type: S.TEXT, pageIndex: 2, author: 'Ana', created: d('2026-01-03') }),
    a({ id: 'r1', type: S.TEXT, pageIndex: 0, author: 'Bo', inReplyToId: 'c1' }),
    a({ id: 'r2', type: S.TEXT, pageIndex: 0, author: 'Cy', inReplyToId: 'c1' }),
  ];

  it('turns annotations into comments with number, first line and reply count', () => {
    const cs = commentsOf(list);
    expect(cs.map((c) => [c.id, c.number, c.firstLine, c.replies])).toEqual([
      ['c1', 1, 'Move', 2],
      ['c2', 2, '', 0],
      ['c3', 3, '', 0],
    ]);
  });

  it('groups by page with headers; filters combine', () => {
    const all: CommentFilter = {};
    expect(
      buildRows(commentsOf(list), all, 'page').map((r) =>
        r.kind === 'page' ? `p${String(r.page)}:${String(r.count)}` : r.comment.id,
      ),
    ).toEqual(['p0:2', 'c1', 'c2', 'p2:1', 'c3']);
    const ana = buildRows(commentsOf(list), { authors: ['Ana'] }, 'page');
    expect(ana.flatMap((r) => (r.kind === 'comment' ? [r.comment.id] : []))).toEqual(['c1', 'c3']);
    const pageAndType = buildRows(
      commentsOf(list),
      { authors: ['Ana'], types: [S.TEXT], pages: [2, 2] },
      'page',
    );
    expect(pageAndType.map((r) => r.kind)).toEqual(['page', 'comment']);
  });

  it('sorts by date (newest first), author or type without page headers', () => {
    const byDate = buildRows(commentsOf(list), {}, 'date').map(
      (r) => r.kind === 'comment' && r.comment.id,
    );
    expect(byDate).toEqual(['c3', 'c2', 'c1']);
    const byAuthor = buildRows(commentsOf(list), {}, 'author').map(
      (r) => r.kind === 'comment' && r.comment.id,
    );
    expect(byAuthor).toEqual(['c1', 'c3', 'c2']);
  });
});
