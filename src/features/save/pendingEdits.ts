// Edits still on their way to the Render worker (M2-19): a form field commits
// its value asynchronously, so a Ctrl+S pressed in the field could otherwise
// reach the worker first and save without it. Anything that reads the
// document's current state (save, print, print-ready export) waits for these.

const pending = new Set<Promise<unknown>>();

/** Registers an edit in flight; returns it unchanged. */
export function trackEdit<T>(edit: Promise<T>): Promise<T> {
  pending.add(edit);
  const done = (): void => {
    pending.delete(edit);
  };
  edit.then(done, done);
  return edit;
}

/** Resolves once every edit registered so far has settled (failures included). */
export async function editsSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
