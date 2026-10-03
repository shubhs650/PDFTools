// Recognize Text (OCR) on the main thread (M5-04, ADR-020 decisions 3, 5–8):
// the dialog's page scope → for each page without a text layer, the Work
// worker's raster (rule 1) → the OCR worker's words → the Work worker's
// text-layer objects → the Render worker applies them as one undo step
// through the comment-transfer route (`runTransfer`, capability modify). The
// page-operation busy dialog shows "Page n of m" with Cancel; a cancel stops
// between pages or terminates the OCR worker mid-page (decision 6). Nothing is
// applied when no word was found. The OCR worker is terminated when the job
// ends, so its memory is held only while recognizing.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { isAbortError, RpcError } from '../../engine/errors';
import { OcrClient } from '../../engine/ocrClient';
import { msg, t } from '../../i18n';
import { OCR_DPI, wordCount, type PageOcr } from '../../model/ocr/types';
import { DENIED } from '../../workers/work/permissionGate';
import { announceTransfer } from '../annotate/transfer/transferAnnounce';
import { resolveScope, type Scope } from '../extract/scope';
import { runTransfer, showPagesError, transferBlocked } from '../pages/pageOps';
import { selectionOf } from '../pages/selection';
import { workClient } from '../view/host';

export type OcrError = 'empty' | 'syntax' | 'outOfRange' | 'noSelection' | 'noDocument';

export interface OcrOutcome {
  /** Pages that received a text layer. */
  recognized: number;
  /** Pages skipped because they had text already. */
  skipped: number;
  words: number;
  /** Pages recognized but without any word (nothing written for them). */
  blank: number;
}

interface OcrState {
  /** The dialog's document (null: closed). */
  docId: string | null;
  error: OcrError | null;
  /** The last run's outcome (for the probe and the announcement). */
  last: OcrOutcome | null;
}

export const ocrStore = createStore<OcrState>()(() => ({ docId: null, error: null, last: null }));

export function useOcr<T>(selector: (s: OcrState) => T): T {
  return useStore(ocrStore, selector);
}

let client: OcrClient | null = null;

/** The OCR worker client (one for the app; the worker itself lives per job). */
export function ocrClient(): OcrClient {
  client ??= new OcrClient();
  return client;
}

/** Test seam: the client used by the next jobs. */
export function setOcrClient(c: OcrClient | null): void {
  client = c;
}

/** Why the command can't run now (null: it can; rule 9). */
export function ocrBlocked(docId: string): ReturnType<typeof transferBlocked> {
  return transferBlocked(docId, 'modify', msg('ocr.restricted'));
}

export function openOcr(docId: string): void {
  if (!documentStore.getState().docs[docId]) return;
  ocrStore.setState({ docId, error: null });
}

export function closeOcr(): void {
  ocrStore.setState({ docId: null, error: null });
}

/**
 * The dialog's Recognize: resolves the scope (errors stay in the dialog),
 * closes it and runs the job. Resolves once the layer is applied, or the job
 * was cancelled, found nothing or failed (announced or shown by the busy UI).
 */
export async function startOcr(scope: Scope): Promise<void> {
  const { docId } = ocrStore.getState();
  const d = docId ? documentStore.getState().docs[docId] : undefined;
  if (!docId || !d) {
    ocrStore.setState({ error: 'noDocument' });
    return;
  }
  const r = resolveScope(scope, {
    pageCount: d.meta.pageCount,
    current: d.view.page,
    selection: selectionOf(docId).selected,
  });
  if (!r.ok) {
    ocrStore.setState({ error: r.error });
    return;
  }
  closeOcr();
  await recognizePages(docId, r.pages);
}

/** Recognizes `pages` (0-based) of the document as one undo step. */
export async function recognizePages(docId: string, pages: readonly number[]): Promise<boolean> {
  const outcome: OcrOutcome = { recognized: 0, skipped: 0, words: 0, blank: 0 };
  /** Recognized pages, kept across a stale retry (the closure fills it). */
  const state: { results: PageOcr[] | null } = { results: null };
  const ocr = ocrClient();
  try {
    const ok = await runTransfer(
      docId,
      msg('ocr.recognizing'),
      async (progress, onCancel) => {
        const controller = new AbortController();
        onCancel(() => {
          controller.abort();
        });
        const signal = controller.signal;
        // A stale retry (the document changed meanwhile) rebuilds the layer only.
        if (!state.results) {
          const results: PageOcr[] = [];
          for (const [i, pageIndex] of pages.entries()) {
            progress({ done: i, total: pages.length });
            const raster = await workClient().run(
              'ocrRaster',
              { docId, pageIndex, dpi: OCR_DPI },
              { signal },
            ).promise;
            if (raster.hasText) {
              outcome.skipped++;
              continue;
            }
            const rec = await ocr.recognize(
              { width: raster.width, height: raster.height, data: raster.data, dpi: OCR_DPI },
              { signal },
            );
            const page: PageOcr = {
              pageIndex,
              width: raster.width,
              height: raster.height,
              lines: rec.lines,
            };
            if (wordCount(page) === 0) outcome.blank++;
            else results.push(page);
          }
          progress({ done: pages.length, total: pages.length });
          state.results = results;
        }
        ocr.stop();
        if (state.results.length === 0) return null;
        const layer = await workClient().run(
          'ocrLayer',
          { docId, pages: state.results },
          { signal },
        ).promise;
        outcome.recognized = layer.pages.length;
        outcome.words = layer.words;
        return { objects: layer.objects, firstNew: layer.firstNew };
      },
      { capability: 'modify', restricted: msg('ocr.restricted') },
    );
    ocrStore.setState({ last: outcome });
    if (ok) {
      announceTransfer(
        docId,
        t('ocr.done', {
          count: outcome.recognized,
          words: outcome.words,
          skipped: outcome.skipped,
        }),
      );
    } else if (state.results !== null && state.results.length === 0) {
      announceTransfer(docId, t('ocr.nothing', { skipped: outcome.skipped }));
    }
    return ok;
  } catch (err) {
    if (isAbortError(err)) return false;
    const denied = err instanceof RpcError && err.code.startsWith(DENIED);
    // Content-free (rule 10): the error's code and message are ours.
    if (!denied) recordError('ocr.run', err);
    showPagesError(denied ? msg('ocr.restricted') : msg('ocr.failed'));
    return false;
  } finally {
    ocr.stop();
  }
}
