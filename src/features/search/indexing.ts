// Background text indexing, main-thread side (§6, ADR-006 decision 3, M2-06):
// one indexing job per open document, started once its Work copy exists and
// cancelled when it closes; scrolling and zooming are reported (throttled) so
// the Work worker backs off meanwhile.
import { warmOxide } from '../extract/oxideWarm';
import { noteActivity } from '../view/activity';
import { startedWorkClient, workClient } from '../view/host';

export type IndexState = 'indexing' | 'done' | 'stopped' | 'failed';

export interface IndexStatus {
  state: IndexState;
  done: number;
  total: number;
}

const jobs = new Map<string, { cancel(): void }>();
/** Indexing waits this long after open, so the first pages render first. */
export const START_DELAY_MS = 1000;
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const status = new Map<string, IndexStatus>();

/** Reports at most this often; the worker pauses for its quiet period after each. */
const ACTIVITY_THROTTLE_MS = 100;
let lastActivity = -Infinity;

export function startIndexing(docId: string, visible: number[], delayMs = START_DELAY_MS): void {
  if (jobs.has(docId) || pending.has(docId)) return;
  if (delayMs > 0) {
    pending.set(
      docId,
      setTimeout(() => {
        pending.delete(docId);
        startIndexing(docId, visible, 0);
      }, delayMs),
    );
    return;
  }
  const job = workClient().run(
    'indexText',
    { docId, visible },
    {
      onProgress: (p) => {
        status.set(docId, { state: 'indexing', ...p });
      },
    },
  );
  jobs.set(docId, job);
  status.set(docId, { state: 'indexing', done: 0, total: 0 });
  job.promise.then(
    (r) => {
      status.set(docId, { state: 'done', done: r.pages, total: r.pages });
      warmOxide(); // the Work worker is idle now (M4-04, ADR-009 d2)
    },
    () => {
      const s = status.get(docId);
      if (s?.state === 'indexing') status.set(docId, { ...s, state: 'failed' });
    },
  );
  void job.promise
    .finally(() => {
      if (jobs.get(docId) === job) jobs.delete(docId);
    })
    .catch(() => undefined);
}

/** Closing a tab cancels its indexing (the worker drops the cache on close). */
export function stopIndexing(docId: string): void {
  clearTimeout(pending.get(docId));
  pending.delete(docId);
  const s = status.get(docId);
  if (s?.state === 'indexing') status.set(docId, { ...s, state: 'stopped' });
  jobs.get(docId)?.cancel();
  jobs.delete(docId);
}

export function indexStatus(docId: string): IndexStatus | undefined {
  return status.get(docId);
}

/** The user is scrolling or zooming (called from the view on every such event). */
export function reportActivity(now = performance.now()): void {
  noteActivity(now);
  if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
  lastActivity = now;
  startedWorkClient()?.notifyActivity();
}
