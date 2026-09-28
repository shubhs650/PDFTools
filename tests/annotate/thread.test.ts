import {
  PdfAnnotationState as St,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype as S,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import { commentsOf } from '../../src/features/annotate/comments/commentsModel';
import {
  buildThread,
  descendants,
  makeReply,
  makeState,
} from '../../src/features/annotate/comments/thread';

const rect = { origin: { x: 10, y: 20 }, size: { width: 30, height: 40 } };
const a = (o: Partial<PdfAnnotationObject> & { id: string; type?: S }) =>
  ({ type: S.TEXT, pageIndex: 0, rect, ...o }) as PdfAnnotationObject;
const d = (s: string) => new Date(s);
const state = (id: string, parent: string, author: string, s: St, at: string) =>
  a({
    id,
    inReplyToId: parent,
    author,
    created: d(at),
    state: s,
    stateModel: PdfAnnotationStateModel.Review,
  });

const doc = [
  a({ id: 'root', type: S.SQUARE, author: 'Ana', contents: 'Move it', created: d('2026-01-01') }),
  a({ id: 'r2', inReplyToId: 'root', author: 'Cy', contents: 'Later', created: d('2026-01-03') }),
  a({ id: 'r1', inReplyToId: 'root', author: 'Bo', contents: 'Why?', created: d('2026-01-02') }),
  a({
    id: 'r1a',
    inReplyToId: 'r1',
    author: 'Ana',
    contents: 'Clash',
    created: d('2026-01-02T12:00:00Z'),
  }),
  state('s1', 'root', 'Bo', St.Rejected, '2026-01-04'),
  state('s2', 'root', 'Bo', St.Accepted, '2026-01-05'),
  state('s3', 'root', 'Cy', St.Completed, '2026-01-04'),
  a({ id: 'orphan', inReplyToId: 'gone', author: 'Dee', contents: 'Lost parent' }),
];

describe('reply threads (M3-12)', () => {
  it('orders replies by date, nested under their parent reply', () => {
    const t = buildThread(doc, 'root');
    expect(t.replies.map((e) => [e.annot.id, e.depth])).toEqual([
      ['r1', 0],
      ['r1a', 1],
      ['r2', 0],
    ]);
  });

  it('keeps the latest state per author, and the history', () => {
    const t = buildThread(doc, 'root');
    expect(t.states).toEqual([
      { author: 'Bo', state: St.Accepted, date: d('2026-01-05') },
      { author: 'Cy', state: St.Completed, date: d('2026-01-04') },
    ]);
    expect(t.history.map((h) => h.id)).toEqual(['s1', 's3', 's2']);
  });

  it('lists a reply whose parent is gone as a comment of its own', () => {
    expect(commentsOf(doc).map((c) => c.id)).toEqual(['root', 'orphan']);
    expect(commentsOf(doc)[0]?.replies).toBe(2); // direct replies, states excluded
  });

  it('finds everything under a comment (for delete)', () => {
    expect(descendants(doc, 'root').sort()).toEqual(['r1', 'r1a', 'r2', 's1', 's2', 's3']);
    expect(descendants(doc, 'r2')).toEqual([]);
  });

  it('makes replies and states as standard Text annotations with /IRT', () => {
    const now = d('2026-02-01');
    const [parent] = doc;
    if (!parent) throw new Error('fixture');
    expect(makeReply(parent, 'Done', 'Ana', now, 'new')).toEqual({
      type: S.TEXT,
      id: 'new',
      pageIndex: 0,
      rect,
      inReplyToId: 'root',
      contents: 'Done',
      author: 'Ana',
      created: now,
      modified: now,
      flags: ['print', 'noZoom', 'noRotate'],
      strokeColor: '#FFE14D',
      opacity: 1,
    });
    expect(makeState(parent, St.Accepted, 'Ana', 'Accepted set by Ana', now, 'st')).toMatchObject({
      type: S.TEXT,
      inReplyToId: 'root',
      state: St.Accepted,
      stateModel: PdfAnnotationStateModel.Review,
      contents: 'Accepted set by Ana',
      flags: ['hidden', 'print', 'noZoom', 'noRotate'],
    });
  });
});
