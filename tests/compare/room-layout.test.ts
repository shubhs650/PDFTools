// M12-25 (ADR-033, D-62): room to work. The comparison panes' fold and width state, the
// left-pane sections, the app's left pane on comparison tabs, and the overlay's colour key.
import { describe, expect, it } from 'vitest';
import { paneStep } from '../../src/features/compare/layout/appPanes';
import {
  EMPTY_LAYOUT,
  PANE_DEFAULT_WIDTH,
  foldKey,
  keepLayouts,
  layoutOf,
  layoutStore,
  paneWidth,
  sectionOpen,
  setFolded,
  setPaneWidth,
  setSection,
  updateLayout,
} from '../../src/features/compare/layout/layoutStore';
import { PANE_WIDTH_MAX, PANE_WIDTH_MIN } from '../../src/app/paneSize';
import { BLUE, GREEN, MAGENTA, RED, keyColours } from '../../src/model/compare/overlay';

describe('comparison panes', () => {
  it('fold and open again; an unchanged state is the same object', () => {
    const folded = setFolded(EMPTY_LAYOUT, 'diffs', true);
    expect(folded.folded.diffs).toBe(true);
    expect(setFolded(folded, 'diffs', true)).toBe(folded);
    expect(setFolded(folded, 'diffs', false).folded.diffs).toBe(false);
    expect(setFolded(EMPTY_LAYOUT, 'sheets', false)).toBe(EMPTY_LAYOUT);
  });

  it('keep their default width until dragged, within the side pane limits', () => {
    expect(paneWidth(EMPTY_LAYOUT, 'sheets')).toBe(PANE_DEFAULT_WIDTH.sheets);
    expect(paneWidth(setPaneWidth(EMPTY_LAYOUT, 'sheets', 333.4), 'sheets')).toBe(333);
    expect(paneWidth(setPaneWidth(EMPTY_LAYOUT, 'changes', 9999), 'changes')).toBe(PANE_WIDTH_MAX);
    expect(paneWidth(setPaneWidth(EMPTY_LAYOUT, 'closeout', 10), 'closeout')).toBe(PANE_WIDTH_MIN);
  });

  it('fold key changes when any pane folds (the overlay is fitted again)', () => {
    const a = foldKey(EMPTY_LAYOUT);
    expect(foldKey(setFolded(EMPTY_LAYOUT, 'closeout', true))).not.toBe(a);
    expect(foldKey(setPaneWidth(EMPTY_LAYOUT, 'closeout', 400))).toBe(a);
  });

  it('are remembered per comparison and forgotten when it closes', () => {
    updateLayout('c1', (l) => setFolded(l, 'sheets', true));
    updateLayout('c2', (l) => setPaneWidth(l, 'diffs', 400));
    expect(layoutOf('c1').folded.sheets).toBe(true);
    expect(layoutOf('c2').folded.sheets).toBeUndefined();
    keepLayouts((id) => id === 'c2');
    expect(layoutOf('c1')).toBe(EMPTY_LAYOUT);
    expect(layoutOf('c2').widths.diffs).toBe(400);
    keepLayouts(() => false);
    expect(layoutStore.getState().byId).toEqual({});
  });
});

describe('left-pane sections', () => {
  it('follow their default until opened or closed by hand', () => {
    expect(sectionOpen(EMPTY_LAYOUT, 'align', false)).toBe(false);
    expect(sectionOpen(EMPTY_LAYOUT, 'layers', true)).toBe(true);
    const open = setSection(EMPTY_LAYOUT, 'align', true);
    expect(sectionOpen(open, 'align', false)).toBe(true);
    expect(sectionOpen(setSection(open, 'layers', false), 'layers', true)).toBe(false);
    expect(setSection(open, 'align', true)).toBe(open);
  });
});

describe("the app's left pane on comparison tabs", () => {
  it('closes on a comparison tab and comes back as it was on a document tab', () => {
    let s = paneStep({ saved: null }, true, true);
    expect(s).toEqual({ open: false, mem: { saved: true } });
    // Opened from the rail on the comparison, then another comparison: it closes again.
    s = paneStep(s.mem, true, true);
    expect(s).toEqual({ open: false, mem: { saved: true } });
    // Back on a document: as it was there.
    s = paneStep(s.mem, false, false);
    expect(s).toEqual({ open: true, mem: { saved: null } });
  });

  it('stays closed on a document if it was closed there', () => {
    const s = paneStep({ saved: null }, false, true);
    expect(paneStep(s.mem, true, false)).toEqual({ open: false, mem: { saved: null } });
  });

  it('is left alone between documents', () => {
    expect(paneStep({ saved: null }, true, false)).toEqual({ open: true, mem: { saved: null } });
    expect(paneStep({ saved: null }, false, false)).toEqual({ open: false, mem: { saved: null } });
  });
});

describe('the colour key', () => {
  it('names each side by its colour and their overlap black', () => {
    expect(keyColours({ colA: RED, colB: GREEN, fade: 0 })).toEqual({
      a: RED,
      b: GREEN,
      both: [0, 0, 0],
    });
    expect(keyColours({ colA: MAGENTA, colB: GREEN, fade: 0 }).both).toEqual([0, 0, 0]);
    expect(keyColours({ colA: RED, colB: BLUE, fade: 0 }).both).toEqual([0, 0, 0]);
  });

  it('shows Fade unchanged as grey, and custom colours as they multiply', () => {
    expect(keyColours({ colA: RED, colB: GREEN, fade: 1 }).both).toEqual([200, 200, 200]);
    expect(keyColours({ colA: [255, 128, 0], colB: [0, 128, 255], fade: 0 }).both).toEqual([
      0, 64, 0,
    ]);
  });
});
