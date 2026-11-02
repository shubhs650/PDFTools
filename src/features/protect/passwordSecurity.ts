// Protect → Password Security… and Remove Security (M6-12, D-40 a, §7.12,
// ADR-022 decision 2): where to save is asked first (while the click's
// gesture is fresh; suggested "<name>-protected.pdf" / "-unprotected.pdf",
// never the original) → the Render worker makes the new file on a copy of
// the current state → the Work worker reopens it with each password and
// compares → only then is it written. The open document, its file and its
// Ctrl+S are never changed. Passwords live in this module's call frames only:
// never stored, logged or put in a report (M2-Q7, rule 10).
import { createStore, useStore } from 'zustand';
import { recordError, recordEvent } from '../../app/diagnostics';
import { documentStore, securityOf, type DocumentMeta } from '../../app/store/documentStore';
import { RpcError } from '../../engine/errors';
import { msg, t } from '../../i18n';
import {
  baseName,
  encryptPlan,
  hasOwnerRights,
  isValid,
  validate,
  type PasswordSecurityForm,
} from '../../model/passwordSecurity';
import {
  accessStrategy,
  downloadBytes,
  pickSaveTarget,
  writeToHandle,
} from '../../storage/fileAccess';
import type { SecureAction } from '../../engine/renderApi';
import type { SecurityCheck } from '../../workers/work/verifySecurity';
import { openFiles } from '../open/openDocument';
import { settleEdits } from '../pages/pageOps';
import { renderEngine, workClient } from '../view/host';

export type SecurityMode = 'apply' | 'remove';

export interface SecurityResult {
  name: string;
  handle?: FileSystemFileHandle;
  bytes: ArrayBuffer;
  /** The new file needs a password to open (the summary says so). */
  openPassword: boolean;
  restricted: boolean;
}

interface SecurityState {
  docId: string | null;
  mode: SecurityMode;
  running: { phase: 'copy' | 'verify' | 'write'; done: number; total: number } | null;
  result: SecurityResult | null;
  /** 'verify': the check failed, nothing was written. */
  error: 'denied' | 'failed' | 'verify' | null;
}

const CLOSED: SecurityState = {
  docId: null,
  mode: 'apply',
  running: null,
  result: null,
  error: null,
};

export const securityStore = createStore<SecurityState>()(() => CLOSED);

export function useSecurity<T>(selector: (s: SecurityState) => T): T {
  return useStore(securityStore, selector);
}

let job: AbortController | null = null;
/** The last verified output (e2e builds only: the test hook reads it). */
export let lastSecured: ArrayBuffer | null = null;

/** Owner rights from the document's state (the Render worker checks again, live). */
export function ownerRights(meta: DocumentMeta): boolean {
  return hasOwnerRights({
    revision: securityOf(meta).revision,
    ownerUnlocked: meta.ownerUnlocked === true,
  });
}

export const isEncrypted = (meta: DocumentMeta): boolean => securityOf(meta).revision >= 2;

/** "plan.pdf" → "plan-protected.pdf" / "plan-unprotected.pdf" (rule 11: a message). */
export const securedName = (name: string, mode: SecurityMode): string =>
  t(mode === 'apply' ? msg('passwordSecurity.fileName') : msg('removeSecurity.fileName'), {
    base: baseName(name),
  });

export function openSecurityDialog(docId: string, mode: SecurityMode): void {
  if (!documentStore.getState().docs[docId]) return;
  securityStore.setState({ ...CLOSED, docId, mode });
}

export function closeSecurityDialog(): void {
  job?.abort();
  job = null;
  securityStore.setState(CLOSED);
}

export function cancelSecurity(): void {
  job?.abort();
}

/**
 * Applies the dialog's form (mode 'apply') or removes security ('remove').
 * Resolves when done; the store holds the outcome.
 */
export async function runSecurity(form?: PasswordSecurityForm): Promise<void> {
  const { docId, mode, running } = securityStore.getState();
  const d = docId ? documentStore.getState().docs[docId] : undefined;
  if (!docId || !d || running) return;
  let action: SecureAction;
  let check: SecurityCheck;
  let openPassword = false;
  let restricted = false;
  if (mode === 'apply') {
    if (!form || !isValid(validate(form))) return;
    const plan = encryptPlan(form);
    action = {
      kind: 'encrypt',
      userPassword: plan.userPassword,
      ownerPassword: plan.ownerPassword,
      flags: plan.flags,
    };
    check = {
      kind: 'encrypt',
      userPassword: plan.userPassword,
      ownerPassword: plan.ownerPassword,
      allowed: plan.allowed,
    };
    openPassword = form.openRequired;
    restricted = form.restrict;
  } else {
    action = { kind: 'remove' };
    check = { kind: 'remove' };
  }
  const name = securedName(d.meta.name, mode);
  const controller = new AbortController();
  job = controller;
  const { signal } = controller;
  securityStore.setState({ running: { phase: 'copy', done: 0, total: 2 }, error: null });
  try {
    let handle: FileSystemFileHandle | undefined;
    if (accessStrategy() === 'fsa') {
      handle = await pickSaveTarget(name);
      if (!handle) {
        securityStore.setState({ running: null });
        return;
      }
    }
    // Every edit, saved or not, reaches the Render worker first.
    await settleEdits(docId);
    signal.throwIfAborted();
    const made = await renderEngine().rpc.call(
      'secureCopy',
      { docId, action },
      {
        signal,
        onProgress: (p) => {
          if (!signal.aborted) securityStore.setState({ running: { phase: 'copy', ...p } });
        },
      },
    ).promise;
    signal.throwIfAborted();
    securityStore.setState({ running: { phase: 'verify', done: 0, total: 0 } });
    const verdict = await workClient().run(
      'verifySecurity',
      { bytes: made.bytes, check, expected: made.expected },
      {
        signal,
        onProgress: (p) => {
          if (!signal.aborted) securityStore.setState({ running: { phase: 'verify', ...p } });
        },
      },
    ).promise;
    signal.throwIfAborted();
    if (!verdict.ok) {
      // Nothing is written. The entry carries the failed check only (rule 10).
      recordEvent('security.verify', 'security-verification-failed', {
        [verdict.reason]: 1,
        ...(verdict.page === undefined ? {} : { page: verdict.page + 1 }),
      });
      securityStore.setState({ running: null, error: 'verify' });
      return;
    }
    securityStore.setState({ running: { phase: 'write', done: 0, total: 0 } });
    const blob = new Blob([made.bytes], { type: 'application/pdf' });
    if (handle) await writeToHandle(handle, blob, signal);
    else downloadBytes(blob, name);
    securityStore.setState({
      running: null,
      result: {
        name: handle?.name ?? name,
        bytes: made.bytes,
        openPassword,
        restricted,
        ...(handle ? { handle } : {}),
      },
    });
    if (import.meta.env.MODE === 'e2e') lastSecured = made.bytes;
  } catch (err) {
    const cancelled = signal.aborted;
    const denied = err instanceof RpcError && err.code === 'pdfium:5';
    if (!cancelled && !denied) recordError('security.apply', err);
    securityStore.setState({
      running: null,
      error: cancelled ? null : denied ? 'denied' : 'failed',
    });
  } finally {
    if (job === controller) job = null;
  }
}

/** Opens the new file in a new tab (linked to the file it was saved to, if any). */
export async function openSecured(): Promise<void> {
  const { result } = securityStore.getState();
  if (!result) return;
  const file = new File([result.bytes], result.name, { type: 'application/pdf' });
  closeSecurityDialog();
  await openFiles([{ file, ...(result.handle ? { handle: result.handle } : {}) }]);
}
