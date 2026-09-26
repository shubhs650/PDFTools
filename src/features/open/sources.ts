// Where each open document came from (M1-13): the File (and FSA handle on
// Chromium), its fingerprint and size. Not in a Zustand store: handles and
// Files are not UI state. Save (M1-22) and recovery (M1-24) read it.

export interface DocSource {
  file: File;
  handle?: FileSystemFileHandle;
  fingerprint: string;
  /** Size of the file as opened: the offset for the first incremental append. */
  size: number;
  /**
   * Set once the app has written to `handle` (M1-22). The file then holds the
   * original bytes as its prefix, but `file` (a snapshot from before) can no
   * longer be read.
   */
  written?: boolean;
}

/**
 * The bytes the document was opened from (the prefix of the file as saved):
 * the Work worker's copy is original + tail (M1-21), and Save As copies them.
 */
export async function originalBlob(docId: string): Promise<Blob> {
  const src = sources.get(docId);
  if (!src) throw new Error('document source missing');
  if (src.written && src.handle) return (await src.handle.getFile()).slice(0, src.size);
  return src.file;
}

export const sources = new Map<string, DocSource>();

export interface Candidate {
  handle?: FileSystemFileHandle;
  fingerprint: string;
}

/**
 * The open document that is the same file as `candidate`, if any. Two FSA
 * handles are compared with `isSameEntry` (same path on disk); otherwise the
 * fingerprint decides (a dropped copy of an open file focuses its tab).
 */
export async function findDuplicate(
  candidate: Candidate,
  open: ReadonlyMap<string, Candidate> = sources,
): Promise<string | undefined> {
  for (const [id, src] of open) {
    if (candidate.handle && src.handle) {
      if (await candidate.handle.isSameEntry(src.handle)) return id;
    } else if (candidate.fingerprint === src.fingerprint) {
      return id;
    }
  }
  return undefined;
}
