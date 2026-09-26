// Owner-password unlock (D-19, §7.12, ADR-013 decision 3): the Render worker's
// document is unlocked in place (no reopen), then the Work worker's copy; the
// permissions are read back from PDFium, never assumed. The password is passed
// on and not kept here (M2-Q7).
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import { documentManager, renderEngine, startedWorkClient } from '../view/host';

interface UnlockState {
  /** Document whose unlock dialog is open. */
  docId: string | null;
  busy: boolean;
  /** The last owner password given was wrong. */
  wrong: boolean;
}

export const unlockStore = createStore<UnlockState>()(() => ({
  docId: null,
  busy: false,
  wrong: false,
}));

export function useUnlock<T>(selector: (s: UnlockState) => T): T {
  return useStore(unlockStore, selector);
}

export function openUnlockDialog(docId: string): void {
  unlockStore.setState({ docId, busy: false, wrong: false });
}

export function closeUnlockDialog(): void {
  unlockStore.setState({ docId: null, busy: false, wrong: false });
}

/** Unlocks both workers' copies; false for a wrong owner password (nothing changes then). */
export async function unlockOwner(docId: string, ownerPassword: string): Promise<boolean> {
  const dm = await documentManager();
  const ok = await dm.unlockOwnerPermissions(docId, ownerPassword).toPromise();
  if (!ok) return false;
  const info = await renderEngine().rpc.call('docInfo', { docId }).promise;
  documentStore
    .getState()
    .setSecurity(docId, { permissions: info.permissions, ownerUnlocked: info.ownerUnlocked });
  // The Work copy is unlocked too (and again after its reloads); a failure there
  // leaves the Render worker, which enforces edits, unlocked.
  await startedWorkClient()
    ?.unlock(docId, ownerPassword)
    .catch(() => false);
  return true;
}

/** The unlock dialog's submit. */
export async function submitUnlock(ownerPassword: string): Promise<void> {
  const { docId } = unlockStore.getState();
  if (!docId) return;
  unlockStore.setState({ busy: true, wrong: false });
  let ok = false;
  try {
    ok = await unlockOwner(docId, ownerPassword);
  } finally {
    if (ok) closeUnlockDialog();
    else unlockStore.setState({ busy: false, wrong: true });
  }
}
