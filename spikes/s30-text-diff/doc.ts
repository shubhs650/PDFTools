// Spike S30 (M12-05): one revision as a sequence of comparison units.
//
//   characters (PDFium) → words → headers/footers out → tables and figures as
//   atoms → reading order (XY-cut) → paragraphs (spacing, size, list markers,
//   continued across columns and pages) → tokens (tokens.ts).
//
// Units: a paragraph, a table row (cells kept apart), or a figure (a picture,
// compared as a picture). Three reading-order routes are kept for the spike's
// comparison: 'xy' (ours, the proposal), 'stream' (PDFium's content order,
// naive lines) and 'oxide' (PDF Oxide's column-aware spans).
/* eslint-disable @typescript-eslint/no-non-null-assertion -- indices in range, in hot loops (spike code) */

import { toPlain, type OxideDocument } from '../../src/workers/work/oxide.ts';
import type { Doc } from '../s28-alignment/pdfium.ts';
import { detectHf, type HfGroup } from './hf.ts';
import { readingOrder, streamLines, wordsOf, type Box, type Line, type Word } from './layout.ts';
import { pageText, type Figure } from './pdfium-text.ts';
import { pageTables, type PageTable } from './tables.ts';
import { tokenize, type Token } from './tokens.ts';

export type Route = 'xy' | 'stream' | 'oxide';

export interface Unit {
  kind: 'para' | 'row' | 'figure';
  /** Text as read (cells joined with " | "). */
  text: string;
  tokens: Token[];
  /** Words behind each token (index into `words`), for marks on the page. */
  tokWord: number[];
  words: Word[];
  page: number;
  /** The comparison key of the whole unit. */
  key: string;
  /** Tokens that are clause numbers (own number first, then references). */
  clauseTok: number[];
  /** The key with clause numbers masked (finds renumbered units). */
  relabelKey: string;
  /** Text from an OCR layer or read by OCR at compare time. */
  ocr?: boolean;
  row?: {
    table: number;
    cells: string[];
    /** Token index range per cell. */
    cellTok: [number, number][];
    /** Column names (header row text). */
    header: string[];
    /** Short row label: first cells resolved through merges. */
    label: string;
  };
  figure?: Figure;
}

export interface DocText {
  units: Unit[];
  hf: HfGroup[];
  pages: number;
  /** Pages read by OCR (compare time) or carrying an OCR text layer. */
  ocrPages: number[];
  /** Pages with no text and no OCR: "limited support". */
  emptyPages: number[];
  ms: { text: number; tables: number; order: number; total: number };
}

export interface OcrWord {
  text: string;
  box: Box;
  size: number;
}
/** Reads a scanned page at compare time (ocr.ts); null leaves the page out. */
export type OcrFn = (doc: Doc, page: number) => Promise<OcrWord[] | null>;

export interface ExtractOptions {
  route?: Route;
  /** Recognise tables with the app's detector (needs `oxide`). */
  tables?: boolean;
  oxide?: OxideDocument | null;
  /** Leave headers and footers out (reported once). Default true. */
  headersFooters?: boolean;
  ocr?: OcrFn | null;
}

const LIST_START =
  /^(?:(?:Clause|Section|Step|Article|Paragraph|Item|Note|Annex|Appendix|Table|Figure|Fig\.)\s+[\dA-Z]|\d+(?:\.\d+)*[.):]?\s+(?=\p{Lu})|[a-z]\)|[ivx]+\)|[•▪◦\-–]\s)/u;

/** Words of an Oxide span list (route 'oxide'), y down. */
function oxideWords(ox: OxideDocument, page: number, h: number): Word[] {
  const spans = toPlain(
    (ox as unknown as { extractSpans(p: number, r: null, o: string): unknown }).extractSpans(
      page,
      null,
      'column_aware',
    ),
  ) as {
    text: string;
    bbox: { x: number; y: number; width: number; height: number };
    fontSize: number;
    charWidths?: number[];
  }[];
  const out: Word[] = [];
  for (const s of spans) {
    const cw = s.charWidths ?? [];
    const chars = Array.from(s.text);
    let x = s.bbox.x;
    let start = -1;
    let x0 = 0;
    const y1 = h - s.bbox.y;
    const y0 = y1 - s.bbox.height;
    for (let i = 0; i <= chars.length; i++) {
      const c = chars[i];
      const w = cw[i] ?? s.bbox.width / Math.max(1, chars.length);
      if (c === undefined || /\s/u.test(c)) {
        if (start >= 0)
          out.push({
            text: chars.slice(start, i).join(''),
            x0,
            y0,
            x1: x,
            y1,
            size: s.fontSize,
            bold: false,
            invisible: false,
            rtl: false,
            base: y1,
            page,
          });
        start = -1;
      } else if (start < 0) {
        start = i;
        x0 = x;
      }
      x += w;
    }
  }
  return out;
}

