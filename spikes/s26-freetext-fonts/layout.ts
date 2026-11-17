// Spike S26, route R2: shaping and line layout of a text comment with
// HarfBuzz (harfbuzzjs, MIT). Pure functions over loaded faces, so the same
// code runs in the Work worker (rule 1).
//
//  1. Runs: each character takes the chosen face if it has a glyph, else the
//     first fallback that has one (Noto Sans Math, Noto Sans Devanagari,
//     Noto Sans SC), so a Hindi word in Roboto or a ⌀ in any family is drawn
//     instead of a box. Marks and joiners stay with the run before them.
//  2. Each run is shaped (Devanagari conjuncts, reordered vowel signs,
//     kerning, ligatures).
//  3. Lines break where CSS would in the on-page editor: after spaces,
//     between ideographs, at "\n", and inside a word that is wider than the
//     box (the editor's contenteditable has `overflow-wrap: break-word`).
import * as hb from 'harfbuzzjs';

/** `a[i]`, which must exist. */
export function at<T>(a: ArrayLike<T>, i: number): T {
  const v = a[i];
  if (v === undefined) throw new Error(`no element ${String(i)}`);
  return v;
}

export interface Face {
  id: string;
  bytes: Uint8Array;
  font: hb.Font;
  upem: number;
  /** hhea ascender and descender, in font units (descender negative). */
  ascender: number;
  descender: number;
  unicodes: Set<number>;
  /** Draw bold with a stroke / italic with a slant (the family has no such face). */
  fakeBold?: boolean;
  fakeItalic?: boolean;
}

export function loadFace(id: string, bytes: Uint8Array): Face {
  const face = new hb.Face(new hb.Blob(bytes.slice().buffer));
  const font = new hb.Font(face);
  const upem = face.upem;
  font.setScale(upem, upem);
  const ext = font.hExtents();
  return {
    id,
    bytes,
    font,
    upem,
    ascender: ext.ascender,
    descender: ext.descender,
    unicodes: new Set(face.collectUnicodes()),
  };
}

export interface PlacedGlyph {
  face: Face;
  gid: number;
  /** Pen position of the glyph's origin on the line, in points, before alignment. */
  x: number;
  /** Offsets from the pen, in points (marks). */
  dx: number;
  dy: number;
  /** Advance in points. */
  adv: number;
  /** UTF-16 index of the glyph's cluster in the paragraph, and the cluster's text. */
  cluster: number;
  text: string;
}

export interface Line {
  glyphs: PlacedGlyph[];
  /** Width without trailing spaces, in points. */
  width: number;
  /** The line's text (for /ActualText). */
  text: string;
}

const isMarkOrJoiner = (c: number): boolean =>
  (c >= 0x300 && c <= 0x36f) ||
  (c >= 0x900 && c <= 0x903) ||
  (c >= 0x93a && c <= 0x94f) ||
  (c >= 0x951 && c <= 0x957) ||
  (c >= 0x962 && c <= 0x963) ||
  c === 0x200c ||
  c === 0x200d ||
  (c >= 0xfe00 && c <= 0xfe0f);
const isSpace = (c: number): boolean => c === 0x20 || c === 0x3000;
const isIdeo = (c: number): boolean =>
  (c >= 0x3040 && c <= 0x30ff) ||
  (c >= 0x3400 && c <= 0x9fff) ||
  (c >= 0xf900 && c <= 0xfaff) ||
  (c >= 0xff00 && c <= 0xffef) ||
  (c >= 0x3000 && c <= 0x303f);

interface Run {
  face: Face;
  start: number;
  end: number;
}

/** Splits a paragraph into runs of one face each. */
export function runs(text: string, primary: Face, fallbacks: Face[]): Run[] {
  const out: Run[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text.codePointAt(i) ?? 0;
    const n = c > 0xffff ? 2 : 1;
    const prev = out[out.length - 1];
    let face: Face;
    if (prev && (isMarkOrJoiner(c) || (isSpace(c) && prev.face.unicodes.has(c)))) face = prev.face;
    else if (primary.unicodes.has(c) || isSpace(c)) face = primary;
    else face = fallbacks.find((f) => f.unicodes.has(c)) ?? primary;
    if (prev?.face === face) prev.end = i + n;
    else out.push({ face, start: i, end: i + n });
    i += n;
  }
  return out;
}

