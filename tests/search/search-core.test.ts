import { describe, expect, it } from 'vitest';
import {
  Batcher,
  QueryError,
  compileQuery,
  countInPage,
  findInPage,
  searchOrder,
} from '../../src/workers/work/searchCore';

// Promoted from spikes/s5-search (ADR-006 decision 1), plus M2-05 additions.

const matches = (q: string, text: string, opts = {}): string[] =>
  findInPage(text, 0, compileQuery(q, opts)).map((h) => h.match);

describe('compileQuery / findInPage', () => {
  it('is case-insensitive by default and literal (no regex metachars)', () => {
    expect(matches('a.b', 'A.B axb a.b')).toEqual(['A.B', 'a.b']);
  });

  it('matchCase', () => {
    expect(matches('Contract', 'contract Contract CONTRACT', { matchCase: true })).toEqual([
      'Contract',
    ]);
  });

  it('wholeWord, including non-ASCII letters', () => {
    expect(matches('art', 'art party art. Kunstart', { wholeWord: true })).toEqual(['art', 'art']);
    expect(matches('über', 'über überall', { wholeWord: true })).toEqual(['über']);
  });

  it('spaces in the query match line breaks in the page text', () => {
    expect(matches('shall be terminated', 'shall be\r\nterminated')).toEqual([
      'shall be\r\nterminated',
    ]);
  });

  it('wildcards', () => {
    expect(matches('52.2*-4', '52.212-4 52.2-4 52 212-4', { wildcards: true })).toEqual([
      '52.212-4',
      '52.2-4',
    ]);
    expect(matches('FAR ?', 'FAR 1 FAR x FAR', { wildcards: true })).toEqual(['FAR 1', 'FAR x']);
  });

  it('regex', () => {
    expect(matches('\\d{2}\\.\\d{3}-\\d', 'see 52.212-4 and 9.104-1', { regex: true })).toEqual([
      '52.212-4',
    ]);
  });

  it('rejects empty and empty-matching queries, and bad regex, with codes only (rule 10)', () => {
    const code = (f: () => unknown): string => {
      try {
        f();
        return 'none';
      } catch (e) {
        return e instanceof QueryError ? e.code : 'other';
      }
    };
    expect(code(() => compileQuery('   '))).toBe('search-empty-query');
    expect(code(() => compileQuery('a*', { regex: true }))).toBe('search-matches-empty');
    expect(code(() => compileQuery('(', { regex: true }))).toBe('search-invalid-query');
  });

  it('limits hits per call; countInPage counts them all', () => {
    const re = compileQuery('a');
    expect(findInPage('a a a a', 0, re, 2, 2)).toHaveLength(2);
    expect(countInPage('a a a a', re)).toBe(4);
    expect(countInPage('xyz', re)).toBe(0);
  });

  it('returns char offsets and trimmed, single-line context', () => {
    const [h] = findInPage('xx\nfoo bar\nyy', 7, compileQuery('bar'), 4);
    expect(h).toEqual({ page: 7, start: 7, length: 3, before: 'foo ', match: 'bar', after: ' yy' });
  });
});

describe('searchOrder', () => {
  it('visible pages first, then onward, wrapping', () => {
    expect(searchOrder(6, [2, 3])).toEqual([2, 3, 4, 5, 0, 1]);
    expect(searchOrder(3, [])).toEqual([0, 1, 2]);
    expect(searchOrder(3, [5, 1])).toEqual([1, 2, 0]);
  });
});

describe('Batcher', () => {
  it('flushes at most every interval (even when empty, for progress), and always on final', () => {
    let t = 0;
    const out: number[][] = [];
    const b = new Batcher<number>(
      (x) => out.push(x),
      50,
      () => t,
    );
    b.push([1]);
    t = 20;
    b.push([2]);
    t = 60;
    b.push([3]);
    t = 70;
    b.push([4], true);
    expect(out).toEqual([[1, 2, 3], [4]]);
  });
});