/** Lines → paragraphs (and atoms → units). */
function paragraphs(lines: readonly Line[]): Line[][] {
  const paras: Line[][] = [];
  let cur: Line[] = [];
  const flush = () => {
    if (cur.length) paras.push(cur);
    cur = [];
  };
  // The column of a line: the lines of its page it overlaps horizontally.
  const colEdge = (l: Line): [number, number] => {
    let lo = l.x0;
    let hi = l.x1;
    for (const o of lines) {
      if (o.page !== l.page || o.atom !== undefined) continue;
      if (Math.min(o.x1, l.x1) - Math.max(o.x0, l.x0) > 0.5 * Math.min(o.x1 - o.x0, l.x1 - l.x0)) {
        lo = Math.min(lo, o.x0);
        hi = Math.max(hi, o.x1);
      }
    }
    return [lo, hi];
  };
  const full = (l: Line) => {
    const [lo, hi] = colEdge(l);
    return l.x1 >= hi - 0.12 * (hi - lo);
  };
  for (const l of lines) {
    if (l.atom !== undefined) {
      flush();
      paras.push([l]);
      continue;
    }
    const p = cur[cur.length - 1];
    if (!p) {
      cur.push(l);
      continue;
    }
    const text = l.words.map((w) => w.text).join(' ');
    const sameSize = Math.abs(l.size - p.size) <= 0.15 * Math.max(l.size, p.size);
    const below = l.page === p.page && l.y0 >= p.y0 + 0.3 * p.size;
    const overlaps = Math.min(l.x1, p.x1) - Math.max(l.x0, p.x0) > 0;
    let brk: boolean;
    if (!sameSize || l.bold !== p.bold) brk = true;
    else if (below && overlaps) brk = l.y0 - p.y1 > 0.5 * l.size || LIST_START.test(text);
    // A column or page change: the paragraph goes on if its last line was full.
    else brk = !full(p) || LIST_START.test(text);
    if (brk) flush();
    cur.push(l);
  }
  flush();
  return paras;
}

/** The text of a paragraph's lines, line-end hyphens joined; word index per char. */
function joinLines(lines: readonly Line[]): { text: string; words: Word[]; at: number[] } {
  const words: Word[] = [];
  let text = '';
  const at: number[] = [];
  const add = (s: string, wi: number) => {
    text += s;
    at.push(...Array<number>(s.length).fill(wi));
  };
  lines.forEach((l, li) => {
    l.words.forEach((w, wi) => {
      let t = w.text;
      const lastOfLine = wi === l.words.length - 1;
      const next = lastOfLine ? lines[li + 1]?.words[0]?.text : undefined;
      // PDFium marks a hyphen at the end of a line as U+0002.
      const soft = t.endsWith('\u0002');
      const hard = /\p{L}[-‐]$/u.test(t);
      let glue = text.length > 0 ? ' ' : '';
      if (words.length > 0) {
        const prev = words[words.length - 1]!;
        const pt = prev.text;
        const prevSoft = pt.endsWith('\u0002');
        const prevHard = /[\p{L}\p{N}][-‐]$/u.test(pt);
        const prevEndOfLine = prev.base !== w.base || prev.page !== w.page;
        if (prevEndOfLine && (prevSoft || prevHard)) glue = '';
      }
      if (soft) t = /^\p{Ll}/u.test(next ?? '') ? t.slice(0, -1) : `${t.slice(0, -1)}-`;
      else if (hard && lastOfLine && /^\p{Ll}/u.test(next ?? '')) t = t.slice(0, -1);
      words.push(w);
      add(glue, words.length - 1);
      add(t, words.length - 1);
    });
  });
  return { text, words, at };
}

const CLAUSE_WORD =
  /^(?:clause|sub-clause|subclause|section|article|paragraph|step|annex|appendix|item|§)$/i;
const CLAUSE_NUM = /^\d+(?:\.\d+)*\.?$/;

/** Clause numbers: the unit's own leading number, and numbers after "Clause", "Section", …. */
export function clauseTokens(
  tokens: readonly Token[],
  superscript: (i: number) => boolean = () => false,
): number[] {
  const out: number[] = [];
  tokens.forEach((t, i) => {
    if (!CLAUSE_NUM.test(t.key)) return;
    // A raised small number is a footnote mark: numbered like a clause.
    if (superscript(i) && /^\d+$/.test(t.key)) {
      out.push(i);
      return;
    }
    const prev = tokens[i - 1];
    const lead = i === 0 || (i === 1 && prev !== undefined && CLAUSE_WORD.test(prev.key));
    const cited = prev !== undefined && CLAUSE_WORD.test(prev.key);
    // A bare leading number counts only as a heading number ("3." or "3.4"), not "24.0 bar".
    if (lead || cited) {
      const next = tokens[i + 1];
      if (i === 0 && next && (next.kind === 'value' || next.kind === 'number')) return;
      out.push(i);
    }
  });
  return out;
}

