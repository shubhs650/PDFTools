// M12-15 (D-62, Q16; the plan's question 1): the close-out list of the old
// revision. Each comment has a state: open, Addressed, Carried over, Changed
// differently (closed out here: Completed + an automatic reply + a grouped
// check highlight), or Completed some other way. Check marks are not listed.
import {
  PdfAnnotationReplyType,
  PdfAnnotationState as St,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype as S,
  PdfBlendMode,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import { buildCrsRows } from '../../src/features/crs/crsModel';
import { commentsOf } from '../../src/features/annotate/comments/commentsModel';
import { descendants } from '../../src/features/annotate/comments/thread';
import {
  canReopen,
  checkRect,
  closeOutParts,
  closeOutRows,
  counts,
  filterRows,
  isCheckMark,
  isCloseOutPart,
  outcomeOf,
  partIds,
  partsOf,
  type Outcome,
} from '../../src/features/compare/closeout/closeOutModel';

const rect = { origin: { x: 100, y: 200 }, size: { width: 40, height: 20 } };
const a = (o: Partial<PdfAnnotationObject> & { id: string; type?: S }) =>
  ({ type: S.TEXT, pageIndex: 0, rect, ...o }) as PdfAnnotationObject;
const d = (s: string) => new Date(s);

// Pair 19's old revision: four checker comments, a designer's reply, and see-through checks.
const OLD = [
  a({
    id: 'C1-cloud',
    type: S.POLYGON,
    author: 'R. Mehta',
    contents: 'C1: Use W360x51.',
    created: d('2026-09-10'),
  }),
  a({
    id: 'C2-cloud',
    type: S.POLYGON,
    author: 'R. Mehta',
    contents: 'C2: 1200x900.',
    created: d('2026-09-10T01:00:00Z'),
  }),
  a({
    id: 'C3-note',
    author: 'R. Mehta',
    contents: 'C3: Bay 2-3.',
    created: d('2026-09-10T02:00:00Z'),
  }),
  a({
    id: 'C4-note',
    author: 'R. Mehta',
    contents: 'C4: Spacing?',
    created: d('2026-09-10T03:00:00Z'),
  }),
  a({
    id: 'C4-reply',
    inReplyToId: 'C4-note',
    author: 'S. Kulkarni',
    contents: 'As shown.',
    created: d('2026-09-11'),
  }),
  a({
    id: 'K1',
    type: S.INK,
    author: 'R. Mehta',
    contents: 'Checked',
    blendMode: PdfBlendMode.Multiply,
  }),
  a({ id: 'K3', type: S.HIGHLIGHT, author: 'R. Mehta', contents: 'Checked' }),
  a({
    id: 'K4',
    type: S.SQUARE,
    author: 'R. Mehta',
    contents: 'Notes checked',
    opacity: 0.35,
  }),
];

let n = 0;
const uuid = () => `u${String(++n)}`;
const NOW = d('2026-11-23T10:00:00Z');

function close(
  all: PdfAnnotationObject[],
  id: string,
  outcome: Outcome,
  at = NOW,
): PdfAnnotationObject[] {
  const root = all.find((x) => x.id === id);
  if (!root) throw new Error(id);
  return [
    ...all,
    ...closeOutParts(root, outcome, {
      author: 'Reviewer',
      now: at,
      text: { state: 'Completed set by Reviewer', reply: `${outcome} in RevB.pdf` },
      colour: '#00ff00',
      uuid,
    }),
  ];
}

describe('the close-out list', () => {
  it('lists every comment of the old revision, not the check marks or replies', () => {
    const rows = closeOutRows(OLD);
    expect(rows.map((r) => r.id)).toEqual(['C1-cloud', 'C2-cloud', 'C3-note', 'C4-note']);
    expect(rows.every((r) => r.state === 'open')).toBe(true);
    // The Comments pane's numbers, so the list and the CRS agree.
    const nums = new Map(commentsOf(OLD).map((c) => [c.id, c.number]));
    for (const r of rows) expect(r.number).toBe(nums.get(r.id));
  });

  it('treats highlights, see-through and blended markups as check marks', () => {
    expect(isCheckMark(a({ id: 'h', type: S.HIGHLIGHT }))).toBe(true);
    expect(isCheckMark(a({ id: 'o', type: S.SQUARE, opacity: 0.5 } as never))).toBe(true);
    expect(
      isCheckMark(a({ id: 'b', type: S.INK, blendMode: PdfBlendMode.Multiply } as never)),
    ).toBe(true);
    expect(isCheckMark(a({ id: 'c', type: S.POLYGON, opacity: 1 } as never))).toBe(false);
  });

  it('closes a comment out: Completed, the automatic reply and a grouped check highlight', () => {
    const all = close(OLD, 'C1-cloud', 'addressed');
    const row = closeOutRows(all).find((r) => r.id === 'C1-cloud');
    expect(row?.state).toBe('addressed');
    expect(row?.status).toBe(St.Completed);
    expect(row?.checkId).toMatch(/^closeout-check-/u);
    const parts = partsOf(all, 'C1-cloud');
    expect(parts).toHaveLength(3);
    const state = parts.find(
      (p) => (p as { stateModel?: string }).stateModel === PdfAnnotationStateModel.Review,
    );
    expect((state as { state?: St }).state).toBe(St.Completed);
    const check = parts.find((p) => p.type === S.HIGHLIGHT) as PdfAnnotationObject & {
      replyType?: PdfAnnotationReplyType;
      opacity?: number;
      blendMode?: PdfBlendMode;
      segmentRects?: unknown[];
    };
    expect(check.replyType).toBe(PdfAnnotationReplyType.Group);
    expect(check.blendMode).toBe(PdfBlendMode.Multiply);
    expect(check.opacity).toBeLessThan(0.7);
    expect(check.rect).toEqual(checkRect(rect));
    expect(check.segmentRects).toEqual([checkRect(rect)]);
    // The highlight is not a comment of its own, and goes when the comment is deleted.
    expect(commentsOf(all).map((c) => c.id)).not.toContain(check.id);
    expect(descendants(all, 'C1-cloud')).toContain(check.id);
  });

  it("follows the owner's three cases (pair 19)", () => {
    let all = close(OLD, 'C1-cloud', 'addressed');
    all = close(all, 'C2-cloud', 'changed');
    all = close(all, 'C3-note', 'carried');
    all = close(all, 'C4-note', 'carried');
    const rows = closeOutRows(all);
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ['C1-cloud', 'addressed'],
      ['C2-cloud', 'changed'],
      ['C3-note', 'carried'],
      ['C4-note', 'carried'],
    ]);
    expect(counts(rows)).toEqual({ open: 0, closed: 4 });
  });

  it('shows a comment completed some other way, and reopens on a later status', () => {
    const done = [
      ...OLD,
      a({
        id: 's1',
        inReplyToId: 'C3-note',
        author: 'X',
        state: St.Completed,
        stateModel: PdfAnnotationStateModel.Review,
        created: d('2026-10-01'),
      }),
    ];
    expect(closeOutRows(done).find((r) => r.id === 'C3-note')?.state).toBe('completed');
    // Closed out, then set back to Accepted by hand: open again.
    const back = [
      ...close(OLD, 'C3-note', 'carried'),
      a({
        id: 's2',
        inReplyToId: 'C3-note',
        author: 'Reviewer',
        state: St.Accepted,
        stateModel: PdfAnnotationStateModel.Review,
        created: d('2026-11-24'),
      }),
    ];
    const row = closeOutRows(back).find((r) => r.id === 'C3-note');
    expect(row?.state).toBe('open');
    expect(row?.status).toBe(St.Accepted);
  });

  it('takes the latest close-out when a comment was closed out twice', () => {
    let all = close(OLD, 'C2-cloud', 'addressed', d('2026-11-23T10:00:00Z'));
    all = close(all, 'C2-cloud', 'changed', d('2026-11-23T11:00:00Z'));
    expect(closeOutRows(all).find((r) => r.id === 'C2-cloud')?.state).toBe('changed');
  });

  it('filters open and closed comments', () => {
    const rows = closeOutRows(close(OLD, 'C1-cloud', 'addressed'));
    expect(filterRows(rows, 'open').map((r) => r.id)).toEqual(['C2-cloud', 'C3-note', 'C4-note']);
    expect(filterRows(rows, 'closed').map((r) => r.id)).toEqual(['C1-cloud']);
    expect(filterRows(rows, 'all')).toHaveLength(4);
  });

  it('knows what Reopen takes away', () => {
    expect(canReopen(OLD, 'C1-cloud')).toBe(false);
    const all = close(OLD, 'C1-cloud', 'addressed');
    expect(canReopen(all, 'C1-cloud')).toBe(true);
    const left = all.filter((x) => !partsOf(all, 'C1-cloud').includes(x));
    expect(closeOutRows(left).find((r) => r.id === 'C1-cloud')?.state).toBe('open');
  });
});

