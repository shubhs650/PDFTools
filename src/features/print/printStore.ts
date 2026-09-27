// Print dialog state (M2-15): the options (kept for the session), the job's
// progress, and running it: targets → Work-worker renders → print frame.
import { createStore, useStore } from 'zustand';
import { DEFAULT_OPTIONS, isPercentValid, type PrintOptions } from './options';
import { buildPrintFrame, printFrame } from './printFrame';
import { PrintCancelled, renderTargets, targetsOf } from './printJob';

interface PrintState {
  docId: string | null;
  options: PrintOptions;
  running: { done: number; total: number } | null;
  /** 'failed' or null. */
  error: string | null;
}

export const printStore = createStore<PrintState>()(() => ({
  docId: null,
  options: DEFAULT_OPTIONS,
  running: null,
  error: null,
}));

export function usePrint<T>(selector: (s: PrintState) => T): T {
  return useStore(printStore, selector);
}

let job: AbortController | null = null;

export function openPrint(docId: string): void {
  printStore.setState({ docId, running: null, error: null });
}

export function closePrint(): void {
  job?.abort();
  job = null;
  printStore.setState({ docId: null, running: null, error: null });
}

export function setOptions(patch: Partial<PrintOptions>): void {
  printStore.setState((s) => ({ options: { ...s.options, ...patch }, error: null }));
}

export function cancelPrint(): void {
  job?.abort();
}

/** Renders and prints with the current options (the dialog has validated them). */
export async function startPrint(): Promise<void> {
  const { docId, options } = printStore.getState();
  if (!docId || printStore.getState().running) return;
  const targets = targetsOf(docId, options);
  if (!targets.ok || (options.scale === 'custom' && !isPercentValid(options.percent))) return;
  const controller = new AbortController();
  job = controller;
  printStore.setState({ running: { done: 0, total: 0 }, error: null });
  try {
    const pages = await renderTargets(docId, targets.targets, options, controller.signal, (p) => {
      printStore.setState({ running: p });
    });
    const frame = await buildPrintFrame(pages, options.scale, options.percent, controller.signal);
    printStore.setState({ docId: null, running: null });
    printFrame(frame);
  } catch (err) {
    const cancelled = err instanceof PrintCancelled || controller.signal.aborted;
    printStore.setState({ running: null, error: cancelled ? null : 'failed' });
  } finally {
    if (job === controller) job = null;
  }
}
