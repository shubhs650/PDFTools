import {
  PdfAnnotationState,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype as S,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  commentsOf,
  groupKeys,
  isFiltered,
  layoutComments,
  matches,
  numberComments,
  type CommentFilter,
  type CommentRow,
  type CommentSort,
} from '../../src/features/annotate/comments/commentsModel';
import { buildThread, childrenOf } from '../../src/features/annotate/comments/thread';

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

  const ids = (rows: CommentRow[]) =>
    rows.map((r) =>
      r.kind === 'group'
        ? `${r.key}:${String(r.count)}${r.collapsed ? '-' : ''}`
        : r.kind === 'comment'
          ? r.comment.id
          : `  ${r.reply.id}`,
    );

  it('groups by page with headers; filters combine', () => {
    const all: CommentFilter = {};
    expect(ids(layoutComments(commentsOf(list), all, 'page').rows)).toEqual([
      'g:page:0:2',
      'c1',
      'c2',
      'g:page:2:1',
      'c3',
    ]);
    const ana = layoutComments(commentsOf(list), { authors: ['Ana'] }, 'page');
    expect(ana.order.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(ana.shown).toBe(2);
    const pageAndType = layoutComments(
      commentsOf(list),
      { authors: ['Ana'], types: [S.TEXT], pages: [2, 2] },
      'page',
    );
    expect(pageAndType.rows.map((r) => r.kind)).toEqual(['group', 'comment']);
  });

  it('sorts by date (newest first), author or type inside the groups, or without groups', () => {
    const flat = (sort: CommentSort) =>
      ids(layoutComments(commentsOf(list), {}, sort, { group: 'none' }).rows);
    expect(flat('date')).toEqual(['c3', 'c2', 'c1']);
    expect(flat('author')).toEqual(['c1', 'c3', 'c2']);
    expect(flat('type')).toEqual(['c3', 'c1', 'c2']); // Text (1) < Square (5) < Highlight (9)
    // Inside page groups: page 0 newest first.
    expect(ids(layoutComments(commentsOf(list), {}, 'date').rows)).toEqual([
      'g:page:0:2',
      'c2',
      'c1',
      'g:page:2:1',
      'c3',
    ]);
  });

  it('groups by author, type or status; the order of groups is stable', () => {
    const cs = commentsOf(list);
    expect(ids(layoutComments(cs, {}, 'page', { group: 'author' }).rows)).toEqual([
      'g:author:Ana:2',
      'c1',
      'c3',
      'g:author:Bo:1',
      'c2',
    ]);
    expect(
      layoutComments(cs, {}, 'page', { group: 'type' })
        .rows.filter((r) => r.kind === 'group')
        .map((r) => r.key),
    ).toEqual([
      'g:type:annotate.type.highlight',
      'g:type:annotate.type.note',
      'g:type:annotate.type.rectangle',
    ]);
    const withStatus = commentsOf([
      ...list,
      a({
        id: 's1',
        type: S.TEXT,
        inReplyToId: 'c2',
        state: PdfAnnotationState.Accepted,
        stateModel: PdfAnnotationStateModel.Review,
        created: d('2026-02-01'),
      }),
    ]);
    expect(ids(layoutComments(withStatus, {}, 'page', { group: 'status' }).rows)).toEqual([
      'g:status:none:2',
      'c1',
      'c3',
      'g:status:Accepted:1',
      'c2',
    ]);
  });

  it('puts each card’s replies after it, nested ones deeper; collapsed groups hide their cards', () => {
    const all = [
      ...list,
      a({ id: 'r3', type: S.TEXT, author: 'Ana', inReplyToId: 'r1', created: d('2026-01-05') }),
    ];
    const kids = childrenOf(all);
    const repliesOf = (id: string) => buildThread(all, id, kids).replies;
    const layout = layoutComments(commentsOf(all), {}, 'page', { repliesOf });
    expect(ids(layout.rows)).toEqual([
      'g:page:0:2',
      'c1',
      '  r1',
      '  r3',
      '  r2',
      'c2',
      'g:page:2:1',
      'c3',
    ]);
    const depth = layout.rows.flatMap((r) =>
      r.kind === 'reply' ? [[r.reply.id, r.depth, r.last]] : [],
    );
    expect(depth).toEqual([
      ['r1', 0, false],
      ['r3', 1, false],
      ['r2', 0, true],
    ]);
    const card = layout.rows.find((r) => r.kind === 'comment' && r.comment.id === 'c1');
    expect(card?.kind === 'comment' && card.replies).toBe(3);

    const folded = layoutComments(commentsOf(all), {}, 'page', {
      repliesOf,
      collapsed: new Set(['page:0']),
    });
    expect(ids(folded.rows)).toEqual(['g:page:0:2-', 'g:page:2:1', 'c3']);
    // Previous / Next still walk every comment shown, the collapsed ones too.
    expect(folded.order.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(folded.groupOf.get('c2')).toBe('page:0');
    expect(groupKeys(folded)).toEqual(['page:0', 'page:2']);
  });
});

describe('Find (M6-05, rule 3: applied on Enter)', () => {
  const list = [
    a({ id: 'f1', type: S.SQUARE, author: 'Ana', contents: 'Check the WELD size' }),
    a({ id: 'f2', type: S.SQUARE, author: 'Bo', contents: 'Pump', subject: 'Clearance' }),
    a({ id: 'f3', type: S.TEXT, author: 'Cy', contents: 'Valve' }),
    a({ id: 'f4', type: S.TEXT, author: 'Di', contents: 'Agreed, weld it', inReplyToId: 'f3' }),
  ];
  const found = (text: string) =>
    layoutComments(commentsOf(list), { text }, 'page', { group: 'none' }).order.map((c) => c.id);

  it('matches text, author, subject and replies, ignoring case; every word must match', () => {
    expect(found('weld')).toEqual(['f1', 'f3']); // f3 through its reply
    expect(found('bo')).toEqual(['f2']);
    expect(found('clearance')).toEqual(['f2']);
    expect(found('weld size')).toEqual(['f1']);
    expect(found('nothing here')).toEqual([]);
    expect(found('   ')).toEqual(['f1', 'f2', 'f3']);
  });

  it('counts as a filter only when it has words; combines with the others', () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ text: '  ' })).toBe(false);
    expect(isFiltered({ text: 'x' })).toBe(true);
    expect(isFiltered({ authors: [] })).toBe(false);
    expect(isFiltered({ pages: [0, 0] })).toBe(true);
    const cs = commentsOf(list);
    expect(
      cs.filter((c) => matches(c, { text: 'weld', authors: ['Cy'] })).map((c) => c.id),
    ).toEqual(['f3']);
  });

  it('marks locked comments', () => {
    const cs = commentsOf([a({ id: 'l', type: S.SQUARE, flags: ['print', 'locked'] })]);
    expect(cs[0]?.locked).toBe(true);
  });
});
