// OPFS crash-recovery store (ARCHITECTURE §4.3, D-05, ADR-001 B11, ADR-005
// finding 10). Worker-only: writes use sync access handles, which exist only
// in dedicated workers (and cost ~1 ms at any file size), so nothing here can
// run on the main thread (rule 1). Never touches the user's file (rule 7).
//
// Layout, one directory per document fingerprint:
//   recovery/<fp>/original.pdf   the original bytes, written once on first edit
//   recovery/<fp>/tail-a.bin     the narrow incremental tail (ADR-005), written
//   recovery/<fp>/tail-b.bin     to the slot meta does NOT point at, then meta
//   recovery/<fp>/meta.json      is switched, so a crash mid-write keeps the
//                                previous snapshot intact.
// A directory without a complete original (meta.originalBytes) is ignored by
// list() and removed by discard().

import { AbortError } from '../engine/errors';
import type { RecoveryMeta, Snapshot, TailSlot, UiState } from './recoveryTypes';

export type { RecoveryMeta, Snapshot, TailSlot, UiState };

export const RECOVERY_DIR = 'recovery';
const CHUNK = 8 * 1024 * 1024;

export interface WriteControl {
  signal?: AbortSignal;
  progress?: (done: number, total: number) => void;
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortError();
}

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  write: (access: FileSystemSyncAccessHandle) => Promise<void> | void,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    await write(access);
    access.flush();
  } finally {
    access.close();
  }
}

