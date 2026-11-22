// OCR at compare time (M12-18, D-63, Q29): the OCR worker's words on a
// scanned page → positioned characters, as if the page had a text layer, so
// the rest of the text comparison reads them like any page. The words keep
// the OCR flag (TEXT_INVISIBLE, as an OCR text layer has), so their changes
// are labelled "from OCR". The file is not changed. Pure code.
import {
  TEXT_INVISIBLE,
  applyAffine,
  type Affine,
  type PageFrame,
  type PageText,
} from '../material';
import type { OcrLine } from '../../ocr/types';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * A recognised page → its PageText in displayed space. `dpi` is the raster's
 * resolution; `turn` maps PDFium's layout of the page (pt, y down) to the
 * displayed page.
 */
export function ocrPageText(
  lines: readonly OcrLine[],
  dpi: number,
  frame: PageFrame,
  turn: Affine,
): PageText {
  const k = 72 / dpi;
  const chars: { code: number; box: number[]; size: number; flags: number }[] = [];
  for (const line of lines)
    for (const w of line.words) {
      const cps = Array.from(graphemes.segment(w.text.normalize('NFC')), (g) => g.segment);
      if (cps.length === 0) continue;
      const [ax, ay] = applyAffine(turn, w.box.x0 * k, w.box.y0 * k);
      const [bx, by] = applyAffine(turn, w.box.x1 * k, w.box.y1 * k);
      const x0 = Math.min(ax, bx);
      const x1 = Math.max(ax, bx);
      const y0 = Math.min(ay, by);
      const y1 = Math.max(ay, by);
      const size = Math.max(1, (y1 - y0) * 1.15);
      const step = (x1 - x0) / cps.length;
      cps.forEach((g, i) => {
        // A cluster's code points share its box (a base letter and its marks).
        for (let at = 0; at < g.length;) {
          const code = g.codePointAt(at) ?? 32;
          chars.push({
            code,
            box: [x0 + i * step, y0, x0 + (i + 1) * step, y1],
            size,
            flags: TEXT_INVISIBLE,
          });
          at += code > 0xffff ? 2 : 1;
        }
      });
      // A real space ends the word (the layout splits words on it).
      chars.push({ code: 32, box: [x1, y0, x1, y1], size, flags: TEXT_INVISIBLE });
    }
  const n = chars.length;
  const t: PageText = {
    frame,
    codes: new Uint32Array(n),
    boxes: new Float32Array(n * 4),
    origins: new Float32Array(n * 2),
    sizes: new Float32Array(n),
    angles: new Float32Array(n),
    flags: new Uint8Array(n),
    structure: { imageCover: 1, figures: [], tables: [], ocr: true },
  };
  chars.forEach((c, i) => {
    t.codes[i] = c.code;
    t.boxes.set(c.box, i * 4);
    // Baseline: near the bottom of the word box (descenders are rare in values).
    t.origins.set([c.box[0] ?? 0, c.box[3] ?? 0], i * 2);
    t.sizes[i] = c.size;
    t.flags[i] = c.flags;
  });
  return t;
}
