// The document outline as the rows of an ARIA tree (§5, M2-10). Only the
// rows of expanded branches exist, so a deep outline costs what is open.
// Row ids are index paths ("0", "0.3", "0.3.1"). Pure.
import type { PdfBookmarkObject, PdfLinkTarget } from '@embedpdf/models';

export interface OutlineRow {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
  target: PdfLinkTarget | undefined;
  hasChildren: boolean;
  expanded: boolean;
  /** Position among its siblings (1-based) and their number (aria-posinset / setsize). */
  posInSet: number;
  setSize: number;
}

export function visibleRows(
  bookmarks: readonly PdfBookmarkObject[],
  expanded: ReadonlySet<string>,
): OutlineRow[] {
  const out: OutlineRow[] = [];
  const walk = (list: readonly PdfBookmarkObject[], parentId: string | null, level: number) => {
    list.forEach((b, i) => {
      const id = parentId === null ? String(i) : `${parentId}.${String(i)}`;
      const hasChildren = (b.children?.length ?? 0) > 0;
      const open = hasChildren && expanded.has(id);
      out.push({
        id,
        parentId,
        level,
        title: b.title,
        target: b.target,
        hasChildren,
        expanded: open,
        posInSet: i + 1,
        setSize: list.length,
      });
      if (open && b.children) walk(b.children, id, level + 1);
    });
  };
  walk(bookmarks, null, 1);
  return out;
}

/** Every branch id (Expand All). */
export function allBranchIds(bookmarks: readonly PdfBookmarkObject[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly PdfBookmarkObject[], parentId: string | null) => {
    list.forEach((b, i) => {
      const id = parentId === null ? String(i) : `${parentId}.${String(i)}`;
      if (b.children?.length) {
        out.push(id);
        walk(b.children, id);
      }
    });
  };
  walk(bookmarks, null);
  return out;
}

export type TreeKeyResult =
  { focus: string } | { expand: string } | { collapse: string } | { activate: string } | null;

/** ARIA tree keyboard pattern over the visible rows. */
export function treeKey(rows: readonly OutlineRow[], focusId: string, key: string): TreeKeyResult {
  const i = rows.findIndex((r) => r.id === focusId);
  const row = rows[i];
  if (!row) return rows[0] ? { focus: rows[0].id } : null;
  const at = (j: number): TreeKeyResult => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
    return r ? { focus: r.id } : null;
  };
  switch (key) {
    case 'ArrowDown':
      return at(i + 1);
    case 'ArrowUp':
      return at(i - 1);
    case 'Home':
      return at(0);
    case 'End':
      return at(rows.length - 1);
    case 'ArrowRight':
      if (!row.hasChildren) return null;
      return row.expanded ? at(i + 1) : { expand: row.id };
    case 'ArrowLeft':
      if (row.expanded) return { collapse: row.id };
      return row.parentId === null ? null : { focus: row.parentId };
    case 'Enter':
    case ' ':
      return { activate: row.id };
    default:
      return null;
  }
}