/** Shaped glyphs of one paragraph, positioned along one infinite line. */
export function shapeParagraph(
  text: string,
  primary: Face,
  fallbacks: Face[],
  size: number,
): PlacedGlyph[] {
  const out: PlacedGlyph[] = [];
  let x = 0;
  for (const r of runs(text, primary, fallbacks)) {
    const buf = new hb.Buffer();
    buf.addText(text.slice(r.start, r.end));
    buf.guessSegmentProperties();
    hb.shape(r.face.font, buf);
    const k = size / r.face.upem;
    const gs = buf.getGlyphInfosAndPositions();
    // Cluster texts: from a cluster to the next cluster start (LTR, monotonic).
    const starts = [...new Set(gs.map((g) => g.cluster))].sort((a, b) => a - b);
    const runText = text.slice(r.start, r.end);
    for (const g of gs) {
      const si = starts.indexOf(g.cluster);
      const end = starts[si + 1] ?? runText.length;
      out.push({
        face: r.face,
        gid: g.codepoint,
        x,
        dx: (g.xOffset ?? 0) * k,
        dy: (g.yOffset ?? 0) * k,
        adv: (g.xAdvance ?? 0) * k,
        cluster: r.start + g.cluster,
        text: runText.slice(g.cluster, end),
      });
      x += (g.xAdvance ?? 0) * k;
    }
  }
  return out;
}

/** Break opportunities (UTF-16 indexes a line may start at). */
function breaks(text: string): Set<number> {
  const s = new Set<number>();
  for (let i = 1; i < text.length; i++) {
    const a = text.codePointAt(i - 1) ?? 0;
    const b = text.codePointAt(i) ?? 0;
    if ((isSpace(a) && !isSpace(b)) || a === 0x2d || isIdeo(a) || (isIdeo(b) && !isSpace(a)))
      s.add(i);
  }
  return s;
}

function makeLine(glyphs: PlacedGlyph[], para: string, from: number, to: number): Line {
  const x0 = glyphs[0]?.x ?? 0;
  const moved = glyphs.map((g) => ({ ...g, x: g.x - x0 }));
  let width = 0;
  for (const g of moved) {
    const c = para.codePointAt(g.cluster) ?? 0;
    if (!isSpace(c)) width = Math.max(width, g.x + g.adv);
  }
  return { glyphs: moved, width, text: para.slice(from, to) };
}

/** Lines of `text` in a box `width` points wide. */
export function layout(
  text: string,
  primary: Face,
  fallbacks: Face[],
  size: number,
  width: number,
): Line[] {
  const lines: Line[] = [];
  for (const para of text.split(/\r\n|\r|\n/u)) {
    const gs = shapeParagraph(para, primary, fallbacks, size);
    if (!gs.length) {
      lines.push({ glyphs: [], width: 0, text: '' });
      continue;
    }
    const br = breaks(para);
    // Segments: glyphs between break opportunities (clusters are monotonic, LTR).
    const segs: { from: number; to: number; glyphs: PlacedGlyph[] }[] = [];
    for (const g of gs) {
      const last = segs[segs.length - 1];
      if (
        !last ||
        (br.has(g.cluster) && g.cluster !== last.glyphs[last.glyphs.length - 1]?.cluster)
      )
        segs.push({ from: g.cluster, to: g.cluster, glyphs: [g] });
      else last.glyphs.push(g);
    }
    for (let i = 0; i < segs.length; i++) at(segs, i).to = segs[i + 1]?.from ?? para.length;
    let cur: PlacedGlyph[] = [];
    let curFrom = 0;
    const flush = (to: number, nextFrom: number): void => {
      lines.push(makeLine(cur, para, curFrom, to));
      cur = [];
      curFrom = nextFrom;
    };
    for (const seg of segs) {
      const segStart = at(seg.glyphs, 0).x;
      const inkEnd = (gl: PlacedGlyph[]): number => {
        let e = 0;
        for (const g of gl) if (!isSpace(para.codePointAt(g.cluster) ?? 0)) e = g.x + g.adv;
        return e;
      };
      const lineStart = cur[0]?.x ?? segStart;
      if (cur.length && inkEnd(seg.glyphs) - lineStart > width) flush(seg.from, seg.from);
      // A segment wider than the box on its own breaks between clusters.
      let pending = seg.glyphs;
      while (!cur.length && pending.length && inkEnd(pending) - at(pending, 0).x > width) {
        const x0 = at(pending, 0).x;
        let cut = pending.findIndex(
          (g, j) => j > 0 && g.cluster !== at(pending, j - 1).cluster && g.x + g.adv - x0 > width,
        );
        if (cut <= 0)
          cut = Math.max(
            1,
            pending.findIndex((g, j) => j > 0 && g.cluster !== at(pending, 0).cluster),
          );
        if (cut <= 0) break;
        // Do not split a cluster.
        while (cut < pending.length && at(pending, cut).cluster === at(pending, cut - 1).cluster)
          cut++;
        cur = pending.slice(0, cut);
        curFrom = at(cur, 0).cluster;
        const next = pending[cut]?.cluster ?? seg.to;
        flush(next, next);
        pending = pending.slice(cut);
      }
      if (!cur.length && pending.length) curFrom = at(pending, 0).cluster;
      cur.push(...pending);
    }
    if (cur.length) flush(para.length, para.length);
  }
  return lines;
}
