// Review & Extract's tables (M4-14, §7.7): the outlines proposed by detection
// or drawn by hand, each accepted for export or not, and the mode's own undo
// and redo (separate from the document's history: nothing here changes the
// PDF). Pure.
import { bbox, type TableGrid } from '../../model/tableGrid';

export interface ReviewTable {
  id: string;
  grid: TableGrid;
  /** Included in the export. */
  accepted: boolean;
}

export interface ReviewDoc {
  tables: ReviewTable[];
  past: ReviewTable[][];
  future: ReviewTable[][];
}

export type ReviewAction =
  /** Detection results for a page: proposals not overlapping a table already there. */
  | { type: 'detected'; page: number; grids: TableGrid[]; ids: string[] }
  | { type: 'accept'; id: string; accepted: boolean }
  | { type: 'acceptAll' }
  | { type: 'edit'; id: string; grid: TableGrid }
  | { type: 'add'; table: ReviewTable }
  /** Several tables at once (a template applied to pages): one undo step. */
  | { type: 'addMany'; tables: ReviewTable[] }
  | { type: 'remove'; id: string }
  | { type: 'undo' }
  | { type: 'redo' };

/** Undo steps kept. */
const MAX_PAST = 100;

export const emptyReview = (): ReviewDoc => ({ tables: [], past: [], future: [] });

const overlap = (a: TableGrid, b: TableGrid): boolean => {
  if (a.page !== b.page) return false;
  const [ax0, ay0, ax1, ay1] = bbox(a);
  const [bx0, by0, bx1, by1] = bbox(b);
  return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
};

const step = (doc: ReviewDoc, tables: ReviewTable[]): ReviewDoc => ({
  tables,
  past: [...doc.past, doc.tables].slice(-MAX_PAST),
  future: [],
});

export function review(doc: ReviewDoc, a: ReviewAction): ReviewDoc {
  switch (a.type) {
    case 'detected': {
      const fresh = a.grids
        .map((grid, i) => ({ id: a.ids[i] ?? `t${String(i)}`, grid, accepted: false }))
        .filter((t) => !doc.tables.some((o) => overlap(o.grid, t.grid)));
      if (!fresh.length) return doc;
      // Not an undo step: detection is not an edit.
      return { ...doc, tables: [...doc.tables, ...fresh] };
    }
    case 'accept': {
      const t = doc.tables.find((x) => x.id === a.id);
      if (!t || t.accepted === a.accepted) return doc;
      return step(
        doc,
        doc.tables.map((x) => (x.id === a.id ? { ...x, accepted: a.accepted } : x)),
      );
    }
    case 'acceptAll':
      if (doc.tables.every((t) => t.accepted)) return doc;
      return step(
        doc,
        doc.tables.map((t) => ({ ...t, accepted: true })),
      );
    case 'edit': {
      const t = doc.tables.find((x) => x.id === a.id);
      if (!t || JSON.stringify(t.grid) === JSON.stringify(a.grid)) return doc;
      // Adjusting an outline accepts it.
      return step(
        doc,
        doc.tables.map((x) => (x.id === a.id ? { ...x, grid: a.grid, accepted: true } : x)),
      );
    }
    case 'add':
      return step(doc, [...doc.tables, a.table]);
    case 'addMany':
      return a.tables.length ? step(doc, [...doc.tables, ...a.tables]) : doc;
    case 'remove':
      if (!doc.tables.some((t) => t.id === a.id)) return doc;
      return step(
        doc,
        doc.tables.filter((t) => t.id !== a.id),
      );
    case 'undo': {
      const prev = doc.past.at(-1);
      if (!prev) return doc;
      return { tables: prev, past: doc.past.slice(0, -1), future: [doc.tables, ...doc.future] };
    }
    case 'redo': {
      const [next, ...rest] = doc.future;
      if (!next) return doc;
      return { tables: next, past: [...doc.past, doc.tables], future: rest };
    }
  }
}

/** Tables in reading order: by page, then top to bottom, then left to right. */
export function ordered(tables: readonly ReviewTable[]): ReviewTable[] {
  return [...tables].sort((a, b) => {
    if (a.grid.page !== b.grid.page) return a.grid.page - b.grid.page;
    const [ax0, , , ay1] = bbox(a.grid);
    const [bx0, , , by1] = bbox(b.grid);
    return Math.abs(ay1 - by1) > 20 ? by1 - ay1 : ax0 - bx0;
  });
}
