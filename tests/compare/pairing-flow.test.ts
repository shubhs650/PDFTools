// M12-09 (D-60): what the input window pairs and what a pairing table's lists
// offer. The pairing itself runs in the workers (tests/compare/pairing.test.ts,
// tests/compare/compare-worker.test.ts, e2e/compare-pairing.spec.ts).
import { describe, expect, it } from 'vitest';
import type { DocumentsState } from '../../src/app/store/documentStore';
import { newComparison } from '../../src/features/compare/model';
import {
  ALL_PAGES_UP_TO,
  pairingInputs,
  partnerOptions,
  type PairingState,
} from '../../src/features/compare/pairingFlow';
import { pairingRows, type PairingResult } from '../../src/model/compare/pairing';

const docs = (pages: Record<string, number>): DocumentsState['docs'] =>
  Object.fromEntries(
    Object.entries(pages).map(([id, pageCount]) => [
      id,
      { meta: { name: `${id}.pdf`, pageCount } },
    ]),
  ) as unknown as DocumentsState['docs'];

describe('pairingInputs', () => {
  it('an overlay with both sides ready: each side’s files with their page ranges and names', () => {
    const c = newComparison('c', 'overlay', ['a1', 'a2'], ['b1']);
    const withRange = { ...c, a: c.a.map((f) => (f.docId === 'a2' ? { ...f, range: '2-3' } : f)) };
    const r = pairingInputs(withRange, docs({ a1: 1, a2: 4, b1: 3 }));
    expect(r?.a.files).toEqual([
      { docId: 'a1', pages: [0], name: 'a1.pdf' },
      { docId: 'a2', pages: [1, 2], name: 'a2.pdf' },
    ]);
    expect(r?.b.files).toEqual([{ docId: 'b1', pages: [0, 1, 2], name: 'b1.pdf' }]);
    // The key changes with the inputs (the pages are paired again).
    const other = pairingInputs(c, docs({ a1: 1, a2: 4, b1: 3 }));
    expect(other?.key).not.toBe(r?.key);
  });

  it('nothing to pair: a text comparison, an empty side, a file still opening, a bad range', () => {
    const d = docs({ a1: 1, b1: 1 });
    expect(pairingInputs(newComparison('c', 'text', ['a1'], ['b1']), d)).toBeNull();
    expect(pairingInputs(newComparison('c', 'overlay', ['a1'], []), d)).toBeNull();
    expect(pairingInputs(newComparison('c', 'overlay', ['a1'], ['b2']), d)).toBeNull();
    const c = newComparison('c', 'overlay', ['a1'], ['b1']);
    expect(pairingInputs({ ...c, b: [{ docId: 'b1', range: '5' }] }, d)).toBeNull();
  });
});

describe('partnerOptions', () => {
  const state = (na: number, nb: number): PairingState => {
    const sim = new Float32Array(na * nb);
    // A page i is most like B page i, then the ones next to it.
    for (let i = 0; i < na; i++)
      for (let j = 0; j < nb; j++) sim[i * nb + j] = 1 - Math.abs(i - j) / 100;
    const result: PairingResult = {
      pairs: Array.from({ length: Math.min(na, nb) }, (_, i) => [i, i] as [number, number]),
      removed: [],
      added: [],
      na,
      nb,
      sim,
    };
    const page = (k: number) => ({ docId: 'd', page: k, file: 0 });
    return {
      key: 'k',
      status: 'done',
      done: 0,
      total: 0,
      pages: { a: [...Array(na).keys()].map(page), b: [...Array(nb).keys()].map(page) },
      result,
      rows: pairingRows(result),
    };
  };

  it('a small side offers every page', () => {
    const p = state(3, 5);
    expect(partnerOptions(p, 'b', { a: 0, b: 0, excluded: false })).toEqual([0, 1, 2, 3, 4]);
  });

  it('a long side offers the likeliest partners of the other side’s page and the current one', () => {
    const n = ALL_PAGES_UP_TO + 40;
    const p = state(n, n);
    const opts = partnerOptions(p, 'a', { a: 90, b: 50, excluded: false });
    expect(opts).toContain(50);
    expect(opts).toContain(90);
    expect(opts.length).toBe(21);
    expect(opts).toEqual([...opts].sort((x, y) => x - y));
    // A page on one side only: every page.
    expect(partnerOptions(p, 'a', { a: null, b: null, excluded: false })).toHaveLength(n);
  });
});
