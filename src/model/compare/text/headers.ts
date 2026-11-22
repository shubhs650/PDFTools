// Headers and footers (M12-17, D-63, Q28, experimental, spike S30). Rows of
// text in the top and bottom 12 % of the page that recur at the same height
// (within 4 pt) on at least half the pages, digits ignored while grouping, are
// a header or footer. They are taken out of the running text (page furniture
// would otherwise land between paragraphs wherever the page breaks fall);
// each group keeps a template where the words that change from page to page
// (the running page number) are `{n}`, so "Page {n} of 6" against
// "Page {n} of 7" is one change, reported once. Pure code.
import { tokenize } from './tokens';

/** A row of text on a page: the layout lines that share its height. */
export interface Row {
  page: number;
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  text: string;
  /** The layout lines it is made of (their unique ids). */
  lines: number[];
}

export interface HfGroup {
  band: 'top' | 'bottom';
  /** Typical top of the row: pt from the top (top band) or from the bottom (negative). */
  y: number;
  pages: number[];
  /** Template keys ({n} for the running ones). */
  template: string[];
  /** The first page's row, as read and where it is. */
  sample: string;
  page: number;
  box: [number, number, number, number];
}

const BAND = 0.12;
const mask = (s: string): string => s.replace(/\d+/g, '#');

function dice(a: string, b: string): number {
  const ta = tokenize(a).map((t) => t.key);
  const tb = tokenize(b).map((t) => t.key);
  if (!ta.length && !tb.length) return 1;
  const m = new Map<string, number>();
  for (const k of ta) m.set(k, (m.get(k) ?? 0) + 1);
  let common = 0;
  for (const k of tb) {
    const c = m.get(k) ?? 0;
    if (c > 0) {
      common++;
      m.set(k, c - 1);
    }
  }
  return (2 * common) / (ta.length + tb.length);
}

const mostCommon = <T>(xs: readonly T[]): T | undefined => {
  const count = new Map<T, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  let best: T | undefined;
  let n = 0;
  for (const [x, c] of count)
    if (c > n) {
      best = x;
      n = c;
    }
  return best;
};

/**
 * Header and footer bands drawn by hand (D-63, Q28): the height of each band
 * from its edge of the page, in points. Everything in a band is a header or
 * footer, on every page, whether it repeats or not; nothing outside is.
 */
export interface HfBands {
  top: number;
  bottom: number;
}

/**
 * The header and footer groups of a document and the layout lines they
 * hold. `rows[p]` are page p's rows; `heights[p]` its height. With `bands`,
 * the hand-drawn bands replace the detection.
 */
export function detectHf(
  rows: readonly (readonly Row[])[],
  heights: readonly number[],
  bands?: HfBands,
): { groups: HfGroup[]; lines: Set<number> } {
  const n = rows.length;
  const lines = new Set<number>();
  if (n < (bands ? 1 : 2)) return { groups: [], lines };
  const cands: { r: Row; band: 'top' | 'bottom'; y: number }[] = [];
  rows.forEach((rs, p) => {
    const h = heights[p] ?? 842;
    if (bands) {
      for (const r of rs) {
        const cy = (r.y0 + r.y1) / 2;
        if (cy <= bands.top) cands.push({ r, band: 'top', y: r.y0 });
        else if (cy >= h - bands.bottom) cands.push({ r, band: 'bottom', y: r.y0 - h });
      }
      return;
    }
    // Only the outermost two rows at each edge can be a header or footer.
    const byY = [...rs].sort((a, b) => a.y0 - b.y0);
    const edge = new Set([...byY.slice(0, 2), ...byY.slice(-2)]);
    for (const r of edge) {
      if (r.y1 <= BAND * h) cands.push({ r, band: 'top', y: r.y0 });
      else if (r.y0 >= (1 - BAND) * h) cands.push({ r, band: 'bottom', y: r.y0 - h });
    }
  });
  // Clusters by band and height (4 pt).
  cands.sort((a, b) => (a.band === b.band ? a.y - b.y : a.band < b.band ? -1 : 1));
  const clusters: (typeof cands)[] = [];
  for (const c of cands) {
    const last = clusters[clusters.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev?.band === c.band && c.y - prev.y <= 4) last.push(c);
    else clusters.push([c]);
  }
  const enough = bands ? 1 : Math.max(2, Math.ceil(0.5 * n));
  const groups: HfGroup[] = [];
  for (const cl of clusters) {
    if (new Set(cl.map((c) => c.r.page)).size < enough) continue;
    // The usual text of the group (digits masked), and the members like it.
    const usual = mostCommon(cl.map((c) => mask(c.r.text))) ?? '';
    const members = bands ? cl : cl.filter((c) => dice(mask(c.r.text), usual) >= 0.5);
    const pages = new Set(members.map((c) => c.r.page));
    if (pages.size < enough) continue;
    for (const c of members) for (const id of c.r.lines) lines.add(id);
    // Template: per token position, the same on every page or running ({n}).
    // Rows of the most common length decide (a first page may differ).
    const all = members.map((c) => tokenize(c.r.text).map((t) => t.key));
    const len = mostCommon(all.map((t) => t.length)) ?? 0;
    const toks = all.filter((t) => t.length === len);
    const template =
      toks.length > 1
        ? (toks[0] ?? []).map((k, i) => (toks.every((t) => t[i] === k) ? k : '{n}'))
        : tokenize(usual).map((t) => t.key);
    const first = [...members].sort((a, b) => a.r.page - b.r.page)[0]?.r;
    groups.push({
      band: cl[0]?.band ?? 'top',
      y: members.reduce((s, c) => s + c.y, 0) / members.length,
      pages: [...pages].sort((a, b) => a - b),
      template,
      sample: first?.text ?? '',
      page: first?.page ?? 0,
      box: first ? [first.x0, first.y0, first.x1, first.y1] : [0, 0, 0, 0],
    });
  }
  return { groups, lines };
}