function withClauses(u: Omit<Unit, 'clauseTok' | 'relabelKey'>): Unit {
  const sizes = u.words.map((w) => w.size).sort((a, b) => a - b);
  const body = sizes[sizes.length >> 1] ?? 0;
  const sup = (i: number) => {
    const w = u.words[u.tokWord[i] ?? -1];
    return w !== undefined && w.size < 0.8 * body;
  };
  const clauseTok = u.kind === 'para' ? clauseTokens(u.tokens, sup) : [];
  const masked = u.tokens.map((t, i) => (clauseTok.includes(i) ? '#' : t.key));
  const relabelKey = clauseTok.length ? `${u.key.slice(0, 2)}${masked.join(' ')}` : u.key;
  return { ...u, clauseTok, relabelKey };
}

/** A paragraph unit from plain text (no words on a page): for tests. */
export function paraUnit(text: string, page = 0): Unit {
  const tokens = tokenize(text);
  return withClauses({
    kind: 'para',
    text,
    tokens,
    tokWord: tokens.map(() => 0),
    words: [],
    page,
    key: `p:${tokens.map((t) => t.key).join(' ')}`,
  });
}

function unitOf(lines: readonly Line[], ocrPages: Set<number>): Unit {
  const { text, words, at } = joinLines(lines);
  const tokens = tokenize(text);
  const tokWord = tokens.map((t) => at[t.start] ?? 0);
  const page = lines[0]?.page ?? 0;
  return withClauses({
    kind: 'para',
    text,
    tokens,
    tokWord,
    words,
    page,
    key: `p:${tokens.map((t) => t.key).join(' ')}`,
    ...(ocrPages.has(page) ? { ocr: true } : {}),
  });
}

function rowUnits(
  t: PageTable,
  tableId: number,
  page: number,
  header: string[],
  repeatHeader: boolean,
): Unit[] {
  const out: Unit[] = [];
  const g = t.table.grid;
  const anchorText = (r: number, c: number): string => {
    const m = g.merges.find((x) => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);
    return m ? (t.rows[m.r]?.[m.c] ?? '') : (t.rows[r]?.[c] ?? '');
  };
  t.rows.forEach((cells, r) => {
    if (r < t.headerRows && repeatHeader) return;
    const toks: Token[] = [];
    const cellTok: [number, number][] = [];
    let text = '';
    cells.forEach((c, ci) => {
      if (ci > 0) text += ' | ';
      const base = text.length;
      text += c;
      const ts = tokenize(c).map((x) => ({ ...x, start: x.start + base, end: x.end + base }));
      cellTok.push([toks.length, toks.length + ts.length]);
      toks.push(...ts);
    });
    // The first cell names the row; a short one (an item number) takes the next one along.
    const first = anchorText(r, 0) || anchorText(r, 1);
    const label = first.length <= 4 && anchorText(r, 1) ? `${first} · ${anchorText(r, 1)}` : first;
    out.push(
      withClauses({
        kind: 'row',
        text,
        tokens: toks,
        tokWord: toks.map(() => 0),
        words: [],
        page,
        key: `r:${cells
          .map((c) =>
            tokenize(c)
              .map((x) => x.key)
              .join(' '),
          )
          .join('␟')}`,
        row: {
          table: tableId,
          cells,
          cellTok,
          header,
          label: r < t.headerRows ? '(header)' : label,
        },
      }),
    );
  });
  return out;
}

