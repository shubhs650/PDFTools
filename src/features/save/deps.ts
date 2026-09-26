// The save flow's real dependencies (M1-21): the Render worker saves and
// digests, the Work worker verifies. The Work copy of a document is opened
// here if its first open failed (openDocument.ts leaves that to the first job).
import { recordEvent } from '../../app/diagnostics';
import type { SaveFlowDeps } from '../../engine/saveFlow';
import { originalBlob } from '../open/sources';
import { renderEngine, workClient } from '../view/host';

async function ensureWorkCopy(docId: string): Promise<void> {
  const work = workClient();
  if (work.has(docId)) return;
  const read = async () => (await originalBlob(docId)).arrayBuffer();
  await work.open(docId, await read(), { reload: read });
}

export function saveDeps(): SaveFlowDeps {
  const rpc = renderEngine().rpc;
  return {
    saveIncremental: (docId, keepAll) =>
      rpc.call('saveIncremental', { docId, ...(keepAll ? { keepAll } : {}) }).promise,
    async verify(docId, piece, expected, signal) {
      await ensureWorkCopy(docId);
      return workClient().run('verify', { docId, piece, expected }, signal ? { signal } : {})
        .promise;
    },
    commit: (docId, tailLength) => rpc.call('commitSave', { docId, tailLength }).promise,
    refreshWork: (docId, piece) => workClient().append(docId, piece),
    logFallback: ({ code, objectCount, size }) => {
      recordEvent('save', code, { objectCount, size });
    },
  };
}
