// Per-document state keyed by docId (ARCHITECTURE §3.1, D-01): meta from the
// engine, view state (kept for recovery, §4.3), dirty flag and save state.
// Tab order and the active document live here too. Pure transitions; the
// open/save pipelines (M1-13, M1-22) call them.
import { createStore, useStore } from 'zustand';
import type { Security } from '../../model/permissions';
import type { Comparison } from '../../features/compare/model';

export type ViewMode = 'single' | 'continuous' | 'facing' | 'continuousFacing';
export type Rotation = 0 | 90 | 180 | 270;
export type ZoomSetting = number | 'fitPage' | 'fitWidth' | 'fitVisible';

/**
 * Where a document came from (M11-03, D-50): shown on the tab's hover card instead of a
 * folder path, which a web app never learns. 'saved': Save As or Save Optimized wrote it
 * to a file the user picked; 'downloaded': a new file that went to the browser's
 * downloads (no file handle); 'created': built in the app and not saved yet.
 */
export type DocumentSource =
  | 'picked'
  | 'dropped'
  | 'launched'
  | 'recent'
  | 'recovered'
  | 'attachment'
  | 'created'
  | 'saved'
  | 'downloaded';

export interface DocumentMeta {
  id: string;
  /** Display name for the tab (file name). Never logged or reported (rule 10). */
  name: string;
  pageCount: number;
  /** `FPDF_GetDocPermissions` bits, read live after an owner unlock (rule 9, D-19). */
  permissions: number;
  /** Security handler revision (`FPDF_GetSecurityHandlerRevision`); absent or -1: not encrypted. */
  securityRevision?: number;
  /** Full access for this session after the owner password was given (§7.12). */
  ownerUnlocked?: boolean;
  signatureCount: number;
  /** `FPDF_GetFormType` (M2-14): 2 full XFA, 3 hybrid XFA → banner; absent: none. */
  formType?: number;
  /** Where it came from (M11-03); absent: opened from this device. */
  source?: DocumentSource;
  /** The file's size on disk in bytes, as last opened or written; absent: no file yet. */
  fileSize?: number;
  /** The file's last-modified time (ms since the epoch), as last opened or written. */
  modified?: number;
  /**
   * A comparison's notes (M12-12, D-62): the blank pages behind the overlay window,
   * one per sheet, holding what is drawn there. Never a tab, never written into
   * Document A or B, and only the comment and view commands act on it.
   */
  role?: 'notes';
}

/** What the tab's hover card shows about the file (M11-03); set at open and after a save. */
export type FileFacts = Partial<Pick<DocumentMeta, 'source' | 'fileSize' | 'modified'>>;

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
  /**
   * The tabs in order: a document's id for a document tab, a comparison's id for a
   * comparison tab (M12-08, D-58). A document dropped into a comparison is open (in
   * `docs`) without a tab of its own.
   */
  order: string[];
  /**
   * The document commands act on (S27: "active tab" and "active document" are two
   * things). With a document tab selected it is that document; with a comparison tab
   * selected it is the comparison window in use, or null (the input window).
   */
  activeId: string | null;
  /** The tab shown: a document's or a comparison's id (M12-08, D-58). */
  activeTab: string | null;
  /** Comparison tabs by id (M12-08, D-58); their inputs, in features/compare. */
  comparisons: Record<string, Comparison>;
  open(meta: DocumentMeta): void;
  /** A document without a tab of its own (dropped or picked into a comparison, D-58). */
  openWithoutTab(meta: DocumentMeta): void;
  /** A document open without a tab gets one, at the end, and is selected. */
  showTab(id: string): void;
  /** Takes a document's tab away and keeps the document open (a comparison shows it). */
  removeTab(id: string): void;
  close(id: string): void;
  activate(id: string): void;
  /**
   * Makes `id` the document commands act on without changing the tab shown (a window of
   * the comparison tab in use, S27 change 3); for a document tab, the same as activate.
   */
  focusDocument(id: string): void;
  /** A new comparison tab after the selected one (or at `at`), selected (D-58). */
  openComparison(comparison: Comparison, at?: number): void;
  updateComparison(id: string, fn: (c: Comparison) => Comparison): void;
  closeComparison(id: string): void;
  move(id: string, toIndex: number): void;
  /** A new order of the same tabs (Sort Tabs by Name, M11-05); ignored otherwise. */
  reorder(order: readonly string[]): void;
  setView(id: string, view: Partial<ViewState>): void;
  markDirty(id: string): void;
  /** After Save Optimized wrote the document's file: nothing appended since (M1-23). */
  markOptimized(id: string, editsAtStart: number): void;
  /** Tab name after Save As to a new file (M1-22). */
  rename(id: string, name: string): void;
  /** The file was written (or adopted a new file): its source, size and time (M11-03). */
  setFileFacts(id: string, facts: FileFacts): void;
  /** After a page operation (M4-09). */
  setPageCount(id: string, pageCount: number): void;
  /** The first form field was created (M6-14). */
  setFormType(id: string, formType: number): void;
  setSaveState(id: string, save: SaveState): void;
  /** Permissions after an owner-password unlock (read back from the Render worker). */
  setSecurity(id: string, security: { permissions: number; ownerUnlocked: boolean }): void;
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

