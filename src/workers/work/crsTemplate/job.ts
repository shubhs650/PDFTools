// The Work worker's side of a CRS export into a project template (M13-07,
// D-71): ExcelJS loaded lazily, each row's snapshot rendered from a copy of
// its document with the unsaved edits appended (the ADR-013 route, as the
// Standard CRS), at twice the size it is shown in its column so it stays
// sharp. Only the finished file's bytes go back, transferred.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { snapshotOf, type SnapshotRegion } from '../crs';
import type { JobSlice } from '../scheduler';
import { fillTemplate, type TemplateFillSpec, type TemplateSnapshot } from './fill';

/** A row's snapshot: which document (index in the job's list) and the markup's box. */
export interface TemplateShot {
  doc: number;
  region: SnapshotRegion;
}

/** Rendered pixels per shown pixel. */
const SHARP = 2;

export async function exportTemplateCrs(
  mod: WrappedPdfiumModule,
  docPtrs: readonly (number | null)[],
  template: ArrayBuffer,
  spec: TemplateFillSpec,
  shots: readonly (readonly (TemplateShot | null)[])[] | null,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<{ bytes: ArrayBuffer; names: string[] }> {
  const { default: lib } = await import('exceljs');
  const total = spec.sheets.reduce((n, s) => n + s.rows.length, 0);
  progress({ done: 0, total });
  const snapshot = shots
    ? (g: number, i: number, widthPx: number, maxPx: number): Promise<TemplateSnapshot | null> => {
        const shot = shots[g]?.[i];
        const ptr = shot ? docPtrs[shot.doc] : null;
        if (!shot || ptr === null || ptr === undefined) return Promise.resolve(null);
        return snapshotOf(mod, ptr, shot.region, widthPx * SHARP, maxPx * SHARP)();
      }
    : null;
  const out = await fillTemplate(
    lib,
    template,
    spec,
    snapshot,
    () => slice.checkpoint(),
    (done) => {
      progress({ done, total });
    },
  );
  return { bytes: out.bytes, names: out.names };
}
