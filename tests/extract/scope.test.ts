import { describe, expect, it } from 'vitest';
import { resolveScope } from '../../src/features/extract/scope';
import { freeName } from '../../src/storage/fileAccess';

const ctx = { pageCount: 10, current: 3 };

describe('export scope (M4-04)', () => {
  it('all, current and custom ranges give document order without repeats', () => {
    expect(resolveScope({ kind: 'all', custom: '' }, { pageCount: 3, current: 0 })).toEqual({
      ok: true,
      pages: [0, 1, 2],
    });
    expect(resolveScope({ kind: 'current', custom: '' }, ctx)).toEqual({ ok: true, pages: [3] });
    expect(resolveScope({ kind: 'custom', custom: '8, 2-4, 3, 10-' }, ctx)).toEqual({
      ok: true,
      pages: [1, 2, 3, 7, 9],
    });
  });

  it('reports the print dialog range errors', () => {
    expect(resolveScope({ kind: 'custom', custom: ' ' }, ctx)).toEqual({
      ok: false,
      error: 'empty',
    });
    expect(resolveScope({ kind: 'custom', custom: 'a-b' }, ctx)).toEqual({
      ok: false,
      error: 'syntax',
    });
    expect(resolveScope({ kind: 'custom', custom: '11' }, ctx)).toEqual({
      ok: false,
      error: 'outOfRange',
    });
  });

  it('uses the selection when there is one', () => {
    expect(
      resolveScope({ kind: 'selection', custom: '' }, { ...ctx, selection: [5, 1, 5, 99] }),
    ).toEqual({
      ok: true,
      pages: [1, 5],
    });
    expect(resolveScope({ kind: 'selection', custom: '' }, ctx)).toEqual({
      ok: false,
      error: 'noSelection',
    });
  });
});

describe('folder output names (M4-Q5)', () => {
  it('never replaces an existing file', () => {
    const taken = new Set(['page-1.png', 'page-1 (2).png', 'readme']);
    expect(freeName('page-1.png', taken)).toBe('page-1 (3).png');
    expect(freeName('Page-1.PNG', new Set(['page-1.png']))).toBe('Page-1 (2).PNG');
    expect(freeName('readme', taken)).toBe('readme (2)');
    expect(freeName('new.txt', taken)).toBe('new.txt');
  });
});
