// Self-made positioned text for the text comparison's unit tests (M12-17): a
// page's characters as the Work worker's `compareText` gives them, laid out
// from plain lines (5 pt a character at 10 pt, spaces as real space
// characters), and documents built from paragraphs through the engine's own
// layout and paragraph code.
import { TEXT_GENERATED, type PageText } from '../../../src/model/compare/material';
import { buildDoc, type TextDoc } from '../../../src/model/compare/text/document';
import { pageLayout } from '../../../src/model/compare/text/layout';
import type { Interner } from '../../../src/model/compare/text/myers';

export interface SynthChar {
  code: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size?: number;
  angle?: number;
  flags?: number;
}

export interface SynthLine {
  text: string;
  x?: number;
  y: number;
  size?: number;
}

/** Characters → a PageText (displayed space). */
export function pageTextOf(chars: SynthChar[], width = 595, height = 842): PageText {
  const n = chars.length;
  const t: PageText = {
    frame: { width, height, rotation: 0, toDisplay: [1, 0, 0, -1, 0, height] },
    codes: new Uint32Array(n),
    boxes: new Float32Array(n * 4),
    origins: new Float32Array(n * 2),
    sizes: new Float32Array(n),
    angles: new Float32Array(n),
    flags: new Uint8Array(n),
  };
  chars.forEach((c, i) => {
    const size = c.size ?? 10;
    t.codes[i] = c.code;
    t.boxes.set([c.x0, c.y0, c.x1, c.y1], i * 4);
    t.origins.set([c.x0, c.y0 + 0.8 * size], i * 2);
    t.sizes[i] = size;
    t.angles[i] = c.angle ?? 0;
    t.flags[i] = c.flags ?? 0;
  });
  return t;
}

/** Lines of text, left to right, 0.5 × size a character. */
export function linesText(lines: SynthLine[], width = 5000, height = 842): PageText {
  const chars: SynthChar[] = [];
  for (const l of lines) {
    const size = l.size ?? 10;
    let x = l.x ?? 50;
    for (const ch of l.text) {
      const w = 0.5 * size;
      chars.push({
        code: ch.codePointAt(0) ?? 32,
        x0: x,
        y0: l.y,
        x1: x + w,
        y1: l.y + size,
        size,
      });
      x += w;
    }
    // PDFium's generated line break after each line.
    chars.push({ code: 13, x0: x, y0: l.y, x1: x, y1: l.y + size, size, flags: TEXT_GENERATED });
  }
  return pageTextOf(chars, width, height);
}

/** One paragraph a line, 30 pt apart, clear of the header and footer bands. */
export const paragraphsText = (paras: string[]): PageText =>
  linesText(paras.map((text, i) => ({ text, y: 150 + i * 30 })));

/** A document of pages of paragraphs, through the engine's layout and paragraph code. */
export function docOf(pages: string[][], intern: Interner): TextDoc {
  return buildDoc(
    pages.map((paras) => pageLayout(paragraphsText(paras))),
    intern,
  );
}
