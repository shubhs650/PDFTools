// M3-05: which annotations the keyboard reaches, in what order; stable ids.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationDocumentState } from '@embedpdf/plugin-annotation';
import { describe, expect, it } from 'vitest';
import { cycleTarget, pageAnnotations } from '../../src/features/annotate/model';
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
