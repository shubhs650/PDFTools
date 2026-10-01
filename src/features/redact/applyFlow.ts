// Apply Redactions (M4-17/18, §7.9 steps 2–5, rule 8): confirm → where to save
// (asked first, while the click's gesture is fresh; suggested
// "<name>-redacted.pdf") → the Work worker applies the marks on a copy,
// sanitizes, rewrites and verifies the output (progress, Cancel) → the file is
// written only when verification passed. The original file and the open
// document are never changed. A failed verification writes nothing and names
// the pages and checks (no content, rule 10), with a content-free report.
import { createStore, useStore } from 'zustand';
import { recordError, recordEvent, type DiagnosticEntry } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { RpcError } from '../../engine/errors';
import { t } from '../../i18n';
import {
  accessStrategy,
  downloadBytes,
  pickSaveTarget,
  writeToHandle,
} from '../../storage/fileAccess';
import type { RecutReport } from '../../workers/work/redact/pathRecut';
import type { Leak, LeakKind } from '../../workers/work/redact/verify';
import type { SkipStep } from '../../workers/work/redact/apply';
import { DENIED } from '../../workers/work/permissionGate';
import { openFiles } from '../open/openDocument';
import { settleEdits, syncLive } from '../pages/pageOps';
import { workClient } from '../view/host';

export interface ApplyResult {
  marks: number;
  pages: number;
  removedAnnotations: number;
  outlineItemsRemoved: number;
  fieldsRemoved: number;
  recut: RecutReport;
  name: string;
  /** The file it was written to (FSA), linked to the new tab when it is opened. */
  handle?: FileSystemFileHandle;
  bytes: ArrayBuffer;
}

export interface ApplyFailure {
  /** Pages (1-based) and the checks that failed there; page 0: the whole document. */
  leaks: { page: number; kinds: LeakKind[] }[];
  entry: DiagnosticEntry;
}

interface ApplyState {
  docId: string | null;
  running: { phase: 'apply' | 'verify'; done: number; total: number } | null;
  result: ApplyResult | null;
  failure: ApplyFailure | null;
  error: 'denied' | 'failed' | 'noMarks' | null;
}

const CLOSED: ApplyState = { docId: null, running: null, result: null, failure: null, error: null };

export const applyStore = createStore<ApplyState>()(() => CLOSED);

export function useApply<T>(selector: (s: ApplyState) => T): T {
  return useStore(applyStore, selector);
}

let job: AbortController | null = null;
/** The last verified output (e2e builds only: the test hook reads it). */
export let lastRedacted: ArrayBuffer | null = null;
/** e2e only: the failure-path probe leaves out one step (M4-18 tests). */
let testSkip: SkipStep | undefined;

export function setRedactTestSkip(skip: SkipStep | undefined): void {
  testSkip = skip;
}

export function openApply(docId: string): void {
  if (!documentStore.getState().docs[docId]) return;
  applyStore.setState({ ...CLOSED, docId });
}

export function closeApply(): void {
  job?.abort();
  job = null;
  applyStore.setState(CLOSED);
}

export function cancelApply(): void {
  job?.abort();
}

/** "plan.pdf" → "plan-redacted.pdf" (rule 11: the pattern is a message). */
export const redactedName = (name: string): string =>
  t('redact.apply.fileName', { base: name.replace(/\.pdf$/iu, '') || name });

/** Groups leaks by page (1-based; 0 for the document), kinds unique. */
export function groupLeaks(leaks: readonly Leak[]): { page: number; kinds: LeakKind[] }[] {
  const by = new Map<number, Set<LeakKind>>();
  for (const l of leaks) {
    const set = by.get(l.page + 1) ?? new Set<LeakKind>();
    set.add(l.kind);
    by.set(l.page + 1, set);
  }
  return [...by]
    .sort((a, b) => a[0] - b[0])
    .map(([page, kinds]) => ({ page, kinds: [...kinds].sort() }));
}

export async function runApply(): Promise<void> {
  const { docId, running } = applyStore.getState();
  const d = docId ? documentStore.getState().docs[docId] : undefined;
  if (!docId || !d || running) return;
  const name = redactedName(d.meta.name);
  const controller = new AbortController();
  job = controller;
  applyStore.setState({
    running: { phase: 'apply', done: 0, total: 0 },
    error: null,
    failure: null,
  });
  try {
    let handle: FileSystemFileHandle | undefined;
    if (accessStrategy() === 'fsa') {
      handle = await pickSaveTarget(name);
      if (!handle) {
        applyStore.setState({ running: null });
        return;
      }
    }
    // The Work copy sees every mark, saved or not.
    await settleEdits(docId);
    await syncLive(docId);
    controller.signal.throwIfAborted();
    const r = await workClient().run(
      'redact',
      { docId, ...(import.meta.env.MODE === 'e2e' && testSkip ? { skip: testSkip } : {}) },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (!controller.signal.aborted) applyStore.setState({ running: p });
        },
      },
    ).promise;
    controller.signal.throwIfAborted();
    if (r.marks === 0) {
      applyStore.setState({ running: null, error: 'noMarks' });
      return;
    }
    if (r.leaks.length > 0) {
      // Nothing is written (rule 8). The log entry carries pages and kinds only (rule 10).
      const leaks = groupLeaks(r.leaks);
      const counts: Record<string, number> = { pages: leaks.length };
      for (const l of r.leaks) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
      const entry = recordEvent('redact.verify', 'redaction-verification-failed', counts);
      applyStore.setState({ running: null, failure: { leaks, entry } });
      return;
    }
    const blob = new Blob([r.bytes], { type: 'application/pdf' });
    if (handle) await writeToHandle(handle, blob, controller.signal);
    else downloadBytes(blob, name);
    applyStore.setState({
      running: null,
      result: {
        marks: r.marks,
        pages: r.pages.length,
        removedAnnotations: r.removedAnnotations,
        outlineItemsRemoved: r.outlineItemsRemoved,
        fieldsRemoved: r.fieldsRemoved,
        recut: r.recut,
        name,
        bytes: r.bytes,
        ...(handle ? { handle } : {}),
      },
    });
    if (import.meta.env.MODE === 'e2e') lastRedacted = r.bytes;
  } catch (err) {
    const cancelled = controller.signal.aborted;
    const denied = err instanceof RpcError && err.code.startsWith(DENIED);
    if (!cancelled && !denied) recordError('redact.apply', err);
    applyStore.setState({ running: null, error: cancelled ? null : denied ? 'denied' : 'failed' });
  } finally {
    if (job === controller) job = null;
  }
}

/** Opens the redacted file in a new tab (linked to the file it was saved to, if any). */
export async function openRedacted(): Promise<void> {
  const { result } = applyStore.getState();
  if (!result) return;
  const file = new File([result.bytes], result.name, { type: 'application/pdf' });
  closeApply();
  await openFiles([{ file, ...(result.handle ? { handle: result.handle } : {}) }]);
}
