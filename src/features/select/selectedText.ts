// The selected-text menu (M11-08·O1, ADR-028): a right click on selected text
// (or Shift+F10 / the Menu key while text is selected) opens Copy, the four
// text markups, Mark for Redaction and Search for "…". Pure: the hit test, the
// search query made from the selected text, and the menu's short quote of it.
// The plugin and the DOM are wired in textSelection.ts and DocumentMenu.tsx.
import { msg } from '../../i18n';
import type { ContextMenuEntry } from '../../ui/components/contextMenuModel';

/** A page's selected text as the selection plugin gives it (EmbedPDF page points). */
export interface PageTextSelection {
  pageIndex: number;
  segmentRects: readonly {
    origin: { x: number; y: number };
    size: { width: number; height: number };
  }[];
}

/** Points of slack around a selected line for a right click to count as on it. */
export const TEXT_HIT_SLACK = 2;

/** Whether a page point is on the selected text (one of its line boxes). Pure. */
export function onSelectedText(
  at: { page: number; x: number; y: number },
  selections: readonly PageTextSelection[],
  slack = TEXT_HIT_SLACK,
): boolean {
  return selections.some(
    (s) =>
      s.pageIndex === at.page &&
      s.segmentRects.some(
        (r) =>
          at.x >= r.origin.x - slack &&
          at.x <= r.origin.x + r.size.width + slack &&
          at.y >= r.origin.y - slack &&
          at.y <= r.origin.y + r.size.height + slack,
      ),
  );
}

/** Where a keyboard-opened menu points: the middle of the first selected line. Pure. */
export function selectionAnchor(
  selections: readonly PageTextSelection[],
): { page: number; x: number; y: number } | null {
  for (const s of selections) {
    const r = s.segmentRects[0];
    if (r)
      return {
        page: s.pageIndex,
        x: r.origin.x + r.size.width / 2,
        y: r.origin.y + r.size.height / 2,
      };
  }
  return null;
}

/** The longest query Search for "…" runs (characters as the user sees them). */
export const MAX_QUERY = 256;
/** The longest quote of it in the menu. */
export const MAX_SNIPPET = 32;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** `text` cut to `max` characters as the user sees them (never inside one), with "…" when cut. Pure. */
export function clip(text: string, max: number): string {
  const parts = Array.from(segmenter.segment(text), (s) => s.segment);
  if (parts.length <= max) return text;
  return `${parts
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

/**
 * The search query for the selected text (one string per page): lines and
 * pages joined by one space, runs of white space as one, cut to MAX_QUERY
 * (without "…": a prefix still finds the text). Empty when nothing is selected. Pure.
 */
export function searchQueryOf(texts: readonly string[]): string {
  const one = texts.join(' ').replace(/\s+/gu, ' ').trim();
  const parts = Array.from(segmenter.segment(one), (s) => s.segment);
  return parts.length <= MAX_QUERY ? one : parts.slice(0, MAX_QUERY).join('').trimEnd();
}

/** The menu's quote of the query. Pure. */
export const snippetOf = (query: string): string => clip(query, MAX_SNIPPET);

const cmd = (id: string): ContextMenuEntry => ({ kind: 'command', id, once: true });
const sep = (key: string): ContextMenuEntry => ({ kind: 'separator', key });

/**
 * The menu (plan O1): Copy, the markups, Mark for Redaction, then Search for
 * "…" quoting `snippet` ("" while the text is still being read: the
 * command's own label). Each item is the ribbon's command, so its disabled
 * reason (rule 9) and its way of acting on the selection are the same.
 */
export function selectedTextMenu(snippet: string): ContextMenuEntry[] {
  return [
    cmd('edit.copy'),
    sep('markups'),
    cmd('comment.highlight'),
    cmd('comment.underline'),
    cmd('comment.strikeout'),
    cmd('comment.squiggly'),
    sep('redact'),
    cmd('protect.markRedaction'),
    sep('search'),
    snippet
      ? {
          kind: 'command',
          id: 'edit.searchSelection',
          once: true,
          label: msg('contextMenu.searchFor'),
          values: { text: snippet },
        }
      : cmd('edit.searchSelection'),
  ];
}
