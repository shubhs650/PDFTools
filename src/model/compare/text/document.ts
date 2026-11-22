// One revision as a sequence of comparison units (M12-17, D-63, spike S30):
//
//   page layouts (layout.ts, reading order) → paragraphs (spacing, size,
//   weight, list markers, continued across columns and pages) → line-end
//   hyphens joined → tokens (tokens.ts).
//
// A unit is a paragraph (M12-18 adds table rows and figures). Everything is
// kept in flat typed arrays over the whole document (S30: objects per word
// and token do not scale past a few hundred pages); only each paragraph's
// text stays a string. Token keys are interned in an Interner both sides
// share, so equality is one integer comparison. Pure code.
import { detectHf, type HfGroup, type Row } from './headers';
import type { Interner } from './myers';
import { WORD_BOLD, WORD_RTL, type PageLayout } from './layout';
import { kindCode, tokenize } from './tokens';

export interface TextDoc {
  /** Pages read (a prefix of the side's pages while a comparison is running). */
  pages: number;
  /** Pages without any text: "limited support". */
  empty: number[];
  /** Headers and footers, taken out of the running text (experimental). */
  hf: HfGroup[];
  /** Per unit: its text as read, its key (interned), its first page. */
  unitText: string[];
  unitKey: Int32Array;
  unitPage: Int32Array;
  /** Unit u holds tokens unitTok[u] … unitTok[u + 1] − 1 and words unitWord[u] … unitWord[u + 1] − 1. */
  unitTok: Int32Array;
  unitWord: Int32Array;
  /** Per token: offsets in its unit's text, key (interned), kind code, number (NaN: none), word. */
  tokStart: Int32Array;
  tokEnd: Int32Array;
  tokKey: Int32Array;
  tokKind: Uint8Array;
  tokNum: Float64Array;
  tokWord: Int32Array;
  /** Per word: page, line (unique in the document), box x0 y0 x1 y1, offset and length in its unit's text, flags. */
  wordPage: Int32Array;
  wordLine: Int32Array;
  wordBox: Float32Array;
  wordOff: Int32Array;
  wordLen: Int32Array;
  wordFlags: Uint8Array;
}

export const unitCount = (d: TextDoc): number => d.unitText.length;
export const tokenCount = (d: TextDoc): number => d.tokKey.length;

/** A line while paragraphs are formed. */
interface LineRef {
  page: number;
  /** Unique line number in the document. */
  id: number;
  layout: PageLayout;
  w0: number;
  w1: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size: number;
  bold: boolean;
  /** The column's left and right edge (the page's lines it overlaps). */
  lo: number;
  hi: number;
}

const LIST_START =
  /^(?:(?:Clause|Section|Step|Article|Paragraph|Item|Note|Annex|Appendix|Table|Figure|Fig\.)\s+[\dA-Z]|\d+(?:\.\d+)*[.):]?\s+(?=\p{Lu})|[a-z]\)|[ivx]+\)|[•▪◦\-–]\s)/u;

const wordText = (l: PageLayout, k: number): string =>
  l.text.slice(l.wordStart[k] ?? 0, l.wordStart[k + 1] ?? 0);

const lineText = (l: LineRef): string => {
  const parts: string[] = [];
  for (let k = l.w0; k < l.w1; k++) parts.push(wordText(l.layout, k));
  return parts.join(' ');
};

/** A page's lines. */
function pageLines(layout: PageLayout, page: number, firstId: number): LineRef[] {
  const n = layout.lineSize.length;
  const out: LineRef[] = [];
  for (let k = 0; k < n; k++) {
    const b = k * 4;
    out.push({
      page,
      id: firstId + k,
      layout,
      w0: layout.lineStart[k] ?? 0,
      w1: layout.lineStart[k + 1] ?? 0,
      x0: layout.lineBox[b] ?? 0,
      y0: layout.lineBox[b + 1] ?? 0,
      x1: layout.lineBox[b + 2] ?? 0,
      y1: layout.lineBox[b + 3] ?? 0,
      size: layout.lineSize[k] ?? 0,
      bold: ((layout.lineFlags[k] ?? 0) & WORD_BOLD) !== 0,
      lo: 0,
      hi: 0,
    });
  }
  return out;
}

/** The column of each line: the lines of its page it overlaps horizontally. */
function columnEdges(out: readonly LineRef[]): void {
  for (const l of out) {
    l.lo = l.x0;
    l.hi = l.x1;
    for (const o of out) {
      if (Math.min(o.x1, l.x1) - Math.max(o.x0, l.x0) > 0.5 * Math.min(o.x1 - o.x0, l.x1 - l.x0)) {
        l.lo = Math.min(l.lo, o.x0);
        l.hi = Math.max(l.hi, o.x1);
      }
    }
  }
}

