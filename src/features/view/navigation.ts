// Page navigation input (§5, M1-15). 0-based indexes inside, 1-based for people.
import { parseLocaleNumber } from '../../i18n/format';

export function clampPage(index: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.min(pageCount - 1, Math.max(0, Math.trunc(index)));
}

/** "12" (or "١٢") → 11; null unless a whole page number within 1..pageCount. */
export function parsePageInput(text: string, pageCount: number, locale: string): number | null {
  const n = parseLocaleNumber(text, locale);
  if (n === null || !Number.isInteger(n) || n < 1 || n > pageCount) return null;
  return n - 1;
}

export type PageMove = 'first' | 'prev' | 'next' | 'last';

export function movePage(current: number, move: PageMove, pageCount: number): number {
  const to = { first: 0, prev: current - 1, next: current + 1, last: pageCount - 1 }[move];
  return clampPage(to, pageCount);
}
