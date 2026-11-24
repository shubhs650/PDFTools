// Spike S33 (M13-06), browser part: the template load, fill and write in a
// module worker, with ExcelJS imported lazily as the app's Work worker does
// (src/workers/work/crs.ts). The template is made in the worker by the same
// script (rule 13), then loaded from its bytes like a picked file.
import { fillGroups, fillOne, commentsA, specA } from './scenarios';
import { templateA, A } from './templates';

export interface Job {
  rows: number;
  snapEvery: number;
  sheets: number;
}

self.onmessage = async (e: MessageEvent<Job>) => {
  try {
    const t0 = performance.now();
    const { default: lib } = await import('exceljs');
    const tLib = performance.now() - t0;
    const template = await templateA(lib);
    const t1 = performance.now();
    const { rows, snapEvery, sheets } = e.data;
    const bytes =
      sheets <= 1
        ? (await fillOne(lib, template, A.sheet, specA(), commentsA(rows, 1, snapEvery))).bytes
        : (
            await fillGroups(
              lib,
              template,
              A.sheet,
              Array.from({ length: sheets }, (_, g) => ({
                name: `Page ${String(g + 1)}`,
                rows: commentsA(Math.ceil(rows / sheets), g + 1, snapEvery),
              })),
              () => specA(),
            )
          ).bytes;
    const ms = performance.now() - t1;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    self.postMessage(
      {
        ms,
        libMs: tLib,
        size: bytes.length,
        heapMB: heap ? heap.usedJSHeapSize / 1e6 : null,
        buffer: bytes.buffer,
      },
      { transfer: [bytes.buffer] },
    );
  } catch (err) {
    self.postMessage({ error: (err as Error).message });
  }
};
