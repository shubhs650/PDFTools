// Sticky note pop-up windows (M7-06, ADR-023 D-44): which are open, where, and
// saving that as the note's standard /Popup annotation (spike S23 passed).
//
// What reaches the file: the pop-up's /Rect and /Open, written by the Render
// worker (setNotePopup) and saved with the next Ctrl+S. Moving or resizing a
// window is a change the user made, so it makes the document dirty; opening
// and closing one is not (Acrobat users are not asked to save after reading a
// note), but the state goes into the file whenever it is saved. Without the
// annotate permission (rule 9) a window still opens to read the note, and
// nothing is written.
import type { PdfAnnotationObject } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { allows } from '../../../model/permissions';
import { hostStore, renderEngine, workClient } from '../../view/host';
import { defaultPopupRect, type DeviceRect, type PageFrame } from './popupGeometry';

export interface OpenPopup {
  noteId: string;
  rect: DeviceRect;
  /** Stacking order among the document's windows (the last raised on top). */
  z: number;
  /** Bumped to put the focus in the window's text (a new note, Open Popup). */
  focus: number;
}

interface DocPopups {
  open: Record<string, OpenPopup>;
  /** Each note's window rect as last known (from the file or this session). */
  rects: Record<string, DeviceRect>;
  /** Pages whose pop-ups were read from the file. */
  read: Record<number, true>;
}

interface PopupState {
  byDoc: Record<string, DocPopups>;
  top: number;
}

const EMPTY: DocPopups = { open: {}, rects: {}, read: {} };

export const notePopupStore = createStore<PopupState>()(() => ({ byDoc: {}, top: 0 }));

export function useNotePopups<T>(selector: (s: PopupState) => T): T {
  return useStore(notePopupStore, selector);
}

export const popupsOf = (s: PopupState, docId: string): DocPopups => s.byDoc[docId] ?? EMPTY;

/** A copy of `rec` without `keys`. */
const without = <T>(rec: Record<string, T>, keys: readonly string[]): Record<string, T> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => !keys.includes(k)));

function update(docId: string, fn: (d: DocPopups, top: number) => Partial<DocPopups>): void {
  notePopupStore.setState((s) => {
    const d = popupsOf(s, docId);
    return { byDoc: { ...s.byDoc, [docId]: { ...d, ...fn(d, s.top + 1) } }, top: s.top + 1 };
  });
}

/** Whether the document lets the user change comments (rule 9). */
export function canAnnotate(docId: string): boolean {
  const meta = documentStore.getState().docs[docId]?.meta;
  return meta ? allows(securityOf(meta), 'annotate') : false;
}

/** The page as the view draws it: unrotated size, quarter turns, zoom. */
export function pageFrame(docId: string, pageIndex: number): PageFrame | null {
  const core = hostStore.getState().registry?.getStore().getState().core.documents[docId];
  const page = core?.document?.pages[pageIndex];
  if (!core || !page) return null;
  return {
    width: page.size.width,
    height: page.size.height,
    rotation: (page.rotation + core.rotation) % 4,
    scale: core.scale,
  };
}

// ------------------------------------------------------------ writing the file

/** One write at a time per note, in order (open, then a move, then a close). */
const chains = new Map<string, Promise<unknown>>();

