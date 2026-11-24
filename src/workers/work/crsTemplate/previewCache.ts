// The set-up's preview reads one workbook again and again (each step, each
// start row typed); the loaded workbook is kept for its key, one at a time
// (M13-08). Runs in the Work worker.
import type ExcelJS from 'exceljs';
import { loadTemplate, TemplateError } from './fill';
import { sheetPreview, type PreviewRequest, type SheetPreview } from './preview';

let kept: { key: string; wb: ExcelJS.Workbook } | null = null;

export async function previewOf(
  lib: typeof ExcelJS,
  key: string,
  bytes: ArrayBuffer,
  request: PreviewRequest,
): Promise<{ ok: true; preview: SheetPreview | null } | { ok: false }> {
  if (kept?.key !== key) {
    kept = null;
    try {
      kept = { key, wb: await loadTemplate(lib, bytes) };
    } catch (err) {
      if (err instanceof TemplateError) return { ok: false };
      throw err;
    }
  }
  return { ok: true, preview: sheetPreview(kept.wb, request) };
}
