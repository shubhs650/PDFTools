// M6-09 (ADR-021 D-38 c): what a flatten draws, removes and keeps. Pure.
import { PdfAnnotationReplyType, PdfAnnotationSubtype as S } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  planFlatten,
  planPages,
  type FlattenAnnot,
} from '../../src/features/annotate/flatten/flattenModel';

const A = (o: Partial<FlattenAnnot> & Pick<FlattenAnnot, 'id'>): FlattenAnnot => ({
  pageIndex: 0,
  type: S.SQUARE,
  flags: ['print'],
  ...o,
});

const ALL: FlattenAnnot[] = [
  A({ id: 'red' }),
  A({ id: 'reply', type: S.TEXT, inReplyToId: 'red' }),
  A({ id: 'reply2', type: S.TEXT, inReplyToId: 'reply' }),
  A({ id: 'state', type: S.TEXT, inReplyToId: 'red', stateModel: 'Review' }),
  A({ id: 'blue' }),
  A({ id: 'group', inReplyToId: 'blue', replyType: PdfAnnotationReplyType.Group }),
  A({ id: 'link', type: S.LINK }),
  A({ id: 'widget', type: S.WIDGET }),
  A({ id: 'redact', type: S.REDACT }),
  A({ id: 'popup', type: S.POPUP }),
  A({ id: 'locked', flags: ['print', 'locked'] }),
  A({ id: 'hidden', flags: ['hidden'] }),
  A({ id: 'noview', flags: ['noView'] }),
  A({ id: 'oval', pageIndex: 1, type: S.CIRCLE }),
  // A reply whose comment is gone counts as a comment (as in the Comments pane).
  A({ id: 'orphan', pageIndex: 2, type: S.TEXT, inReplyToId: 'gone' }),
];

describe('planFlatten', () => {
  it('all pages: comments flattened with their groups; replies and states removed; links, fields, pop-ups and redaction marks untouched', () => {
    const plan = planFlatten(ALL, { scope: { kind: 'pages', pages: null }, keepReplies: false });
    expect(plan.comments).toBe(4);
    expect(plan.locked).toBe(1);
    expect(plan.hidden).toBe(2);
    expect(plan.pages).toEqual([
      {
        page: 0,
        flatten: ['red', 'blue', 'group'],
        remove: ['reply', 'reply2', 'state'],
        unlink: [],
      },
      { page: 1, flatten: ['oval'], remove: [], unlink: [] },
      { page: 2, flatten: ['orphan'], remove: [], unlink: [] },
    ]);
    expect(planPages(plan)).toEqual([0, 1, 2]);
  });

  it('keep replies: direct replies lose their link and stay, their own replies with them; states still go', () => {
    const plan = planFlatten(ALL, { scope: { kind: 'pages', pages: [0] }, keepReplies: true });
    expect(plan.pages).toEqual([
      { page: 0, flatten: ['red', 'blue', 'group'], remove: ['state'], unlink: ['reply'] },
    ]);
  });

  it('a page range and the current page', () => {
    const plan = planFlatten(ALL, { scope: { kind: 'pages', pages: [1, 2] }, keepReplies: false });
    expect(plan.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(plan.comments).toBe(2);
    expect(plan.locked).toBe(0);
    const none = planFlatten(ALL, { scope: { kind: 'pages', pages: [5] }, keepReplies: false });
    expect(none).toEqual({ pages: [], comments: 0, locked: 0, hidden: 0 });
  });

  it('selected: a selected reply or group part stands for its comment; each comment once', () => {
    const plan = planFlatten(ALL, {
      scope: { kind: 'selected', ids: ['reply2', 'red', 'group', 'nope'] },
      keepReplies: false,
    });
    expect(plan.comments).toBe(2);
    expect(plan.pages[0]?.flatten).toEqual(['red', 'blue', 'group']);
  });

  it('selected: locked, hidden and non-comments are not flattened', () => {
    const plan = planFlatten(ALL, {
      scope: { kind: 'selected', ids: ['locked', 'hidden', 'link', 'redact'] },
      keepReplies: false,
    });
    expect(plan).toEqual({ pages: [], comments: 0, locked: 1, hidden: 1 });
  });

  it('a hidden group part is removed, not drawn; reply cycles end', () => {
    const plan = planFlatten(
      [
        A({ id: 'a' }),
        A({
          id: 'g',
          inReplyToId: 'a',
          replyType: PdfAnnotationReplyType.Group,
          flags: ['hidden'],
        }),
        A({ id: 'x', type: S.TEXT, inReplyToId: 'y' }),
        A({ id: 'y', type: S.TEXT, inReplyToId: 'x' }),
      ],
      { scope: { kind: 'selected', ids: ['a', 'x'] }, keepReplies: false },
    );
    expect(plan.pages[0]?.flatten).toContain('a');
    expect(plan.pages[0]?.remove).toContain('g');
    expect(plan.pages[0]?.flatten).not.toContain('g');
  });

  it('a reply on another page than its comment is handled on its own page', () => {
    const plan = planFlatten(
      [A({ id: 'a' }), A({ id: 'r', type: S.TEXT, pageIndex: 1, inReplyToId: 'a' })],
      { scope: { kind: 'pages', pages: [0] }, keepReplies: false },
    );
    expect(plan.pages).toEqual([
      { page: 0, flatten: ['a'], remove: [], unlink: [] },
      { page: 1, flatten: [], remove: ['r'], unlink: [] },
    ]);
  });
});
