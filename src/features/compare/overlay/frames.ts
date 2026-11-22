// A page's displayed size (points, /Rotate and the CropBox applied), from the
// Render worker (M12-11), cached per document edit count: the overlay's
// sheet is drawn in Document B's frame (A's for a sheet only A has), and the
// comparison's notes have one page of that size per sheet (M12-12).
import { useEffect, useState } from 'react';
import { renderEngine } from '../../view/host';
import type { Sheet } from './overlayState';

export interface Size {
  width: number;
  height: number;
}

const frames = new Map<string, Promise<Size>>();

/** The displayed size of a page, asked once per edit count. */
export function frameOf(docId: string, page: number, version: number): Promise<Size> {
  const key = `${docId}\n${String(page)}\n${String(version)}`;
  let job = frames.get(key);
  if (!job) {
    job = renderEngine().rpc.call('overlayFrame', { docId, pageIndex: page }).promise;
    frames.set(key, job);
    job.catch(() => frames.delete(key));
  }
  return job;
}

/** The page a sheet is drawn in: Document B's, or A's for a sheet only A has. */
export const framePage = (s: Sheet): Sheet['a'] => s.b ?? s.a;

/** A page's displayed size once known (null meanwhile). */
export function useFrame(p: Sheet['a'], version: number): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  const docId = p?.docId;
  const page = p?.page;
  useEffect(() => {
    if (docId === undefined || page === undefined) return;
    let live = true;
    frameOf(docId, page, version).then(
      (s) => {
        if (live) setSize(s);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [docId, page, version]);
  return size;
}
