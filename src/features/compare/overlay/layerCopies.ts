// The overlay's layer copies (layer switches, D-59, Q24; PDFium can't switch
// layers, ADR-012). For a document with layers switched, the Work worker
// builds its current bytes plus an update that makes the switches its default
// layer visibility (`compareLayerCopy`); the bytes pass through here untouched
// (transferred, rule 1) to the Render worker, which opens them as a copy the
// overlay draws the page content from. One copy per document, switches and
// state of its bytes; a few are kept, older ones are closed once a newer one
// is drawn. The document itself is never changed.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { layerKey, type LayerStates } from '../../../workers/shared/layerCopy';
import { renderEngine, workClient } from '../../view/host';

/** Layer copies open in the Render worker at once (each holds a whole file). */
const MAX_COPIES = 4;
/** A replaced copy stays open this long, so tiles asked for just before still draw. */
const CLOSE_DELAY_MS = 2000;

interface Entry {
  docId: string;
  key: string;
  copyId: string;
  job: Promise<string>;
}

const entries = new Map<string, Entry>();
/** Documents and switches whose copy could not be built (encrypted, damaged). */
const failed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let seq = 0;

function changed(): void {
  version++;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function close(k: string, delay = 0): void {
  const e = entries.get(k);
  if (!e) return;
  entries.delete(k);
  const go = (): void => {
    void e.job
      .then(() => renderEngine().rpc.call('overlayCopyClose', { copyIds: [e.copyId] }).promise)
      .catch(() => undefined);
  };
  if (delay > 0) setTimeout(go, delay);
  else go();
}

/**
 * The Render worker's id of `docId` drawn with `states` (opened on first use),
 * or null when the switches are the file's defaults.
 */
export function layerCopyId(
  docId: string,
  states: LayerStates | undefined,
): Promise<string> | null {
  const key = layerKey(states);
  if (!key || !states) return null;
  const rev = workClient().bytesRevision(docId);
  const k = `${docId}\n${String(rev)}\n${key}`;
  const hit = entries.get(k);
  if (hit) {
    // Most recently used last (the cap closes the oldest).
    entries.delete(k);
    entries.set(k, hit);
    return hit.job;
  }
  const copyId = `${docId}~layers${String(++seq)}`;
  const job = (async () => {
    const { bytes } = await workClient().run('compareLayerCopy', { docId, layers: states }).promise;
    await renderEngine().rpc.call('overlayCopyOpen', { copyId, bytes }, { transfer: [bytes] })
      .promise;
    return copyId;
  })();
  const entry: Entry = { docId, key, copyId, job };
  entries.set(k, entry);
  failed.delete(`${docId}\n${key}`);
  job.then(
    () => {
      // Copies of older bytes with the same switches are not drawn any more.
      for (const [other, e] of [...entries])
        if (e !== entry && e.docId === docId && e.key === key) close(other, CLOSE_DELAY_MS);
    },
    () => {
      // Kept (rejected): asking again for the same bytes and switches does not retry.
      failed.add(`${docId}\n${key}`);
      changed();
    },
  );
  while (entries.size > MAX_COPIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined || oldest === k) break;
    close(oldest, CLOSE_DELAY_MS);
  }
  return job;
}

/** Closes every layer copy of these documents (a comparison closed); views ask again if needed. */
export function closeLayerCopies(docIds: readonly string[]): void {
  const set = new Set(docIds);
  let any = false;
  for (const [k, e] of [...entries])
    if (set.has(e.docId)) {
      close(k);
      any = true;
    }
  if (any) changed();
}

/** Whether `docId` with these switches could not be drawn (the overlay shows its defaults). */
export function useLayerCopyFailed(docId: string | null, states: LayerStates | undefined): boolean {
  useSyncExternalStore(subscribe, () => version);
  const key = layerKey(states);
  return docId !== null && key !== '' && failed.has(`${docId}\n${key}`);
}

export interface LayerContent {
  /** The copy to draw the page content from; undefined: the document itself. */
  contentId: string | undefined;
  /** A copy for the current switches is being built (the previous drawing stays). */
  pending: boolean;
}

/**
 * The overlay content of one side with its layer switches: the copy's id once
 * it is open. While a new copy is built, the previous one stays in use.
 * `edits` (the document's edit count) has the copy checked again after a change.
 */
export function useLayerContent(
  docId: string | null,
  states: LayerStates | undefined,
  edits: number,
): LayerContent {
  const tick = useSyncExternalStore(subscribe, () => version);
  const key = layerKey(states);
  const want = docId && key ? `${docId}\n${key}` : '';
  const [got, setGot] = useState<{ want: string; docId: string; contentId?: string } | null>(null);
  useEffect(() => {
    if (!docId) return;
    const job = layerCopyId(docId, states);
    if (!job) return;
    let live = true;
    job.then(
      (contentId) => {
        if (live) setGot({ want: `${docId}\n${layerKey(states)}`, docId, contentId });
      },
      () => {
        if (live) setGot({ want: `${docId}\n${layerKey(states)}`, docId });
      },
    );
    return () => {
      live = false;
    };
    // `key` stands for the switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, key, edits, tick]);
  if (!want) return { contentId: undefined, pending: false };
  const same = got?.docId === docId;
  return { contentId: same ? got.contentId : undefined, pending: got?.want !== want };
}
