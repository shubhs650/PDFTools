// Closing an information bar (owner, 2026-11-24, M13-04): the signatures,
// restrictions and XFA bars above a document, and the notes above a text
// comparison, each get a × that closes that one bar for that document or
// comparison while the window is open. Nothing is stored: the bar is back when
// the file is opened again. Prompts that ask for a decision keep their own buttons.
import { createStore, useStore } from 'zustand';

const closedBars = createStore<{ keys: ReadonlySet<string> }>()(() => ({ keys: new Set() }));

/** True once the bar `key` (e.g. `signatures:<docId>`) was closed in this window. */
export function useBarClosed(key: string): boolean {
  return useStore(closedBars, (s) => s.keys.has(key));
}

/** Every closed bar's key (for a list of notes). */
export function useClosedBars(): ReadonlySet<string> {
  return useStore(closedBars, (s) => s.keys);
}

export function closeBar(key: string): void {
  closedBars.setState((s) => ({ keys: new Set(s.keys).add(key) }));
}
