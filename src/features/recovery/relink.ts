// Re-linking a recovered document to its file (§4.3, M1-24): the recent list
// (M1-18) keeps file handles keyed by the fingerprint of the file as opened,
// which is also the snapshot's key. If that file is still unchanged on disk
// (same fingerprint now), Ctrl+S can append to it again.
import type { RecentEntry } from '../../storage/idb';

export function relinkCandidate(
  entries: readonly RecentEntry[],
  fp: string,
): FileSystemFileHandle | undefined {
  return entries.find((e) => e.id === fp && e.handle)?.handle;
}

/** The handle, if its file still has fingerprint `fp`; never throws. */
export async function verifyRelink(
  handle: FileSystemFileHandle,
  fp: string,
  fingerprintOf: (file: Blob) => Promise<string>,
): Promise<FileSystemFileHandle | undefined> {
  try {
    return (await fingerprintOf(await handle.getFile())) === fp ? handle : undefined;
  } catch {
    return undefined;
  }
}
