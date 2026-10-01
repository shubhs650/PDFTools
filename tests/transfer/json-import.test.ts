import { describe, expect, it } from 'vitest';
import {
  parseAnnotationJson,
  planJsonImport,
  reviveModel,
  type JsonRecord,
} from '../../src/features/annotate/transfer/jsonImport';

// M4-20: our JSON v1 as an import source — strict validation, the plan
// (filters, mapping, duplicates, unsupported types), reply and state handling.

const model = (type = 5) => ({
  type,
  id: 'x',
  pageIndex: 0,
  rect: { origin: { x: 10, y: 20 }, size: { width: 30, height: 40 } },
  created: '2026-01-02T00:00:00.000Z',
  custom: { private: true },
});

const record = (over: Record<string, unknown> = {}) => ({
  number: 1,
  page: 1,
  id: 'c1',
  type: 'square',
  author: 'Ana',
  subject: null,
  contents: 'Fix',
  created: '2026-01-02T00:00:00.000Z',
  modified: null,
  replies: [{ id: 'r1', inReplyTo: 'c1', depth: 0, author: 'Bo', annotation: model(1) }],
  states: [{ id: 's1', author: 'Bo', state: 'Accepted', date: '2026-01-03T00:00:00.000Z' }],
  annotation: model(),
  ...over,
});

const file = (annotations: unknown[], over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'pdftools-annotations',
    version: 1,
    exported: '2026-01-04T00:00:00.000Z',
    document: { name: 'a.pdf', pages: 3 },
    annotations,
    ...over,
  });

describe('parseAnnotationJson', () => {
  it('reads a valid v1 file (page 1-based → 0-based, unknown fields ignored)', () => {
    const r = parseAnnotationJson(file([record({ extra: 1 })], { future: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.pages).toBe(3);
    expect(r.doc.records[0]).toMatchObject({ page: 0, id: 'c1', type: 'square', author: 'Ana' });
    expect(r.doc.records[0]?.replies[0]?.id).toBe('r1');
  });

  it('refuses other formats, other versions and broken records', () => {
    expect(parseAnnotationJson('{')).toEqual({ ok: false, error: 'syntax' });
    expect(parseAnnotationJson('[]')).toEqual({ ok: false, error: 'format' });
    expect(parseAnnotationJson(file([], { version: 2 }))).toEqual({
      ok: false,
      error: 'version',
      at: 2,
    });
    expect(parseAnnotationJson(file([], { annotations: {} }))).toEqual({
      ok: false,
      error: 'shape',
    });
    const bad = [
      record({ page: 0 }),
      record({ page: 1.5 }),
      record({ id: '' }),
      record({ annotation: { type: 5 } }),
      record({ annotation: { ...model(), rect: { origin: { x: 'a', y: 0 }, size: {} } } }),
      record({ replies: [{ id: 'r', annotation: {} }] }),
      record({ states: [{ id: 's' }] }),
      record({ created: 'yesterday' }),
      record({ replies: null }),
    ];
    for (const b of bad)
      expect(parseAnnotationJson(file([record(), b]))).toEqual({
        ok: false,
        error: 'shape',
        at: 2,
      });
  });
});

const recs = (list: Record<string, unknown>[]): JsonRecord[] => {
  const r = parseAnnotationJson(file(list));
  if (!r.ok) throw new Error(r.error);
  return r.doc.records;
};

describe('planJsonImport', () => {
  const base = { offset: 0, withReplies: true, targetPages: 3, existing: new Set<string>() };

  it('imports a comment with its reply and state', () => {
    const { items, counts } = planJsonImport(recs([record()]), base);
    expect(items).toHaveLength(1);
    expect(items[0]?.target).toBe(0);
    expect(counts).toEqual({
      selected: 3,
      roots: 1,
      skipped: { duplicate: 0, missingPage: 0, filtered: 0, unsupported: 0 },
    });
  });

  it('filters by page, author and type; replies optional; states always', () => {
    const list = recs([
      record(),
      record({ id: 'c2', page: 2, author: 'Bo', replies: [], states: [] }),
      record({ id: 'c3', page: 3, type: 'circle', replies: [], states: [] }),
    ]);
    const byAuthor = planJsonImport(list, { ...base, authors: new Set(['Ana']) });
    expect(byAuthor.items.map((i) => i.record.id)).toEqual(['c1', 'c3']);
    const byType = planJsonImport(list, { ...base, types: new Set(['circle']) });
    expect(byType.items.map((i) => i.record.id)).toEqual(['c3']);
    const byPage = planJsonImport(list, { ...base, pages: new Set([1]) });
    expect(byPage.items.map((i) => i.record.id)).toEqual(['c2']);
    const noReplies = planJsonImport(list, { ...base, withReplies: false });
    expect(noReplies.items[0]?.replies).toEqual([]);
    expect(noReplies.items[0]?.record.states).toHaveLength(1);
    expect(noReplies.counts.skipped.filtered).toBe(1);
  });

  it('maps by offset and skips missing pages, duplicates and stamps', () => {
    const list = recs([
      record(),
      record({ id: 'c2', page: 3, replies: [], states: [] }),
      record({ id: 'c3', type: 'stamp', replies: [], states: [] }),
    ]);
    const shifted = planJsonImport(list, { ...base, offset: 1 });
    expect(shifted.items.map((i) => [i.record.id, i.target])).toEqual([['c1', 1]]);
    expect(shifted.counts.skipped.missingPage).toBe(1);
    expect(shifted.counts.skipped.unsupported).toBe(1);
    const dup = planJsonImport(list, { ...base, existing: new Set(['c1', 'c2']) });
    expect(dup.items).toEqual([]);
    expect(dup.counts.skipped.duplicate).toBe(4);
    // A reply already in the document is skipped; its comment still comes.
    const partial = planJsonImport(list.slice(0, 1), { ...base, existing: new Set(['r1']) });
    expect(partial.items[0]?.replies).toEqual([]);
    expect(partial.counts.skipped.duplicate).toBe(1);
  });
});

describe('reviveModel', () => {
  it('revives dates, drops the private bag, places on the target page', () => {
    const m = reviveModel(model(), 2);
    expect(m.pageIndex).toBe(2);
    expect(m.created).toEqual(new Date('2026-01-02T00:00:00.000Z'));
    expect('custom' in m).toBe(false);
  });
});
