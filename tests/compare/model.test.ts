import { describe, expect, it } from 'vitest';
import {
  addFiles,
  compareBlock,
  documentsOf,
  moveFile,
  nameParts,
  newComparison,
  rangePages,
  removeFile,
  setRange,
  sidePageCount,
  swapSides,
  withType,
} from '../../src/features/compare/model';
import { comparisonTitle } from '../../src/features/compare/title';
import { blockFor, limitsOf, type InputFile } from '../../src/features/compare/permissions';
import { PERM_ANNOTATE, PERM_COPY, PERM_PRINT, UNRESTRICTED } from '../../src/model/permissions';

// M12-08 (D-58): a comparison's inputs, its tab name and its permission rules.

const ids = (files: readonly { docId: string }[]) => files.map((f) => f.docId);

describe('comparison inputs (D-58)', () => {
  it('starts on the input window; a text comparison takes one file per side', () => {
    const c = newComparison('c', 'text', ['a1', 'a2'], ['b1']);
    expect(c).toMatchObject({ id: 'c', type: 'text', stage: 'input' });
    expect(ids(c.a)).toEqual(['a1']);
    expect(ids(c.b)).toEqual(['b1']);
    expect(newComparison('o', 'overlay', ['a1', 'a2']).a).toHaveLength(2);
  });

  it('an overlay side is a set: new files go at the end, a file there stays put', () => {
    let c = newComparison('c', 'overlay', ['a1']);
    c = addFiles(c, 'a', ['a2', 'a1', 'a3']);
    expect(ids(c.a)).toEqual(['a1', 'a2', 'a3']);
  });

  it('a text side takes the first new file in place of the old one', () => {
    let c = newComparison('c', 'text', ['a1']);
    c = addFiles(c, 'a', ['a2', 'a3']);
    expect(ids(c.a)).toEqual(['a2']);
  });

  it('a file moves to the side it is added to (one document is never shown twice)', () => {
    let c = newComparison('c', 'overlay', ['x'], ['y']);
    c = addFiles(c, 'b', ['x']);
    expect(ids(c.a)).toEqual([]);
    expect(ids(c.b)).toEqual(['y', 'x']);
    expect(documentsOf(c)).toEqual(['y', 'x']);
  });

  it('keeps a file’s range while it stays; remove, move, swap and the other type', () => {
    let c = newComparison('c', 'overlay', ['a1', 'a2'], ['b1']);
    c = setRange(c, 'a', 'a2', '2-3');
    c = addFiles(c, 'a', ['a2']);
    expect(c.a[1]).toEqual({ docId: 'a2', range: '2-3' });
    c = moveFile(c, 'a', 'a2', -1);
    expect(ids(c.a)).toEqual(['a2', 'a1']);
    expect(moveFile(c, 'a', 'a2', -1)).toBe(c); // already first
    c = swapSides(c);
    expect(ids(c.a)).toEqual(['b1']);
    expect(ids(c.b)).toEqual(['a2', 'a1']);
    const text = withType(c, 'text');
    expect(text.type).toBe('text');
    expect(ids(text.b)).toEqual(['a2']);
    expect(withType(text, 'overlay').b).toHaveLength(1);
    expect(ids(removeFile(c, 'b', 'a2').b)).toEqual(['a1']);
  });

  it('reads a page range: empty is every page; numbers in document order, once', () => {
    expect(rangePages('', 3)).toEqual({ ok: true, pages: [0, 1, 2] });
    expect(rangePages('  ', 2)).toEqual({ ok: true, pages: [0, 1] });
    expect(rangePages('3, 1-2, 2', 5)).toEqual({ ok: true, pages: [0, 1, 2] });
    expect(rangePages('4-', 5)).toEqual({ ok: true, pages: [3, 4] });
    expect(rangePages('9', 5)).toEqual({ ok: false, error: 'outOfRange' });
    expect(rangePages('a-b', 5)).toEqual({ ok: false, error: 'syntax' });
  });

  it('says why Compare cannot run: an empty side, a file still opening, a bad range', () => {
    const pages = (d: string): number | undefined => ({ a1: 4, b1: 2 })[d];
    let c = newComparison('c', 'overlay');
    expect(compareBlock(c, pages)).toEqual({ kind: 'empty', side: 'a' });
    c = addFiles(c, 'a', ['a1']);
    expect(compareBlock(c, pages)).toEqual({ kind: 'empty', side: 'b' });
    c = addFiles(c, 'b', ['b9']);
    expect(compareBlock(c, pages)).toEqual({ kind: 'opening' });
    c = addFiles(removeFile(c, 'b', 'b9'), 'b', ['b1']);
    expect(compareBlock(c, pages)).toBeNull();
    c = setRange(c, 'b', 'b1', '5');
    expect(compareBlock(c, pages)).toEqual({
      kind: 'range',
      side: 'b',
      docId: 'b1',
      error: 'outOfRange',
    });
    expect(sidePageCount(setRange(c, 'a', 'a1', '2-3').a, pages)).toBe(2);
  });

  it('names the tab after the first file of each side, with +N for a set', () => {
    const names: Record<string, string> = { a1: 'RevA.pdf', a2: 'RevA-2.PDF', b1: 'RevB.pdf' };
    const nameOf = (d: string) => names[d];
    const c = newComparison('c', 'overlay', ['a1', 'a2'], ['b1']);
    expect(nameParts(c, nameOf)).toEqual({ a: 'RevA', aMore: 1, b: 'RevB', bMore: 0 });
    expect(comparisonTitle(c, nameOf)).toBe('RevA +1 ↔ RevB');
    expect(comparisonTitle(newComparison('t', 'text', ['a1']), nameOf)).toBe('Text Comparison');
    expect(comparisonTitle(newComparison('o', 'overlay'), nameOf)).toBe('PDF Overlay');
  });
});

describe('permission rules per action (D-58, rule 9)', () => {
  const sec = (permissions: number) => ({ permissions, revision: 4 });
  const files: InputFile[] = [
    { docId: 'a', name: 'RevA.pdf', security: UNRESTRICTED },
    { docId: 'b', name: 'RevB.pdf', security: sec(PERM_PRINT | PERM_ANNOTATE) }, // no copy
    { docId: 'c', name: 'RevC.pdf', security: sec(PERM_PRINT | PERM_COPY) }, // no comments
  ];

  it('viewing is always allowed', () => {
    expect(blockFor('view', files)).toBeNull();
  });

  it('commenting follows the file the comment goes into', () => {
    expect(blockFor('comment', files, 'a')).toBeNull();
    expect(blockFor('comment', files, 'b')).toBeNull();
    expect(blockFor('comment', files, 'c')).toEqual({
      docId: 'c',
      name: 'RevC.pdf',
      capability: 'annotate',
    });
  });

  it('copying, Export Overlay, the change register and Save comparison need copying of every file', () => {
    for (const action of ['copyText', 'exportOverlay', 'changeRegister', 'saveComparison'] as const)
      expect(blockFor(action, files)).toEqual({ docId: 'b', name: 'RevB.pdf', capability: 'copy' });
    expect(
      blockFor(
        'saveComparison',
        [files[0], files[2]].filter((f) => f !== undefined),
      ),
    ).toBeNull();
  });

  it('says what a file turns off, for the input window', () => {
    expect(limitsOf(UNRESTRICTED)).toEqual({ comment: false, copy: false });
    expect(limitsOf(sec(PERM_PRINT | PERM_ANNOTATE))).toEqual({ comment: false, copy: true });
    expect(limitsOf(sec(PERM_PRINT))).toEqual({ comment: true, copy: true });
  });
});
