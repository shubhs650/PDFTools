// One revision as a sequence of comparison units (M12-17, M12-18, D-63,
// spike S30):
//
//   page layouts (layout.ts, reading order, tables and figures as atoms) →
//   headers and footers out (detected, or the bands drawn by hand) →
//   paragraphs (spacing, size, weight, list markers, continued across columns
//   and pages) → line-end hyphens joined → tokens (tokens.ts).
//
// A unit is a paragraph, a table row (its cells kept apart) or a figure (a
// picture). Everything is kept in flat typed arrays over the whole document
// (S30: objects per word and token do not scale past a few hundred pages);
// only each paragraph's text stays a string, and the few rows and figures
// keep a small record each. Token keys are interned in an Interner both sides
// share, so equality is one integer comparison. Pure code.
import type { PageFigure, PageTable } from '../material';
import { detectHf, type HfBands, type HfGroup, type Row } from './headers';
import type { Interner } from './myers';
import { WORD_BOLD, WORD_CELL, WORD_INVISIBLE, WORD_RTL, type PageLayout } from './layout';
import { kindCode, tokenize, type Token } from './tokens';

/** Kinds of unit (`TextDoc.unitKind`). */
export const UNIT_PARA = 0;
export const UNIT_ROW = 1;
export const UNIT_FIGURE = 2;
/** `TextDoc.unitFlags`: most of its words come from OCR (a text layer of a scan, or read at compare time). */
export const UNIT_OCR = 1;

/** A table row (D-63, Q30). */
export interface RowInfo {
  /** The table on its page (unique in the document) and the row in it. */
  table: number;
  row: number;
  cells: string[];
  /** Per cell: its first token and the token after its last (document token indexes). */
  cellTok: Int32Array;
  /** Column names: the table's header rows, cell by cell. */
  header: string[];
  /** The row's name: its first cell (with the next when the first is a short item number). */
  label: string;
  /** One of the table's header rows. */
  head: boolean;
}

/** A figure (D-63): a picture, compared as a picture. */
export interface FigureInfo {
  page: number;
  box: [number, number, number, number];
  hash: string;
  thumb: Uint8Array;
}

export interface TextDoc {
  /** Pages read (a prefix of the side's pages while a comparison is running). */
  pages: number;
  /** Pages without any text: "limited support". */
  empty: number[];
  /** Of those, the scans OCR could read for the comparison (D-63, Q29). */
  scanned: number[];
  /** Pages whose text was read by OCR at compare time. */
  ocrPages: number[];
  /** Headers and footers, taken out of the running text (experimental). */
  hf: HfGroup[];
  /** Per unit: its text as read, its key (interned), its first page. */
  unitText: string[];
  unitKey: Int32Array;
  unitPage: Int32Array;
  /** Unit u holds tokens unitTok[u] … unitTok[u + 1] − 1 and words unitWord[u] … unitWord[u + 1] − 1. */
  unitTok: Int32Array;
  unitWord: Int32Array;
  /** UNIT_PARA, UNIT_ROW or UNIT_FIGURE; UNIT_OCR flags. */
  unitKind: Uint8Array;
  unitFlags: Uint8Array;
  /** The key with clause numbers masked (finds renumbered clauses); the key itself when it has none. */
  unitRelabel: Int32Array;
  /** Unit u's clause numbers are tokens clauseTok[unitClause[u]] … clauseTok[unitClause[u + 1] − 1]. */
  unitClause: Int32Array;
  clauseTok: Int32Array;
  /** Rows and figures by unit. */
  rows: Map<number, RowInfo>;
  figures: Map<number, FigureInfo>;
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
  /** A table or figure of its page instead of words (PageLayout.lineAtom). */
  atom: number;
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
      atom: layout.lineAtom[k] ?? -1,
    });
  }
  return out;
}

