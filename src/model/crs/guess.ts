// First suggestions for a CRS template's set-up (M13-08, D-71, plan M13 §6
// "Setting up"): the table's header row and so its start row, the fields its
// header names, and the detail cells next to their labels. Each is only a
// starting point the person checks in the guided steps; nothing is placed
// that the person can't see and change. Pure: works on the sheet preview's
// cells. The patterns read English headers, as project forms are written;
// anything else is simply left for the person to place.
import { cellName } from './a1';
import type { CrsField, DetailField } from './template';

/** What a guess needs of a preview cell. */
export interface GuessCell {
  r: number;
  c: number;
  text: string;
  rs?: number;
  cs?: number;
  bold?: true;
  fill?: string;
  formula?: true;
  top?: unknown;
  bottom?: unknown;
  left?: unknown;
  right?: unknown;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/gu, ' ').trim();

const looksLikeHeader = (c: GuessCell): boolean =>
  norm(c.text) !== '' && (c.bold === true || c.fill !== undefined || c.bottom !== undefined);

/**
 * The table's header row: the row (among the first `within`) with the most
 * header-looking cells, at least three. Null when there is none.
 */
export function guessHeaderRow(cells: readonly GuessCell[], within = 60): number | null {
  const count = new Map<number, number>();
  for (const c of cells)
    if (c.r <= within && looksLikeHeader(c)) count.set(c.r, (count.get(c.r) ?? 0) + 1);
  let best: number | null = null;
  let most = 2;
  for (const [r, n] of [...count].sort((a, b) => a[0] - b[0])) {
    if (n > most) {
      best = r;
      most = n;
    }
  }
  return best;
}

/** The first row under the header (a two-row header's merged cells count). */
export function guessStartRow(cells: readonly GuessCell[], within = 60): number | null {
  const head = guessHeaderRow(cells, within);
  if (head === null) return null;
  let last = head;
  for (const c of cells) if (c.r === head && c.rs) last = Math.max(last, head + c.rs - 1);
  // A second header line right under a merged first one (e.g. "Response" over "By | Date").
  return last + 1;
}

/** Header words → field, most specific first. */
const FIELD_PATTERNS: readonly [CrsField, RegExp][] = [
  ['commentId', /\bcomment ?id\b|\buid\b|^id$/u],
  ['commentNo', /\bcomment (no|number|#)|\bcmt\.? ?no\b/u],
  ['srNo', /^(s\.? ?no|sr\.? ?no|sl\.? ?no|serial|item no|item)\b|^(no\.?|#)$/u],
  ['pageLabel', /page label|sheet (no|number)|drawing (no|number)|\bdwg\.? ?no/u],
  ['page', /\bpage\b|\bpg\.?\b/u],
  ['lastReplyAuthor', /(last )?repl(y|ied) by|reply author/u],
  ['firstReply', /first reply/u],
  ['lastReply', /last reply/u],
  ['allReplies', /\brepl(y|ies)\b/u],
  ['snapshot', /snapshot|picture|image|screenshot|sketch/u],
  ['discipline', /discipline|department|\bdept\b|\btrade\b/u],
  ['type', /\btype\b|category|markup/u],
  ['text', /comment|remark|observation|query|description/u],
  ['author', /reviewer|author|commented by|raised by|originator/u],
  ['modified', /modified|updated/u],
  ['created', /\bdate\b|raised on|created/u],
  ['status', /status/u],
];

/**
 * Fields for the header row's columns, left to right; each field once. A
 * header such as "Response" or "Days open" matches nothing and stays free.
 */
export function guessColumns(
  cells: readonly GuessCell[],
  headerRow: number,
): { field: CrsField; col: number }[] {
  const out: { field: CrsField; col: number }[] = [];
  const used = new Set<CrsField>();
  const heads = cells
    .filter((c) => c.r <= headerRow && c.r + (c.rs ?? 1) - 1 >= headerRow && norm(c.text) !== '')
    .sort((a, b) => a.c - b.c);
  for (const h of heads) {
    const text = norm(h.text);
    if (/respon|answer|days|remarks by|vendor|contractor/u.test(text)) continue;
    const hit = FIELD_PATTERNS.find(([f, re]) => !used.has(f) && re.test(text));
    if (!hit) continue;
    used.add(hit[0]);
    out.push({ field: hit[0], col: h.c });
  }
  return out;
}

/** Label words → detail field. */
const DETAIL_PATTERNS: readonly [DetailField, RegExp][] = [
  ['docName', /file name|document name/u],
  [
    'docNumber',
    /\bdoc(ument)?\.? ?(no|number|#)|\bdrawing (no|number)|\bdwg\.? ?no|\bdocument ref/u,
  ],
  ['revision', /^rev(ision)?\.?( no\.?)?:?$/u],
  ['title', /title/u],
  ['reviewer', /reviewer|reviewed by/u],
  ['reviewDate', /review date|date of review|^date:?$/u],
  ['commentCount', /total comments|no\.? of comments|number of comments|comment count/u],
  ['pageCount', /no\.? of (pages|sheets)|page count|total pages/u],
  ['scheme', /status (scheme|codes?)/u],
];

/**
 * Detail cells: for a label cell above the table, the empty cell just right
 * of it (after its merge). Only cells without text or a formula are taken.
 */
export function guessDetails(
  cells: readonly GuessCell[],
  beforeRow: number,
): Partial<Record<DetailField, string>> {
  const at = new Map(cells.map((c) => [`${String(c.r)}:${String(c.c)}`, c]));
  const covered = new Set<string>();
  for (const c of cells)
    for (let r = c.r; r < c.r + (c.rs ?? 1); r++)
      for (let k = c.c; k < c.c + (c.cs ?? 1); k++)
        if (r !== c.r || k !== c.c) covered.add(`${String(r)}:${String(k)}`);
  const out: Partial<Record<DetailField, string>> = {};
  const labels = cells
    .filter((c) => c.r < beforeRow && norm(c.text) !== '')
    .sort((a, b) => a.r - b.r || a.c - b.c);
  for (const l of labels) {
    const text = norm(l.text);
    if (text.length > 40) continue;
    const hit = DETAIL_PATTERNS.find(([f, re]) => out[f] === undefined && re.test(text));
    if (!hit) continue;
    const r = l.r;
    const c = l.c + (l.cs ?? 1);
    const key = `${String(r)}:${String(c)}`;
    if (covered.has(key)) continue;
    const v = at.get(key);
    if (v && (norm(v.text) !== '' || v.formula)) continue;
    // An empty cell before a formula: the form works the value out itself.
    const after = at.get(`${String(r)}:${String(c + (v?.cs ?? 1))}`);
    if (after?.formula) continue;
    out[hit[0]] = cellName(c, r);
  }
  return out;
}
