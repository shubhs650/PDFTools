// Stream (unruled) tables (M4-12, §7.7): our own detector, since PDF Oxide
// finds none (ADR-009). From word boxes: words → lines (by baseline) → chunks
// (split at gaps wider than about a character height) → blocks of
// consecutive lines with two or more chunks → column bands where chunks line
// up (whitespace columns between them) → rows, with wrapped continuation
// lines (no text in the table's key column) folded into the row above. Two
// tables side by side are told apart by their independent row structure.
// Pure.
import type { TableGrid, WordBox } from '../../../model/tableGrid';

export interface StreamWord extends WordBox {
  bold: boolean;
  /** Font size (points). */
  size: number;
}

interface Chunk {
  x0: number;
  x1: number;
  words: StreamWord[];
}

interface Line {
  /** Baseline (word box bottom). */
  y: number;
  top: number;
  size: number;
  chunks: Chunk[];
}

/** Gap between chunks, in font sizes, that separates columns. */
const CHUNK_GAP = 1.0;
/** Largest gap between lines of one block, in font sizes. */
const LINE_GAP = 2.8;
/** Lines with two or more chunks a block needs. */
const MIN_LINES = 3;

export function toLines(words: readonly StreamWord[]): Line[] {
  const sorted = [...words].sort((a, b) => b.y0 - a.y0 || a.x0 - b.x0);
  const groups: StreamWord[][] = [];
  for (const w of sorted) {
    const g = groups.at(-1);
    const f = g?.[0];
    if (g && f && Math.abs(f.y0 - w.y0) <= 0.4 * Math.max(f.size, w.size)) g.push(w);
    else groups.push([w]);
  }
  return groups.map((g) => {
    const ws = [...g].sort((a, b) => a.x0 - b.x0);
    const size = Math.max(...ws.map((w) => w.size));
    const chunks: Chunk[] = [];
    for (const w of ws) {
      const c = chunks.at(-1);
      if (c && w.x0 - c.x1 <= CHUNK_GAP * size) {
        c.words.push(w);
        c.x1 = Math.max(c.x1, w.x1);
      } else chunks.push({ x0: w.x0, x1: w.x1, words: [w] });
    }
    return {
      y: Math.min(...ws.map((w) => w.y0)),
      top: Math.max(...ws.map((w) => w.y1)),
      size,
      chunks,
    };
  });
}

/** Column bands: the union of overlapping chunk extents, left to right. */
export function bands(chunks: readonly Chunk[]): [number, number][] {
  const sorted = [...chunks].sort((a, b) => a.x0 - b.x0);
  const out: [number, number][] = [];
  for (const c of sorted) {
    const last = out.at(-1);
    if (last && c.x0 <= last[1]) last[1] = Math.max(last[1], c.x1);
    else out.push([c.x0, c.x1]);
  }
  return out;
}

/** Runs of lines close together, each with at least MIN_LINES multi-chunk lines. */
function blocks(lines: readonly Line[]): Line[][] {
  const out: Line[][] = [];
  let cur: Line[] = [];
  const flush = () => {
    // Leading and trailing single-chunk lines (titles, notes) are not table rows.
    while (cur.length && (cur[0]?.chunks.length ?? 0) < 2) cur.shift();
    while (cur.length && (cur.at(-1)?.chunks.length ?? 0) < 2) cur.pop();
    if (cur.filter((l) => l.chunks.length >= 2).length >= MIN_LINES) out.push(cur);
    cur = [];
  };
  for (const l of lines) {
    const prev = cur.at(-1);
    if (prev && prev.y - l.y > LINE_GAP * Math.max(prev.size, l.size)) flush();
    cur.push(l);
  }
  flush();
  return out;
}

const within = (c: Chunk, [a, b]: [number, number]) => c.x0 >= a - 0.5 && c.x1 <= b + 0.5;

/**
 * Splits bands into groups at gaps where the chunks on either side don't share
 * their lines (two independent tables side by side).
 */