const newSlice = (meta: DocumentMeta): DocumentSlice => ({
  meta,
  view: { ...DEFAULT_VIEW },
  dirty: false,
  edits: 0,
  save: 'idle',
  appendedBytes: 0,
});

/** Whether `id` is a tab (a document's or a comparison's). */
const isTab = (s: Pick<DocumentsState, 'docs' | 'comparisons'>, id: string): boolean =>
  s.docs[id] !== undefined || s.comparisons[id] !== undefined;

/** Selecting tab `id` (or none): a document tab is also the document commands act on. */
const select = (
  docs: Record<string, DocumentSlice>,
  id: string | null,
): Pick<DocumentsState, 'activeTab' | 'activeId'> => ({
  activeTab: id,
  activeId: id !== null && docs[id] ? id : null,
});

/**
 * Tab `id` leaves the strip: the selected tab's right neighbour is selected, else the
 * left one; a document that is gone is no longer the one commands act on.
 */
function withoutTab(
  s: DocumentsState,
  id: string,
  docs: Record<string, DocumentSlice>,
): Pick<DocumentsState, 'order' | 'activeTab' | 'activeId'> {
  const i = s.order.indexOf(id);
  const order = s.order.filter((x) => x !== id);
  if (s.activeTab === id) return { order, ...select(docs, order[i] ?? order[i - 1] ?? null) };
  return {
    order,
    activeTab: s.activeTab,
    activeId: s.activeId !== null && docs[s.activeId] ? s.activeId : null,
  };
}

/** Every comparison without `docId` on either side (it was closed). */
function withoutDocument(
  comparisons: Record<string, Comparison>,
  docId: string,
): Record<string, Comparison> {
  let changed = false;
  const next: Record<string, Comparison> = {};
  for (const [id, c] of Object.entries(comparisons)) {
    const a = c.a.filter((f) => f.docId !== docId);
    const b = c.b.filter((f) => f.docId !== docId);
    if (a.length !== c.a.length || b.length !== c.b.length) {
      changed = true;
      next[id] = { ...c, a, b };
    } else next[id] = c;
  }
  return changed ? next : comparisons;
}