describe('the parts by their /NM', () => {
  it('names each part and reads the outcome back', () => {
    const ids = partIds('carried', () => 'x');
    expect(ids).toEqual({
      state: 'closeout-state-x',
      reply: 'closeout-carried-x',
      check: 'closeout-check-x',
    });
    expect(outcomeOf({ id: ids.reply })).toBe('carried');
    expect(outcomeOf({ id: ids.state })).toBeNull();
    expect(outcomeOf({ id: 'C1-cloud' })).toBeNull();
    expect(isCloseOutPart({ id: ids.check })).toBe(true);
    expect(isCloseOutPart({ id: 'C1-cloud' })).toBe(false);
  });
});

describe('the states in the CRS export', () => {
  it('shows Completed in Status and the automatic reply in Replies', () => {
    let all = close(OLD, 'C1-cloud', 'addressed');
    all = close(all, 'C3-note', 'carried');
    const rows = buildCrsRows(all, {
      typeLabel: (x) => x.type.toString(),
      statusLabel: (s) => (s === St.Completed ? 'Completed' : (s ?? '')),
      date: (x) => x.toISOString().slice(0, 10),
      discipline: () => '',
      noAuthor: 'Anonymous',
    });
    const byText = (t: string) => rows.find((r) => r.comment.includes(t));
    expect(byText('C1:')?.status).toBe('Completed');
    expect(byText('C1:')?.replies).toContain('addressed in RevB.pdf');
    expect(byText('C3:')?.replies).toContain('carried in RevB.pdf');
    expect(byText('C2:')?.status).toBe('');
    // The check highlight is part of its comment, not a row of its own.
    expect(rows.some((r) => r.id.startsWith('closeout-'))).toBe(false);
  });
});