function splitSideBySide(block: readonly Line[], bs: [number, number][]): [number, number][][] {
  if (bs.length < 4) return [bs];
  const linesIn = (group: [number, number][]) => {
    const ext: [number, number] = [group[0]?.[0] ?? 0, group.at(-1)?.[1] ?? 0];
    return new Set(block.filter((l) => l.chunks.some((c) => within(c, ext))));
  };
  // Widest gap first; each side keeps at least two bands.
  const gaps = bs
    .slice(1)
    .map((b, i) => ({ i: i + 1, w: b[0] - (bs[i]?.[1] ?? 0) }))
    .filter((g) => g.i >= 2 && g.i <= bs.length - 2)
    .sort((a, b) => b.w - a.w);
  for (const g of gaps.slice(0, 2)) {
    const left = bs.slice(0, g.i);
    const right = bs.slice(g.i);
    const L = linesIn(left);
    const R = linesIn(right);
    const shared = [...L].filter((l) => R.has(l)).length;
    if (shared < 0.6 * Math.min(L.size, R.size))
      return [...splitSideBySide(block, left), ...splitSideBySide(block, right)];
  }
  return [bs];
}

/** One table from a block's lines restricted to a group of column bands. */
function tableOf(
  page: number,
  block: readonly Line[],
  group: [number, number][],
): TableGrid | null {
  const ext: [number, number] = [group[0]?.[0] ?? 0, group.at(-1)?.[1] ?? 0];
  const lines = block
    .map((l) => ({ ...l, chunks: l.chunks.filter((c) => within(c, ext)) }))
    .filter((l) => l.chunks.length > 0);
  if (lines.filter((l) => l.chunks.length >= 2).length < MIN_LINES) return null;
  const colOf = (c: Chunk) => group.findIndex((b) => c.x0 >= b[0] - 0.5 && c.x0 <= b[1] + 0.5);
  // The key column: the leftmost one most full lines (two or more chunks) have text in.
  const full = lines.filter((l) => l.chunks.length >= 2);
  const counts = group.map(
    (_, k) => full.filter((l) => l.chunks.some((c) => colOf(c) === k)).length,
  );
  const key = counts.indexOf(Math.max(...counts));
  // Rows: a line without text in the key column continues the row above.
  const rowsOfLines: (typeof lines)[] = [];
  for (const l of lines) {
    const prev = rowsOfLines.at(-1)?.at(-1);
    const continues =
      prev !== undefined &&
      !l.chunks.some((c) => colOf(c) === key) &&
      prev.y - l.y <= 1.6 * Math.max(prev.size, l.size);
    if (continues) rowsOfLines.at(-1)?.push(l);
    else rowsOfLines.push([l]);
  }
  if (rowsOfLines.length < 2) return null;
  const tops = rowsOfLines.map((r) => Math.max(...r.map((l) => l.top)));
  const bottoms = rowsOfLines.map((r) => Math.min(...r.map((l) => l.y - 0.25 * l.size)));
  const rows = [
    (tops[0] ?? 0) + 2,
    ...tops.slice(1).map((t, i) => (t + (bottoms[i] ?? t)) / 2),
    (bottoms.at(-1) ?? 0) - 1,
  ];
  const cols = [
    ext[0] - 2,
    ...group.slice(1).map((b, i) => (b[0] + (group[i]?.[1] ?? b[0])) / 2),
    ext[1] + 2,
  ];
  return { page, cols, rows, headerRows: 0, merges: [], source: 'stream' };
}

const insideAny = (w: WordBox, boxes: readonly [number, number, number, number][]) => {
  const cx = (w.x0 + w.x1) / 2;
  const cy = (w.y0 + w.y1) / 2;
  return boxes.some(([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1);
};

/** Unruled tables of a page; words inside `exclude` (ruled tables already found) are ignored. */
export function streamTables(
  page: number,
  words: readonly StreamWord[],
  exclude: readonly [number, number, number, number][] = [],
): TableGrid[] {
  const lines = toLines(words.filter((w) => !insideAny(w, exclude)));
  const out: TableGrid[] = [];
  for (const block of blocks(lines)) {
    const multi = block.filter((l) => l.chunks.length >= 2);
    const bs = bands(multi.flatMap((l) => l.chunks));
    if (bs.length < 2) continue;
    for (const group of splitSideBySide(block, bs)) {
      if (group.length < 2) continue;
      const t = tableOf(page, block, group);
      if (t) out.push(t);
    }
  }
  return out;
}
