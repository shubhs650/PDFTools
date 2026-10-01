// PDF Oxide's raw output → the detectors' inputs (M4-12). Oxide returns JS
// Maps (made plain by toPlain); boxes are user-space, y up, a word's box from
// its baseline up by its font size.
import { toPlain } from '../oxide';
import type { OxideBox, OxideTable } from './lattice';
import type { StreamWord } from './stream';

interface RawWord {
  bbox?: OxideBox;
  text?: string;
  isBold?: boolean;
  avgFontSize?: number;
}

const finite = (b: OxideBox | undefined): b is OxideBox =>
  !!b && [b.x, b.y, b.width, b.height].every((v) => Number.isFinite(v));

export function wordsOf(raw: unknown): StreamWord[] {
  const list = toPlain(raw);
  if (!Array.isArray(list)) return [];
  const out: StreamWord[] = [];
  for (const w of list as RawWord[]) {
    const text = (w.text ?? '').trim();
    if (!text || !finite(w.bbox)) continue;
    const { x, y, width, height } = w.bbox;
    out.push({
      x0: x,
      y0: y,
      x1: x + width,
      y1: y + height,
      text,
      bold: w.isBold === true,
      size: w.avgFontSize && w.avgFontSize > 0 ? w.avgFontSize : height,
    });
  }
  return out;
}

export function tablesOf(raw: unknown): OxideTable[] {
  const list = toPlain(raw);
  if (!Array.isArray(list)) return [];
  return (list as Partial<OxideTable>[]).filter(
    (t): t is OxideTable => finite(t.bbox) && Array.isArray(t.rows),
  );
}
