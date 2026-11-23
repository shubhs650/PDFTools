// The text layer of difference detection on drawings (M12-14, D-61, Q23,
// S28): the positioned words of A, moved by the sheet's alignment, against
// B's. A word not found at its place on the other side (the same text within
// half its size) is a text change. S28 found it necessary, not optional: a
// single digit changed in 7 pt text moves fewer pixels than the tolerance
// hides. Invisible text (an OCR layer over a scan) is left out: a scan's
// differences are its regions.
import {
  applyAffine,
  TEXT_GENERATED,
  TEXT_INVISIBLE,
  type Affine,
  type PageText,
} from '../material';

export type Box = [number, number, number, number];

export interface PlacedWord {
  text: string;
  /** Box in B's displayed page (pt). */
  box: Box;
  cx: number;
  cy: number;
  /** Font size, scaled with the placement. */
  size: number;
}

export interface TextChange extends PlacedWord {
  kind: 'added' | 'removed';
}

/**
 * Words of a page with their boxes (S28's rule, as wordsOf): a character joins
 * the word when it is on the same line and close after the last one along the
 * text's direction. `place` moves A's words into B's frame.
 */
export function placedWords(t: PageText, place: Affine | null = null): PlacedWord[] {
  const out: PlacedWord[] = [];
  const k = place ? Math.hypot(place[0], place[1]) : 1;
  let text = '';
  let box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  let size = 0;
  let lx = 0;
  let ly = 0;
  let ls = 0;
  let la = 0;
  let has = false;
  const flush = (): void => {
    if (text) {
      let b = box;
      if (place) {
        const pts = [
          applyAffine(place, b[0], b[1]),
          applyAffine(place, b[2], b[1]),
          applyAffine(place, b[0], b[3]),
          applyAffine(place, b[2], b[3]),
        ];
        b = [
          Math.min(...pts.map((p) => p[0])),
          Math.min(...pts.map((p) => p[1])),
          Math.max(...pts.map((p) => p[0])),
          Math.max(...pts.map((p) => p[1])),
        ];
      }
      out.push({
        text,
        box: b,
        cx: (b[0] + b[2]) / 2,
        cy: (b[1] + b[3]) / 2,
        size: size * k,
      });
    }
    text = '';
    box = [Infinity, Infinity, -Infinity, -Infinity];
    size = 0;
    has = false;
  };
  for (let i = 0; i < t.codes.length; i++) {
    const code = t.codes[i] ?? 0;
    const flags = t.flags[i] ?? 0;
    if (flags & TEXT_INVISIBLE) {
      flush();
      continue;
    }
    if (code <= 32 || code === 0xa0 || flags & TEXT_GENERATED) {
      flush();
      continue;
    }
    const ax = t.boxes[i * 4] ?? 0;
    const ay = t.boxes[i * 4 + 1] ?? 0;
    const bx = t.boxes[i * 4 + 2] ?? 0;
    const by = t.boxes[i * 4 + 3] ?? 0;
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    const y0 = Math.min(ay, by);
    const y1 = Math.max(ay, by);
    const x = (x0 + x1) / 2;
    const y = (y0 + y1) / 2;
    const a = ((t.angles[i] ?? 0) * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const s = Math.max(Math.abs((x1 - x0) * dy) + Math.abs((y1 - y0) * dx), 0.1);
    let near = false;
    if (has && Math.abs(a - la) < 0.1) {
      const along = (x - lx) * dx + (y - ly) * dy;
      const across = Math.abs((x - lx) * dy - (y - ly) * dx);
      const sz = Math.max(s, ls);
      near = across < sz * 0.5 && along > -0.1 && along < sz * 1.2;
    }
    if (!near) flush();
    text += String.fromCodePoint(code);
    box = [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)];
    size = Math.max(size, t.sizes[i] ?? 0, s);
    lx = x;
    ly = y;
    ls = s;
    la = a;
    has = true;
  }
  flush();
  return out;
}

/** Words of one side not found at their place on the other (B's frame, pt). */
export function textChanges(
  a: PageText | undefined,
  b: PageText | undefined,
  place: Affine,
): TextChange[] {
  const wa = a ? placedWords(a, place) : [];
  const wb = b ? placedWords(b) : [];
  const byText = (words: PlacedWord[]): Map<string, PlacedWord[]> => {
    const m = new Map<string, PlacedWord[]>();
    for (const w of words) {
      const list = m.get(w.text);
      if (list) list.push(w);
      else m.set(w.text, [w]);
    }
    return m;
  };
  const ia = byText(wa);
  const ib = byText(wb);
  const out: TextChange[] = [];
  const unmatched = (
    from: PlacedWord[],
    to: Map<string, PlacedWord[]>,
    kind: TextChange['kind'],
  ): void => {
    for (const w of from) {
      const tol = Math.max(2, w.size * 0.5);
      const same = to.get(w.text);
      if (!same?.some((v) => Math.hypot(v.cx - w.cx, v.cy - w.cy) <= tol)) out.push({ ...w, kind });
    }
  };
  unmatched(wa, ib, 'removed');
  unmatched(wb, ia, 'added');
  return out;
}
