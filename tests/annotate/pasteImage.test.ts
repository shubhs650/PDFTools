import { afterEach, describe, expect, it } from 'vitest';
import {
  clipIsNewest,
  noteOutsideCopy,
  noteSeen,
  outsideAt,
  pasteChoice,
  resetClipboardClock,
  seenAt,
  tick,
} from '../../src/features/annotate/transfer/clipboardClock';
import { visibleMiddle } from '../../src/features/view/pagePoint';

// M7-08 (ADR-023 D-45): which copy a paste takes, and where Ctrl+V puts an image.

describe('the newest copy wins (comments or an image)', () => {
  afterEach(resetClipboardClock);

  it('takes the image when there are no copied comments, and nothing when neither', () => {
    expect(pasteChoice({ image: true, clipAt: null, imageSeenAt: null, outsideAt: 0 })).toBe(
      'image',
    );
    expect(pasteChoice({ image: false, clipAt: null, imageSeenAt: null, outsideAt: 5 })).toBe(
      'none',
    );
    expect(pasteChoice({ image: false, clipAt: 3, imageSeenAt: null, outsideAt: 5 })).toBe(
      'comments',
    );
  });

  it('takes the comments copied after the image', () => {
    noteOutsideCopy(); // the screenshot, in another app
    const clipAt = tick(); // then Ctrl+C on comments
    expect(pasteChoice({ image: true, clipAt, imageSeenAt: null, outsideAt: outsideAt() })).toBe(
      'comments',
    );
    expect(clipIsNewest(clipAt, outsideAt())).toBe(true);
  });

  it('takes an image copied after the comments (the window was left, or a snapshot)', () => {
    const clipAt = tick();
    noteOutsideCopy();
    expect(pasteChoice({ image: true, clipAt, imageSeenAt: null, outsideAt: outsideAt() })).toBe(
      'image',
    );
    expect(clipIsNewest(clipAt, outsideAt())).toBe(false);
  });

  it('knows an image already pasted before the comments were copied is the old one', () => {
    noteSeen('png:100:abc');
    const clipAt = tick();
    noteOutsideCopy(); // a file picker took the focus; the clipboard did not change
    expect(
      pasteChoice({
        image: true,
        clipAt,
        imageSeenAt: seenAt('png:100:abc'),
        outsideAt: outsideAt(),
      }),
    ).toBe('comments');
    // An image first seen after the copy is newer: pasted again and again.
    noteSeen('png:200:def');
    expect(
      pasteChoice({
        image: true,
        clipAt,
        imageSeenAt: seenAt('png:200:def'),
        outsideAt: outsideAt(),
      }),
    ).toBe('image');
  });

  it('keeps when an image was first seen, and forgets the oldest after a few', () => {
    noteSeen('a');
    const first = seenAt('a');
    noteSeen('a');
    expect(seenAt('a')).toBe(first);
    for (let i = 0; i < 16; i++) noteSeen(`x${String(i)}`);
    expect(seenAt('a')).toBeNull();
    expect(seenAt('x15')).not.toBeNull();
  });

  it('an empty comment clipboard is never the newest', () => {
    expect(clipIsNewest(null, 0)).toBe(false);
  });
});

describe('Ctrl+V: the middle of the part of the page in view', () => {
  const view = { left: 0, top: 100, right: 1000, bottom: 900 };

  it('is the page’s middle when all of it is in view', () => {
    expect(visibleMiddle({ left: 200, top: 150, right: 800, bottom: 850 }, view)).toEqual({
      x: 500,
      y: 500,
    });
  });

  it('is the middle of the visible strip when the page is scrolled half out', () => {
    expect(visibleMiddle({ left: 200, top: -900, right: 800, bottom: 500 }, view)).toEqual({
      x: 500,
      y: 300,
    });
  });

  it('is null when none of the page is in view', () => {
    expect(visibleMiddle({ left: 200, top: 950, right: 800, bottom: 1500 }, view)).toBeNull();
  });
});
