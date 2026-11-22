// Spike S30 (M12-05): headers and footers (D-63, Q28, experimental). Lines in
// the top and bottom 12 % of the page that recur at the same height on most
// pages (digits ignored while grouping) are a header or footer. They are left
// out of the running text; each group's template keeps the words that are the
// same on every page and marks the words that change from page to page (the
// running page number) as {n}, so "Page {n} of 6" against "Page {n} of 7" is
// one change, reported once.

import type { Line } from './layout.ts';
import { tokenize } from './tokens.ts';

export interface HfGroup {
  band: 'top' | 'bottom';
  /** Typical baseline (pt from the top). */
  y: number;
  pages: number[];
  /** Template tokens ({n} for the running ones). */
  template: string[];
  /** Text of the first page's line, as read. */
  sample: string;
}

const BAND = 0.12;
const textOf = (l: Line) => l.words.map((w) => w.text).join(' ');
const mask = (s: string) => s.replace(/\d+/g, '#');

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

export function detectHf(
  pages: readonly (readonly Line[])[],
  heights: readonly number[],
): { groups: HfGroup[]; lines: Set<Line> } {
  const n = pages.length;
  const lines = new Set<Line>();
  if (n < 2) return { groups: [], lines };
  const cands: { l: Line; band: 'top' | 'bottom'; y: number }[] = [];
  pages.forEach((ls, p) => {
    const h = heights[p] ?? 842;
    // Only the outermost two lines at each edge can be a header or footer.
    const byY = [...ls].sort((a, b) => a.y0 - b.y0);
    const edge = new Set([...byY.slice(0, 2), ...byY.slice(-2)]);
    for (const l of ls) {
      if (!edge.has(l)) continue;
      if (l.y1 <= BAND * h) cands.push({ l, band: 'top', y: l.y0 });
      else if (l.y0 >= (1 - BAND) * h) cands.push({ l, band: 'bottom', y: l.y0 - h });
    }
  });
  // Cluster by band and height (4 pt).
  cands.sort((a, b) => (a.band === b.band ? a.y - b.y : a.band < b.band ? -1 : 1));
  const clusters: (typeof cands)[] = [];
  for (const c of cands) {
    const last = clusters[clusters.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev?.band === c.band && c.y - prev.y <= 4) last.push(c);
    else clusters.push([c]);
  }
  const groups: HfGroup[] = [];
  for (const cl of clusters) {
    const byPage = new Map<number, Line[]>();
    for (const c of cl) byPage.set(c.l.page, [...(byPage.get(c.l.page) ?? []), c.l]);
    if (byPage.size < Math.max(2, Math.ceil(0.5 * n))) continue;
    // The usual text of the group (digits masked), and the members like it.
    const count = new Map<string, number>();
    for (const c of cl) count.set(mask(textOf(c.l)), (count.get(mask(textOf(c.l))) ?? 0) + 1);
    const usual = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const members = cl.filter((c) => dice(mask(textOf(c.l)), usual) >= 0.5);
    const memberPages = new Set(members.map((c) => c.l.page));
    if (memberPages.size < Math.max(2, Math.ceil(0.5 * n))) continue;
    for (const c of members) lines.add(c.l);
    // Template: per token position, the same on every page or running ({n}).
    // Lines of the most common length decide (a first page may differ).
    const all = members.map((c) => tokenize(textOf(c.l)).map((t) => t.key));
    const lens = new Map<number, number>();
    for (const t of all) lens.set(t.length, (lens.get(t.length) ?? 0) + 1);
    const len = [...lens].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const toks = all.filter((t) => t.length === len);
    const template =
      toks.length > 1
        ? (toks[0] ?? []).map((k, i) => (toks.every((t) => t[i] === k) ? k : '{n}'))
        : tokenize(usual).map((t) => t.key);
    groups.push({
      band: cl[0]?.band ?? 'top',
      y: members.reduce((s, c) => s + c.y, 0) / members.length,
      pages: [...memberPages].sort((a, b) => a - b),
      template,
      sample: members[0] ? textOf(members[0].l) : '',
    });
  }
  return { groups, lines };
}
