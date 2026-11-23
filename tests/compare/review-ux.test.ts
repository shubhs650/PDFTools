// M12-27 (ADR-033 decisions 4–6): the review of a comparison made easier — the
// comment zoom of the close-out list, "Page n of m" and Go to page in a text
// comparison, the unsaved mark of a comparison tab, and the question before a
// comparison closes with comments only a comparison file keeps.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentStore } from '../../src/app/store/documentStore';
import { mapBox, rectBox, textZoomFor } from '../../src/features/compare/closeout/reveal';
import { registerCompareCommands } from '../../src/features/compare/commands';
import {
  closePromptStore,
  closeWithoutSaving,
  keepComparison,
  unsavedOnlyHere,
} from '../../src/features/compare/file/closePrompt';
import { newComparison } from '../../src/features/compare/model';
import { notesStore } from '../../src/features/compare/review/notes';
import { comparisonUnsaved } from '../../src/features/compare/unsaved';
import { cancelClosePrompts, requestCloseMany } from '../../src/features/open/openDocument';
import { openStore } from '../../src/features/open/openStore';
import { currentPage, parsePage, READ_AT } from '../../src/model/compare/pageCounter';
import type { Affine } from '../../src/model/compare/material';

const meta = (id: string) => ({
  id,
  name: `${id}.pdf`,
  pageCount: 3,
  permissions: -1,
  signatureCount: 0,
});
const store = () => documentStore.getState();
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('click to zoom (the close-out list)', () => {
  it('turns an annotation rectangle into a box and maps it through the alignment', () => {
    const box = rectBox({ origin: { x: 10, y: 20 }, size: { width: 30, height: 40 } });
    expect(box).toEqual([10, 20, 40, 60]);
    // Twice the size, shifted by (5, 7).
    const m: Affine = [2, 0, 0, 2, 5, 7];
    expect(mapBox(m, box)).toEqual([25, 47, 85, 127]);
    // A quarter turn: the box around the turned corners.
    const turn: Affine = [0, 1, -1, 0, 100, 0];
    expect(mapBox(turn, [0, 0, 10, 20])).toEqual([80, 0, 100, 10]);
  });

  it('zooms a text comparison in only for a small comment, at most twice and 400 %', () => {
    // A 24 px note in an 800 × 600 window at 120 %: zoomed in, twice at most.
    expect(textZoomFor(1.2, 24, 24, 800, 600)).toBeCloseTo(2.4);
    // A comment already a fair part of the window: no zoom.
    expect(textZoomFor(1.2, 200, 30, 800, 600)).toBeNull();
    // Never past 400 %.
    expect(textZoomFor(3, 10, 10, 800, 600)).toBe(4);
    // Already at 400 %: nothing to do.
    expect(textZoomFor(4, 10, 10, 800, 600)).toBeNull();
    // Just under an eighth of the window: still at most twice.
    expect(textZoomFor(1, 90, 60, 800, 600)).toBe(2);
    // A third of the window wanted, if that is nearer than twice the zoom.
    expect(textZoomFor(3.5, 10, 10, 800, 600)).toBe(4);
  });
});

describe('Page n of m and Go to page (text comparison)', () => {
  // Three 800 pt pages with 10 pt gaps, at 1 px per pt, the stack 16 px down.
  const stack = { tops: [0, 810, 1620], heights: [800, 800, 800] };
  const w = { scrollTop: 0, clientHeight: 600, scrollHeight: 2436, off: 16, scale: 1 };

  it('reads the page a quarter of the way down the window', () => {
    expect(currentPage(stack, w)).toBe(0);
    // Page 2's top at the window's top.
    expect(currentPage(stack, { ...w, scrollTop: 16 + 810 })).toBe(1);
    // Page 2 still fills the top quarter.
    expect(currentPage(stack, { ...w, scrollTop: 16 + 810 + 700 - 600 * READ_AT })).toBe(1);
    expect(currentPage(stack, { ...w, scrollTop: 16 + 1620 - 600 * READ_AT + 1 })).toBe(2);
  });

  it('says the last page once the window is at the end', () => {
    expect(currentPage(stack, { ...w, scrollTop: 2436 - 600 })).toBe(2);
    expect(currentPage({ tops: [], heights: [] }, w)).toBe(0);
  });

  it('takes a typed page from 1 to the page count', () => {
    expect(parsePage('12', 140)).toBe(11);
    expect(parsePage(' 1 ', 140)).toBe(0);
    expect(parsePage('140', 140)).toBe(139);
    expect(parsePage('141', 140)).toBeNull();
    expect(parsePage('0', 140)).toBeNull();
    expect(parsePage('2.5', 140)).toBeNull();
    expect(parsePage('', 140)).toBeNull();
    expect(parsePage('abc', 140)).toBeNull();
  });
});

describe('the unsaved mark and closing a comparison', () => {
  let off: () => void = () => undefined;
  beforeEach(() => {
    cancelClosePrompts();
    closePromptStore.setState({ queue: [] });
    notesStore.setState({ byId: {} });
    documentStore.setState({
      docs: {},
      order: [],
      activeId: null,
      activeTab: null,
      comparisons: {},
    });
    off = registerCompareCommands();
  });
  afterEach(() => {
    off();
  });

  const withNotes = () => {
    store().openWithoutTab(meta('a'));
    store().openWithoutTab(meta('b'));
    store().openWithoutTab(meta('notes'));
    store().openComparison({ ...newComparison('cmp', 'overlay', ['a'], ['b']), stage: 'result' });
    notesStore.setState({ byId: { cmp: { key: 'k', status: 'ready', docId: 'notes' } } });
  };

  it('marks the comparison tab while A, B or the overlay notes are unsaved', () => {
    withNotes();
    const c = store().comparisons.cmp;
    if (!c) throw new Error('no comparison');
    expect(comparisonUnsaved(c, store().docs)).toBe(false);
    store().markDirty('b');
    expect(comparisonUnsaved(c, store().docs)).toBe(true);
    store().markSaved('b', store().docs.b?.edits ?? 0);
    expect(comparisonUnsaved(c, store().docs)).toBe(false);
    store().markDirty('notes');
    expect(comparisonUnsaved(c, store().docs)).toBe(true);
  });

  it('closes at once when nothing is unsaved', async () => {
    withNotes();
    expect(unsavedOnlyHere('cmp')).toBeNull();
    requestCloseMany(['cmp']);
    await settle();
    expect(store().comparisons).toEqual({});
    expect(closePromptStore.getState().queue).toEqual([]);
  });

  it('asks before losing comments drawn on the overlay; Cancel keeps the comparison', async () => {
    withNotes();
    store().markDirty('notes');
    expect(unsavedOnlyHere('cmp')).toBe('notes');
    requestCloseMany(['cmp']);
    await settle();
    expect(closePromptStore.getState().queue).toEqual(['cmp']);
    expect(store().comparisons.cmp).toBeDefined();
    keepComparison('cmp');
    expect(closePromptStore.getState().queue).toEqual([]);
    expect(store().comparisons.cmp).toBeDefined();
  });

  it("Don't save closes it; Document A's own unsaved changes are still asked about", async () => {
    withNotes();
    store().markDirty('notes');
    store().markDirty('a');
    requestCloseMany(['cmp']);
    await settle();
    closeWithoutSaving('cmp');
    await settle();
    expect(store().comparisons).toEqual({});
    expect(openStore.getState().closePrompt).toBe('a');
  });
});
