// The Bookmarks pane's state and edits (M6-11, §7.15, ADR-022 decision 5).
// The outline is read by our own object layer in the Work worker (colour,
// style and open state included); each edit is made there on the current
// state and applied by the Render worker's reopen route as one undo step
// (`runTransfer`, capability modify, rule 9), then the outline is read again.
// The pane remembers its expanded branches and the focused bookmark by index
// path; an edit moves them along (outlineEdit.ts). Cut / Copy / Paste keep
// every key of the copied bookmarks and work within the document they came
// from (their destinations point at its pages).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { notify } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { AbortError, isAbortError } from '../../engine/errors';
import { msg, type MessageKey } from '../../i18n';
import {
  itemAt,
  keyPath,
  pathKey,
  type ClipItem,
  type DestSpec,
  type OutlineEdit,
  type OutlineExpect,
  type OutlineItem,
  type OutlinePath,
} from '../../model/outline';
import { pagesVersion, runTransfer, syncLive, transferBlocked } from '../pages/pageOps';
import { workClient } from '../view/host';
import { allBranchIds } from './outline';
import { takeDropped } from './outlineCache';
import { remapPath } from './outlineEdit';

export type Loaded =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; items: OutlineItem[]; version: number };

interface BookmarksState {
  outlines: Record<string, Loaded>;
  /** Expanded branches per document (path keys). */
  expanded: Record<string, ReadonlySet<string>>;
  /** The focused bookmark per document (path key): what the commands act on. */
  focus: Record<string, string>;
  /** The bookmark whose title is being edited in place. */
  renaming: { docId: string; key: string } | null;
  /** The bookmark whose Properties dialog is open. */
  properties: { docId: string; key: string } | null;
  /** Copied bookmarks (in-app, this document only). */
  clip: { docId: string; items: ClipItem[] } | null;
  /** An edit is running (the pane does not read the outline meanwhile). */
  editing: string | null;
  /** The last failure, said by the pane (no document content, rule 10). */
  error: MessageKey | null;
  /** Bumped when the pane should move focus into the tree (after an edit, rename). */
  focusTick: number;
}

export const bookmarksStore = createStore<BookmarksState>()(() => ({
  outlines: {},
  expanded: {},
  focus: {},
  renaming: null,
  properties: null,
  clip: null,
  editing: null,
  error: null,
  focusTick: 0,
}));

export function useBookmarks<T>(selector: (s: BookmarksState) => T): T {
  return useStore(bookmarksStore, selector);
}

// Commands follow the focused bookmark, the clipboard and running edits.
bookmarksStore.subscribe((s, prev) => {
  if (
    s.focus !== prev.focus ||
    s.clip !== prev.clip ||
    s.outlines !== prev.outlines ||
    s.editing !== prev.editing
  )
    notify();
});
documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  const gone = Object.keys(bookmarksStore.getState().outlines).filter((id) => !(id in s.docs));
  const clip = bookmarksStore.getState().clip;
  if (!gone.length && (!clip || clip.docId in s.docs)) return;
  const drop = <T>(r: Record<string, T>) =>
    Object.fromEntries(Object.entries(r).filter(([id]) => id in s.docs));
  bookmarksStore.setState((st) => ({
    outlines: drop(st.outlines),
    expanded: drop(st.expanded),
    focus: drop(st.focus),
    clip: st.clip && st.clip.docId in s.docs ? st.clip : null,
  }));
});

/** How long a just-opened document's Work copy is waited for. */
const WORK_COPY_WAIT_MS = 10_000;
const loads = new Map<string, Promise<OutlineItem[]>>();

const setOutline = (docId: string, loaded: Loaded): void => {
  bookmarksStore.setState((s) => ({ outlines: { ...s.outlines, [docId]: loaded } }));
};

/** Reads the outline from the Work worker's copy (brought up to date first). */
function fetchOutline(docId: string): Promise<OutlineItem[]> {
  let p = loads.get(docId);
  if (p) return p;
  p = workClient()
    .whenAdded(docId, WORK_COPY_WAIT_MS)
    .then(() => syncLive(docId).catch(() => undefined))
    .then(() => workClient().run('readOutline', { docId }).promise)
    .then((r) => r.items)
    .finally(() => loads.delete(docId));
  loads.set(docId, p);
  return p;
}

/**
 * Loads the outline when the pane shows it, and again when the document's
 * pages or bookmarks changed (an undo included). The first read opens the
 * branches the file marks open.
 */
