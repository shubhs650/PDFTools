// The comparison's notes (M12-12, D-62; S27 change 9): a small document of
// blank pages, one per sheet in the sheet's displayed size, opened without a
// tab and shown by the overlay window with the overlay drawn as its page
// content. The overlay window is then a live window like A and B (every
// comment tool, the Properties pane, every context menu and its own undo),
// and what is drawn there lives in this document: never in Document A or B.
// The comparison file keeps it (D-65, M12-20); until then the notes last as
// long as the comparison tab, and close with it without a prompt.
//
// The pages are built in the Work worker (rule 1).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore } from '../../../app/store/documentStore';
import { t } from '../../../i18n';
import { BLANK_MAX_SIDE, BLANK_MIN_SIDE } from '../../../model/blankSize';
import { closeDocument, openFiles } from '../../open/openDocument';
import { workClient } from '../../view/host';
import type { Size } from '../overlay/frames';

export interface NotesState {
  /** The sheets' sizes the notes were made for. */
  key: string;
  status: 'making' | 'ready' | 'failed';
  docId: string | null;
}

interface NotesStoreState {
  byId: Record<string, NotesState>;
}

export const notesStore = createStore<NotesStoreState>()(() => ({ byId: {} }));

export function useNotes(id: string): NotesState | undefined {
  return useStore(notesStore, (s) => s.byId[id]);
}

const set = (id: string, n: NotesState | null): void => {
  notesStore.setState((s) => {
    if (n) return { byId: { ...s.byId, [id]: n } };
    return { byId: Object.fromEntries(Object.entries(s.byId).filter(([k]) => k !== id)) };
  });
};

/** A page side the blank document accepts (a sheet is never this small or large). */
const side = (v: number): number => Math.min(BLANK_MAX_SIDE, Math.max(BLANK_MIN_SIDE, v));

/** The key of a list of sheet sizes (two decimals, as the overlay frames are). */
export const sizesKey = (sizes: readonly Size[]): string =>
  sizes.map((s) => `${s.width.toFixed(2)}x${s.height.toFixed(2)}`).join(',');

let watching = false;

/** A comparison that closed takes its notes with it. */
function watchClosing(): void {
  if (watching) return;
  watching = true;
  documentStore.subscribe((s) => {
    for (const [id, n] of Object.entries(notesStore.getState().byId)) {
      if (s.comparisons[id]) continue;
      set(id, null);
      if (n.docId) void closeDocument(n.docId);
    }
  });
}

const making = new Map<string, Promise<void>>();

/**
 * The comparison's notes for these sheet sizes: made once, made again when the
 * sheets change (the pairing was edited). Resolves when ready or failed.
 */
export function ensureNotes(id: string, sizes: readonly Size[]): Promise<void> {
  watchClosing();
  const key = sizesKey(sizes);
  const cur = notesStore.getState().byId[id];
  if (cur?.key === key && cur.status !== 'failed') return making.get(id) ?? Promise.resolve();
  const old = cur?.docId ?? null;
  set(id, { key, status: 'making', docId: null });
  const job = (async () => {
    try {
      if (old) await closeDocument(old);
      const pages = sizes.map((s) => ({ width: side(s.width), height: side(s.height) }));
      const first = pages[0] ?? { width: 612, height: 792 };
      const { bytes } = await workClient().run('createBlank', {
        width: first.width,
        height: first.height,
        count: pages.length,
        sizes: pages,
      }).promise;
      const file = new File([bytes], t('compare.review.notesName'), { type: 'application/pdf' });
      const [docId] = await openFiles([{ file }], 'created', { notes: true });
      // The comparison closed or the sheets changed meanwhile: these notes are not wanted.
      if (
        notesStore.getState().byId[id]?.key !== key ||
        !documentStore.getState().comparisons[id]
      ) {
        if (docId) await closeDocument(docId);
        return;
      }
      set(id, { key, status: docId ? 'ready' : 'failed', docId: docId ?? null });
    } catch (err) {
      recordError('compareNotes', err);
      if (notesStore.getState().byId[id]?.key === key)
        set(id, { key, status: 'failed', docId: null });
    } finally {
      making.delete(id);
    }
  })();
  making.set(id, job);
  return job;
}

/** Whether a document is a comparison's notes. */
export const isNotes = (docId: string | null): boolean =>
  !!docId && documentStore.getState().docs[docId]?.meta.role === 'notes';
