// M6-11: where the pane's remembered bookmarks (expanded, focused) are after
// an edit must be where the Work worker's writer put them. Checked against the
// writer's own applyEdit on a small tree for every edit kind and position.
import { describe, expect, it } from 'vitest';
import {
  dropEdit,
  focusAfterDelete,
  moveTarget,
  movesSomething,
  nudgeEdit,
  remapPath,
} from '../../src/features/bookmarks/outlineEdit';
import { pathKey, type OutlineEdit, type OutlineItem } from '../../src/model/outline';
import { PdfString } from '../../src/model/pdf/objects';
import { applyEdit, type Node } from '../../src/workers/work/outline';

/** A — A1 (A1a, A1b), A2; B; C — C1. */
const SHAPE: [string, [string, string[]][]][] = [
  [
    'A',
    [
      ['A1', ['A1a', 'A1b']],
      ['A2', []],
    ],
  ],
  ['B', []],
  ['C', [['C1', []]]],
];

function nodes(): Node[] {
  const n = (title: string, kids: Node[] = []): Node => ({
    num: null,
    gen: 0,
    dict: new Map([['Title', PdfString.of(title)]]),
    orig: null,
    kids,
  });
  return SHAPE.map(([t, kids]) =>
    n(
      t,
      kids.map(([k, g]) =>
        n(
          k,
          g.map((x) => n(x)),
        ),
      ),
    ),
  );
}

const items = (list: Node[]): OutlineItem[] =>
  list.map((n) => ({
    title: (n.dict.get('Title') as PdfString).text(),
    target: undefined,
    action: null,
    color: null,
    bold: false,
    italic: false,
    open: false,
    children: items(n.kids),
  }));

/** Every title with its path. */
function paths(list: Node[], parent: number[] = []): Map<string, string> {
  const out = new Map<string, string>();
  list.forEach((n, i) => {
    const p = [...parent, i];
    out.set((n.dict.get('Title') as PdfString).text(), pathKey(p));
    for (const [k, v] of paths(n.kids, p)) out.set(k, v);
  });
  return out;
}

const NEW = { title: 'N', dest: null };

/** Every edit worth checking on SHAPE. */
function edits(): OutlineEdit[] {
  const all: OutlineEdit[] = [];
  const at = [[], [0], [0, 0], [2]];
  for (const parent of at)
    for (let index = 0; index <= 3; index++)
      all.push({ kind: 'insert', parent, index, items: [NEW, NEW] });
  const each = [[0], [0, 0], [0, 0, 1], [0, 1], [1], [2], [2, 0]];
  for (const path of each)
    for (const mode of ['all', 'keepChildren', 'onlyChildren'] as const)
      all.push({ kind: 'remove', path, mode });
  for (const path of each)
    for (const parent of [[], [0], [0, 0], [1], [2], [2, 0]])
      for (let index = 0; index <= 3; index++) all.push({ kind: 'move', path, parent, index });
  return all;
}

describe('remapPath agrees with the writer (M6-11)', () => {
  it('for inserts, every delete and every move', () => {
    let checked = 0;
    for (const edit of edits()) {
      const before = nodes();
      const old = paths(before);
      const childCount = edit.kind === 'remove' ? remapCount(before, edit.path) : 0;
      const after = nodes();
      try {
        applyEdit(after, edit, []);
      } catch {
        continue; // refused (a bad position, a move into itself)
      }
      const now = paths(after);
      for (const [title, key] of old) {
        const want = now.get(title) ?? null;
        const got = remapPath(edit, key.split('.').map(Number), childCount);
        expect(got === null ? null : pathKey(got), `${JSON.stringify(edit)} ${title}`).toBe(want);
        checked++;
      }
      if (edit.kind === 'move') {
        const to = moveTarget(edit);
        const moved = [...old].find(([, k]) => k === pathKey(edit.path))?.[0] ?? '';
        expect(pathKey([...to.parent, to.index]), JSON.stringify(edit)).toBe(now.get(moved));
      }
    }
    expect(checked).toBeGreaterThan(900);
  });
});

function remapCount(list: Node[], path: number[]): number {
  let cur: Node | undefined;
  let l = list;
  for (const i of path) {
    cur = l[i];
    l = cur?.kids ?? [];
  }
  return cur?.kids.length ?? 0;
}

describe('the moves the pane makes', () => {
  const tree = items(nodes());

  it('drops before, after and inside; never into itself; nothing for a no-op', () => {
    expect(dropEdit(tree, [1], [0], 'before')).toEqual({
      kind: 'move',
      path: [1],
      parent: [],
      index: 0,
    });
    expect(dropEdit(tree, [1], [2], 'inside')).toEqual({
      kind: 'move',
      path: [1],
      parent: [2],
      index: 1,
    });
    expect(dropEdit(tree, [0], [0, 1], 'inside')).toBeNull();
    expect(dropEdit(tree, [0], [0], 'before')).toBeNull();
    expect(dropEdit(tree, [0], [1], 'before')).toBeNull(); // A is already before B
    expect(dropEdit(tree, [0], [1], 'after')).toEqual({
      kind: 'move',
      path: [0],
      parent: [],
      index: 2,
    });
  });

  it('nudges up, down, out of the parent and into the one above', () => {
    expect(nudgeEdit(tree, [0], 'up')).toBeNull();
    expect(nudgeEdit(tree, [1], 'up')).toEqual({ kind: 'move', path: [1], parent: [], index: 0 });
    expect(nudgeEdit(tree, [1], 'down')).toEqual({ kind: 'move', path: [1], parent: [], index: 3 });
    expect(nudgeEdit(tree, [2], 'down')).toBeNull();
    expect(nudgeEdit(tree, [0, 1], 'promote')).toEqual({
      kind: 'move',
      path: [0, 1],
      parent: [],
      index: 1,
    });
    expect(nudgeEdit(tree, [1], 'promote')).toBeNull();
    expect(nudgeEdit(tree, [1], 'demote')).toEqual({
      kind: 'move',
      path: [1],
      parent: [0],
      index: 2,
    });
    expect(nudgeEdit(tree, [0], 'demote')).toBeNull();
    for (const how of ['up', 'down', 'promote', 'demote'] as const) {
      const e = nudgeEdit(tree, [0, 1], how);
      if (e?.kind === 'move') expect(movesSomething(e)).toBe(true);
    }
    // Down: the item lands one further (index counted before it is taken out).
    const down = nudgeEdit(tree, [1], 'down');
    if (down?.kind !== 'move') throw new Error('move');
    expect(moveTarget(down)).toEqual({ parent: [], index: 2 });
  });

  it('gives focus to the next bookmark after a delete, else the one above, else the parent', () => {
    expect(focusAfterDelete(tree, [0])).toEqual([0]);
    expect(focusAfterDelete(tree, [2])).toEqual([1]);
    expect(focusAfterDelete(tree, [2, 0])).toEqual([2]);
    expect(focusAfterDelete(tree, [0, 0, 1])).toEqual([0, 0, 0]);
  });
});
