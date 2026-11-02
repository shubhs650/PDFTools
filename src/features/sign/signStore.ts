// Saved visual signatures and the Sign Document dialog's state (M6-13, ADR-021
// D-40 b, §7.11, §10.3). Saved signatures stay on this device: IndexedDB
// `visualSignatures`, loaded once, checked on the way in (model/visualSignature.ts),
// at most MAX_SAVED_SIGNATURES, deleted by "Clear all local data". Nothing
// here is logged or reported (rule 10): recordError gets codes only.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import {
  keepNewest,
  parseSignatureRecord,
  SIGNATURE_RECORD_VERSION,
  type StoredEntry,
  type StoredSignatureRecord,
} from '../../model/visualSignature';
import { appDb } from '../../storage/appDb';

interface SignState {
  /** The document whose Sign Document dialog is open. */
  docId: string | null;
  /** Saved signatures, newest first. */
  saved: StoredEntry[];
  loaded: boolean;
  /** "Flatten after placing", remembered for the session. */
  flattenAfter: boolean;
}

export const signStore = createStore<SignState>()(() => ({
  docId: null,
  saved: [],
  loaded: false,
  flattenAfter: false,
}));

export function useSign<T>(selector: (s: SignState) => T): T {
  return useStore(signStore, selector);
}

let loading: Promise<void> | null = null;

export function loadSignatures(): Promise<void> {
  loading ??= appDb()
    .then(async (db) => {
      const parsed: StoredEntry[] = [];
      for (const raw of await db.listSignatures()) {
        const e = parseSignatureRecord(raw);
        if (e) parsed.push(e);
      }
      const { kept, dropped } = keepNewest([
        // Anything saved while loading wins.
        ...signStore.getState().saved,
        ...parsed.filter((p) => !signStore.getState().saved.some((s) => s.id === p.id)),
      ]);
      signStore.setState({ saved: kept, loaded: true });
      for (const id of dropped) await db.deleteSignature(id);
    })
    .catch((err: unknown) => {
      recordError('sign.load', err);
      signStore.setState({ loaded: true });
    });
  return loading;
}

/** Keeps `entry` on this device (the oldest beyond the limit is deleted). */
export async function saveSignature(entry: StoredEntry): Promise<void> {
  const { kept, dropped } = keepNewest([entry, ...signStore.getState().saved]);
  signStore.setState({ saved: kept });
  try {
    const db = await appDb();
    const rec: StoredSignatureRecord = { v: SIGNATURE_RECORD_VERSION, entry };
    await db.putSignature(entry.id, rec);
    for (const id of dropped) await db.deleteSignature(id);
  } catch (err) {
    recordError('sign.save', err);
  }
}

export async function deleteSignature(id: string): Promise<void> {
  signStore.setState((s) => ({ saved: s.saved.filter((e) => e.id !== id) }));
  try {
    await (await appDb()).deleteSignature(id);
  } catch (err) {
    recordError('sign.delete', err);
  }
}

/** "Clear all local data" (the database is deleted separately). */
export function resetSignatures(): void {
  loading = null;
  signStore.setState({ saved: [], loaded: false });
}

export function openSignDialog(docId: string): void {
  signStore.setState({ docId });
  void loadSignatures();
}

export function closeSignDialog(): void {
  signStore.setState({ docId: null });
}
