// Print dialog state (M2-15): the options (kept for the session), the job's
// progress, and running it: targets → Work-worker renders → print frame.
import { createStore, useStore } from 'zustand';
import { documentStore, securityOf } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import { buildPrintReady } from './exportPrintReady';
import { DEFAULT_OPTIONS, isPercentValid, viewerBlock, type PrintOptions } from './options';
import { buildPrintFrame, printFrame } from './printFrame';
import { PrintCancelled, renderTargets, targetsOf, type Target } from './printJob';
import { openViewerFrame, printViewerFrame } from './viewerRoute';

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

/** Whether the browser-viewer route can print `docId` with `opts` (null) or why not. */
export function viewerBlockFor(docId: string, opts: PrintOptions) {
  const meta = documentStore.getState().docs[docId]?.meta;
  return viewerBlock(opts, !!meta && allows(securityOf(meta), 'printHighQuality'));
}

/**
 * The browser-viewer route (M2-16): the print-ready copy of the chosen pages
 * (document order), then the viewer's own print dialog. Scale and quality are
 * the viewer's (vector).
 */
async function printViaViewer(
  docId: string,
  targets: readonly Target[],
  opts: PrintOptions,
  signal: AbortSignal,
): Promise<void> {
  const count = documentStore.getState().docs[docId]?.meta.pageCount ?? 0;
  const pages = [...new Set(targets.map((t) => t.pageIndex))].sort((a, b) => a - b);
  const pdf = await buildPrintReady(
    docId,
    {
      pages: pages.length === count ? null : pages,
      markups: opts.markups === 'off' ? 'off' : 'on',
    },
    signal,
    (p) => {
      if (!signal.aborted) printStore.setState({ running: p });
    },
  );
  const frame = await openViewerFrame(pdf, signal);
  printStore.setState({ docId: null, running: null });
  printViewerFrame(frame);
}

/** Renders and prints with the current options (the dialog has validated them). */
export async function startPrint(): Promise<void> {
  const { docId, options } = printStore.getState();
  if (!docId || printStore.getState().running) return;
  const targets = targetsOf(docId, options);
  // A blocked viewer route falls back to raster (the dialog shows why).
  const viewer = options.method === 'viewer' && !viewerBlockFor(docId, options);
  if (!targets.ok) return;
  if (!viewer && options.scale === 'custom' && !isPercentValid(options.percent)) return;
  const controller = new AbortController();
  job = controller;
  printStore.setState({ running: { done: 0, total: 0 }, error: null });
  try {
    if (viewer) {
      await printViaViewer(docId, targets.targets, options, controller.signal);
      return;
    }
    const pages = await renderTargets(docId, targets.targets, options, controller.signal, (p) => {
      printStore.setState({ running: p });
    });
    const frame = await buildPrintFrame(pages, options.scale, options.percent, controller.signal);
    printStore.setState({ docId: null, running: null });
    printFrame(frame);
  } catch (err) {
    const cancelled =
      err instanceof PrintCancelled ||
      (err instanceof DOMException && err.name === 'AbortError') ||
      controller.signal.aborted;
    printStore.setState({ running: null, error: cancelled ? null : 'failed' });
  } finally {
    if (job === controller) job = null;
  }
}
