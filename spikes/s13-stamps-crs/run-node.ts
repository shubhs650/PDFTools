// M3-02 spike, Node part (ADR-015): CRS snapshots — a crop around each markup
// with the markups drawn. Two routes on the Work worker's copy (the ADR-013
// "copy with unsaved edits" route): PDFium's annotation render flag on the crop,
// or the content crop plus only the markups that meet it (ADR-014 annotation
// tiles). Writes spikes/s13-stamps-crs/out/s13-node.json.
//
//   node --import ./spikes/shared/ts-ext.ts spikes/s13-stamps-crs/run-node.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init } from '@embedpdf/pdfium';
import { markedContractPdf, markedSheetPdf } from '../../e2e/fixtures/generate.ts';
import { acquirePage } from '../../src/workers/render/pdfium.ts';
import { annotBoxes, renderAnnotTile, type AnnotBox } from '../s12-annotate/annot-tiles.ts';

const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round((s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0) * 100) / 100;
};
const stats = (xs: number[]) => ({
  n: xs.length,
  p50: pct(xs, 50),
  p95: pct(xs, 95),
  max: pct(xs, 100),
  totalMs: Math.round(xs.reduce((a, b) => a + b, 0)),
});

/** A 256-px square snapshot around each markup, at most `limit` markups. */
async function snapshots(name: string, bytes: Uint8Array, limit: number) {
  const doc: PdfDocumentObject = await native
    .openDocumentBuffer({ id: name, content: bytes.slice().buffer })
    .toPromise();
  const flag: number[] = [];
  const tiles: number[] = [];
  let done = 0;
  for (const page of doc.pages) {
    if (done >= limit) break;
    const ref = acquirePage(native, name, page.index);
    const boxes: AnnotBox[] = annotBoxes(mod, ref.pagePtr);
    ref.release();
    for (const b of boxes) {
      if (done >= limit) break;
      // The markup plus a margin, as a square in top-left page points.
      const side = Math.max(b.r - b.l, b.t - b.b) + 40;
      const x = Math.max(0, (b.l + b.r) / 2 - side / 2);
      const y = Math.max(0, page.size.height - (b.t + b.b) / 2 - side / 2);
      const scale = 256 / side;
      const rect = { origin: { x, y }, size: { width: side, height: side } };
      let t0 = performance.now();
      await native
        .renderPageRect(doc, page, rect, { scaleFactor: scale, withAnnotations: true })
        .toPromise();
      flag.push(performance.now() - t0);
      t0 = performance.now();
      await native.renderPageRect(doc, page, rect, { scaleFactor: scale }).toPromise();
      renderAnnotTile(mod, native, name, boxes, page.size.height, x, y, scale, 256, page.index);
      tiles.push(performance.now() - t0);
      done++;
    }
  }
  await native.closeDocument(doc).toPromise();
  return { snapshots: done, annotationFlag: stats(flag), contentPlusMarkups: stats(tiles) };
}

const out = {
  // Contract: 5 markups per page, 1,000 snapshots over 200 pages.
  markedContract: await snapshots('contract', markedContractPdf(200, 5), 1000),
  // Dense A0 with 1,000 markups: 200 snapshots on the one page.
  markedSheet: await snapshots('sheet', markedSheetPdf(200_000, 1000), 200),
};
mkdirSync('spikes/s13-stamps-crs/out', { recursive: true });
writeFileSync('spikes/s13-stamps-crs/out/s13-node.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
