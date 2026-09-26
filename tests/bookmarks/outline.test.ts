import type { PdfBookmarkObject } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import { allBranchIds, treeKey, visibleRows } from '../../src/features/bookmarks/outline';

// M2-10: the outline as an ARIA tree.

const b = (title: string, children?: PdfBookmarkObject[]): PdfBookmarkObject =>
  children ? { title, children } : { title };

const outline = [b('A', [b('A1'), b('A2', [b('A2a')])]), b('B')];

describe('outline rows', () => {
  it('shows only expanded branches, with levels and set positions', () => {
    expect(visibleRows(outline, new Set()).map((r) => r.id)).toEqual(['0', '1']);
    const rows = visibleRows(outline, new Set(['0', '0.1']));
    expect(rows.map((r) => `${r.id}:${r.title}:${String(r.level)}`)).toEqual([
      '0:A:1',
      '0.0:A1:2',
      '0.1:A2:2',
      '0.1.0:A2a:3',
      '1:B:1',
    ]);
    expect(rows[2]).toMatchObject({ hasChildren: true, expanded: true, posInSet: 2, setSize: 2 });
    expect(rows[4]).toMatchObject({ hasChildren: false, expanded: false, parentId: null });
    expect(allBranchIds(outline)).toEqual(['0', '0.1']);
  });

  it('follows the ARIA tree keys', () => {
    const closed = visibleRows(outline, new Set());
    expect(treeKey(closed, '0', 'ArrowRight')).toEqual({ expand: '0' });
    expect(treeKey(closed, '0', 'ArrowDown')).toEqual({ focus: '1' });
    expect(treeKey(closed, '1', 'ArrowRight')).toBeNull(); // a leaf
    const open = visibleRows(outline, new Set(['0']));
    expect(treeKey(open, '0', 'ArrowRight')).toEqual({ focus: '0.0' }); // to the first child
    expect(treeKey(open, '0.1', 'ArrowLeft')).toEqual({ focus: '0' }); // to the parent
    expect(treeKey(open, '0', 'ArrowLeft')).toEqual({ collapse: '0' });
    expect(treeKey(open, '0.0', 'End')).toEqual({ focus: '1' });
    expect(treeKey(open, '1', 'Home')).toEqual({ focus: '0' });
    expect(treeKey(open, '0.0', 'Enter')).toEqual({ activate: '0.0' });
    expect(treeKey(open, '0.0', 'x')).toBeNull();
  });
});
