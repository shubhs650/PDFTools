// The custom icons of the M4 commands (M4-03, ADR-010 decision 3, rule 15):
// drawn in Fluent's Regular line style on the 20-unit grid like M3's, with
// Filled variants for the two marking tools' pressed state. No product logo
// is used (the Word export shows a generic document with a ¶ tag), and nothing
// is copied or traced from another product's artwork.
import { bar, box, dashed, poly, ring, strokes, type Pt } from './draw';
import type { Design } from './m3';

/** A half disc facing left (the bowl of a pilcrow), as a closed polygon. */
function leftHalfDisc(cx: number, cy: number, r: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = Math.PI / 2 + (i / 16) * Math.PI; // 90° → 270°, through 180° (the left side)
    pts.push([cx + r * Math.cos(t), cy - r * Math.sin(t)]);
  }
  return pts;
}

/** The ¶ knocked out of a solid tag: holes that touch but never overlap (nonzero fill). */
function pilcrowTag(k: number): string {
  const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return [
    box(2, 9, 9, 8.5, k),
    poly(leftHalfDisc(5.5, 12, 1.5), k, true),
    poly(rect(5.5, 10.5, 6.5, 16), k, true),
    poly(rect(6.5, 10.5, 8, 11.5), k, true),
    poly(rect(8, 10.5, 9, 16), k, true),
  ].join(' ');
}

export const TO_WORD: Design = {
  // A page with a folded corner and text lines; a solid tag with ¶ in front.
  regular: (k) => [
    strokes(
      [
        [10, 2],
        [14, 2],
        [17, 5],
        [17, 18],
        [10, 18],
      ],
      k,
      true,
    ),
    strokes(
      [
        [14, 2],
        [14, 5],
        [17, 5],
      ],
      k,
    ),
    bar([12, 8], [15, 8], k),
    bar([12.5, 12], [15, 12], k),
    bar([12.5, 15], [15, 15], k),
    pilcrowTag(k),
  ],
  filled: (k) => TO_WORD.regular(k),
};

export const MARK_REDACTION: Design = {
  // Text lines with the middle one covered by a solid redaction bar.
  regular: (k) => [bar([3, 4.5], [12, 4.5], k), box(3, 8, 14, 4.5, k), bar([3, 16], [14, 16], k)],
  filled: (k) => [
    bar([3, 4.5], [12, 4.5], k, 1.6),
    box(2.5, 7.5, 15, 5.5, k),
    bar([3, 16], [14, 16], k, 1.6),
  ],
};

/** The dashed outline of the area tool. */
const dashedFrame = (k: number): string =>
  [
    dashed([3, 4], [17, 4], k),
    dashed([17, 4], [17, 16], k),
    dashed([17, 16], [3, 16], k),
    dashed([3, 16], [3, 4], k),
  ].join(' ');

export const MARK_REDACTION_AREA: Design = {
  // A dashed area with its lower-right part already filled in.
  regular: (k) => [dashedFrame(k), box(10, 10, 7, 6, k)],
  filled: (k) => [dashedFrame(k), box(7, 7, 10, 9, k)],
};

export const APPLY_REDACTIONS: Design = {
  // A redaction bar over a text line, and a check badge: apply.
  regular: (k) => [
    box(2, 4, 12, 5, k),
    bar([2.5, 13], [8, 13], k),
    ring(14.5, 14.5, 4, k),
    strokes(
      [
        [12.5, 14.5],
        [14, 16],
        [16.5, 13],
      ],
      k,
    ),
  ],
  filled: (k) => APPLY_REDACTIONS.regular(k),
};

/** Command id → design; `large` marks the ribbon's large buttons (a 32 px glyph too). */
export const M4_DESIGNS: Record<string, { design: Design; large?: true }> = {
  'convert.word': { design: TO_WORD, large: true },
  'protect.markRedaction': { design: MARK_REDACTION, large: true },
  'protect.markRedactionArea': { design: MARK_REDACTION_AREA, large: true },
  'protect.applyRedactions': { design: APPLY_REDACTIONS, large: true },
};
