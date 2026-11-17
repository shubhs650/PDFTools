// Split Document (M11-08·O7, D-55): which pages go into which file. Pure.
// Three ways: every N pages; typed page ranges, one file per range; or one
// file per top-level bookmark, from its page to the page before the next.
// File names are made from the original's name by the caller (i18n).
import type { PdfLinkTarget } from '@embedpdf/models';
import type { OutlineItem } from '../../model/outline';
import { parseRange, type RangeError } from '../print/options';

export type SplitMode = 'every' | 'ranges' | 'bookmarks';

/** At most this many files from one split. */
export const SPLIT_MAX_PARTS = 1000;

/** A top-level bookmark: its title and 0-based page (-1: it goes nowhere in this document). */
export interface TopBookmark {
  title: string;
  page: number;
}

export interface SplitPart {
  /** 0-based page indexes, in the order they go into the file. */
  pages: number[];
  /** The bookmark it was cut at (bookmarks mode). */
  title?: string;
}

export type SplitError = RangeError | 'every' | 'noBookmarks' | 'tooMany';

export type SplitResult = { ok: true; parts: SplitPart[] } | { ok: false; error: SplitError };

const ok = (parts: SplitPart[]): SplitResult =>
  parts.length > SPLIT_MAX_PARTS ? { ok: false, error: 'tooMany' } : { ok: true, parts };

/** Every `n` pages; the last file takes what is left. */
export function splitEvery(pageCount: number, n: number): SplitResult {
  if (!Number.isInteger(n) || n < 1 || n > Math.max(1, pageCount))
    return { ok: false, error: 'every' };
  const parts: SplitPart[] = [];
  for (let from = 0; from < pageCount; from += n)
    parts.push({ pages: range(from, Math.min(from + n, pageCount)) });
  return ok(parts);
}

/** "1-5, 6-10; 11-": each item between commas or semicolons is one file (the print dialog's ranges). */
export function splitRanges(text: string, pageCount: number): SplitResult {
  const items = text
    .normalize('NFKC')
    .split(/[,;]+/u)
    .map((s) => s.replace(/\s+/gu, ''))
    .filter((s) => s !== '');
  if (items.length === 0) return { ok: false, error: 'empty' };
  const parts: SplitPart[] = [];
  for (const item of items) {
    const r = parseRange(item, pageCount);
    if (!r.ok) return r;
    parts.push({ pages: r.pages });
  }
  return ok(parts);
}

/**
 * One file per top-level bookmark that goes to a page here, in page order:
 * from its page up to the page before the next one. Pages before the first
 * bookmark go into the first file; bookmarks on the same page make one file
 * (the first one's title).
 */
export function splitBookmarks(tops: readonly TopBookmark[], pageCount: number): SplitResult {
  const starts = tops
    .filter((b) => Number.isInteger(b.page) && b.page >= 0 && b.page < pageCount)
    .map((b, i) => ({ ...b, i }))
    .sort((a, b) => a.page - b.page || a.i - b.i)
    .filter((b, k, all) => k === 0 || b.page !== all[k - 1]?.page);
  if (starts.length === 0) return { ok: false, error: 'noBookmarks' };
  return ok(
    starts.map((b, k) => ({
      pages: range(k === 0 ? 0 : b.page, starts[k + 1]?.page ?? pageCount),
      title: b.title,
    })),
  );
}

/** The page a bookmark's target opens (-1: none, or a link out of the document). */
export function targetPage(target: PdfLinkTarget | undefined): number {
  if (!target) return -1;
  const dest =
    target.type === 'destination'
      ? target.destination
      : 'destination' in target.action
        ? target.action.destination
        : undefined;
  return dest?.pageIndex ?? -1;
}

/** The outline's top level as split points. */
export const topBookmarks = (items: readonly OutlineItem[]): TopBookmark[] =>
  items.map((it) => ({ title: it.title, page: targetPage(it.target) }));

/** "1-3, 8": consecutive runs of 0-based pages, written 1-based. */
export function rangeText(pages: readonly number[]): string {
  const runs: string[] = [];
  let start = pages[0];
  if (start === undefined) return '';
  let prev = start;
  for (const p of [...pages.slice(1), Number.NaN]) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    runs.push(start === prev ? String(start + 1) : `${String(start + 1)}-${String(prev + 1)}`);
    start = p;
    prev = p;
  }
  return runs.join(', ');
}

/** Characters no file system takes in a name, and control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f\u007f]/gu;
const MAX_TITLE = 80;

/** A bookmark title made safe for a file name: "" when nothing is left. */
export function safeTitle(title: string): string {
  const clean = title.replace(/\s+/gu, ' ').replace(UNSAFE, '_').trim();
  const cut = Array.from(clean).slice(0, MAX_TITLE).join('');
  return cut.replace(/[. ]+$/u, '');
}

/** "7" → "07" for 10–99 files: names sort in order. At least two digits. */
export function partNumber(i: number, count: number): string {
  return String(i + 1).padStart(Math.max(2, String(count).length), '0');
}

/** Names unique within the set (case-insensitive): "a.pdf", "a (2).pdf", … */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let n = name;
    for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base} (${String(i)})${ext}`;
    taken.add(n.toLowerCase());
    return n;
  });
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}
