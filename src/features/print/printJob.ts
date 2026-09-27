// The print job (D-25, §7.13, M2-15): which pages and regions, then banded
// renders in the Work worker (on a copy of the current revision, unsaved
// edits included) and PNG encoding in the encoder worker. The main thread
// only passes transferred buffers along (rule 1); each band is a checkpoint
// for Cancel (rule 2).
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { documentStore, securityOf } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import { editsSettled } from '../save/pendingEdits';
import { capability, hostStore, renderEngine, workClient } from '../view/host';
import {
  DPI,
  bands,
  isLandscape,
  parseRange,
  rasterSize,
  type PrintOptions,
  type RangeResult,
  type Region,
} from './options';

export interface PrintedPage {
  /** PNG bands, top to bottom. */
  bands: Blob[];
  /** Size of what is printed, in points (the page or its region). */
  width: number;
  height: number;
  landscape: boolean;
  dpi: number;
}

export interface Target {
  pageIndex: number;
  region: Region | null;
}

export class PrintCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'PrintCancelled';
  }
}

/** The visible part of the current page in the viewport, in page points (null: none shown). */
export function viewRegion(docId: string): Target | null {
  const slice = documentStore.getState().docs[docId];
  if (!slice) return null;
  const { page, scale, rotation } = slice.view;
  const vp = document.querySelector<HTMLElement>('#document-panel .viewport');
  const content = vp?.querySelector<HTMLElement>(`[data-page="${String(page)}"] .page-content`);
  if (!vp || !content) return null;
  // A rotated view isn't mapped back to page space: print the whole page.
  if (rotation !== 0) return { pageIndex: page, region: null };
  const v = vp.getBoundingClientRect();
  const c = content.getBoundingClientRect();
  const left = Math.max(v.left, c.left);
  const top = Math.max(v.top, c.top);
  const right = Math.min(v.right, c.right);
  const bottom = Math.min(v.bottom, c.bottom);
  if (right <= left || bottom <= top) return null;
  return {
    pageIndex: page,
    region: {
      x: (left - c.left) / scale,
      y: (top - c.top) / scale,
      width: (right - left) / scale,
      height: (bottom - top) / scale,
    },
  };
}

/** The bounds of the current text selection on its first page (null: nothing selected). */
export function selectionRegion(docId: string): Target | null {
  const registry = hostStore.getState().registry;
  const sel = registry ? capability<SelectionCapability>(registry, 'selection') : null;
  const first = sel?.forDocument(docId).getBoundingRects()[0];
  if (!first) return null;
  const r = first.rect;
  return {
    pageIndex: first.page,
    region: { x: r.origin.x, y: r.origin.y, width: r.size.width, height: r.size.height },
  };
}

/** What the options select, or why they can't be printed. */
export function targetsOf(
  docId: string,
  opts: PrintOptions,
): { ok: true; targets: Target[] } | { ok: false; error: string } {
  const slice = documentStore.getState().docs[docId];
  if (!slice) return { ok: false, error: 'noDocument' };
  const count = slice.meta.pageCount;
  switch (opts.range) {
    case 'all':
      return { ok: true, targets: Array.from({ length: count }, (_, i) => whole(i)) };
    case 'current':
      return { ok: true, targets: [whole(slice.view.page)] };
    case 'view': {
      const t = viewRegion(docId);
      return t ? { ok: true, targets: [t] } : { ok: false, error: 'noView' };
    }
    case 'area': {
      const t = selectionRegion(docId);
      return t ? { ok: true, targets: [t] } : { ok: false, error: 'noSelection' };
    }
    case 'custom': {
      const r: RangeResult = parseRange(opts.custom, count);
      return r.ok ? { ok: true, targets: r.pages.map(whole) } : { ok: false, error: r.error };
    }
  }
}

const whole = (pageIndex: number): Target => ({ pageIndex, region: null });

/** The resolution the document allows: high-quality print denied → standard (rule 9). */
export function dpiFor(docId: string, opts: PrintOptions): number {
  const meta = documentStore.getState().docs[docId]?.meta;
  const high = opts.quality === 'high' && meta && allows(securityOf(meta), 'printHighQuality');
  return high ? DPI.high : DPI.standard;
}

/**
 * Renders the targets. Progress counts bands; the signal stops it between
 * bands. The Work worker's print copy is always closed.
 */
export async function renderTargets(
  docId: string,
  targets: readonly Target[],
  opts: PrintOptions,
  signal: AbortSignal,
  onProgress: (p: { done: number; total: number }) => void,
): Promise<PrintedPage[]> {
  const check = (): void => {
    if (signal.aborted) throw new PrintCancelled();
  };
  const dpi = dpiFor(docId, opts);
  await editsSettled();
  // Unsaved edits: the Render worker's narrow tail, appended to the print copy.
  const { tail } = await renderEngine().rpc.call('snapshotTail', { docId }).promise;
  check();
  const work = workClient();
  // No respawn while the print copy is open (it lives in the worker).
  const release = work.hold();
  const piece = tail.byteLength > 0 ? tail : undefined;
  let printId: string;
  try {
    ({ printId } = await work.run(
      'printOpen',
      piece ? { docId, piece } : { docId },
      piece ? { transfer: [piece] } : {},
    ).promise);
  } catch (err) {
    release();
    throw err;
  }
  try {
    check();
    const boxes = await work.run('printPages', {
      printId,
      pages: targets.map((t) => t.pageIndex),
    }).promise;
    const plan = targets.map((t, i) => {
      const box = boxes[i] ?? { width: 1, height: 1, rotation: 0 };
      // Regions are in the unrotated page space; a rotated page prints whole.
      const region = t.region && box.rotation === 0 ? t.region : null;
      const size = region ?? { width: box.width, height: box.height };
      const raster = rasterSize(size, dpi);
      return { target: t, region, size, raster, bands: bands(raster.height) };
    });
    const total = plan.reduce((n, p) => n + p.bands.length, 0);
    let done = 0;
    onProgress({ done, total });
    const out: PrintedPage[] = [];
    for (const p of plan) {
      const encoded: Promise<Blob>[] = [];
      for (const b of p.bands) {
        check();
        const band = await work.run(
          'printBand',
          {
            printId,
            pageIndex: p.target.pageIndex,
            scale: p.raster.scale,
            region: p.region,
            top: b.top,
            rows: b.rows,
            markups: opts.markups,
          },
          { signal },
        ).promise;
        // Encoding overlaps the next band's render.
        encoded.push(
          renderEngine().encoder.call(
            'encode',
            { data: band.data, width: band.width, height: band.height, type: 'image/png' },
            { transfer: [band.data.buffer] },
          ).promise,
        );
        onProgress({ done: ++done, total });
      }
      const blobs = await Promise.all(encoded);
      out.push({
        bands: blobs,
        width: p.size.width,
        height: p.size.height,
        landscape: isLandscape(p.size),
        dpi: p.raster.dpi,
      });
    }
    return out;
  } catch (err) {
    if (signal.aborted) throw new PrintCancelled();
    throw err;
  } finally {
    void work
      .run('printClose', { printId })
      .promise.catch(() => undefined)
      .finally(release);
  }
}
