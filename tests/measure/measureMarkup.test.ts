import {
  PdfAnnotationReplyType,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  areaLabelPoint,
  CAPTION_GAP,
  corners,
  inside,
  lineCaption,
  longestSegment,
} from '../../src/model/measureGeometry';
import {
  captionBoundsEP,
  captionPlace,
  captionText,
  dragOffset,
  estimateWidth,
  metaOf,
  mirror,
  offsetBox,
  sameMeta,
  toolFromShape,
} from '../../src/model/measureMarkup';
import {
  entryFromPdf,
  entryToPdf,
  metaFromEntry,
  pageData,
  readItems,
} from '../../src/model/measureData';
import { oldPairs } from '../../src/model/measureUpgrade';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('caption placement (M14-03, Q40)', () => {
  it('Above: centred over a horizontal line, clear of it by half its height and the gap', () => {
    const c = lineCaption({ x: 0, y: 0 }, { x: 100, y: 0 }, 'top', 40, 12);
    expect(c.angle).toBeCloseTo(0);
    close(c.at, { x: 50, y: 6 + CAPTION_GAP });
  });

  it('In line: on the line’s middle', () => {
    const c = lineCaption({ x: 0, y: 0 }, { x: 100, y: 0 }, 'inline', 40, 12);
    close(c.at, { x: 50, y: 0 });
  });

  it('reads left to right whichever way the line was drawn', () => {
    const a = lineCaption({ x: 100, y: 0 }, { x: 0, y: 0 }, 'top', 40, 12);
    expect(Math.abs(a.angle)).toBeLessThan(1e-9);
    close(a.at, { x: 50, y: 6 + CAPTION_GAP });
    // A vertical line: the text reads bottom to top, "above" is to its left.
    const v = lineCaption({ x: 0, y: 100 }, { x: 0, y: 0 }, 'top', 40, 12);
    expect(v.angle).toBeCloseTo(Math.PI / 2);
    expect(v.at.x).toBeLessThan(0);
  });

  it('a Polylength’s or Perimeter’s value sits on the longest segment', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 80 },
    ];
    const [a, b] = longestSegment(pts, false);
    expect([a, b]).toEqual([pts[1], pts[2]]);
    const c = captionPlace({ tool: 'polylength' }, pts, null, 30, 10);
    expect(c.angle).toBeCloseTo(Math.PI / 2);
    expect(c.at.y).toBeCloseTo(40);
  });

  it('an Area’s value sits in the middle, inside the outline even for an L shape', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    close(captionPlace({ tool: 'area' }, square, null, 30, 10).at, { x: 50, y: 50 });
    const l = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 100 },
      { x: 0, y: 100 },
    ];
    const p = areaLabelPoint(l, 16, 8);
    for (const q of corners({ at: p, angle: 0, width: 16, height: 8 }))
      expect(inside(q, l)).toBe(true);
  });

  it('a dragged offset is along the caption, then up from it', () => {
    const c = { at: { x: 0, y: 0 }, angle: Math.PI / 2, width: 1, height: 1 };
    close(offsetBox(c, { x: 5, y: 0 }).at, { x: 0, y: 5 });
  });

  it('a drag on the page becomes the offset that puts the caption under the pointer', () => {
    // A vertical Length in EmbedPDF's page points (y down).
    const ptsEP = [
      { x: 100, y: 300 },
      { x: 100, y: 100 },
    ];
    const meta = { tool: 'length' as const, cap: 'top' as const };
    const before = captionPlace(meta, ptsEP.map(mirror), null, 20, 10);
    const o = dragOffset(meta, ptsEP, null, { x: 30, y: -12 });
    const after = captionPlace({ ...meta, capOffset: o }, ptsEP.map(mirror), null, 20, 10);
    close(mirror(after.at), { x: mirror(before.at).x + 30, y: mirror(before.at).y - 12 });
    // Offsets add up.
    const o2 = dragOffset({ ...meta, capOffset: o }, ptsEP, null, { x: -30, y: 12 });
    close(o2, { x: 0, y: 0 });
  });

  it('the main thread’s caption bounds hold the estimated text', () => {
    const b = captionBoundsEP(
      { tool: 'length' },
      [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      null,
      '12.50 m',
    );
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b[2] - b[0]).toBeGreaterThanOrEqual(estimateWidth('12.50 m'));
    // Above the line on the page (y down: smaller y).
    expect(b[3]).toBeLessThanOrEqual(100);
    expect(captionBoundsEP({ tool: 'length' }, [], null, 'x')).toBeNull();
    expect(captionBoundsEP({ tool: 'length' }, [{ x: 0, y: 0 }], null, ' ')).toBeNull();
  });

  it('the label goes in front of the value (Q27)', () => {
    const f = (l: string, v: string) => `${l}: ${v}`;
    expect(captionText('Slab S1', '42.5 m²', f)).toBe('Slab S1: 42.5 m²');
    expect(captionText('  ', '42.5 m²', f)).toBe('42.5 m²');
    expect(captionText(undefined, '42.5 m²', f)).toBe('42.5 m²');
  });
});

