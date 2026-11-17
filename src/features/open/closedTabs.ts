// Reopen Closed Tab (M11-05, ADR-028 D-50): the tabs closed in this session that came
// from a file on disk, newest last, with their File System Access handles (as Recent
// files keeps them). In memory only: handles of closed documents are never written
// anywhere, and a document with no handle (a new one, a download, Firefox or Safari)
// cannot be reopened from the file, so it is not listed.
import { notify } from '../../app/commands/dispatch';
import type { DocumentSource } from '../../app/store/documentStore';

export interface ClosedTab {
  /** The tab's name when it closed (shown in the error if reopening fails). */
  name: string;
  handle: FileSystemFileHandle;
  /** Where it had come from: the reopened tab's hover card says the same. */
  source: DocumentSource;
  /** Its place in the row when it closed: reopened there. */
  index: number;
}

/** Enough for a working day; the oldest go first. */
export const MAX_CLOSED = 25;

const closed: ClosedTab[] = [];

/** The sources a reopened tab keeps; others (a recovered copy, …) read "opened". */
const KEEP: ReadonlySet<DocumentSource> = new Set([
  'picked',
  'dropped',
  'launched',
  'recent',
  'saved',
]);

/** Called as a document closes, with its handle if it has one. */
export function rememberClosed(tab: {
  name: string;
  handle: FileSystemFileHandle | undefined;
  source: DocumentSource | undefined;
  index: number;
}): void {
  if (!tab.handle) return;
  closed.push({
    name: tab.name,
    handle: tab.handle,
    source: tab.source && KEEP.has(tab.source) ? tab.source : 'picked',
    index: tab.index,
  });
  if (closed.length > MAX_CLOSED) closed.splice(0, closed.length - MAX_CLOSED);
  notify();
}

export const closedCount = (): number => closed.length;

/** For tests: forget them all. */
export function clearClosed(): void {
  closed.length = 0;
  notify();
}

/** Takes the last closed tab off the list (to reopen it). */
export function takeLastClosed(): ClosedTab | undefined {
  const tab = closed.pop();
  if (tab) notify();
  return tab;
}
