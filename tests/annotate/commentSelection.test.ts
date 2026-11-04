// M7-04: which comments a commit must write again (B13), and which drawing
// tools leave their new comment selected (B9).
import type { PdfAnnotationObject } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import { changedDuringCommit } from '../../src/features/annotate/commitGuard';
import { selectsAfterDraw } from '../../src/features/annotate/selectAfterDraw';

const obj = (id: string, x = 0, pageIndex = 0) =>
  ({
    id,
    pageIndex,
    rect: { origin: { x, y: 0 }, size: { width: 1, height: 1 } },
  }) as PdfAnnotationObject;

describe('changedDuringCommit', () => {
  it('a comment unchanged since it was sent is left alone', () => {
    const a = obj('a');
    expect(
      changedDuringCommit(new Map([['a', a]]), { a: { object: a, commitState: 'moved' } }),
    ).toEqual([]);
  });

  it('a comment moved again while its move was written is moved again', () => {
    const sent = obj('a', 1, 2);
    const now = obj('a', 5, 2);
    expect(
      changedDuringCommit(new Map([['a', sent]]), { a: { object: now, commitState: 'moved' } }),
    ).toEqual([{ uid: 'a', pageIndex: 2, kind: 'move' }]);
  });

  it('any other change (or one to a comment being created) is a full update', () => {
    const sent = new Map([
      ['a', obj('a')],
      ['b', obj('b')],
    ]);
    expect(
      changedDuringCommit(sent, {
        a: { object: obj('a', 3), commitState: 'dirty' },
        b: { object: obj('b', 3), commitState: 'new' },
      }),
    ).toEqual([
      { uid: 'a', pageIndex: 0, kind: 'patch' },
      { uid: 'b', pageIndex: 0, kind: 'patch' },
    ]);
  });

  it('deleted, purged or already written comments are the plugin’s own business', () => {
    const sent = new Map([
      ['a', obj('a')],
      ['b', obj('b')],
      ['c', obj('c')],
    ]);
    expect(
      changedDuringCommit(sent, {
        a: { object: obj('a', 3), commitState: 'deleted' },
        c: { object: obj('c', 3), commitState: 'synced' },
      }),
    ).toEqual([]);
  });
});

describe('selectsAfterDraw', () => {
  it('shapes, lines, notes, text, stamps, measurements and fields stay selected', () => {
    for (const t of [
      'square',
      'circle',
      'line',
      'polygon',
      'textComment',
      'freeText',
      'dynamicStamp',
      'measureDistance',
      'formTextField',
    ])
      expect(selectsAfterDraw(t)).toBe(true);
  });

  it('not freehand strokes, links, calibration or scale viewports, nor non-drawing tools', () => {
    for (const t of [
      'ink',
      'inkHighlighter',
      'link',
      'calibrate',
      'scaleViewport',
      'select',
      'highlight',
    ])
      expect(selectsAfterDraw(t)).toBe(false);
  });
});
