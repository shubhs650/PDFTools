// Bookmark edits as the pane sees them (M6-11, §7.15): which edit a command
// or a drop makes, and where every bookmark the pane remembers (expanded
// branches, the focused one) is afterwards, so the tree looks the same after
// the outline was read again. Paths are index paths ([2, 0]); the Work
// worker applies the same edits to the outline objects (outline.ts). Pure.
import {
  itemAt,
  within,
  type OutlineEdit,
  type OutlineItem,
  type OutlinePath,
} from '../../model/outline';

const parentOf = (p: OutlinePath): OutlinePath => p.slice(0, -1);
const last = (p: OutlinePath): number => p[p.length - 1] ?? 0;

const same = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** `path` with its index under `parent` moved by `by` when it is at `from` or later. */
function shift(path: OutlinePath, parent: OutlinePath, from: number, by: number): OutlinePath {
  if (path.length <= parent.length || !within(path, parent)) return path;
  const i = path[parent.length] ?? 0;
  if (i < from) return path;
  const out = path.slice();
  out[parent.length] = i + by;
  return out;
}

/** Where `path` is after the item at `x` (and everything in it) left. Null: it went with it. */
function afterRemoval(path: OutlinePath, x: OutlinePath): OutlinePath | null {
  if (within(path, x)) return null;
  return shift(path, parentOf(x), last(x) + 1, -1);
}

/** Where a moved item lands: its new parent's path and its index there (after the move). */
export function moveTarget(edit: Extract<OutlineEdit, { kind: 'move' }>): {
  parent: OutlinePath;
  index: number;
} {
  const x = last(edit.path);
  const at = same(parentOf(edit.path), edit.parent) && edit.index > x ? edit.index - 1 : edit.index;
  return { parent: afterRemoval(edit.parent, edit.path) ?? edit.parent, index: at };
}

/**
 * Where the bookmark at `path` is after `edit` (null: it is gone).
 * `childCount`: the number of children of the item a "delete but retain
 * children" removes (they move up into its place).
 */
export function remapPath(
  edit: OutlineEdit,
  path: OutlinePath,
  childCount = 0,
): OutlinePath | null {
  switch (edit.kind) {
    case 'update':
      return path;
    case 'insert':
      return shift(path, edit.parent, edit.index, edit.items.length);
    case 'remove': {
      const x = edit.path;
      if (edit.mode === 'all') return afterRemoval(path, x);
      if (edit.mode === 'onlyChildren')
        return path.length > x.length && within(path, x) ? null : path;
      // keepChildren: the item goes, its children take its place.
      if (same(path, x)) return null;
      if (within(path, x)) {
        const k = path[x.length] ?? 0;
        return [...parentOf(x), last(x) + k, ...path.slice(x.length + 1)];
      }
      return shift(path, parentOf(x), last(x) + 1, childCount - 1);
    }
    case 'move': {
      const { parent, index } = moveTarget(edit);
      if (within(path, edit.path)) return [...parent, index, ...path.slice(edit.path.length)];
      const p = afterRemoval(path, edit.path);
      return p ? shift(p, parent, index, 1) : null;
    }
  }
}

/** The move a drop makes (null: not allowed, or nothing would change). */
export function dropEdit(
  items: readonly OutlineItem[],
  dragged: OutlinePath,
  onto: OutlinePath,
  where: 'before' | 'after' | 'inside',
): OutlineEdit | null {
  if (within(onto, dragged)) return null;
  const edit: OutlineEdit =
    where === 'inside'
      ? {
          kind: 'move',
          path: dragged,
          parent: onto,
          index: itemAt(items, onto)?.children.length ?? 0,
        }
      : {
          kind: 'move',
          path: dragged,
          parent: parentOf(onto),
          index: last(onto) + (where === 'after' ? 1 : 0),
        };
  return movesSomething(edit) ? edit : null;
}

/** False when a move leaves the item where it is. */
export function movesSomething(edit: Extract<OutlineEdit, { kind: 'move' }>): boolean {
  const { parent, index } = moveTarget(edit);
  return !same([...parent, index], edit.path);
}

export type Nudge = 'up' | 'down' | 'promote' | 'demote';

/** Move up / down among its siblings, promote (out of its parent), demote (into the one above). */
export function nudgeEdit(
  items: readonly OutlineItem[],
  path: OutlinePath,
  how: Nudge,
): OutlineEdit | null {
  const parent = parentOf(path);
  const x = last(path);
  const siblings = parent.length ? (itemAt(items, parent)?.children ?? []) : items;
  if (!siblings[x]) return null;
  switch (how) {
    case 'up':
      return x > 0 ? { kind: 'move', path, parent, index: x - 1 } : null;
    case 'down':
      return x < siblings.length - 1 ? { kind: 'move', path, parent, index: x + 2 } : null;
    case 'promote':
      return parent.length
        ? { kind: 'move', path, parent: parentOf(parent), index: last(parent) + 1 }
        : null;
    case 'demote': {
      const above = siblings[x - 1];
      return above
        ? { kind: 'move', path, parent: [...parent, x - 1], index: above.children.length }
        : null;
    }
  }
}

/** Which bookmark has focus after the one at `path` was deleted with everything in it. */
export function focusAfterDelete(items: readonly OutlineItem[], path: OutlinePath): OutlinePath {
  const parent = parentOf(path);
  const x = last(path);
  const siblings = parent.length ? (itemAt(items, parent)?.children ?? []) : items;
  // The next one moves into its place; else the one above; else the parent.
  if (x < siblings.length - 1) return path;
  if (x > 0) return [...parent, x - 1];
  return parent;
}
