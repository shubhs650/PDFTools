// CRS export in the Work worker (M3-19, D-15, §3.1, §7.5, ADR-015): the
// workbook is built here with ExcelJS (lazy-loaded: non-core), each row's
// snapshot rendered from a copy of the current revision with the unsaved
// edits appended (the ADR-013 route), markups drawn, encoded to PNG with
// OffscreenCanvas. Progress per row, cancel between rows (rule 2); only the
// finished file's bytes go back, transferred.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { JobSlice } from './scheduler';
import { buildWorkbook, type Snapshot, type WorkbookSpec } from './crsWorkbook';
import { pageBox, renderBand } from './print';

export interface SnapshotRegion {
  /** 0-based page; the markup's box in page points, top-left origin (unrotated). */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Largest snapshot in pixels, and the margin around the markup (points). */
const MAX_W = 240;
const MAX_H = 160;
const PAD = 12;
const MAX_SCALE = 4;

async function toPng(data: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

/** The markup's region with a margin, clipped to the page; the whole page when rotated. */
function snapshotOf(
  mod: WrappedPdfiumModule,
  docPtr: number,
  r: SnapshotRegion,
): () => Promise<Snapshot> {
  return async () => {
    const box = pageBox(mod, docPtr, r.page);
    const region =
      box.rotation === 0
        ? (() => {
            const x = Math.max(0, r.x - PAD);
            const y = Math.max(0, r.y - PAD);
            return {
              x,
              y,
              width: Math.max(1, Math.min(box.width, r.x + r.width + PAD) - x),
              height: Math.max(1, Math.min(box.height, r.y + r.height + PAD) - y),
            };
          })()
        : { x: 0, y: 0, width: box.width, height: box.height };
    const scale = Math.min(MAX_SCALE, MAX_W / region.width, MAX_H / region.height);
    const rows = Math.max(1, Math.round(region.height * scale));
    const band = renderBand(mod, docPtr, {
      pageIndex: r.page,
      scale,
      region,
      top: 0,
      rows,
      markups: 'on',
    });
    return {
      png: await toPng(band.data, band.width, band.height),
      width: band.width,
      height: rows,
    };
  };
}

export async function exportCrs(
  mod: WrappedPdfiumModule,
  docPtr: number | null,
  spec: WorkbookSpec,
  regions: readonly SnapshotRegion[] | null,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<ArrayBuffer> {
  const { default: lib } = await import('exceljs');
  const total = spec.rows.length;
  progress({ done: 0, total });
  const snapshot =
    regions && docPtr !== null
      ? (i: number): Promise<Snapshot | null> => {
          const r = regions[i];
          return r ? snapshotOf(mod, docPtr, r)() : Promise.resolve(null);
        }
      : null;
  return buildWorkbook(
    lib,
    spec,
    snapshot,
    () => slice.checkpoint(),
    (done) => {
      progress({ done, total });
    },
  );
}
