// E2E-only probe for the storage layer (M1-12). Never part of a production build.
import { AbortError } from '../engine/errors';
import { storageClient } from '../engine/storageClient';
import { appendToHandle } from '../storage/fileAccess';
import type { UiState } from '../storage/recoveryTypes';
import type { TestHook } from './hook';

const bytesOf = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

async function opfsFile(name: string, content: string): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(bytesOf(content));
  await w.close();
  return handle;
}

const text = async (h: FileSystemFileHandle): Promise<string> => (await h.getFile()).text();

export function registerStorageProbe(hook: TestHook): void {
  const client = () => storageClient();
  hook.capabilities['storage'] = {
    fingerprint: (content: string) =>
      client().call('fingerprint', { file: new Blob([bytesOf(content)]) }).promise,
    putOriginal: async (fp: string, content: string) => {
      const progress: number[] = [];
      const size = await client().call(
        'putOriginal',
        { fp, source: new Blob([bytesOf(content)]) },
        { onProgress: (p) => progress.push(p.done) },
      ).promise;
      return { size, progress };
    },
    writeTail: (fp: string, tail: string, ui?: UiState) =>
      client().call('writeTail', { fp, tail: bytesOf(tail).buffer, ...(ui ? { ui } : {}) }).promise,
    list: () => client().call('list', null).promise,
    read: async (fp: string) => {
      const r = await client().call('read', { fp }).promise;
      const dec = new TextDecoder();
      return { original: dec.decode(r.original), tail: dec.decode(r.tail), ui: r.ui ?? null };
    },
    discard: (fp: string) => client().call('discard', { fp }).promise,
    clearAll: () => client().call('clearAll', null).promise,
    /** OPFS files live under recovery/ only; the test checks nothing else appears. */
    opfsEntries: async () => {
      const root = await navigator.storage.getDirectory();
      const names: string[] = [];
      for await (const name of root.keys()) names.push(name);
      return names.sort();
    },
    /** Whether the main thread can make sync access handles (it must not; they are worker-only). */
    mainThreadSyncAccess: async () => {
      const h = await opfsFile('probe-sync.bin', '');
      const ok = typeof (h as { createSyncAccessHandle?: unknown }).createSyncAccessHandle;
      await (await navigator.storage.getDirectory()).removeEntry('probe-sync.bin');
      return ok === 'function';
    },
    /** FSA append on an OPFS-backed handle; `abort` cancels before commit. */
    append: async (initial: string, tail: string, abort: boolean) => {
      const h = await opfsFile('probe-append.pdf', initial);
      const ac = new AbortController();
      if (abort) ac.abort();
      let error: string | null = null;
      try {
        await appendToHandle(h, initial.length, bytesOf(tail), ac.signal);
      } catch (err) {
        error = err instanceof AbortError ? 'abort' : String(err);
      }
      const after = await text(h);
      await (await navigator.storage.getDirectory()).removeEntry('probe-append.pdf');
      return { after, error };
    },
    /** Append refuses when the file size no longer matches (changed on disk). */
    appendChanged: async () => {
      const h = await opfsFile('probe-changed.pdf', 'abcdef');
      let error: string | null = null;
      try {
        await appendToHandle(h, 3, bytesOf('X'));
      } catch (err) {
        error = (err as Error).name;
      }
      const after = await text(h);
      await (await navigator.storage.getDirectory()).removeEntry('probe-changed.pdf');
      return { after, error };
    },
  };
}
