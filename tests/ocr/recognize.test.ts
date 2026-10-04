import type { TessIterator } from 'tesseract.js-core/tesseract-core-simd-lstm.js';
import { describe, expect, it } from 'vitest';
import { pgmOf, readLines, RIL_TEXTLINE, RIL_WORD } from '../../src/workers/ocr/recognize';

interface FakeWord {
  text: string;
  box: [number, number, number, number];
  conf: number;
  /** Starts a new line with this box and baseline. */
  line?: {
    box: [number, number, number, number];
    baseline: [number, number, number, number] | null;
  };
}

/** A ResultIterator over `words`, in Tesseract's shape (Next advances by word). */
function fakeIterator(words: FakeWord[]): TessIterator {
  let at = 0;
  const box = (b: [number, number, number, number]) => ({ x0: b[0], y0: b[1], x1: b[2], y1: b[3] });
  const lineOf = (i: number) => {
    for (let k = i; k >= 0; k--) {
      const l = words[k]?.line;
      if (l) return l;
    }
    throw new Error('no line');
  };
  return {
    Begin: () => {
      at = 0;
    },
    Next: (level) => {
      if (level !== RIL_WORD) throw new Error('only words are iterated');
      at++;
      return at < words.length;
    },
    IsAtBeginningOf: (level) => level === RIL_TEXTLINE && words[at]?.line !== undefined,
    GetUTF8Text: (level) => (level === RIL_WORD ? (words[at]?.text ?? '') : ''),
    Confidence: () => words[at]?.conf ?? 0,
    getBoundingBox: (level) => {
      const w = words[at];
      if (!w) throw new Error('past the end');
      return box(level === RIL_WORD ? w.box : lineOf(at).box);
    },
    getBaseline: () => {
      const b = lineOf(at).baseline;
      return b
        ? { ...box(b), has_baseline: true }
        : { x0: 0, y0: 0, x1: 0, y1: 0, has_baseline: false };
    },
    __destroy__: () => undefined,
  };
}

describe('result iterator → lines and words (ADR-020 d3)', () => {
  it('groups words by line with the line box and baseline; empty words are dropped', () => {
    const lines = readLines(
      fakeIterator([
        {
          text: 'Pump ',
          box: [10, 10, 50, 30],
          conf: 95,
          line: { box: [10, 8, 200, 32], baseline: [10, 28, 200, 28] },
        },
        { text: 'P-101', box: [60, 10, 110, 30], conf: 90 },
        { text: ' ', box: [0, 0, 0, 0], conf: 0 },
        {
          text: 'Service',
          box: [10, 50, 80, 70],
          conf: 80,
          line: { box: [10, 48, 200, 72], baseline: null },
        },
      ]),
    );
    expect(lines).toEqual([
      {
        box: { x0: 10, y0: 8, x1: 200, y1: 32 },
        baseline: { x0: 10, y0: 28, x1: 200, y1: 28 },
        words: [
          { text: 'Pump', box: { x0: 10, y0: 10, x1: 50, y1: 30 }, conf: 95 },
          { text: 'P-101', box: { x0: 60, y0: 10, x1: 110, y1: 30 }, conf: 90 },
        ],
      },
      {
        box: { x0: 10, y0: 48, x1: 200, y1: 72 },
        baseline: null,
        words: [{ text: 'Service', box: { x0: 10, y0: 50, x1: 80, y1: 70 }, conf: 80 }],
      },
    ]);
  });

  it('a page with no words gives no lines', () => {
    expect(
      readLines(
        fakeIterator([
          { text: '', box: [0, 0, 0, 0], conf: 0, line: { box: [0, 0, 0, 0], baseline: null } },
        ]),
      ),
    ).toEqual([]);
  });

  it('writes a binary PGM with the raster as its body', () => {
    const pgm = pgmOf(3, 2, Uint8Array.from([1, 2, 3, 4, 5, 6]));
    expect(Buffer.from(pgm.subarray(0, 11)).toString('latin1')).toBe('P5\n3 2\n255\n');
    expect(Array.from(pgm.subarray(11))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
