import { describe, expect, it } from 'vitest';
import { resolveBinding } from '../../src/app/keys/useShortcuts';
import { copyRoute, pastePlan, rootsOf } from '../../src/features/annotate/transfer/copyPaste';

// M4-21: key routing (comments selected → comments, text → text), the paste
// placement (current page, original pages, the 10 pt offset on its own page)
// and which comments a selection copies.

describe('Ctrl+C / Ctrl+V routing', () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({
    key: k,
    code: `Key${k.toUpperCase()}`,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });
  const doc = { editable: false, inDocument: true };

  it('copies comments when comments are selected, text otherwise', () => {
    expect(copyRoute({ comments: 2, text: false })).toBe('comments');
    expect(copyRoute({ comments: 0, text: true })).toBe('text');
    expect(copyRoute({ comments: 1, text: true })).toBe('text');
    expect(copyRoute({ comments: 0, text: false })).toBe('text');
  });

  it('binds Ctrl+V and Ctrl+Shift+V in the document, never in a text field', () => {
    expect(resolveBinding(key('v'), doc, false)?.target).toBe('edit.paste');
    expect(resolveBinding(key('V', { shiftKey: true }), doc, false)?.target).toBe(
      'comment.pasteToOriginal',
    );
    expect(resolveBinding(key('v'), { editable: true, inDocument: true }, false)).toBeUndefined();
    expect(resolveBinding(key('v'), { editable: false, inDocument: false }, false)).toBeUndefined();
    // The browser keeps the key: its paste event carries the clipboard (M7-08).
    expect(resolveBinding(key('v'), doc, false)?.browserEvent).toBe(true);
    expect(resolveBinding(key('c'), doc, false)?.target).toBe('edit.copy');
  });
});

describe('pastePlan', () => {
  const clip = { pages: [1, 3], sourceDocId: 'a' };

  it('onto the current page of another document: no offset', () => {
    expect(pastePlan(clip, { docId: 'b', page: 0, pageCount: 5 }, 'current')).toEqual({
      pageMap: [0, 0],
      shift: false,
    });
  });

  it('onto a page it came from, in the same document: 10 pt offset', () => {
    expect(pastePlan(clip, { docId: 'a', page: 3, pageCount: 5 }, 'current').shift).toBe(true);
    expect(pastePlan(clip, { docId: 'a', page: 2, pageCount: 5 }, 'current').shift).toBe(false);
    expect(pastePlan(clip, { docId: 'a', page: 0, pageCount: 5 }, 'original')).toEqual({
      pageMap: [1, 3],
      shift: true,
    });
  });

  it('to original pages that a shorter document lacks', () => {
    expect(pastePlan(clip, { docId: 'b', page: 0, pageCount: 2 }, 'original')).toEqual({
      pageMap: [1, null],
      shift: false,
    });
  });
});

describe('rootsOf', () => {
  it('copies each selected thread once, from its comment', () => {
    const c1 = { id: 'c1' };
    const r2 = { id: 'r2', inReplyToId: 'r1' };
    const c2 = { id: 'c2' };
    const all = [c1, { id: 'r1', inReplyToId: 'c1' }, r2, c2];
    expect(rootsOf([r2, c1, c2], all)).toEqual(['c1', 'c2']);
    // A reply whose comment is gone stands for itself.
    expect(rootsOf([{ id: 'x', inReplyToId: 'gone' }], all)).toEqual(['x']);
  });
});
