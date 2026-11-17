// The selected-text menu (M11-08·O1, ADR-028): the hit test on the selected
// lines, the keyboard anchor, the search query and the menu's quote of it, and
// the menu itself (plain items, the quote as the label's value).
import { describe, expect, it } from 'vitest';
import { t } from '../../src/i18n';
import { COMMANDS } from '../../src/app/commands';
import type { CommandState } from '../../src/app/commands/dispatch';
import { menuItems } from '../../src/ui/components/contextMenuModel';
import {
  clip,
  MAX_QUERY,
  MAX_SNIPPET,
  onSelectedText,
  searchQueryOf,
  selectedTextMenu,
  selectionAnchor,
  snippetOf,
  type PageTextSelection,
} from '../../src/features/select/selectedText';

const rect = (x: number, y: number, width: number, height: number) => ({
  origin: { x, y },
  size: { width, height },
});

// Two lines on page 1 and one on page 3.
const SEL: PageTextSelection[] = [
  { pageIndex: 1, segmentRects: [rect(72, 90, 200, 14), rect(72, 106, 120, 14)] },
  { pageIndex: 3, segmentRects: [rect(50, 50, 100, 12)] },
];

describe('onSelectedText', () => {
  it('is true on a selected line (with 2 pt of slack) of the same page only', () => {
    expect(onSelectedText({ page: 1, x: 100, y: 95 }, SEL)).toBe(true);
    expect(onSelectedText({ page: 1, x: 190, y: 119 }, SEL)).toBe(true);
    expect(onSelectedText({ page: 1, x: 70.5, y: 89 }, SEL)).toBe(true);
    expect(onSelectedText({ page: 3, x: 60, y: 55 }, SEL)).toBe(true);
    // Beside the shorter second line, between pages, and on another page.
    expect(onSelectedText({ page: 1, x: 250, y: 112 }, SEL)).toBe(false);
    expect(onSelectedText({ page: 1, x: 100, y: 130 }, SEL)).toBe(false);
    expect(onSelectedText({ page: 2, x: 100, y: 95 }, SEL)).toBe(false);
    expect(onSelectedText({ page: 1, x: 100, y: 95 }, [])).toBe(false);
  });
});

describe('selectionAnchor', () => {
  it('is the middle of the first selected line', () => {
    expect(selectionAnchor(SEL)).toEqual({ page: 1, x: 172, y: 97 });
    expect(selectionAnchor([{ pageIndex: 0, segmentRects: [] }, ...SEL.slice(1)])).toEqual({
      page: 3,
      x: 100,
      y: 56,
    });
    expect(selectionAnchor([])).toBeNull();
  });
});

describe('searchQueryOf', () => {
  it('joins lines and pages with one space and trims', () => {
    expect(searchQueryOf(['  Pump P-101\r\nduty   point ', '\tflow'])).toBe(
      'Pump P-101 duty point flow',
    );
    expect(searchQueryOf([])).toBe('');
    expect(searchQueryOf([' \n '])).toBe('');
  });

  it('keeps at most MAX_QUERY characters, never splitting one', () => {
    const long = 'é'.repeat(MAX_QUERY + 10);
    expect(Array.from(searchQueryOf([long]))).toHaveLength(MAX_QUERY);
    // A flag (two code points) at the cut stays whole or goes whole.
    const flags = '🇮🇳'.repeat(MAX_QUERY + 1);
    const q = searchQueryOf([flags]);
    expect(q).toBe('🇮🇳'.repeat(MAX_QUERY));
  });
});

describe('clip and snippetOf', () => {
  it('quotes short text as is and cuts long text with an ellipsis', () => {
    expect(snippetOf('Page 1')).toBe('Page 1');
    const long = 'The quick brown fox jumps over the lazy dog again';
    const s = snippetOf(long);
    expect(Array.from(s).length).toBeLessThanOrEqual(MAX_SNIPPET);
    expect(s.endsWith('…')).toBe(true);
    expect(long.startsWith(s.slice(0, -1))).toBe(true);
    // No space before the ellipsis, and a letter with its accent stays whole.
    expect(clip('ab cd', 4)).toBe('ab…');
    expect(clip('e\u0301e\u0301e\u0301e\u0301', 3)).toBe('e\u0301e\u0301…');
  });
});

describe('selectedTextMenu', () => {
  const on = (): CommandState => ({ enabled: true, pressed: true });

  it('lists Copy, the four markups, Mark for Redaction and Search for "…", as plain items', () => {
    const items = menuItems(selectedTextMenu('Page 1'), on, () => '');
    expect(items.map((i) => (i.kind === 'separator' ? '-' : i.id))).toEqual([
      'edit.copy',
      '-',
      'comment.highlight',
      'comment.underline',
      'comment.strikeout',
      'comment.squiggly',
      '-',
      'protect.markRedaction',
      '-',
      'edit.searchSelection',
    ]);
    // The markups and redaction are tool toggles on the ribbon; here they act once.
    for (const i of items) if (i.kind !== 'separator') expect(i.toggle).toBe(false);
    const search = items.at(-1);
    if (search?.kind === 'separator' || !search) throw new Error('no search item');
    expect(t(search.label, search.values as never)).toBe('Search for “Page 1”');
  });

  it("uses the command's own label until the text is read", () => {
    const items = menuItems(selectedTextMenu(''), on, () => '');
    const search = items.at(-1);
    if (search?.kind === 'separator' || !search) throw new Error('no search item');
    expect(search.label).toBe('command.edit.searchSelection');
    expect(t(search.label)).toBe('Search for Selected Text');
  });

  it('every item is a command of the table', () => {
    const ids = new Set(COMMANDS.map((c) => c.id));
    for (const e of selectedTextMenu('x'))
      if (e.kind !== 'separator') expect(ids.has(e.id)).toBe(true);
  });
});