export const createDocumentStore = () =>
  createStore<DocumentsState>()((set) => ({
    docs: {},
    order: [],
    activeId: null,
    activeTab: null,
    comparisons: {},
    open: (meta) => {
      set((s) => {
        if (s.docs[meta.id])
          return {
            ...(s.order.includes(meta.id) ? {} : { order: [...s.order, meta.id] }),
            ...select(s.docs, meta.id),
          };
        const docs = { ...s.docs, [meta.id]: newSlice(meta) };
        return { docs, order: [...s.order, meta.id], ...select(docs, meta.id) };
      });
    },
    openWithoutTab: (meta) => {
      set((s) => (s.docs[meta.id] ? {} : { docs: { ...s.docs, [meta.id]: newSlice(meta) } }));
    },
    showTab: (id) => {
      set((s) => {
        if (!s.docs[id]) return {};
        const order = s.order.includes(id) ? s.order : [...s.order, id];
        return { order, ...select(s.docs, id) };
      });
    },
    removeTab: (id) => {
      set((s) => (s.docs[id] && s.order.includes(id) ? withoutTab(s, id, s.docs) : {}));
    },
    close: (id) => {
      set((s) => {
        if (!s.docs[id]) return {};
        const docs = Object.fromEntries(Object.entries(s.docs).filter(([k]) => k !== id));
        return {
          docs,
          ...withoutTab(s, id, docs),
          comparisons: withoutDocument(s.comparisons, id),
        };
      });
    },
    activate: (id) => {
      set((s) =>
        (s.docs[id] && s.order.includes(id)) || s.comparisons[id] ? select(s.docs, id) : {},
      );
    },
    focusDocument: (id) => {
      set((s) => {
        if (!s.docs[id]) return {};
        if (s.order.includes(id) && !s.comparisons[s.activeTab ?? '']) return select(s.docs, id);
        return { activeId: id };
      });
    },
    openComparison: (comparison, at) => {
      set((s) => {
        if (isTab(s, comparison.id)) return {};
        const after = s.activeTab ? s.order.indexOf(s.activeTab) + 1 : s.order.length;
        const i = Math.max(0, Math.min(at ?? after, s.order.length));
        const order = [...s.order];
        order.splice(i, 0, comparison.id);
        return {
          comparisons: { ...s.comparisons, [comparison.id]: comparison },
          order,
          ...select(s.docs, comparison.id),
        };
      });
    },
    updateComparison: (id, fn) => {
      set((s) => {
        const c = s.comparisons[id];
        return c ? { comparisons: { ...s.comparisons, [id]: fn(c) } } : {};
      });
    },
    closeComparison: (id) => {
      set((s) => {
        if (!s.comparisons[id]) return {};
        const comparisons = Object.fromEntries(
          Object.entries(s.comparisons).filter(([k]) => k !== id),
        );
        return { comparisons, ...withoutTab(s, id, s.docs) };
      });
    },
    move: (id, toIndex) => {
      set((s) => {
        if (!s.order.includes(id)) return {};
        const order = s.order.filter((x) => x !== id);
        order.splice(Math.max(0, Math.min(toIndex, order.length)), 0, id);
        return { order };
      });
    },
    reorder: (next) => {
      set((s) => {
        const same =
          next.length === s.order.length &&
          new Set(next).size === next.length &&
          next.every((id) => s.order.includes(id));
        return same ? { order: [...next] } : {};
      });
    },
    setView: (id, view) => {
      set((s) => update(s, id, (d) => ({ view: { ...d.view, ...view } })));
    },
    markDirty: (id) => {
      set((s) => update(s, id, (d) => ({ dirty: true, edits: d.edits + 1 })));
    },
    markOptimized: (id, editsAtStart) => {
      set((s) =>
        update(s, id, (d) => ({
          dirty: d.edits !== editsAtStart,
          save: 'idle',
          appendedBytes: 0,
        })),
      );
    },
    rename: (id, name) => {
      set((s) => update(s, id, (d) => ({ meta: { ...d.meta, name } })));
    },
    setFileFacts: (id, facts) => {
      set((s) => update(s, id, (d) => ({ meta: { ...d.meta, ...facts } })));
    },
    setFormType: (id, formType) => {
      set((s) => update(s, id, (d) => ({ meta: { ...d.meta, formType } })));
    },
    setPageCount: (id, pageCount) => {
      set((s) =>
        update(s, id, (d) => ({
          meta: { ...d.meta, pageCount },
          view: { ...d.view, page: Math.min(d.view.page, Math.max(0, pageCount - 1)) },
        })),
      );
    },
    setSaveState: (id, save) => {
      set((s) => update(s, id, () => ({ save })));
    },
    setSecurity: (id, { permissions, ownerUnlocked }) => {
      set((s) => update(s, id, (d) => ({ meta: { ...d.meta, permissions, ownerUnlocked } })));
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

/** Whether a comparison has `docId` on either side (M12-08, D-58). */
export const inComparison = (s: Pick<DocumentsState, 'comparisons'>, docId: string): boolean =>
  Object.values(s.comparisons).some(
    (c) => c.a.some((f) => f.docId === docId) || c.b.some((f) => f.docId === docId),
  );

/** The active document's slice, or null. */
export const selectActive = (s: DocumentsState): DocumentSlice | null =>
  s.activeId ? (s.docs[s.activeId] ?? null) : null;

/** The document's permission state for src/model/permissions.ts. */
export const securityOf = (meta: DocumentMeta): Security => ({
  permissions: meta.permissions,
  revision: meta.securityRevision ?? -1,
});
