// "Page n of m" and Go to page in a text comparison's windows (M12-27, D-64,
// ADR-033 decision 6). Pure, unit-tested.
import { pageAtY, type PageStack } from './textView';

/** Where in the window the page shown is read: a quarter of the way down. */
export const READ_AT = 0.25;

/** A window's scroll state: its scroll position and sizes (CSS px), and the stack laid out in it. */
export interface WindowScroll {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  /** Where the stack's top sits in the scroll content (CSS px). */
  off: number;
  /** CSS px per pt. */
  scale: number;
}

/**
 * The page a window shows (0-based): the one a quarter of the way down it,
 * or the last page once the window is scrolled to the end (the last page can
 * never reach the top).
 */
export function currentPage(stack: PageStack, w: WindowScroll): number {
  const n = stack.tops.length;
  if (n === 0 || w.scale <= 0) return 0;
  if (w.scrollTop > 0 && w.scrollTop + w.clientHeight >= w.scrollHeight - 2) return n - 1;
  const g = (w.scrollTop + w.clientHeight * READ_AT - w.off) / w.scale;
  return Math.max(0, Math.min(n - 1, pageAtY(stack, g).page));
}

/** A typed page number (1 … count) → its 0-based index, or null when it is not one. */
export function parsePage(text: string, count: number): number | null {
  const s = text.trim();
  if (!/^\d+$/u.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= count ? n - 1 : null;
}
