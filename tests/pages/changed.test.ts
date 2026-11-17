import { describe, expect, it } from 'vitest';
import { changedPages, contentPages } from '../../src/features/pages/changed';
import type { Change } from '../../src/features/pages/pageOps';

// M4-09/M4-20: only pages whose identity changed are
// refreshed — each refreshed page costs a text-geometry job in the Work worker.

const page = (objectNumber: number, rotation: 0 | 1 | 2 | 3 = 0, width = 595) => ({
  objectNumber,
  rotation,
  size: { width, height: 842 },
});

describe('changedPages', () => {
  const before = [page(3), page(5), page(7), page(9)];

  it('a rotation or a resize refreshes that page only', () => {
    expect(changedPages(before, [page(3), page(5, 1), page(7), page(9)])).toEqual([1]);
    expect(changedPages(before, [page(3), page(5), page(7, 0, 612), page(9)])).toEqual([2]);
  });

  it('a move or a delete refreshes every index that holds another page', () => {
    expect(changedPages(before, [page(3), page(7), page(5), page(9)])).toEqual([1, 2]);
    expect(changedPages(before, [page(5), page(7), page(9)])).toEqual([0, 1, 2]);
    expect(changedPages(before, [...before, page(11)])).toEqual([4]);
  });

  it('copied comments change no page identity: nothing is refreshed', () => {
    expect(changedPages(before, before)).toEqual([]);
  });
});

// M11-01: pages whose text changes in place lose their cached selection
// geometry, on apply, undo and redo (all three read the change's content pages).
describe('contentPages', () => {
  const objects = { objects: [], firstNew: 20 };

  it('an OCR layer names the pages it gave text', () => {
    const ocr: Change = { kind: 'objects', ...objects, capability: 'modify', content: [0, 2] };
    expect(contentPages(ocr)).toEqual([0, 2]);
  });

  it('a flatten names its pages', () => {
    const at = (page: number) => ({ page, flatten: ['a'], remove: [], unlink: [] });
    const flatten: Change = { kind: 'op', op: { kind: 'flatten', pages: [at(1), at(4)] } };
    expect(contentPages(flatten)).toEqual([1, 4]);
  });

  it('comments, bookmarks and identity-changing operations name none', () => {
    expect(contentPages({ kind: 'objects', ...objects })).toEqual([]);
    expect(contentPages({ kind: 'objects', ...objects, tag: 'bookmarks' })).toEqual([]);
    expect(contentPages({ kind: 'op', op: { kind: 'rotate', pages: [0], quarter: 1 } })).toEqual(
      [],
    );
  });
});
