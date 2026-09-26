// Signatures pane state (D-24, §7.11, M2-13): checked in the Work worker,
// per document and saved state (a save appends a revision), once each.
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import { isAbortError } from '../../engine/errors';
import type { SignatureInfo } from '../../workers/work/signatures';
import { workClient } from '../view/host';

export type CheckState =
  | { state: 'checking'; done: number; total: number }
  | { state: 'ready'; items: SignatureInfo[] }
  | { state: 'failed' };

interface SignaturesState {
  /** Keyed by `${docId}|${appendedBytes}`. */
  checks: Record<string, CheckState>;
}

export const signaturesStore = createStore<SignaturesState>()(() => ({ checks: {} }));

export function useSignatures<T>(selector: (s: SignaturesState) => T): T {
  return useStore(signaturesStore, selector);
}

export const checkKey = (docId: string): string =>
  `${docId}|${String(documentStore.getState().docs[docId]?.appendedBytes ?? 0)}`;

const running = new Map<string, { cancel(): void }>();

const set = (key: string, v: CheckState): void => {
  signaturesStore.setState((s) => ({ checks: { ...s.checks, [key]: v } }));
};

export function checkDocument(docId: string): void {
  const key = checkKey(docId);
  if (signaturesStore.getState().checks[key] || running.has(key)) return;
  set(key, { state: 'checking', done: 0, total: 0 });
  const job = workClient().run(
    'checkSignatures',
    { docId },
    {
      onProgress: (p) => {
        set(key, { state: 'checking', ...p });
      },
    },
  );
  running.set(key, job);
  job.promise.then(
    (items) => {
      running.delete(key);
      set(key, { state: 'ready', items });
    },
    (err: unknown) => {
      running.delete(key);
      if (isAbortError(err))
        signaturesStore.setState((s) => ({
          checks: Object.fromEntries(Object.entries(s.checks).filter(([k]) => k !== key)),
        }));
      else set(key, { state: 'failed' });
    },
  );
}

documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const id of Object.keys(prev.docs)) {
    if (id in s.docs) continue;
    for (const [key, job] of running) if (key.startsWith(`${id}|`)) job.cancel();
    signaturesStore.setState((st) => ({
      checks: Object.fromEntries(
        Object.entries(st.checks).filter(([k]) => !k.startsWith(`${id}|`)),
      ),
    }));
  }
});
