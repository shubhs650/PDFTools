// M4-14 (§7.7): Review & Extract's tables — proposals, accept, adjust, draw,
// delete, and the mode's own undo/redo.
import { describe, expect, it } from 'vitest';
import { makeGrid, moveCol } from '../../src/model/tableGrid';
import {
  emptyReview,
  ordered,
  review,
  type ReviewDoc,
} from '../../src/features/tables/reviewModel';

const A = makeGrid(0, [50, 500, 300, 700], 3, 4, 'lattice');
const B = makeGrid(0, [320, 500, 550, 700], 2, 4, 'stream');
const C = makeGrid(1, [50, 100, 300, 300], 2, 2);

function detected(): ReviewDoc {
  return review(emptyReview(), { type: 'detected', page: 0, grids: [A, B], ids: ['a', 'b'] });
}

describe('review model', () => {
  it('detection proposes tables (not accepted, not an undo step) and skips overlaps', () => {
    let d = detected();
    expect(d.tables.map((t) => [t.id, t.accepted])).toEqual([
      ['a', false],
      ['b', false],
    ]);
    expect(d.past).toEqual([]);
    d = review(d, { type: 'detected', page: 0, grids: [A, C], ids: ['a2', 'c'] });
    expect(d.tables.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('accept, adjust (accepts), delete, draw — each one undo step; redo; new edit clears redo', () => {
    let d = detected();
    d = review(d, { type: 'accept', id: 'a', accepted: true });
    d = review(d, { type: 'edit', id: 'b', grid: moveCol(B, 1, 420) });
    expect(d.tables.find((t) => t.id === 'b')?.accepted).toBe(true);
    d = review(d, { type: 'remove', id: 'a' });
    d = review(d, { type: 'add', table: { id: 'm', grid: C, accepted: true } });
    expect(d.tables.map((t) => t.id)).toEqual(['b', 'm']);
    expect(d.past).toHaveLength(4);
    d = review(d, { type: 'undo' });
    d = review(d, { type: 'undo' });
    expect(d.tables.map((t) => t.id)).toEqual(['a', 'b']);
    d = review(d, { type: 'redo' });
    expect(d.tables.map((t) => t.id)).toEqual(['b']);
    d = review(d, { type: 'add', table: { id: 'n', grid: C, accepted: false } });
    expect(d.future).toEqual([]);
    d = review(d, { type: 'undo' });
    d = review(d, { type: 'undo' });
    d = review(d, { type: 'undo' });
    expect(d.tables.find((t) => t.id === 'b')?.grid).toEqual(B);
  });

  it('no-op actions add no undo step; Accept All accepts every table', () => {
    expect(review(detected(), { type: 'acceptAll' }).tables.every((t) => t.accepted)).toBe(true);
    let d = detected();
    d = review(d, { type: 'edit', id: 'a', grid: A });
    d = review(d, { type: 'accept', id: 'a', accepted: false });
    d = review(d, { type: 'remove', id: 'x' });
    d = review(d, { type: 'undo' });
    expect(d).toEqual(detected());
  });

  it('adds several tables (a template applied) as one undo step', () => {
    let d = review(emptyReview(), {
      type: 'addMany',
      tables: [
        { id: 'x', grid: A, accepted: true },
        { id: 'y', grid: C, accepted: true },
      ],
    });
    expect(d.tables).toHaveLength(2);
    expect(review(d, { type: 'addMany', tables: [] })).toBe(d);
    d = review(d, { type: 'undo' });
    expect(d.tables).toEqual([]);
  });

  it('orders tables by page, then top to bottom, then left to right', () => {
    const d = review(detected(), { type: 'add', table: { id: 'c', grid: C, accepted: false } });
    expect(ordered([...d.tables].reverse()).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});