function write(docId: string, pageIndex: number, noteId: string, rect: DeviceRect, open: boolean) {
  if (!canAnnotate(docId)) return Promise.resolve(false);
  const key = `${docId}\u0000${noteId}`;
  const run = (chains.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(
      () =>
        renderEngine().rpc.call('setNotePopup', { docId, pageIndex, noteId, rect, open }).promise,
    )
    .then(
      () => true,
      (err: unknown) => {
        // No document content in the log (rule 10): the code only.
        console.warn('[notes] pop-up not saved', (err as { code?: unknown } | null)?.code);
        return false;
      },
    );
  chains.set(key, run);
  void run.finally(() => {
    if (chains.get(key) === run) chains.delete(key);
  });
  return run;
}

// ------------------------------------------------------------ reading the file

const reading = new Map<string, Promise<void>>();
/** How long the Work worker's copy is waited for before open pop-ups are left closed. */
const WORK_COPY_WAIT_MS = 10_000;

/**
 * Reads a page's pop-ups once per document: their rects, and the windows the
 * file has open (Acrobat and PDF-XChange save /Open) open here too.
 */
export function readPagePopups(docId: string, pageIndex: number): Promise<void> {
  if (popupsOf(notePopupStore.getState(), docId).read[pageIndex]) return Promise.resolve();
  const key = `${docId}\u0000${String(pageIndex)}`;
  const known = reading.get(key);
  if (known) return known;
  const run = (async () => {
    const { popups } = await renderEngine().rpc.call('notePopups', { docId, pageIndex }).promise;
    update(docId, (d) => ({
      read: { ...d.read, [pageIndex]: true },
      rects: { ...Object.fromEntries(popups.map((p) => [p.noteId, p.rect])), ...d.rects },
    }));
    if (popups.length === 0) return;
    const work = workClient();
    await work.whenAdded(docId, WORK_COPY_WAIT_MS);
    const { open } = await work.run('popupStates', { docId, objs: popups.map((p) => p.obj) })
      .promise;
    const opened = popups.filter((_, i) => open[i] === true);
    if (opened.length === 0) return;
    update(docId, (d, top) => {
      const next = { ...d.open };
      for (const p of opened)
        next[p.noteId] ??= {
          noteId: p.noteId,
          rect: d.rects[p.noteId] ?? p.rect,
          z: top,
          focus: 0,
        };
      return { open: next };
    });
  })()
    .catch(() => {
      // Not readable (closed meanwhile, a damaged file): the windows stay closed.
    })
    .finally(() => reading.delete(key));
  reading.set(key, run);
  return run;
}

// ------------------------------------------------------------ the windows

/**
 * Opens a note's window (or raises it). `focus` puts the caret in its text;
 * `save: false` for a note the Render worker doesn't have yet (written on its
 * commit, `saveOpenPopup`).
 */
export function openNotePopup(
  docId: string,
  note: Pick<PdfAnnotationObject, 'id' | 'pageIndex' | 'rect'>,
  opts: { focus?: boolean; save?: boolean } = {},
): void {
  const state = popupsOf(notePopupStore.getState(), docId);
  const frame = pageFrame(docId, note.pageIndex);
  const rect =
    state.open[note.id]?.rect ??
    state.rects[note.id] ??
    (frame ? defaultPopupRect(note.rect, frame) : null);
  if (!rect) return;
  const wasOpen = state.open[note.id] !== undefined;
  update(docId, (d, top) => ({
    open: {
      ...d.open,
      [note.id]: {
        noteId: note.id,
        rect,
        z: top,
        focus: (d.open[note.id]?.focus ?? 0) + (opts.focus ? 1 : 0),
      },
    },
    rects: { ...d.rects, [note.id]: rect },
  }));
  if (!wasOpen && opts.save !== false) void write(docId, note.pageIndex, note.id, rect, true);
}

/** After a new note reached the Render worker: its open window goes into the file. */
export function saveOpenPopup(docId: string, note: Pick<PdfAnnotationObject, 'id' | 'pageIndex'>) {
  const p = popupsOf(notePopupStore.getState(), docId).open[note.id];
  if (p) void write(docId, note.pageIndex, note.id, p.rect, true);
}

export function closeNotePopup(docId: string, note: Pick<PdfAnnotationObject, 'id' | 'pageIndex'>) {
  const p = popupsOf(notePopupStore.getState(), docId).open[note.id];
  if (!p) return;
  update(docId, (d) => ({ open: without(d.open, [note.id]) }));
  void write(docId, note.pageIndex, note.id, p.rect, false);
}

/** Brings a window to the front. */
export function raisePopup(docId: string, noteId: string): void {
  const p = popupsOf(notePopupStore.getState(), docId).open[noteId];
  const top = notePopupStore.getState().top;
  if (!p || p.z === top) return;
  update(docId, (d, z) => ({ open: { ...d.open, [noteId]: { ...p, z } } }));
}

/** The user moved or resized a window: saved, and the document is changed. */
export function placePopup(
  docId: string,
  note: Pick<PdfAnnotationObject, 'id' | 'pageIndex'>,
  rect: DeviceRect,
): void {
  const p = popupsOf(notePopupStore.getState(), docId).open[note.id];
  if (!p) return;
  update(docId, (d) => ({
    open: { ...d.open, [note.id]: { ...p, rect } },
    rects: { ...d.rects, [note.id]: rect },
  }));
  void write(docId, note.pageIndex, note.id, rect, true).then((ok) => {
    if (ok) documentStore.getState().markDirty(docId);
  });
}

/** Windows whose note is gone (deleted, undone) are forgotten. */
export function dropPopups(docId: string, noteIds: readonly string[]): void {
  const d = popupsOf(notePopupStore.getState(), docId);
  if (!noteIds.some((id) => d.open[id])) return;
  update(docId, (x) => ({ open: without(x.open, noteIds) }));
}

// A closed document's windows go.
documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  const gone = Object.keys(notePopupStore.getState().byDoc).filter((id) => !s.docs[id]);
  if (gone.length === 0) return;
  notePopupStore.setState((st) => ({ byDoc: without(st.byDoc, gone) }));
});
