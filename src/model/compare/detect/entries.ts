// The differences of a sheet at the settings in use (M12-14, D-61, Q22,
// Q23): from the detector's counts and the text layer's word changes, with
// the sensitivity, the minimum size and the ignore zones applied. Cheap (the
// counts are sparse), so a new setting is applied live, without drawing the
// sheet again. Pure: runs in the Compare worker.
import { BINS, CELL_COUNTS, type DiffCells } from './detector';
import type { Box, TextChange } from './textDiff';

export type Sensitivity = 'low' | 'normal' | 'high';
export const SENSITIVITIES: readonly Sensitivity[] = ['low', 'normal', 'high'];

/**
 * Tolerance in pixels at the analysis resolution (S28, 150 dpi): a mark is
 * unchanged when the other revision has ink this close. Normal found every
 * manifest difference with no false report on the vector corpus; scans need
 * more (noise, edge jitter).
 */
export const TOLERANCE: Record<'vector' | 'scan', Record<Sensitivity, number>> = {
  vector: { high: 1, normal: 2, low: 3 },
  scan: { high: 2, normal: 3, low: 4 },
};

/** Fewest changed pixels a region without text needs (S28: noise and anti-aliasing). */
export const NOISE_PX = { vector: 6, scan: 80 } as const;

/** Regions closer than this (pt) to a word change join it. */
const TEXT_JOIN_PT = 1.5;
/** Word changes closer than this (pt) form one entry ("Ø120 → Ø128"). */
const WORD_JOIN_PT = 2;
/** Word changes on one line closer than this many times their size join too (a table row, a note). */
const LINE_JOIN = 1.2;
/** An entry is "text" when at least this share of its changed pixels is inside its words. */
const TEXT_SHARE = 0.8;

export type DiffKind = 'added' | 'removed' | 'changed';
export type DiffType = 'text' | 'geometry' | 'both';
export const DIFF_KINDS: readonly DiffKind[] = ['added', 'removed', 'changed'];
export const DIFF_TYPES: readonly DiffType[] = ['text', 'geometry', 'both'];

export interface DiffSettings {
  sensitivity: Sensitivity;
  /** Smallest entry kept: its larger side, in pt (0: no limit). */
  minSize: number;
  /** Ignore zones on this sheet (B's displayed page, pt). */
  zones: readonly Box[];
}

export const DEFAULT_SETTINGS: DiffSettings = { sensitivity: 'normal', minSize: 0, zones: [] };

export interface DiffEntry {
  /** Stable while the settings change a little: the centre on a 6 pt grid. */
  key: string;
  kind: DiffKind;
  type: DiffType;
  /** Box in B's displayed page (pt). */
  box: Box;
  /** Changed pixels of A (removed) and of B (added). */
  removed: number;
  added: number;
  /** Words of A and of B that changed, in reading order ("Ø120", "Ø128"). */
  old: string;
  new: string;
}

export interface SheetDiff {
  entries: DiffEntry[];
  /** Changed pixels over pixels with ink on either revision (percent). */
  percent: number;
  /** A scan (the scan tolerance and noise floor apply). */
  scan: boolean;
}

/** The detector's material of one sheet, kept by the Compare worker. */
export interface SheetMaterial {
  cells: DiffCells;
  texts: TextChange[];
  scan: boolean;
  /** The sheet's frame (pt). */
  width: number;
  height: number;
}

const inside = (x: number, y: number, b: Box): boolean =>
  x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

const near = (p: Box, q: Box, gap: number): boolean =>
  p[0] - gap <= q[2] && q[0] - gap <= p[2] && p[1] - gap <= q[3] && q[1] - gap <= p[3];

const union = (p: Box, q: Box): Box => [
  Math.min(p[0], q[0]),
  Math.min(p[1], q[1]),
  Math.max(p[2], q[2]),
  Math.max(p[3], q[3]),
];

