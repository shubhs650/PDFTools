// E2E-only probe for OCR (M5-04, ADR-020). Never part of a production build.
import { ocrClient, ocrStore, recognizePages } from '../features/ocr/ocrJob';
import { pagesBusy } from '../features/pages/pageOps';
import { workClient } from '../features/view/host';
import type { OcrLanguage } from '../model/ocr/languages';
import { OCR_DPI } from '../model/ocr/types';
import type { TestHook } from './hook';

export function registerOcrProbe(hook: TestHook): void {
  hook.capabilities['ocr'] = {
    /** The last run's outcome (pages recognized and skipped, words). */
    last: () => ocrStore.getState().last,
    busy: () => pagesBusy(),
    /** Whether an OCR worker is alive right now (it must not outlive a job). */
    workerRunning: () => ocrClient().running,
    /** Recognizes pages as the dialog would (perf scenarios); resolves when applied. */
    run: (
      docId: string,
      pages: number[],
      languages: OcrLanguage[] = ['eng'],
      reRecognize = false,
    ) => recognizePages(docId, pages, languages, reRecognize),
    /** One raster through the Work worker: size and whether the page has text. */
    raster: async (docId: string, pageIndex: number, force = false) => {
      const r = await workClient().run('ocrRaster', { docId, pageIndex, dpi: OCR_DPI, force })
        .promise;
      return { hasText: r.hasText, width: r.width, height: r.height };
    },
  };
}