export function loadOutline(docId: string): void {
  const st = bookmarksStore.getState();
  const cur = st.outlines[docId];
  const version = pagesVersion(docId);
  if (st.editing === docId || loads.has(docId)) return;
  const dropped = takeDropped(docId);
  if (cur?.state === 'ready' && cur.version === version && !dropped) return;
  if (cur?.state === 'failed') return;
  if (!cur) setOutline(docId, { state: 'loading' });
  fetchOutline(docId).then(
    (items) => {
      if (!documentStore.getState().docs[docId]) return;
      const first = bookmarksStore.getState().outlines[docId]?.state !== 'ready';
      bookmarksStore.setState((s) => ({
        outlines: { ...s.outlines, [docId]: { state: 'ready', items, version } },
        ...(first ? { expanded: { ...s.expanded, [docId]: new Set(openIds(items)) } } : {}),
      }));
    },
    (err: unknown) => {
      if (isAbortError(err)) {
        if (bookmarksStore.getState().outlines[docId]?.state === 'loading')
          bookmarksStore.setState((s) => ({
            outlines: Object.fromEntries(Object.entries(s.outlines).filter(([k]) => k !== docId)),
          }));
        return;
      }
      recordError('bookmarks.read', err);
      setOutline(docId, { state: 'failed' });
    },
  );
}

/** Branches the file marks open (/Count > 0), as path keys. */
function openIds(items: readonly OutlineItem[], parent = ''): string[] {
  const out: string[] = [];
  items.forEach((b, i) => {
    const id = parent === '' ? String(i) : `${parent}.${String(i)}`;
    if (b.open && b.children.length) out.push(id, ...openIds(b.children, id));
  });
  return out;
}

// ------------------------------------------------------------------ what the commands see

export const activeDoc = (): string | null =>
  selectActive(documentStore.getState())?.meta.id ?? null;

export function itemsOf(docId: string): OutlineItem[] | null {
  const o = bookmarksStore.getState().outlines[docId];
  return o?.state === 'ready' ? o.items : null;
}

/** The focused bookmark of the active document (null: none, or not read yet). */
export function focused(): { docId: string; path: OutlinePath; item: OutlineItem } | null {
  const docId = activeDoc();
  if (!docId) return null;
  const items = itemsOf(docId);
  const key = bookmarksStore.getState().focus[docId];
  if (!items || key === undefined) return null;
  const path = keyPath(key);
  const item = itemAt(items, path);
  return item ? { docId, path, item } : null;
}

export function setFocus(docId: string, key: string): void {
  if (bookmarksStore.getState().focus[docId] === key) return;
  bookmarksStore.setState((s) => ({ focus: { ...s.focus, [docId]: key } }));
}

export function setExpanded(docId: string, ids: ReadonlySet<string>): void {
  bookmarksStore.setState((s) => ({ expanded: { ...s.expanded, [docId]: ids } }));
}

export function expandAll(docId: string): void {
  const items = itemsOf(docId);
  if (items) setExpanded(docId, new Set(allBranchIds(items)));
}

export function collapseAll(docId: string): void {
  setExpanded(docId, new Set());
  // The focused bookmark stays visible: its top-level ancestor takes focus.
  const key = bookmarksStore.getState().focus[docId];
  if (key) setFocus(docId, key.split('.')[0] ?? '0');
}

/** Why the outline can't be edited now (null: it can). */
export function editBlocked(docId: string): MessageKey | null {
  if (!itemsOf(docId)) return msg('bookmarks.notReady');
  if (bookmarksStore.getState().editing) return msg('pages.busy');
  return transferBlocked(docId, 'modify', msg('bookmarks.restricted'));
}

export function clearError(): void {
  bookmarksStore.setState({ error: null });
}

// ------------------------------------------------------------------ editing

/** The titles an edit expects at its paths (refused by the Work worker if they moved). */
export function expectAt(items: readonly OutlineItem[], paths: OutlinePath[]): OutlineExpect[] {
  return paths.flatMap((path) => {
    const it = itemAt(items, path);
    return it ? [{ path, title: it.title }] : [];
  });
}

export interface EditOptions {
  /** Paths the edit expects (default: the edited one). */
  expect?: OutlinePath[];
  /** Focus afterwards (default: the edited bookmark where it went). */
  focus?: OutlinePath | null;
  /** Rename the focused bookmark in place afterwards (New Bookmark). */
  rename?: boolean;
  /** Also expand these branches afterwards (paths after the edit). */
  expand?: OutlinePath[];
}

const pathsOf = (edit: OutlineEdit): OutlinePath[] =>
  edit.kind === 'insert' ? (edit.parent.length ? [edit.parent] : []) : [edit.path];