export async function extractDoc(doc: Doc, o: ExtractOptions = {}): Promise<DocText> {
  const route = o.route ?? 'xy';
  const t0 = performance.now();
  let msText = 0;
  let msTables = 0;
  let msOrder = 0;
  const pages: { h: number; w: number; words: Word[]; tables: PageTable[]; figures: Figure[] }[] =
    [];
  const ocrPages = new Set<number>();
  const emptyPages: number[] = [];
  for (let p = 0; p < doc.pages; p++) {
    let t = performance.now();
    const pt = pageText(doc, p);
    let words = route === 'oxide' && o.oxide ? oxideWords(o.oxide, p, pt.h) : wordsOf(pt.chars, p);
    const scan = pt.imageCover > 0.8;
    if (scan && pt.chars.length > 0 && pt.chars.every((c) => c.invisible)) ocrPages.add(p);
    if (scan && words.length === 0 && o.ocr) {
      const ow = await o.ocr(doc, p);
      if (ow) {
        ocrPages.add(p);
        words = ow.map((w) => ({
          text: w.text,
          ...w.box,
          size: w.size,
          bold: false,
          invisible: true,
          rtl: false,
          base: w.box.y1,
          page: p,
        }));
      }
    }
    if (words.length === 0) emptyPages.push(p);
    msText += performance.now() - t;
    t = performance.now();
    // Table detection only where a table can be: rulings, or many numbers.
    const numeric = words.filter((w) => /^[$€£₹]?[\d.,%]+$/.test(w.text)).length;
    const maybeTable = pt.paths >= 4 || numeric >= 0.2 * words.length;
    const tables =
      o.tables && o.oxide && words.length && maybeTable ? await pageTables(doc, o.oxide, p) : [];
    msTables += performance.now() - t;
    // A scanned page's own picture is not a figure of the document.
    const figures = scan ? [] : pt.figures.filter((f) => (f.x1 - f.x0) * (f.y1 - f.y0) > 400);
    pages.push({ h: pt.h, w: pt.w, words, tables, figures });
  }
  const t = performance.now();
  // Headers and footers: lines near the top and bottom edge repeated on most pages.
  const pageLines = pages.map((pg, p) => streamLinesSorted(pg.words, p));
  const hf =
    o.headersFooters === false
      ? { groups: [], lines: new Set<Line>() }
      : detectHf(
          pageLines,
          pages.map((pg) => pg.h),
        );
  const hfWords = new Set<Word>([...hf.lines].flatMap((l) => l.words));
  const units: Unit[] = [];
  const seenHeaders = new Set<string>();
  let tableId = 0;
  const allLines: Line[] = [];
  for (const [p, pg] of pages.entries()) {
    const words = pg.words.filter((w) => !hfWords.has(w));
    const inBox = (w: Box, b: Box) => {
      const cx = (w.x0 + w.x1) / 2;
      const cy = (w.y0 + w.y1) / 2;
      return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1;
    };
    const atoms: Box[] = [...pg.tables.map((x) => x.box), ...pg.figures];
    const flow = words.filter((w) => !pg.tables.some((x) => inBox(w, x.box)));
    let lines: Line[];
    if (route === 'xy') lines = readingOrder(flow, atoms, p);
    else {
      lines = streamLines(flow, p);
      // Atoms go where their top lands among the lines.
      atoms.forEach((a, i) => {
        const at = lines.findIndex((l) => l.y0 > a.y0);
        const line: Line = { ...a, words: [], size: 10, bold: false, rtl: false, page: p, atom: i };
        if (at < 0) lines.push(line);
        else lines.splice(at, 0, line);
      });
    }
    allLines.push(...lines);
  }
  for (const para of paragraphs(allLines)) {
    {
      const first = para[0]!;
      const p = first.page;
      const pg = pages[p]!;
      if (first.atom !== undefined) {
        const ti = first.atom;
        const tb = pg.tables[ti];
        if (tb) {
          const header = tb.rows.slice(0, tb.headerRows).reduce<string[]>((acc, r) => {
            r.forEach((c, i) => {
              acc[i] = [acc[i], c].filter((x) => x).join(' ');
            });
            return acc;
          }, []);
          const hkey = header.join('|');
          const repeat = tb.headerRows > 0 && seenHeaders.has(hkey);
          if (tb.headerRows > 0) seenHeaders.add(hkey);
          units.push(...rowUnits(tb, tableId++, p, header, repeat));
        } else {
          const f = pg.figures[ti - pg.tables.length];
          if (f)
            units.push(
              withClauses({
                kind: 'figure',
                text: '[figure]',
                tokens: [],
                tokWord: [],
                words: [],
                page: p,
                key: `f:${f.hash}`,
                figure: f,
              }),
            );
        }
        continue;
      }
      const u = unitOf(para, ocrPages);
      if (u.tokens.length) units.push(u);
    }
  }
  msOrder = performance.now() - t;
  return {
    units,
    hf: hf.groups,
    pages: doc.pages,
    ocrPages: [...ocrPages],
    emptyPages,
    ms: { text: msText, tables: msTables, order: msOrder, total: performance.now() - t0 },
  };
}

/** Lines of a page for header/footer detection (content order is enough at the edges). */
function streamLinesSorted(words: readonly Word[], page: number): Line[] {
  const sorted = [...words].sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const out: Line[] = [];
  for (const w of sorted) {
    const l = out[out.length - 1];
    if (l && Math.abs(l.words[0]!.base - w.base) < 0.3 * w.size) {
      l.words.push(w);
      l.x0 = Math.min(l.x0, w.x0);
      l.x1 = Math.max(l.x1, w.x1);
      l.y0 = Math.min(l.y0, w.y0);
      l.y1 = Math.max(l.y1, w.y1);
    } else
      out.push({
        x0: w.x0,
        y0: w.y0,
        x1: w.x1,
        y1: w.y1,
        words: [w],
        size: w.size,
        bold: w.bold,
        rtl: w.rtl,
        page,
      });
  }
  return out;
}