describe('the markup’s own data', () => {
  it('reads only a well-formed `measure` field', () => {
    expect(metaOf({ measure: { tool: 'area', fill: '#E44234', label: 'S1' } })).toEqual({
      tool: 'area',
      fill: '#E44234',
      label: 'S1',
    });
    expect(metaOf({ measure: { tool: 'angle' } })).toBeNull();
    expect(
      metaOf({ measure: { tool: 'length', cap: 'side', fill: 'red', capOffset: { x: 0, y: 0 } } }),
    ).toEqual({
      tool: 'length',
    });
    expect(metaOf({})).toBeNull();
    expect(sameMeta({ tool: 'length' }, { tool: 'length', cap: undefined } as never)).toBe(true);
  });

  it('a tool from the standard data alone (ADR-035 Amendment 1 decision 4)', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 9, y: 9 },
      { x: 0, y: 0 },
    ];
    expect(toolFromShape('distance', [])).toBe('length');
    expect(toolFromShape('area', sq)).toBe('area');
    expect(toolFromShape('perimeter', sq)).toBe('perimeter');
    expect(toolFromShape('perimeter', sq.slice(0, 3))).toBe('polylength');
  });
});

describe('Triya data in /PieceInfo (D-74)', () => {
  const meta = {
    tool: 'area' as const,
    label: 'Slab S1',
    fill: '#E44234',
    capOffset: { x: 2, y: -3 },
  };

  it('an entry round-trips', () => {
    const e = entryFromPdf(entryToPdf({ meta, fp: 'abc' }));
    expect(e).toEqual({ meta, fp: 'abc' });
  });

  it('a markup another editor reshaped keeps its label and fill but not its caption offset', () => {
    expect(metaFromEntry({ meta, fp: 'abc' }, 'abc')).toEqual(meta);
    expect(metaFromEntry({ meta, fp: 'abc' }, 'xyz')).toEqual({
      tool: 'area',
      label: 'Slab S1',
      fill: '#E44234',
    });
  });

  it('keeps other applications’ entries; with no items left only theirs stay', () => {
    const other = { dict: { Private: { text: 'theirs' } } };
    const file = { dict: { OtherApp: other } };
    const items = new Map([['m1', entryToPdf({ meta, fp: 'f' })]]);
    const d = pageData(file, items, 'D:20261125000000Z');
    expect(readItems(d.set.PieceInfo).get('m1')).toEqual(items.get('m1'));
    expect((d.set.PieceInfo as { dict: Record<string, unknown> }).dict.OtherApp).toEqual(other);
    expect(d.set.LastModified).toEqual({ text: 'D:20261125000000Z' });
    const none = pageData(file, new Map(), 'D:1');
    expect(none.set.PieceInfo).toEqual({ dict: { OtherApp: other } });
    expect(pageData(null, new Map(), 'D:1')).toEqual({ set: {}, remove: ['PieceInfo'] });
  });

  it('skips entries of another version', () => {
    const pi = {
      dict: { TriyaPDF: { dict: { Private: { dict: { V: 2, Items: { dict: { a: 1 } } } } } } },
    };
    expect(readItems(pi).size).toBe(0);
  });
});

describe('measurements saved by 1.1.0 (Q38)', () => {
  const ann = (o: Partial<PdfAnnotationObject> & Record<string, unknown>) =>
    ({
      pageIndex: 0,
      rect: { origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
      ...o,
    }) as unknown as PdfAnnotationObject;
  const line = ann({ id: 'm1', type: PdfAnnotationSubtype.LINE });
  const label = ann({
    id: 'l1',
    type: PdfAnnotationSubtype.FREETEXT,
    inReplyToId: 'm1',
    replyType: PdfAnnotationReplyType.Group,
  });
  const yes = () => true;

  it('finds a measurement and its grouped text box', () => {
    expect(oldPairs([line, label], yes)).toEqual([{ measure: line, label }]);
  });

  it('not: a plain line, a reply that is not a group, a measurement already one markup', () => {
    expect(oldPairs([line, label], () => false)).toEqual([]);
    expect(oldPairs([line, { ...label, replyType: PdfAnnotationReplyType.Reply }], yes)).toEqual(
      [],
    );
    expect(oldPairs([ann({ ...line, measure: { tool: 'length' } }), label], yes)).toEqual([]);
    expect(oldPairs([label], yes)).toEqual([]);
    const square = ann({ id: 'm1', type: PdfAnnotationSubtype.SQUARE });
    expect(oldPairs([square, label], yes)).toEqual([]);
  });

  it('one pair per measurement', () => {
    const second = { ...label, id: 'l2' };
    expect(oldPairs([line, label, second], yes)).toHaveLength(1);
  });
});
