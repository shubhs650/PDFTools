// M11-06 (ADR-028 D-51): which tools pick comments up, the plugin lock each
// tool sets, which markup a Select Text click is on, and the page menu's tools
// as one radio group.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { LockModeType } from '@embedpdf/plugin-annotation';
import { describe, expect, it } from 'vitest';
import {
  isClick,
  isTextMarkup,
  lockModeFor,
  markupAt,
  picksComments,
} from '../../src/features/annotate/pointerModes';
import { TEXT_COMMENT_CATEGORY } from '../../src/features/annotate/tools/drawModel';
import { PAGE_MENU } from '../../src/features/view/documentMenus';
import { menuItems, menuRuns } from '../../src/ui/components/contextMenuModel';

describe('picksComments and lockModeFor', () => {
  it('Select, Select Comments, Hand and Select Text reach every comment but form fields', () => {
    for (const tool of ['select', 'selectObjects', 'hand', 'selectText']) {
      expect(picksComments(tool), tool).toBe(true);
      expect(lockModeFor(tool), tool).toEqual({
        type: LockModeType.Include,
        categories: ['form'],
      });
    }
  });

  it('Select Fields and the field tools reach the fields only; a text tool its text comment', () => {
    expect(picksComments('selectFields')).toBe(false);
    expect(lockModeFor('selectFields')).toEqual({
      type: LockModeType.Exclude,
      categories: ['form'],
    });
    expect(lockModeFor('freeText')).toEqual({
      type: LockModeType.Exclude,
      categories: [TEXT_COMMENT_CATEGORY],
    });
  });

  it('drawing, markup and other tools reach none, so a press starts a new comment', () => {
    for (const tool of ['square', 'ink', 'highlight', 'snapshot', 'redactArea', 'attachFile']) {
      expect(picksComments(tool), tool).toBe(false);
      expect(lockModeFor(tool), tool).toEqual({ type: LockModeType.All });
    }
  });
});

describe('isClick', () => {
  it('a press that travels less than 5 px is a click', () => {
    expect(isClick(0, 0)).toBe(true);
    expect(isClick(3, 3)).toBe(true);
    expect(isClick(4, 3)).toBe(false);
    expect(isClick(-6, 0)).toBe(false);
  });
});

const rect = (x: number, y: number, w: number, h: number) => ({
  origin: { x, y },
  size: { width: w, height: h },
});

function state(objs: Partial<PdfAnnotationObject>[]) {
  const byUid: Record<string, { object: PdfAnnotationObject }> = {};
  for (const o of objs)
    byUid[o.id ?? ''] = { object: { pageIndex: 0, ...o } as PdfAnnotationObject };
  return { pages: { 0: objs.map((o) => o.id ?? '') }, byUid } as never;
}

describe('markupAt', () => {
  const two = state([
    // Two lines of a highlight: the gap between them is not the highlight.
    {
      id: 'hl',
      type: PdfAnnotationSubtype.HIGHLIGHT,
      rect: rect(70, 70, 200, 50),
      segmentRects: [rect(70, 70, 200, 14), rect(70, 106, 120, 14)],
    },
    // An underline drawn later over the first line: on top.
    {
      id: 'ul',
      type: PdfAnnotationSubtype.UNDERLINE,
      rect: rect(150, 70, 60, 14),
      segmentRects: [rect(150, 70, 60, 14)],
    },
    { id: 'sq', type: PdfAnnotationSubtype.SQUARE, rect: rect(0, 0, 595, 842) },
    {
      id: 'hidden',
      type: PdfAnnotationSubtype.SQUIGGLY,
      rect: rect(300, 300, 50, 14),
      flags: ['hidden'],
    },
  ]);

  it('finds the markup on top whose line boxes hold the point', () => {
    expect(markupAt(two, 0, { x: 100, y: 76 })?.id).toBe('hl');
    expect(markupAt(two, 0, { x: 160, y: 76 })?.id).toBe('ul');
    expect(markupAt(two, 0, { x: 100, y: 110 })?.id).toBe('hl');
  });

  it('not between its lines, never other comments, hidden ones or other pages', () => {
    expect(markupAt(two, 0, { x: 100, y: 95 })).toBeNull();
    expect(markupAt(two, 0, { x: 320, y: 305 })).toBeNull();
    expect(markupAt(two, 1, { x: 100, y: 76 })).toBeNull();
  });

  it('a markup without line boxes counts by its rectangle', () => {
    const one = state([
      { id: 'so', type: PdfAnnotationSubtype.STRIKEOUT, rect: rect(10, 10, 40, 10) },
    ]);
    expect(markupAt(one, 0, { x: 30, y: 15 })?.id).toBe('so');
  });

  it('text markups are the four of them, not the caret or shapes', () => {
    expect(isTextMarkup({ type: PdfAnnotationSubtype.SQUIGGLY })).toBe(true);
    expect(isTextMarkup({ type: PdfAnnotationSubtype.CARET })).toBe(false);
    expect(isTextMarkup({ type: PdfAnnotationSubtype.INK })).toBe(false);
  });
});

describe('the page menu’s tools', () => {
  it('Select first, then Hand, Select Text and Select Comments, as one radio group', () => {
    const items = menuItems(
      PAGE_MENU,
      (id) => ({ enabled: true, pressed: id === 'home.hand' }),
      () => '',
    );
    const runs = menuRuns(items);
    const radios = runs.filter((r) => r.kind === 'radio');
    expect(radios).toHaveLength(1);
    const [group] = radios;
    expect(group?.kind === 'radio' ? group.items.map((i) => i.id) : []).toEqual([
      'home.select',
      'home.hand',
      'home.selectText',
      'home.selectAnnotations',
    ]);
    expect(
      group?.kind === 'radio' ? group.items.filter((i) => i.pressed).map((i) => i.id) : [],
    ).toEqual(['home.hand']);
  });

  it('items outside a group stay single; a group split by another item makes two runs', () => {
    const items = menuItems(
      [
        { kind: 'command', id: 'a', radio: 'g' },
        { kind: 'command', id: 'b' },
        { kind: 'command', id: 'c', radio: 'g' },
        { kind: 'command', id: 'd', radio: 'g' },
      ],
      () => ({ enabled: true, pressed: false }),
      () => '',
    );
    expect(menuRuns(items).map((r) => (r.kind === 'radio' ? r.items.length : 'item'))).toEqual([
      1,
      'item',
      2,
    ]);
  });
});