class Sets {
  private readonly up: number[];
  constructor(n: number) {
    this.up = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let r = i;
    while (this.up[r] !== r) r = this.up[r] ?? r;
    while (this.up[i] !== r) {
      const n = this.up[i] ?? r;
      this.up[i] = r;
      i = n;
    }
    return r;
  }
  join(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.up[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

interface Region {
  box: Box;
  removed: number;
  added: number;
  /** Changed cells: centre x, y (pt) and pixels. */
  cells: number[];
}

/** Regions of changed cells (8-connected), with the zones' cells left out. */
function regions(c: DiffCells, tol: number, zones: readonly Box[]): Region[] {
  const k = 72 / c.dpi;
  const side = c.cell * k;
  // Bins with distance > tol: bin j holds distance j + 2 (the last, ≥ CAP).
  const from = Math.max(0, tol - 1);
  const value = new Map<number, [number, number]>();
  for (let i = 0; i < c.index.length; i++) {
    let rem = 0;
    let add = 0;
    for (let j = from; j < BINS; j++) {
      rem += c.counts[i * CELL_COUNTS + j] ?? 0;
      add += c.counts[i * CELL_COUNTS + BINS + j] ?? 0;
    }
    if (!rem && !add) continue;
    const idx = c.index[i] ?? 0;
    const cx = ((idx % c.cols) + 0.5) * side;
    const cy = (Math.floor(idx / c.cols) + 0.5) * side;
    if (zones.some((z) => inside(cx, cy, z))) continue;
    value.set(idx, [rem, add]);
  }
  const seen = new Set<number>();
  const out: Region[] = [];
  for (const start of value.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const r: Region = {
      box: [Infinity, Infinity, -Infinity, -Infinity],
      removed: 0,
      added: 0,
      cells: [],
    };
    const stack = [start];
    while (stack.length) {
      const idx = stack.pop() ?? 0;
      const [rem, add] = value.get(idx) ?? [0, 0];
      const col = idx % c.cols;
      const row = Math.floor(idx / c.cols);
      r.removed += rem;
      r.added += add;
      r.box = union(r.box, [col * side, row * side, (col + 1) * side, (row + 1) * side]);
      r.cells.push((col + 0.5) * side, (row + 0.5) * side, rem + add);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = col + dx;
          const y = row + dy;
          if (x < 0 || y < 0 || x >= c.cols || y >= c.rows) continue;
          const q = y * c.cols + x;
          if (!seen.has(q) && value.has(q)) {
            seen.add(q);
            stack.push(q);
          }
        }
    }
    out.push(r);
  }
  return out;
}

/** Two word changes that read as one: touching, or close on one line. */
function wordsJoin(p: TextChange | undefined, q: TextChange | undefined): boolean {
  if (!p || !q) return false;
  if (near(p.box, q.box, WORD_JOIN_PT)) return true;
  const size = Math.max(p.size, q.size);
  if (Math.abs(p.cy - q.cy) > size * 0.5) return false;
  const gap = Math.max(p.box[0], q.box[0]) - Math.min(p.box[2], q.box[2]);
  return gap < size * LINE_JOIN;
}

const readingOrder = (p: TextChange, q: TextChange): number =>
  Math.abs(p.cy - q.cy) > Math.min(p.size, q.size) * 0.5 ? p.cy - q.cy : p.cx - q.cx;

/** The sheet's differences at `settings`. */
export function sheetDiff(m: SheetMaterial, s: DiffSettings): SheetDiff {
  const kind = m.scan ? 'scan' : 'vector';
  const tol = TOLERANCE[kind][s.sensitivity];
  const regs = regions(m.cells, tol, s.zones);
  const words = m.texts.filter((w) => !s.zones.some((z) => inside(w.cx, w.cy, z)));
  // Items: the regions, then the word changes; near ones join.
  const n = regs.length + words.length;
  const sets = new Sets(n);
  const boxOf = (i: number): Box =>
    i < regs.length
      ? (regs[i]?.box ?? [0, 0, 0, 0])
      : (words[i - regs.length]?.box ?? [0, 0, 0, 0]);
  for (let i = 0; i < words.length; i++) {
    const wi = regs.length + i;
    for (let j = i + 1; j < words.length; j++)
      if (wordsJoin(words[i], words[j])) sets.join(wi, regs.length + j);
    for (let r = 0; r < regs.length; r++)
      if (near(boxOf(wi), boxOf(r), TEXT_JOIN_PT)) sets.join(wi, r);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = sets.find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  let changed = 0;
  const entries: DiffEntry[] = [];
  for (const members of groups.values()) {
    let box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    let removed = 0;
    let added = 0;
    const ws: TextChange[] = [];
    const cells: number[] = [];
    for (const i of members) {
      box = union(box, boxOf(i));
      if (i < regs.length) {
        const r = regs[i];
        if (!r) continue;
        removed += r.removed;
        added += r.added;
        cells.push(...r.cells);
      } else {
        const w = words[i - regs.length];
        if (w) ws.push(w);
      }
    }
    const px = removed + added;
    if (!ws.length && px < NOISE_PX[kind]) continue;
    if (s.minSize > 0 && Math.max(box[2] - box[0], box[3] - box[1]) < s.minSize) continue;
    changed += px;
    const oldWords = ws.filter((w) => w.kind === 'removed').sort(readingOrder);
    const newWords = ws.filter((w) => w.kind === 'added').sort(readingOrder);
    let k: DiffKind;
    if (px > 0) {
      const share = removed / px;
      k = share > 0.85 ? 'removed' : share < 0.15 ? 'added' : 'changed';
      // A word swapped for another in place is a change, whatever the pixels say.
      if (oldWords.length && newWords.length) k = 'changed';
    } else
      k = oldWords.length && newWords.length ? 'changed' : oldWords.length ? 'removed' : 'added';
    let type: DiffType = 'geometry';
    if (ws.length) {
      let inWords = 0;
      for (let i = 0; i < cells.length; i += 3) {
        const x = cells[i] ?? 0;
        const y = cells[i + 1] ?? 0;
        if (
          ws.some((w) =>
            inside(x, y, [w.box[0] - 1.5, w.box[1] - 1.5, w.box[2] + 1.5, w.box[3] + 1.5]),
          )
        )
          inWords += cells[i + 2] ?? 0;
      }
      type = px === 0 || inWords >= px * TEXT_SHARE ? 'text' : 'both';
    }
    // Clipped to the sheet (the last cells reach past its edge).
    box = [
      Math.max(0, box[0]),
      Math.max(0, box[1]),
      Math.min(m.width, box[2]),
      Math.min(m.height, box[3]),
    ];
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    entries.push({
      key: `${String(Math.round(cx / 6))}:${String(Math.round(cy / 6))}`,
      kind: k,
      type,
      box,
      removed,
      added,
      old: oldWords.map((w) => w.text).join(' '),
      new: newWords.map((w) => w.text).join(' '),
    });
  }
  // Top to bottom in bands a tenth of the sheet high, then left to right.
  const band = Math.max(1, m.height / 10);
  entries.sort((p, q) => {
    const bp = Math.floor(p.box[1] / band);
    const bq = Math.floor(q.box[1] / band);
    return bp !== bq ? bp - bq : p.box[0] - q.box[0] || p.box[1] - q.box[1];
  });
  // Keys stay unique.
  const used = new Map<string, number>();
  for (const e of entries) {
    const n = used.get(e.key) ?? 0;
    used.set(e.key, n + 1);
    if (n) e.key = `${e.key}#${String(n)}`;
  }
  return {
    entries,
    percent: m.cells.ink > 0 ? Math.min(100, (100 * changed) / m.cells.ink) : 0,
    scan: m.scan,
  };
}
