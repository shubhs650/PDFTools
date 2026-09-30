// Page reordering arithmetic (M4-10, §7.8). Pure. PDFium's FPDF_MovePages
// takes the pages to move (kept in document order) and `to`, the index the
// first of them has in the result; the UI speaks of an insertion point in
// the current order (a thumbnail drop, "before page n").

/** Sorted, unique. */
const norm = (pages: readonly number[]): number[] => [...new Set(pages)].sort((a, b) => a - b);

/**
 * `to` for moving `pages` so they land at insertion point `before` (0…count,
 * an index in the current order: the gap before that page). Null when the
 * move changes nothing.
 */
export function moveTo(pages: readonly number[], before: number, count: number): number | null {
  const sel = norm(pages);
  if (sel.length === 0 || sel.length >= count) return null;
  const at = Math.max(0, Math.min(count, before));
  const to = at - sel.filter((p) => p < at).length;
  return changes(sel, to) ? to : null;
}

/** Moving `sel` so its first page lands at `to` changes the order. */
function changes(sel: readonly number[], to: number): boolean {
  return sel.some((p, i) => p !== to + i);
}

/**
 * Alt+↑ / Alt+↓ (M4-10): the selection, gathered in document order, one
 * place up or down from its first page. Null at the edge or when nothing changes.
 */
export function moveByOne(pages: readonly number[], dir: -1 | 1, count: number): number | null {
  const sel = norm(pages);
  const first = sel[0];
  if (first === undefined || sel.length >= count) return null;
  const contiguous = sel.every((p, i) => p === first + i);
  // A scattered selection first gathers at its first page, then moves.
  const to = contiguous ? first + dir : first;
  if (to < 0 || to > count - sel.length) return null;
  return changes(sel, to) ? to : null;
}

/** The pages' new indexes after the move: `to`, `to + 1`, … */
export function movedRange(pages: readonly number[], to: number): number[] {
  return norm(pages).map((_, i) => to + i);
}

/** Where a pointer at `y` drops, from the list's item tops (`tops[i]` … `tops[count]`). */
export function dropIndex(tops: ArrayLike<number>, y: number): number {
  const count = tops.length - 1;
  for (let i = 0; i < count; i++) {
    const top = tops[i] ?? 0;
    const bottom = tops[i + 1] ?? top;
    if (y < (top + bottom) / 2) return i;
  }
  return Math.max(0, count);
}