/** A page's rows: lines that share most of their height, left to right. */
function rowsOf(lines: readonly LineRef[]): Row[] {
  const rows: { y0: number; y1: number; ls: LineRef[] }[] = [];
  for (const l of [...lines].sort((a, b) => a.y0 - b.y0)) {
    const r = rows.find((x) => {
      const ov = Math.min(x.y1, l.y1) - Math.max(x.y0, l.y0);
      return ov >= 0.5 * Math.min(x.y1 - x.y0, l.y1 - l.y0);
    });
    if (r) {
      r.ls.push(l);
      r.y0 = Math.min(r.y0, l.y0);
      r.y1 = Math.max(r.y1, l.y1);
    } else rows.push({ y0: l.y0, y1: l.y1, ls: [l] });
  }
  return rows.map((r) => {
    const ls = r.ls.sort((a, b) => a.x0 - b.x0);
    return {
      page: ls[0]?.page ?? 0,
      y0: r.y0,
      y1: r.y1,
      x0: Math.min(...ls.map((l) => l.x0)),
      x1: Math.max(...ls.map((l) => l.x1)),
      text: ls.map(lineText).join(' '),
      lines: ls.map((l) => l.id),
    };
  });
}

/** Lines → paragraphs: a paragraph goes on across a column or page break when its last line was full. */
export function paragraphs(lines: readonly LineRef[]): LineRef[][] {
  const paras: LineRef[][] = [];
  let cur: LineRef[] = [];
  const full = (l: LineRef): boolean => l.x1 >= l.hi - 0.12 * (l.hi - l.lo);
  for (const l of lines) {
    const p = cur[cur.length - 1];
    if (!p) {
      cur.push(l);
      continue;
    }
    const sameSize = Math.abs(l.size - p.size) <= 0.15 * Math.max(l.size, p.size);
    const below = l.page === p.page && l.y0 >= p.y0 + 0.3 * p.size;
    const overlaps = Math.min(l.x1, p.x1) - Math.max(l.x0, p.x0) > 0;
    let brk: boolean;
    if (!sameSize || l.bold !== p.bold) brk = true;
    else if (below && overlaps) brk = l.y0 - p.y1 > 0.5 * l.size || LIST_START.test(lineText(l));
    else brk = !full(p) || LIST_START.test(lineText(l));
    if (brk) {
      paras.push(cur);
      cur = [];
    }
    cur.push(l);
  }
  if (cur.length) paras.push(cur);
  return paras;
}

/** Growable typed columns while a document is built. */
class Columns {
  unitText: string[] = [];
  unitKey: number[] = [];
  unitPage: number[] = [];
  unitTok: number[] = [0];
  unitWord: number[] = [0];
  tokStart: number[] = [];
  tokEnd: number[] = [];
  tokKey: number[] = [];
  tokKind: number[] = [];
  tokNum: number[] = [];
  tokWord: number[] = [];
  wordPage: number[] = [];
  wordLine: number[] = [];
  wordBox: number[] = [];
  wordOff: number[] = [];
  wordLen: number[] = [];
  wordFlags: number[] = [];
}

/**
 * A paragraph's text, line-end hyphens joined (PDFium marks a hyphen at a
 * line end as U+0002; a hard hyphen before a lower-case word is joined too),
 * its words with their offsets, then its tokens.
 */
