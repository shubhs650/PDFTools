import { describe, expect, it } from 'vitest';
import { accessStrategy, WRITE_CHUNK, writeToHandle } from '../../src/storage/fileAccess';

const noop = () => Promise.resolve();

describe('accessStrategy (M1-12, D-04)', () => {
  it('uses the File System Access API when both pickers exist (Chromium)', () => {
    expect(accessStrategy({ showOpenFilePicker: noop, showSaveFilePicker: noop })).toBe('fsa');
  });

  it('falls back to input + download without the pickers (Firefox, Safari)', () => {
    expect(accessStrategy({})).toBe('fallback');
    expect(accessStrategy({ showOpenFilePicker: noop })).toBe('fallback');
  });
});

describe('writeToHandle (M1-23): chunked, with progress, cancellable before commit', () => {
  function fakeHandle(onWrite?: (n: number) => void) {
    const log: string[] = [];
    let written = 0;
    const writable = {
      write: (b: Blob) => {
        written += b.size;
        log.push(`write:${String(b.size)}`);
        onWrite?.(written);
        return Promise.resolve();
      },
      close: () => {
        log.push('close');
        return Promise.resolve();
      },
      abort: () => {
        log.push('abort');
        return Promise.resolve();
      },
    };
    const handle = {
      createWritable: () => Promise.resolve(writable),
    } as unknown as FileSystemFileHandle;
    return { handle, log };
  }

  it('reports progress before and after each chunk and commits once', async () => {
    const { handle, log } = fakeHandle();
    const size = WRITE_CHUNK * 2 + 10;
    const seen: number[] = [];
    await writeToHandle(handle, new Blob([new Uint8Array(size)]), undefined, (done, total) => {
      expect(total).toBe(size);
      seen.push(done);
    });
    expect(seen).toEqual([0, WRITE_CHUNK, WRITE_CHUNK, WRITE_CHUNK * 2, WRITE_CHUNK * 2, size]);
    expect(log.at(-1)).toBe('close');
    expect(log.filter((l) => l === 'close')).toHaveLength(1);
  });

  it('an abort between chunks aborts the writable (nothing committed)', async () => {
    const ac = new AbortController();
    const { handle, log } = fakeHandle(() => {
      ac.abort();
    });
    await expect(
      writeToHandle(handle, new Blob([new Uint8Array(WRITE_CHUNK * 2)]), ac.signal),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(log).toEqual([`write:${String(WRITE_CHUNK)}`, 'abort']);
  });
});
