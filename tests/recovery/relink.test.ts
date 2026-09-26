import { describe, expect, it } from 'vitest';
import { relinkCandidate, verifyRelink } from '../../src/features/recovery/relink';
import type { RecentEntry } from '../../src/storage/idb';

const handle = (content: string, gone = false) =>
  ({
    getFile: () =>
      gone
        ? Promise.reject(new DOMException('gone', 'NotFoundError'))
        : Promise.resolve(new Blob([content])),
  }) as unknown as FileSystemFileHandle;

const fpOf = async (b: Blob) => `fp:${await b.text()}`;

describe('re-link a recovered document (M1-24)', () => {
  it('finds the recent entry with the snapshot fingerprint and a handle', () => {
    const h = handle('x');
    const entries: RecentEntry[] = [
      { id: 'fp:y', name: 'y.pdf', size: 1, lastOpened: 2, handle: handle('y') },
      { id: 'fp:x', name: 'x.pdf', size: 1, lastOpened: 1, handle: h },
      { id: 'fp:z', name: 'z.pdf', size: 1, lastOpened: 3 },
    ];
    expect(relinkCandidate(entries, 'fp:x')).toBe(h);
    expect(relinkCandidate(entries, 'fp:z')).toBeUndefined();
    expect(relinkCandidate(entries, 'fp:none')).toBeUndefined();
  });

  it('only when the file on disk still has that fingerprint', async () => {
    const same = handle('x');
    expect(await verifyRelink(same, 'fp:x', fpOf)).toBe(same);
    expect(await verifyRelink(handle('changed'), 'fp:x', fpOf)).toBeUndefined();
    expect(await verifyRelink(handle('x', true), 'fp:x', fpOf)).toBeUndefined();
  });
});