/** The column of each line: the lines of its page it overlaps horizontally. */
function columnEdges(out: readonly LineRef[]): void {
  for (const l of out) {
    l.lo = l.x0;
    l.hi = l.x1;
    if (l.atom >= 0) continue;
    for (const o of out) {
      if (o.atom >= 0) continue;
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
    if (l.atom >= 0) {
      // A table or a figure is a unit (or units) of its own.
      if (cur.length) paras.push(cur);
      paras.push([l]);
      cur = [];
      continue;
    }
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
  unitKind: number[] = [];
  unitFlags: number[] = [];
  unitRelabel: number[] = [];
  unitClause: number[] = [0];
  clauseTok: number[] = [];
  rows = new Map<number, RowInfo>();
  figures = new Map<number, FigureInfo>();
  /** Header texts of the tables seen so far: a header repeated on a later page is left out. */
  heads = new Set<string>();
  tables = 0;
  /** Ids of a cell's or figure's own "line" (after every layout line). */
  cellLine = 1_000_000_000;
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
  const sizes: number[] = [];
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
      sizes.push(l.layout.wordSize[k] ?? 0);
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
  const tokWord: number[] = [];
  for (const tk of tokens) {
    while (w + 1 < offs.length && (offs[w + 1] ?? 0) <= tk.start) w++;
    tokWord.push(w);
  }
  // A raised small number is a footnote mark: numbered like a clause.
  const body = median(sizes);
  const raised = (i: number): boolean => (sizes[tokWord[i] ?? 0] ?? body) < 0.8 * body;
  let ocr = 0;
  for (let k = wordBase; k < c.wordFlags.length; k++)
    if ((c.wordFlags[k] ?? 0) & WORD_INVISIBLE) ocr++;
  pushUnit(c, intern, {
    kind: UNIT_PARA,
    text,
    tokens,
    tokWord: tokWord.map((x) => wordBase + x),
    page: lines[0]?.page ?? 0,
    clauses: clauseTokens(tokens, raised),
    ocr: ocr * 2 > c.wordFlags.length - wordBase,
  });
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
}

const CLAUSE_WORD =
  /^(?:clause|sub-clause|subclause|section|article|paragraph|step|annex|appendix|item|§)$/iu;
const CLAUSE_NUM = /^\d+(?:\.\d+)*\.?$/u;

/**
 * Clause numbers among a paragraph's tokens (S30): its own leading number
 * ("3.4", "Clause 3.4"), numbers cited after "Clause", "Section", … and
 * raised footnote marks.
 */
export function clauseTokens(
  tokens: readonly Token[],
  raised: (i: number) => boolean = () => false,
): number[] {
  const out: number[] = [];
  tokens.forEach((t, i) => {
    if (!CLAUSE_NUM.test(t.key)) return;
    if (raised(i) && /^\d+$/u.test(t.key)) {
      out.push(i);
      return;
    }
    const prev = tokens[i - 1];
    const cited = prev !== undefined && CLAUSE_WORD.test(prev.key);
    const lead = i === 0 || (i === 1 && cited);
    if (lead || cited) {
      // A bare leading number is a heading number ("3." or "3.4"), not "24.0 bar".
      const next = tokens[i + 1];
      if (i === 0 && next && (next.kind === 'value' || next.kind === 'number')) return;
      out.push(i);
    }
  });
  return out;
}

interface NewUnit {
  kind: number;
  text: string;
  tokens: readonly Token[];
  /** Per token, its word (document index). */
  tokWord: readonly number[];
  page: number;
  /** Tokens (unit positions) that are clause numbers; the unit's own number first. */
  clauses?: readonly number[];
  ocr?: boolean;
  /** The unit's key when not its tokens' (a figure). */
  key?: string;
}

/** Appends a unit and its tokens (its words are in already). */
function pushUnit(c: Columns, intern: Interner, u: NewUnit): number {
  const t0 = c.tokKey.length;
  const ids: number[] = [];
  u.tokens.forEach((tk, i) => {
    const id = intern.id(tk.key);
    ids.push(id);
    c.tokStart.push(tk.start);
    c.tokEnd.push(tk.end);
    c.tokKey.push(id);
    c.tokKind.push(kindCode(tk.kind));
    c.tokNum.push(tk.num ?? Number.NaN);
    c.tokWord.push(u.tokWord[i] ?? 0);
  });
  const prefix = u.kind === UNIT_ROW ? 'r' : 'p';
  const key = intern.id(u.key ?? `${prefix}:${ids.join(',')}`);
  const clauses = u.clauses ?? [];
  const masked = new Set(clauses);
  c.unitText.push(u.text);
  c.unitKey.push(key);
  c.unitRelabel.push(
    clauses.length
      ? intern.id(`R${prefix}:${ids.map((x, i) => (masked.has(i) ? '#' : x)).join(',')}`)
      : key,
  );
  for (const i of clauses) c.clauseTok.push(t0 + i);
  c.unitClause.push(c.clauseTok.length);
  c.unitKind.push(u.kind);
  c.unitFlags.push(u.ocr ? UNIT_OCR : 0);
  c.unitPage.push(u.page);
  c.unitTok.push(c.tokKey.length);
  c.unitWord.push(c.wordPage.length);
  return c.unitText.length - 1;
}

/** A word that stands for a box: a table cell, a figure. */
function boxWord(
  c: Columns,
  page: number,
  box: ArrayLike<number>,
  off: number,
  len: number,
  ocr: boolean,
): number {
  c.wordPage.push(page);
  c.wordLine.push(c.cellLine++);
  c.wordBox.push(box[0] ?? 0, box[1] ?? 0, box[2] ?? 0, box[3] ?? 0);
  c.wordOff.push(off);
  c.wordLen.push(len);
  c.wordFlags.push(WORD_CELL | (ocr ? WORD_INVISIBLE : 0));
  return c.wordPage.length - 1;
}

/**
 * A table's rows as units (D-63, Q30): cells tokenised apart, each cell
 * marked by its box. A header row seen before (repeated on each page of a
 * long table) is left out.
 */
function addTable(
  c: Columns,
  table: PageTable,
  page: number,
  ocr: boolean,
  intern: Interner,
  repeatedFirst: ReadonlySet<string>,
): void {
  // A first row repeated at the head of other tables is a header (a long table over pages).
  const t =
    table.headerRows === 0 && repeatedFirst.has(firstRow(table))
      ? { ...table, headerRows: 1 }
      : table;
  const id = c.tables++;
  const nc = t.cells[0]?.length ?? 0;
  const anchor = (r: number, col: number): string => {
    const m = t.merges.find((x) => r >= x.r && r < x.r + x.rs && col >= x.c && col < x.c + x.cs);
    return m ? (t.cells[m.r]?.[m.c] ?? '') : (t.cells[r]?.[col] ?? '');
  };
  const header: string[] = [];
  for (let r = 0; r < t.headerRows; r++)
    for (let col = 0; col < nc; col++) {
      const v = t.cells[r]?.[col] ?? '';
      if (v) header[col] = header[col] ? `${header[col] ?? ''} ${v}` : v;
    }
  const hkey = header.join('\u241f');
  const repeated = t.headerRows > 0 && c.heads.has(hkey);
  if (t.headerRows > 0) c.heads.add(hkey);
  t.cells.forEach((cells, r) => {
    const head = r < t.headerRows;
    if (head && repeated) return;
    let text = '';
    const tokens: Token[] = [];
    const tokWord: number[] = [];
    const cellTok: number[] = [];
    const t0 = c.tokKey.length;
    cells.forEach((cell, col) => {
      if (col > 0) text += ' | ';
      const base = text.length;
      text += cell;
      const ts = tokenize(cell);
      cellTok.push(t0 + tokens.length);
      if (ts.length) {
        const b = (r * nc + col) * 4;
        const w = boxWord(c, page, t.cellBoxes.subarray(b, b + 4), base, cell.length, ocr);
        for (const x of ts) {
          tokens.push({ ...x, start: x.start + base, end: x.end + base });
          tokWord.push(w);
        }
      }
      cellTok.push(t0 + tokens.length);
    });
    if (!tokens.length) return;
    const first = anchor(r, 0) || anchor(r, 1);
    const label = first.length <= 4 && anchor(r, 1) ? `${first} · ${anchor(r, 1)}` : first;
    const u = pushUnit(c, intern, { kind: UNIT_ROW, text, tokens, tokWord, page, ocr });
    c.rows.set(u, {
      table: id,
      row: r,
      cells: [...cells],
      cellTok: Int32Array.from(cellTok),
      header,
      label: head ? '' : label,
      head,
    });
  });
}

const firstRow = (t: PageTable): string => (t.cells[0] ?? []).join('\u241f');

/** First rows that head two tables or more (the header of a table running over pages). */
function repeatedFirstRows(layouts: readonly PageLayout[]): Set<string> {
  const seen = new Map<string, number>();
  for (const l of layouts)
    for (const t of l.tables) {
      if (t.cells.length < 2) continue;
      const k = firstRow(t);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  return new Set([...seen].filter(([, n]) => n >= 2).map(([k]) => k));
}

/** A figure as a unit: no words, its picture's hash as its key. */
function addFigure(c: Columns, f: PageFigure, page: number, intern: Interner): void {
  boxWord(c, page, f.box, 0, 0, false);
  const u = pushUnit(c, intern, {
    kind: UNIT_FIGURE,
    text: '',
    tokens: [],
    tokWord: [],
    page,
    key: `f:${f.hash}`,
  });
  c.figures.set(u, { page, box: f.box, hash: f.hash, thumb: f.thumb });
}

export interface BuildOptions {
  /** Take headers and footers out of the running text (default true; experimental). */
  headersFooters?: boolean;
  /** Header and footer bands drawn by hand: they replace the detection (D-63, Q28). */
  bands?: HfBands;
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
  const scanned: number[] = [];
  const ocrPages: number[] = [];
  let id = 0;
  layouts.forEach((l, p) => {
    if (l.wordSize.length === 0 && l.tables.length === 0) {
      empty.push(p);
      if (l.scan) scanned.push(p);
    }
    if (l.ocr) ocrPages.push(p);
    const ls = pageLines(l, p, id);
    id += ls.length;
    perPage.push(ls);
  });
  const hf =
    o.headersFooters === false
      ? { groups: [], lines: new Set<number>() }
      : detectHf(
          perPage.map((ls) => rowsOf(ls.filter((l) => l.atom < 0))),
          layouts.map((l) => l.height),
          o.bands,
        );
  const lines: LineRef[] = [];
  for (const ls of perPage) {
    const body = ls.filter((l) => !hf.lines.has(l.id));
    columnEdges(body);
    lines.push(...body);
  }
  const checkpoint = o.checkpoint;
  const repeated = repeatedFirstRows(layouts);
  const c = new Columns();
  let page = -1;
  for (const para of paragraphs(lines)) {
    const first = para[0]?.page ?? 0;
    if (first !== page) {
      page = first;
      checkpoint?.();
    }
    const atom = para[0]?.atom ?? -1;
    if (atom < 0) {
      addParagraph(c, para, intern);
      continue;
    }
    const l = para[0]?.layout;
    if (!l) continue;
    const table = l.tables[atom];
    if (table) addTable(c, table, first, l.ocr, intern, repeated);
    else {
      const fig = l.figures[atom - l.tables.length];
      if (fig) addFigure(c, fig, first, intern);
    }
  }
  return {
    pages: layouts.length,
    empty,
    scanned,
    ocrPages,
    hf: hf.groups,
    unitText: c.unitText,
    unitKey: Int32Array.from(c.unitKey),
    unitPage: Int32Array.from(c.unitPage),
    unitTok: Int32Array.from(c.unitTok),
    unitWord: Int32Array.from(c.unitWord),
    unitKind: Uint8Array.from(c.unitKind),
    unitFlags: Uint8Array.from(c.unitFlags),
    unitRelabel: Int32Array.from(c.unitRelabel),
    unitClause: Int32Array.from(c.unitClause),
    clauseTok: Int32Array.from(c.clauseTok),
    rows: c.rows,
    figures: c.figures,
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
