// M3-05: which annotations the keyboard reaches, in what order; stable ids.
import {
  PdfAnnotationReplyType,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import type { AnnotationDocumentState } from '@embedpdf/plugin-annotation';
import { describe, expect, it } from 'vitest';
import {
  addIds,
  cycleTarget,
  marqueeHits,
  pageAnnotations,
  touches,
  withGroupMembers,
} from '../../src/features/annotate/model';
import { parseStableId, stableAnnotId } from '../../src/workers/shared/annotId';

const a = (
  id: string,
  x: number,
  y: number,
  type = PdfAnnotationSubtype.SQUARE,
  extra: Partial<PdfAnnotationObject> = {},
): PdfAnnotationObject =>
  ({
    id,
    pageIndex: 0,
    type,
    rect: { origin: { x, y }, size: { width: 10, height: 10 } },
    ...extra,
  }) as PdfAnnotationObject;

function state(list: PdfAnnotationObject[]): AnnotationDocumentState {
  return {
    pages: { 0: list.map((o) => o.id) },
    byUid: Object.fromEntries(list.map((o) => [o.id, { object: o, commitState: 'synced' }])),
    selectedUids: [],
    selectedUid: null,
    activeToolId: null,
    hasPendingChanges: false,
    locked: { type: 'none' },
  } as unknown as AnnotationDocumentState;
}

describe('pageAnnotations', () => {
  it('reading order; no links, widgets, popups or replies', () => {
    const st = state([
      a('low', 10, 500),
      a('right', 300, 100),
      a('left', 20, 101),
      a('link', 0, 0, PdfAnnotationSubtype.LINK),
      a('field', 0, 0, PdfAnnotationSubtype.WIDGET),
      a('popup', 0, 0, PdfAnnotationSubtype.POPUP),
      a('reply', 0, 0, PdfAnnotationSubtype.TEXT, { inReplyToId: 'left' }),
    ]);
    expect(pageAnnotations(st, 0).map((o) => o.id)).toEqual(['left', 'right', 'low']);
    expect(pageAnnotations(st, 3)).toEqual([]);
  });
});

// M7-04 (B7): the marquee picks every comment it touches. Both rectangles are
// in unrotated page space (the plugin's pointer layer maps the drag there on a
// rotated page, and annotation rects never turn with the view), so the test
// holds for every page rotation; e2e/comment-selection.spec.ts drags on a
// rotated page.
const r = (x: number, y: number, width: number, height: number) => ({
  origin: { x, y },
  size: { width, height },
});

describe('touches', () => {
  it('overlap, containment and a shared edge touch; a gap does not', () => {
    expect(touches(r(0, 0, 10, 10), r(5, 5, 10, 10))).toBe(true);
    expect(touches(r(0, 0, 100, 100), r(40, 40, 10, 10))).toBe(true);
    expect(touches(r(40, 40, 10, 10), r(0, 0, 100, 100))).toBe(true);
    expect(touches(r(0, 0, 10, 10), r(10, 0, 10, 10))).toBe(true);
    expect(touches(r(0, 0, 10, 10), r(10.5, 0, 10, 10))).toBe(false);
    expect(touches(r(0, 0, 10, 10), r(0, 11, 10, 10))).toBe(false);
  });
});

describe('marqueeHits', () => {
  const st = state([
    a('a', 10, 10),
    a('b', 50, 10),
    a('c', 200, 200),
    a('field', 12, 12, PdfAnnotationSubtype.WIDGET),
    a('link', 12, 12, PdfAnnotationSubtype.LINK),
    a('reply', 12, 12, PdfAnnotationSubtype.TEXT, { inReplyToId: 'a' }),
    a('hidden', 12, 12, PdfAnnotationSubtype.SQUARE, { flags: ['hidden'] }),
    a('noView', 12, 12, PdfAnnotationSubtype.SQUARE, { flags: ['print', 'noView'] }),
    a('printed', 52, 12, PdfAnnotationSubtype.CIRCLE, { flags: ['print'] }),
  ]);

  it('selects exactly the comments it touches, in reading order', () => {
    expect(marqueeHits(st, 0, r(0, 0, 55, 30)).map((o) => o.id)).toEqual(['a', 'b', 'printed']);
    // Only a corner of b's box.
    expect(marqueeHits(st, 0, r(58, 18, 30, 30)).map((o) => o.id)).toEqual(['b', 'printed']);
    expect(marqueeHits(st, 0, r(100, 100, 50, 50))).toEqual([]);
  });

  it('never form fields, links, replies or hidden comments, nor another page', () => {
    const ids = marqueeHits(st, 0, r(0, 0, 595, 842)).map((o) => o.id);
    expect(ids).toEqual(['a', 'b', 'printed', 'c']);
    expect(marqueeHits(st, 1, r(0, 0, 595, 842))).toEqual([]);
  });
});

describe('addIds', () => {
  it('adds the marquee hits after the selection, each once', () => {
    expect(addIds(['a', 'b'], ['b', 'c', 'c'])).toEqual(['a', 'b', 'c']);
    expect(addIds([], ['x'])).toEqual(['x']);
  });
});

describe('cycleTarget', () => {
  const list = [a('a', 0, 0), a('b', 0, 50), a('c', 0, 90)];
  it('starts at either end and walks; null past the ends (Tab leaves the document)', () => {
    expect(cycleTarget(list, null, 1)?.id).toBe('a');
    expect(cycleTarget(list, null, -1)?.id).toBe('c');
    expect(cycleTarget(list, 'a', 1)?.id).toBe('b');
    expect(cycleTarget(list, 'c', 1)).toBeNull();
    expect(cycleTarget(list, 'a', -1)).toBeNull();
    expect(cycleTarget(list, 'gone', 1)?.id).toBe('a');
    expect(cycleTarget([], null, 1)).toBeNull();
  });
});

describe('stable ids (ADR-014 decision 2)', () => {
  it('round-trip', () => {
    expect(stableAnnotId(42, 3, 1)).toBe('obj-42');
    expect(stableAnnotId(0, 3, 1)).toBe('idx-3-1');
    expect(parseStableId('obj-42')).toEqual({ objectNumber: 42 });
    expect(parseStableId('idx-3-1')).toEqual({ pageIndex: 3, index: 1 });
    expect(parseStableId('b1c2-uuid')).toBeNull();
    expect(parseStableId('obj-')).toBeNull();
  });
});

describe('withGroupMembers', () => {
  const g = { replyType: PdfAnnotationReplyType.Group };
  const st = state([
    a('lead', 0, 0),
    a('m1', 20, 0, PdfAnnotationSubtype.CIRCLE, { inReplyToId: 'lead', ...g }),
    a('m2', 40, 0, PdfAnnotationSubtype.SQUARE, { inReplyToId: 'lead', ...g }),
    a('solo', 60, 0),
    a('reply', 0, 0, PdfAnnotationSubtype.TEXT, { inReplyToId: 'solo' }),
  ]);

  it('a hit on any member of a group selects the whole group', () => {
    expect(withGroupMembers(st, ['m2'])).toEqual(['lead', 'm1', 'm2']);
    expect(withGroupMembers(st, ['lead', 'solo'])).toEqual(['lead', 'm1', 'm2', 'solo']);
  });

  it('an ordinary reply is no group', () => {
    expect(withGroupMembers(st, ['solo'])).toEqual(['solo']);
    expect(withGroupMembers(state([a('x', 0, 0)]), ['x', 'x'])).toEqual(['x']);
  });
});