/**
 * Runs one edit as one undo step. Resolves true when it was applied; a refused
 * edit (the outline changed meanwhile) reads the outline again and says so.
 */
export async function runEdit(
  docId: string,
  edit: OutlineEdit,
  label: MessageKey,
  opts: EditOptions = {},
): Promise<boolean> {
  const items = itemsOf(docId);
  if (!items || editBlocked(docId)) return false;
  const expect = expectAt(items, opts.expect ?? pathsOf(edit));
  const childCount = edit.kind === 'remove' ? (itemAt(items, edit.path)?.children.length ?? 0) : 0;
  bookmarksStore.setState({ editing: docId, error: null, renaming: null });
  let ok = false;
  try {
    ok = await runTransfer(
      docId,
      label,
      async (_progress, onCancel) => {
        const job = workClient().run('editOutline', { docId, edit, expect });
        onCancel(() => {
          job.cancel();
        });
        return job.promise;
      },
      { capability: 'modify', restricted: msg('bookmarks.restricted'), tag: 'bookmarks' },
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'bookmark-stale') bookmarksStore.setState({ error: msg('bookmarks.stale') });
    else if (!isAbortError(err)) {
      recordError('bookmarks.edit', err);
      bookmarksStore.setState({ error: msg('bookmarks.editFailed') });
    }
  }
  try {
    const fresh = await fetchOutline(docId);
    const st = bookmarksStore.getState();
    const remap = (key: string): string | null => {
      if (!ok) return key;
      const p = remapPath(edit, keyPath(key), childCount);
      return p ? pathKey(p) : null;
    };
    const expanded = new Set(
      [...(st.expanded[docId] ?? [])].flatMap((k) => {
        const r = remap(k);
        return r === null ? [] : [r];
      }),
    );
    if (ok) for (const p of opts.expand ?? []) if (p.length) expanded.add(pathKey(p));
    const oldFocus = st.focus[docId];
    let focusKey =
      ok && opts.focus !== undefined
        ? opts.focus === null
          ? undefined
          : pathKey(opts.focus)
        : oldFocus === undefined
          ? undefined
          : (remap(oldFocus) ?? undefined);
    if (focusKey !== undefined && !itemAt(fresh, keyPath(focusKey)))
      focusKey = fresh.length ? '0' : undefined;
    // The focused bookmark's ancestors open, so it can be seen.
    if (focusKey) {
      const p = keyPath(focusKey);
      for (let i = 1; i < p.length; i++) expanded.add(pathKey(p.slice(0, i)));
    }
    bookmarksStore.setState((s) => ({
      outlines: {
        ...s.outlines,
        [docId]: { state: 'ready', items: fresh, version: pagesVersion(docId) },
      },
      expanded: { ...s.expanded, [docId]: expanded },
      focus:
        focusKey === undefined
          ? Object.fromEntries(Object.entries(s.focus).filter(([k]) => k !== docId))
          : { ...s.focus, [docId]: focusKey },
      renaming: ok && opts.rename && focusKey !== undefined ? { docId, key: focusKey } : null,
      focusTick: s.focusTick + 1,
    }));
  } catch (err) {
    if (!isAbortError(err)) recordError('bookmarks.read', err);
  } finally {
    bookmarksStore.setState({ editing: null });
  }
  return ok;
}

/** Copies the bookmarks at `paths` (every key) to the in-app clipboard. */
export async function copyBookmarks(docId: string, paths: OutlinePath[]): Promise<boolean> {
  const items = itemsOf(docId);
  if (!items) return false;
  try {
    const r = await workClient().run('copyOutline', {
      docId,
      paths,
      expect: expectAt(items, paths),
    }).promise;
    if (!documentStore.getState().docs[docId]) throw new AbortError();
    bookmarksStore.setState({ clip: { docId, items: r.items }, error: null });
    return true;
  } catch (err) {
    if (isAbortError(err)) return false;
    const code = (err as { code?: string }).code;
    if (code !== 'bookmark-stale') recordError('bookmarks.copy', err);
    bookmarksStore.setState({
      error: code === 'bookmark-stale' ? msg('bookmarks.stale') : msg('bookmarks.editFailed'),
    });
    return false;
  }
}

export function startRename(docId: string, key: string): void {
  bookmarksStore.setState({ renaming: { docId, key } });
}

export function endRename(): void {
  bookmarksStore.setState((s) => ({ renaming: null, focusTick: s.focusTick + 1 }));
}

export function openProperties(docId: string, key: string): void {
  bookmarksStore.setState({ properties: { docId, key } });
}

export function closeProperties(): void {
  bookmarksStore.setState({ properties: null });
}

export type { DestSpec };
