// Pairing in the input window (M12-09, D-60, ARCHITECTURE §7.16): as soon as
// both sides of an overlay comparison are ready, the pages are paired
// automatically in the workers (signatures in the Work worker, the pairing in
// the Compare worker, rule 1), and the input window shows the result as the
// editable pairing table. The comparison's session is kept: the result
// compares the pairs the table settled on, reusing the signatures read here.
// Changing the inputs (files, order, page ranges, swap) pairs again; closing
// the comparison releases its session.
import { createStore, useStore } from 'zustand';
import { documentStore, type DocumentsState } from '../../app/store/documentStore';
import { isAbortError } from '../../engine/errors';
import {
  candidates,
  comparedPairs,
  isEdited,
  pairingRows,
  type Pairing,
  type PairingResult,
  type PairRow,
} from '../../model/compare/pairing';
import { workClient } from '../view/host';
import { compareClient } from './engine/compareHost';
import { CompareSession, type CompareInput, type SidePage } from './engine/session';
import { rangePages, type Comparison, type SideId } from './model';

export interface PairingState {
  /** The inputs this pairing belongs to. */
  key: string;
  /** Reading the pages' signatures, matching them, done, or failed. */
  status: 'reading' | 'matching' | 'done' | 'failed';
  done: number;
  total: number;
  /** Where each side page comes from. */
  pages: Record<SideId, SidePage[]>;
  /** The automatic pairing and its similarity matrix. */
  result: PairingResult | null;
  /** The pairing table as edited. */
  rows: PairRow[];
}

interface PairingStoreState {
  byId: Record<string, PairingState>;
}

export const pairingStore = createStore<PairingStoreState>()(() => ({ byId: {} }));

export function usePairing(id: string): PairingState | undefined {
  return useStore(pairingStore, (s) => s.byId[id]);
}

const sessions = new Map<string, CompareSession>();

function patch(id: string, key: string, fn: (p: PairingState) => Partial<PairingState>): void {
  pairingStore.setState((s) => {
    const cur = s.byId[id];
    // A pairing of inputs that have changed since is dropped.
    if (cur?.key !== key) return {};
    return { byId: { ...s.byId, [id]: { ...cur, ...fn(cur) } } };
  });
}

function drop(id: string): void {
  const session = sessions.get(id);
  sessions.delete(id);
  void session?.close();
  if (pairingStore.getState().byId[id])
    pairingStore.setState((s) => ({
      byId: Object.fromEntries(Object.entries(s.byId).filter(([k]) => k !== id)),
    }));
}

/** The comparison's sides as the session takes them, or null while it cannot be paired. */
export function pairingInputs(
  c: Comparison,
  docs: DocumentsState['docs'],
): { a: CompareInput; b: CompareInput; key: string } | null {
  if (c.type !== 'overlay' || c.a.length === 0 || c.b.length === 0) return null;
  const side = (s: SideId): CompareInput | null => {
    const files: CompareInput['files'] = [];
    for (const f of c[s]) {
      const meta = docs[f.docId]?.meta;
      if (!meta) return null;
      const r = rangePages(f.range, meta.pageCount);
      if (!r.ok) return null;
      files.push({ docId: f.docId, pages: r.pages, name: meta.name });
    }
    return { files };
  };
  const a = side('a');
  const b = side('b');
  if (!a || !b) return null;
  return { a, b, key: JSON.stringify([a, b]) };
}

/**
 * Pairs the comparison's pages when its inputs are new (an overlay with both
 * sides ready); drops the pairing when they can no longer be paired.
 */
export function syncPairing(c: Comparison): void {
  watchClosing();
  const inputs = pairingInputs(c, documentStore.getState().docs);
  const cur = pairingStore.getState().byId[c.id];
  if (!inputs) {
    if (cur || sessions.has(c.id)) drop(c.id);
    return;
  }
  if (cur?.key === inputs.key) return;
  drop(c.id);
  const { key } = inputs;
  const session = new CompareSession(inputs.a, inputs.b, {
    work: workClient(),
    compare: compareClient(),
    onPairing: (p) => {
      patch(c.id, key, () => ({
        status: p.stage === 'read' ? 'reading' : 'matching',
        done: p.done,
        total: p.total,
      }));
    },
  });
  sessions.set(c.id, session);
  const pages = { a: [...session.sidePages('a')], b: [...session.sidePages('b')] };
  pairingStore.setState((s) => ({
    byId: {
      ...s.byId,
      [c.id]: {
        key,
        status: 'reading',
        done: 0,
        total: pages.a.length + pages.b.length,
        pages,
        result: null,
        rows: [],
      },
    },
  }));
  void (async () => {
    try {
      // The Work worker reads from its own copies of the documents.
      const work = workClient();
      const docIds = new Set([...pages.a, ...pages.b].map((p) => p.docId));
      await Promise.all([...docIds].map((d) => work.whenAdded(d, 10_000)));
      const result = await session.pair();
      patch(c.id, key, () => ({ status: 'done', result, rows: pairingRows(result) }));
    } catch (err) {
      if (isAbortError(err)) return;
      patch(c.id, key, () => ({ status: 'failed' }));
    }
  })();
}

let watching = false;

/** Closing a comparison releases its pairing and session. */
function watchClosing(): void {
  if (watching) return;
  watching = true;
  documentStore.subscribe((s) => {
    for (const id of sessions.keys()) if (!s.comparisons[id]) drop(id);
  });
}

/** Changes the pairing table (an edit from the table). */
export function editPairing(id: string, fn: (rows: PairRow[]) => PairRow[]): void {
  pairingStore.setState((s) => {
    const cur = s.byId[id];
    if (cur?.status !== 'done') return {};
    return { byId: { ...s.byId, [id]: { ...cur, rows: fn(cur.rows) } } };
  });
}

/** Back to the automatic pairing. */
export function resetPairing(id: string): void {
  editPairing(id, (rows) => {
    const r = pairingStore.getState().byId[id]?.result;
    return r ? pairingRows(r) : rows;
  });
}

/** Whether the table differs from the automatic pairing. */
export function pairingEdited(p: PairingState): boolean {
  const auto: Pairing | null = p.result;
  return auto !== null && isEdited(p.rows, auto);
}

/** The sheets to compare, once the pages are paired. */
export function sheetsToCompare(id: string): { a: number; b: number }[] | null {
  const p = pairingStore.getState().byId[id];
  return p?.status === 'done' ? comparedPairs(p.rows) : null;
}

/** The comparison's session (later tasks start it with `sheetsToCompare`). */
export function pairingSession(id: string): CompareSession | undefined {
  return sessions.get(id);
}

/** Pages a partner list offers: every page of a small side, else the likeliest ones. */
export const ALL_PAGES_UP_TO = 60;
const LIKELY = 20;

/**
 * The pages of `side` a sheet's list offers: every page of a small side, else
 * the likeliest partners of the sheet's page on the other side (and the page
 * it has now), in page order.
 */
export function partnerOptions(p: PairingState, side: SideId, row: PairRow): number[] {
  const n = p.pages[side].length;
  const other = side === 'a' ? row.b : row.a;
  if (n <= ALL_PAGES_UP_TO || !p.result || other === null) return [...Array(n).keys()];
  return candidates(p.result, side === 'a' ? 'b' : 'a', other, LIKELY, row[side]).sort(
    (x, y) => x - y,
  );
}
