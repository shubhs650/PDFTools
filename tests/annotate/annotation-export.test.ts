import {
  PdfAnnotationState as St,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype as S,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  JSON_FORMAT,
  jsonPieces,
  jsonSafe,
  subtypeName,
} from '../../src/features/annotate/export/annotationData';

// M4-08 (§7.6, M4-Q7, ADR-018): the JSON v1 export — valid JSON however it is
// cut into pieces, the comments in their pane numbers with every field an
// import needs (the full model, replies in thread order, state history), and
// nothing a JSON file cannot hold.

const rect = { origin: { x: 10, y: 20 }, size: { width: 30, height: 40 } };
const a = (o: Partial<PdfAnnotationObject> & { id: string; type?: S }) =>
  ({ type: S.TEXT, pageIndex: 0, rect, ...o }) as PdfAnnotationObject;
const d = (s: string) => new Date(s);

const doc = [
  a({
    id: 'sq',
    type: S.SQUARE,
    pageIndex: 1,
    author: 'Bo',
    contents: 'Second page',
    created: d('2026-01-01T10:00:00Z'),
    color: '#FF0000',
    strokeWidth: 2,
    custom: { private: true },
  }),
  a({
    id: 'hl',
    type: S.HIGHLIGHT,
    author: 'Ana',
    contents: 'Move it',
    created: d('2026-01-02T00:00:00Z'),
  }),
  a({
    id: 'r1',
    inReplyToId: 'hl',
    author: 'Bo',
    contents: 'Why?',
    created: d('2026-01-03T00:00:00Z'),
  }),
  a({
    id: 'r1a',
    inReplyToId: 'r1',
    author: 'Ana',
    contents: 'Clash',
    created: d('2026-01-04T00:00:00Z'),
  }),
  a({
    id: 's1',
    inReplyToId: 'hl',
    author: 'Bo',
    created: d('2026-01-05T00:00:00Z'),
    state: St.Accepted,
    stateModel: PdfAnnotationStateModel.Review,
  }),
  a({ id: 'link', type: S.LINK }),
];

const header = { name: 'plan.pdf', pages: 2, exported: d('2026-09-29T12:00:00Z') };
const parse = (pieces: Iterable<string>) =>
  JSON.parse([...pieces].join('')) as {
    format: string;
    version: number;
    exported: string;
    document: { name: string; pages: number };
    annotations: Record<string, unknown>[];
  };

describe('annotation JSON v1 (M4-08)', () => {
  it('header and one record per comment, in the pane numbering; links are not comments', () => {
    const j = parse(jsonPieces(doc, header));
    expect(j.format).toBe(JSON_FORMAT);
    expect(j.version).toBe(1);
    expect(j.exported).toBe('2026-09-29T12:00:00.000Z');
    expect(j.document).toEqual({ name: 'plan.pdf', pages: 2 });
    expect(j.annotations.map((r) => [r.number, r.page, r.id, r.type])).toEqual([
      [1, 1, 'hl', 'highlight'],
      [2, 2, 'sq', 'square'],
    ]);
  });

  it('replies in thread order with depth, and the review-state history', () => {
    const [hl] = parse(jsonPieces(doc, header)).annotations;
    expect(hl?.replies).toEqual([
      expect.objectContaining({
        id: 'r1',
        inReplyTo: 'hl',
        depth: 0,
        author: 'Bo',
        contents: 'Why?',
      }),
      expect.objectContaining({ id: 'r1a', inReplyTo: 'r1', depth: 1, author: 'Ana' }),
    ]);
    expect(hl?.states).toEqual([
      { id: 's1', author: 'Bo', state: St.Accepted, date: '2026-01-05T00:00:00.000Z' },
    ]);
  });

  it('carries the full model for re-creating it, dates as ISO strings, no private bag', () => {
    const sq = parse(jsonPieces(doc, header)).annotations[1] as {
      annotation: Record<string, unknown>;
    };
    expect(sq.annotation).toMatchObject({
      id: 'sq',
      type: S.SQUARE,
      pageIndex: 1,
      rect,
      color: '#FF0000',
      strokeWidth: 2,
      created: '2026-01-01T10:00:00.000Z',
    });
    expect(sq.annotation).not.toHaveProperty('custom');
  });

  it('is valid JSON for any batch size, including one record per piece and none at all', () => {
    for (const batch of [1, 2, 200])
      expect(parse(jsonPieces(doc, header, {}, () => null, batch)).annotations).toHaveLength(2);
    expect(parse(jsonPieces([], header)).annotations).toEqual([]);
  });

  it('filtered scope, and measurement facts when the annotation is one', () => {
    const j = parse(
      jsonPieces(doc, header, { filter: { authors: ['Bo'] } }, (x) =>
        x.id === 'sq' ? { kind: 'area', value: '12.5 m²' } : null,
      ),
    );
    expect(j.annotations.map((r) => r.id)).toEqual(['sq']);
    expect(j.annotations[0]?.measure).toEqual({ kind: 'area', value: '12.5 m²' });
  });

  it('jsonSafe drops binary data, functions and non-finite numbers', () => {
    expect(
      jsonSafe({
        a: new Uint8Array([1]),
        f: () => 1,
        n: Number.NaN,
        d: d('2026-01-01T00:00:00Z'),
        k: [1, undefined],
      }),
    ).toEqual({ n: null, d: '2026-01-01T00:00:00.000Z', k: [1, null] });
    expect(subtypeName(S.FREETEXT)).toBe('freetext');
  });
});
