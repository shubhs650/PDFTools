// Tesseract's result iterator → our page result (ADR-020 decision 3), and the
// raster as a PGM file for Leptonica (no image codec needed: the Work worker
// renders 8-bit gray already). Pure, so it is unit-tested with a fake iterator.
import type { TessIterator } from 'tesseract.js-core/tesseract-core-simd-lstm.js';
import type { OcrLine } from '../../model/ocr/types';

/** PageIteratorLevel (tesseract/publictypes.h). */
export const RIL_TEXTLINE = 2;
export const RIL_WORD = 3;

/** Lines with their baselines and words, in Tesseract's reading order. */
export function readLines(it: TessIterator): OcrLine[] {
  const lines: OcrLine[] = [];
  it.Begin();
  do {
    if (it.IsAtBeginningOf(RIL_TEXTLINE) || lines.length === 0) {
      const b = it.getBaseline(RIL_TEXTLINE);
      lines.push({
        box: it.getBoundingBox(RIL_TEXTLINE),
        baseline: b.has_baseline ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : null,
        words: [],
      });
    }
    const text = it.GetUTF8Text(RIL_WORD).trim();
    if (text.length > 0) {
      lines[lines.length - 1]?.words.push({
        text,
        box: it.getBoundingBox(RIL_WORD),
        conf: it.Confidence(RIL_WORD),
      });
    }
  } while (it.Next(RIL_WORD));
  return lines.filter((l) => l.words.length > 0);
}

/** A binary PGM ("P5") of a gray raster, rows top-down. */
export function pgmOf(width: number, height: number, data: Uint8Array): Uint8Array {
  const header = `P5\n${String(width)} ${String(height)}\n255\n`;
  const out = new Uint8Array(header.length + data.length);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  out.set(data, header.length);
  return out;
}