function addParagraph(c: Columns, lines: readonly LineRef[], intern: Interner): void {
  let text = '';
  const wordBase = c.wordPage.length;
  const offs: number[] = [];
  let prevText = '';
  let prevLine = -1;
  lines.forEach((l, li) => {
    for (let k = l.w0; k < l.w1; k++) {
      let t = wordText(l.layout, k);
      const lastOfLine = k === l.w1 - 1;
      const nl = lines[li + 1];
      const next = lastOfLine && nl && nl.w1 > nl.w0 ? wordText(nl.layout, nl.w0) : undefined;
      const soft = t.endsWith('\u0002');
      const hard = /\p{L}[-‐]$/u.test(t);
      let glue = text.length > 0 ? ' ' : '';
      if (prevLine >= 0 && prevLine !== l.id) {
        const prevSoft = prevText.endsWith('\u0002');
        const prevHard = /[\p{L}\p{N}][-‐]$/u.test(prevText);
        if (prevSoft || prevHard) glue = '';
      }
      const raw = t;
      if (soft) t = /^\p{Ll}/u.test(next ?? '') ? t.slice(0, -1) : `${t.slice(0, -1)}-`;
      else if (hard && lastOfLine && /^\p{Ll}/u.test(next ?? '')) t = t.slice(0, -1);
      text += glue;
      offs.push(text.length);
      text += t;
      const b = k * 4;
      c.wordPage.push(l.page);
      c.wordLine.push(l.id);
      c.wordBox.push(
        l.layout.wordBox[b] ?? 0,
        l.layout.wordBox[b + 1] ?? 0,
        l.layout.wordBox[b + 2] ?? 0,
        l.layout.wordBox[b + 3] ?? 0,
      );
      c.wordOff.push(text.length - t.length);
      c.wordLen.push(t.length);
      c.wordFlags.push(l.layout.wordFlags[k] ?? 0);
      prevText = raw;
      prevLine = l.id;
    }
  });
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    // Nothing to compare (punctuation-free blanks): drop the words again.
    for (const col of [c.wordPage, c.wordLine, c.wordOff, c.wordLen, c.wordFlags])
      col.length = wordBase;
    c.wordBox.length = wordBase * 4;
    return;
  }
  // Each token's word: the last word starting at or before it.
  let w = 0;
  const ids: number[] = [];
  for (const tk of tokens) {
    while (w + 1 < offs.length && (offs[w + 1] ?? 0) <= tk.start) w++;
    const id = intern.id(tk.key);
    ids.push(id);
    c.tokStart.push(tk.start);
    c.tokEnd.push(tk.end);
    c.tokKey.push(id);
    c.tokKind.push(kindCode(tk.kind));
    c.tokNum.push(tk.num ?? Number.NaN);
    c.tokWord.push(wordBase + w);
  }
  c.unitText.push(text);
  c.unitKey.push(intern.id(`p:${ids.join(',')}`));
  c.unitPage.push(lines[0]?.page ?? 0);
  c.unitTok.push(c.tokKey.length);
  c.unitWord.push(c.wordPage.length);
}

export interface BuildOptions {
  /** Take headers and footers out of the running text (default true; experimental). */
  headersFooters?: boolean;
  /** Called between pages (cancel). */
  checkpoint?: () => void;
}

/**
 * A side's text document from the layouts of its first pages (`layouts[p]`
 * is side page p).
 */
export function buildDoc(
  layouts: readonly PageLayout[],
  intern: Interner,
  o: BuildOptions = {},
): TextDoc {
  const perPage: LineRef[][] = [];
  const empty: number[] = [];
  let id = 0;
  layouts.forEach((l, p) => {
    if (l.wordSize.length === 0) empty.push(p);
    const ls = pageLines(l, p, id);
    id += ls.length;
    perPage.push(ls);
  });
  const hf =
    o.headersFooters === false
      ? { groups: [], lines: new Set<number>() }
      : detectHf(
          perPage.map(rowsOf),
          layouts.map((l) => l.height),
        );
  const lines: LineRef[] = [];
  for (const ls of perPage) {
    const body = ls.filter((l) => !hf.lines.has(l.id));
    columnEdges(body);
    lines.push(...body);
  }
  const checkpoint = o.checkpoint;
  const c = new Columns();
  let page = -1;
  for (const para of paragraphs(lines)) {
    const first = para[0]?.page ?? 0;
    if (first !== page) {
      page = first;
      checkpoint?.();
    }
    addParagraph(c, para, intern);
  }
  return {
    pages: layouts.length,
    empty,
    hf: hf.groups,
    unitText: c.unitText,
    unitKey: Int32Array.from(c.unitKey),
    unitPage: Int32Array.from(c.unitPage),
    unitTok: Int32Array.from(c.unitTok),
    unitWord: Int32Array.from(c.unitWord),
    tokStart: Int32Array.from(c.tokStart),
    tokEnd: Int32Array.from(c.tokEnd),
    tokKey: Int32Array.from(c.tokKey),
    tokKind: Uint8Array.from(c.tokKind),
    tokNum: Float64Array.from(c.tokNum),
    tokWord: Int32Array.from(c.tokWord),
    wordPage: Int32Array.from(c.wordPage),
    wordLine: Int32Array.from(c.wordLine),
    wordBox: Float32Array.from(c.wordBox),
    wordOff: Int32Array.from(c.wordOff),
    wordLen: Int32Array.from(c.wordLen),
    wordFlags: Uint8Array.from(c.wordFlags),
  };
}

/** Whether a word reads right to left. */
export const wordRtl = (d: TextDoc, w: number): boolean => ((d.wordFlags[w] ?? 0) & WORD_RTL) !== 0;