async function readBytes(dir: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer> {
  const handle = await dir.getFileHandle(name);
  return (await handle.getFile()).arrayBuffer();
}

export class OpfsStore {
  /** Serializes work per fingerprint: a sync access handle is exclusive. */
  private readonly queues = new Map<string, Promise<unknown>>();

  private readonly root: FileSystemDirectoryHandle;

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
  }

  static async open(): Promise<OpfsStore> {
    return new OpfsStore(await navigator.storage.getDirectory());
  }

  private serial<T>(fp: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(fp) ?? Promise.resolve();
    const next = prev.then(job, job);
    const tracked = next.catch(() => undefined);
    this.queues.set(fp, tracked);
    void tracked.then(() => {
      if (this.queues.get(fp) === tracked) this.queues.delete(fp);
    });
    return next;
  }

  private async recoveryDir(create: boolean): Promise<FileSystemDirectoryHandle> {
    return this.root.getDirectoryHandle(RECOVERY_DIR, { create });
  }

  private async docDir(fp: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    if (!/^[0-9a-f]{16,128}$/.test(fp)) throw new Error('Invalid fingerprint');
    return (await this.recoveryDir(create)).getDirectoryHandle(fp, { create });
  }

  private async readMeta(dir: FileSystemDirectoryHandle): Promise<RecoveryMeta | undefined> {
    try {
      const meta = JSON.parse(new TextDecoder().decode(await readBytes(dir, 'meta.json'))) as
        RecoveryMeta | undefined;
      return meta?.v === 1 ? meta : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeMeta(dir: FileSystemDirectoryHandle, meta: RecoveryMeta): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(meta));
    await writeFile(dir, 'meta.json', (a) => {
      a.write(bytes, { at: 0 });
    });
  }

  /**
   * Stores the original bytes once (first edit, §4.3). A Blob is copied in
   * chunks with progress and can be cancelled; a no-op if already stored.
   */
  putOriginal(fp: string, source: Blob | ArrayBuffer, ctl: WriteControl = {}): Promise<number> {
    return this.serial(fp, async () => {
      const dir = await this.docDir(fp, true);
      const existing = await this.readMeta(dir);
      if (existing?.originalBytes !== undefined) return existing.originalBytes;
      const blob = source instanceof Blob ? source : new Blob([source]);
      const total = blob.size;
      try {
        await writeFile(dir, 'original.pdf', async (access) => {
          for (let at = 0; at < total; at += CHUNK) {
            checkAbort(ctl.signal);
            const chunk = new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer());
            access.write(chunk, { at });
            ctl.progress?.(Math.min(at + CHUNK, total), total);
          }
        });
      } catch (err) {
        await this.remove(fp);
        throw err;
      }
      await this.writeMeta(dir, { v: 1, fp, originalBytes: total, updated: Date.now() });
      return total;
    });
  }

  /** Recovery snapshot (§4.3): the narrow tail plus UI state, never a full re-serialization. */
  writeTail(fp: string, tail: ArrayBuffer | Uint8Array, ui?: UiState): Promise<void> {
    return this.serial(fp, async () => {
      const dir = await this.docDir(fp, false);
      const meta = await this.readMeta(dir);
      if (meta?.originalBytes === undefined) throw new Error('No original stored for snapshot');
      const slot: TailSlot = meta.tail?.slot === 'a' ? 'b' : 'a';
      const bytes = tail instanceof Uint8Array ? tail : new Uint8Array(tail);
      await writeFile(dir, `tail-${slot}.bin`, (a) => {
        a.write(bytes, { at: 0 });
      });
      await this.writeMeta(dir, {
        ...meta,
        tail: { slot, bytes: bytes.byteLength },
        ...(ui ? { ui } : {}),
        updated: Date.now(),
      });
    });
  }

  writeUiState(fp: string, ui: UiState): Promise<void> {
    return this.serial(fp, async () => {
      const dir = await this.docDir(fp, false);
      const meta = await this.readMeta(dir);
      if (meta?.originalBytes === undefined) throw new Error('No original stored for snapshot');
      await this.writeMeta(dir, { ...meta, ui, updated: Date.now() });
    });
  }

  /** Complete snapshots, newest first. */
  async list(): Promise<Snapshot[]> {
    let root: FileSystemDirectoryHandle;
    try {
      root = await this.recoveryDir(false);
    } catch {
      return [];
    }
    const out: Snapshot[] = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory') continue;
      const meta = await this.readMeta(handle);
      if (meta?.originalBytes === undefined || meta.fp !== name) continue;
      out.push({
        fp: meta.fp,
        originalBytes: meta.originalBytes,
        tailBytes: meta.tail?.bytes ?? 0,
        ui: meta.ui,
        updated: meta.updated,
      });
    }
    return out.sort((x, y) => y.updated - x.updated);
  }

  /** Original + tail of a snapshot, for "Recover unsaved changes?" (M1-22). */
  read(fp: string): Promise<{ original: ArrayBuffer; tail: ArrayBuffer; ui: UiState | undefined }> {
    return this.serial(fp, async () => {
      const dir = await this.docDir(fp, false);
      const meta = await this.readMeta(dir);
      if (meta?.originalBytes === undefined) throw new Error('No snapshot');
      const original = await readBytes(dir, 'original.pdf');
      const tail = meta.tail
        ? (await readBytes(dir, `tail-${meta.tail.slot}.bin`)).slice(0, meta.tail.bytes)
        : new ArrayBuffer(0);
      return { original, tail, ui: meta.ui };
    });
  }

  /** Clears a snapshot: after a successful save or an explicit discard (§4.3). */
  discard(fp: string): Promise<void> {
    return this.serial(fp, () => this.remove(fp));
  }

  private async remove(fp: string): Promise<void> {
    try {
      await (await this.recoveryDir(false)).removeEntry(fp, { recursive: true });
    } catch (err) {
      if ((err as DOMException | undefined)?.name !== 'NotFoundError') throw err;
    }
  }

  /** Settings → "Clear all local data" (§10.3). */
  async clearAll(): Promise<void> {
    try {
      await this.root.removeEntry(RECOVERY_DIR, { recursive: true });
    } catch (err) {
      if ((err as DOMException | undefined)?.name !== 'NotFoundError') throw err;
    }
  }
}
