import { PdfAnnotationSubtype as S, type PdfAnnotationObject } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  commentsOf,
  isFiltered,
  layoutComments,
  matches,
} from '../../src/features/annotate/comments/commentsModel';
import { buildCrsRows, type RowOptions } from '../../src/features/crs/crsModel';

// M14-08 (D-76, Q34): measurements stay in the Comments pane behind a
// Measurements filter; the CRS takes them only with "Include measurements".

const rect = { origin: { x: 10, y: 20 }, size: { width: 30, height: 40 } };
const a = (o: Partial<PdfAnnotationObject> & { id: string; type?: S }) =>
  ({ type: S.TEXT, pageIndex: 0, rect, author: 'Ana', ...o }) as PdfAnnotationObject;

const doc = [
  a({ id: 'note', contents: 'Check this' }),
  a({ id: 'len', type: S.LINE, intent: 'LineDimension', contents: '2.00 m' }),
  a({ id: 'area', type: S.POLYGON, intent: 'PolygonDimension', contents: '42.50 m²' }),
  a({ id: 'poly', type: S.POLYLINE, intent: 'PolyLineDimension', contents: '7.00 m' }),
  // A plain line and polygon are comments, not measurements.
  a({ id: 'line', type: S.LINE, contents: 'Arrow' }),
  a({ id: 'shape', type: S.POLYGON, contents: 'Zone' }),
];

const opts: RowOptions = {
  typeLabel: () => 'x',
  statusLabel: () => '',
  date: (x) => x.toISOString(),
  discipline: () => '',
  noAuthor: 'Anonymous',
};

describe('measurements in the Comments pane (M14-08)', () => {
  const comments = commentsOf(doc);

  it('knows which comments are measurements', () => {
    expect(
      comments
        .filter((c) => c.measure)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['area', 'len', 'poly']);
  });

  it('shows them by default; the filter hides them', () => {
    expect(layoutComments(comments, {}, 'page').shown).toBe(6);
    const hidden = layoutComments(comments, { measurements: false }, 'page');
    expect(hidden.order.map((c) => c.id).sort()).toEqual(['line', 'note', 'shape']);
    expect(comments.filter((c) => matches(c, { measurements: true }))).toHaveLength(6);
  });

  it('a hidden-measurements filter counts as a filter (its chip shows)', () => {
    expect(isFiltered({ measurements: false })).toBe(true);
    expect(isFiltered({})).toBe(false);
  });
});

describe('measurements in the CRS (M14-08)', () => {
  it('left out unless asked', () => {
    const ids = buildCrsRows(doc, { ...opts, measurements: false }).map((r) => r.id);
    expect(ids.sort()).toEqual(['line', 'note', 'shape']);
    expect(buildCrsRows(doc, { ...opts, measurements: true })).toHaveLength(6);
  });

  it('the annotation export (no option) keeps them', () => {
    expect(buildCrsRows(doc, opts)).toHaveLength(6);
  });
});
