// Per-document state keyed by docId (ARCHITECTURE §3.1, D-01): meta from the
// engine, view state (kept for recovery, §4.3), dirty flag and save state.
// Tab order and the active document live here too. Pure transitions; the
// open/save pipelines (M1-13, M1-22) call them.
import { createStore, useStore } from 'zustand';

export type ViewMode = 'single' | 'continuous' | 'facing' | 'continuousFacing';
export type Rotation = 0 | 90 | 180 | 270;
export type ZoomSetting = number | 'fitPage' | 'fitWidth' | 'fitVisible';

export interface DocumentMeta {
  id: string;
  /** Display name for the tab (file name). Never logged or reported (rule 10). */
  name: string;
  pageCount: number;
  permissions: number;
  signatureCount: number;
}

export interface ViewState {
  /** 0-based current page. */
  page: number;
  /** What the user chose: a factor or a fit mode. */
  zoom: ZoomSetting;
  /** The factor in effect (1 = 100 %); for a fit mode, what it resolved to. */
  scale: number;
  mode: ViewMode;
  rotation: Rotation;
}

export type SaveState = 'idle' | 'saving' | 'error';

export interface DocumentSlice {
  meta: DocumentMeta;
  view: ViewState;
  dirty: boolean;
  /** Counts document changes, so a save only clears `dirty` if nothing changed meanwhile. */
  edits: number;
  save: SaveState;
  /** Bytes appended by incremental saves since open (D-06 growth prompt). */
  appendedBytes: number;
}

export interface DocumentsState {
  docs: Record<string, DocumentSlice>;
  order: string[];
  activeId: string | null;
  open(meta: DocumentMeta): void;
  close(id: string): void;
  activate(id: string): void;
  move(id: string, toIndex: number): void;
  setView(id: string, view: Partial<ViewState>): void;
  markDirty(id: string): void;
  /** Tab name after Save As to a new file (M1-22). */
  rename(id: string, name: string): void;
  setSaveState(id: string, save: SaveState): void;
  /** `editsAtStart`: the edit count when the save began (edits made during it stay dirty). */
  markSaved(id: string, appended: number, editsAtStart?: number): void;
}

export const DEFAULT_VIEW: ViewState = {
  page: 0,
  zoom: 'fitWidth',
  scale: 1,
  mode: 'continuous',
  rotation: 0,
};

function update(
  s: DocumentsState,
  id: string,
  fn: (d: DocumentSlice) => Partial<DocumentSlice>,
): Partial<DocumentsState> {
  const d = s.docs[id];
  if (!d) return {};
  return { docs: { ...s.docs, [id]: { ...d, ...fn(d) } } };
}

export const createDocumentStore = () =>
  createStore<DocumentsState>()((set) => ({
    docs: {},
    order: [],
    activeId: null,
    open: (meta) => {
      set((s) => {
        if (s.docs[meta.id]) return { activeId: meta.id };
        return {
          docs: {
            ...s.docs,
            [meta.id]: {
              meta,
              view: { ...DEFAULT_VIEW },
              dirty: false,
              edits: 0,
              save: 'idle',
              appendedBytes: 0,
            },
          },
          order: [...s.order, meta.id],
          activeId: meta.id,
        };
      });
    },
    close: (id) => {
      set((s) => {
        if (!s.docs[id]) return {};
        const docs = Object.fromEntries(Object.entries(s.docs).filter(([k]) => k !== id));
        const i = s.order.indexOf(id);
        const order = s.order.filter((x) => x !== id);
        // Closing the active tab activates its right neighbour, else the left one.
        const activeId = s.activeId === id ? (order[i] ?? order[i - 1] ?? null) : s.activeId;
        return { docs, order, activeId };
      });
    },
    activate: (id) => {
      set((s) => (s.docs[id] ? { activeId: id } : {}));
    },
    move: (id, toIndex) => {
      set((s) => {
        if (!s.docs[id]) return {};
        const order = s.order.filter((x) => x !== id);
        order.splice(Math.max(0, Math.min(toIndex, order.length)), 0, id);
        return { order };
      });
    },
    setView: (id, view) => {
      set((s) => update(s, id, (d) => ({ view: { ...d.view, ...view } })));
    },
    markDirty: (id) => {
      set((s) => update(s, id, (d) => ({ dirty: true, edits: d.edits + 1 })));
    },
    rename: (id, name) => {
      set((s) => update(s, id, (d) => ({ meta: { ...d.meta, name } })));
    },
    setSaveState: (id, save) => {
      set((s) => update(s, id, () => ({ save })));
    },
    markSaved: (id, appended, editsAtStart) => {
      set((s) =>
        update(s, id, (d) => ({
          dirty: editsAtStart !== undefined && d.edits !== editsAtStart,
          save: 'idle',
          appendedBytes: d.appendedBytes + appended,
        })),
      );
    },
  }));

export const documentStore = createDocumentStore();

export function useDocuments<T>(selector: (s: DocumentsState) => T): T {
  return useStore(documentStore, selector);
}

/** The active document's slice, or null. */
export const selectActive = (s: DocumentsState): DocumentSlice | null =>
  s.activeId ? (s.docs[s.activeId] ?? null) : null;
