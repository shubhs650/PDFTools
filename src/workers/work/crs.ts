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

/** The box shown on screen for an unrotated box (top-left origin) on a page turned `q` quarter turns clockwise. */
export function displayBox(
  r: { x: number; y: number; width: number; height: number },
  page: { width: number; height: number },
  q: number,
): { x: number; y: number; width: number; height: number } {
  // `page` is the shown size; the unrotated page is W × H.
  const odd = q % 2 === 1;
  const W = odd ? page.height : page.width;
  const H = odd ? page.width : page.height;
  const at = (x: number, y: number): [number, number] =>
    q === 1 ? [H - y, x] : q === 2 ? [W - x, H - y] : q === 3 ? [y, W - x] : [x, y];
  const [ax, ay] = at(r.x, r.y);
  const [bx, by] = at(r.x + r.width, r.y + r.height);
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}

/** A span of at least `min` around [a, a + len], kept inside [0, size]. */
function span(a: number, len: number, min: number, size: number): [number, number] {
  const want = Math.min(size, Math.max(len + 2 * PAD, min));
  const start = Math.min(Math.max(0, a + len / 2 - want / 2), Math.max(0, size - want));
  return [start, Math.max(1, Math.min(size, start + want) - start)];
}

/**
 * The markup's region with a margin, as the page is shown (a turned page's
 * box is turned with it), kept on the page. At most `maxW` × `maxH` pixels (a
 * project template asks for its Snapshot column's size, M13-07). `min` widens
 * a small markup's region to show what is round it (a sticky note's icon
 * alone says nothing), centred on the markup.
 */
export function snapshotOf(
  mod: WrappedPdfiumModule,
  docPtr: number,
  r: SnapshotRegion,
  maxW = MAX_W,
  maxH = MAX_H,
  min: { width: number; height: number } = { width: 0, height: 0 },
): () => Promise<Snapshot> {
  return async () => {
    const box = pageBox(mod, docPtr, r.page);
    const d = displayBox(r, box, ((box.rotation % 4) + 4) % 4);
    const [x, width] = span(d.x, d.width, min.width, box.width);
    const [y, height] = span(d.y, d.height, min.height, box.height);
    const region = { x, y, width, height };
    const scale = Math.min(MAX_SCALE, maxW / region.width, maxH / region.height);
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
