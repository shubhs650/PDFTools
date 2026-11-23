// O1 compare an area (ADR-031 D-60): the rectangles drawn in an overlay
// result (one per side, the other side next), and the comparison they open:
// an overlay of one page of each side, on its result, named after them.
import { beforeEach, describe, expect, it } from 'vitest';
import { documentStore } from '../../src/app/store/documentStore';
import {
  NO_PICK,
  areaStore,
  beginAreas,
  compareAreas,
  pickReady,
  setArea,
  startDrawing,
  stopDrawing,
  updatePick,
} from '../../src/features/compare/area/areaPick';
import {
  documentsOf,
  newAreaComparison,
  newComparison,
  swapSides,
  type PageArea,
} from '../../src/features/compare/model';
import { comparisonTitle } from '../../src/features/compare/title';

const onA: PageArea = { docId: 'A', page: 2, box: [10, 20, 110, 90] };
const onB: PageArea = { docId: 'B', page: 4, box: [300, 200, 400, 270] };

describe('drawing the two rectangles', () => {
  it('goes on to the other side while it has no rectangle', () => {
    let p = startDrawing(NO_PICK, 'a');
    p = setArea(p, 'a', onA);
    expect(p).toEqual({ drawing: 'b', a: onA, b: null });
    expect(pickReady(p)).toBe(false);
    p = setArea(p, 'b', onB);
    expect(p.drawing).toBeNull();
    expect(pickReady(p)).toBe(true);
  });

  it('stops when the other side has one already, or when asked', () => {
    const p = setArea(startDrawing({ drawing: null, a: onA, b: onB }, 'a'), 'a', onA);
    expect(p.drawing).toBeNull();
    expect(stopDrawing(startDrawing(NO_PICK, 'b')).drawing).toBeNull();
    expect(stopDrawing(NO_PICK)).toBe(NO_PICK);
  });

  it('a typed rectangle does not start drawing the other side', () => {
    expect(setArea(NO_PICK, 'a', onA).drawing).toBeNull();
  });
});

describe('the area comparison', () => {
  it('is an overlay of one page of each side, on its result', () => {
    const c = newAreaComparison('cmp-x', onA, onB);
    expect(c).toEqual({
      id: 'cmp-x',
      type: 'overlay',
      stage: 'result',
      a: [{ docId: 'A', range: '3' }],
      b: [{ docId: 'B', range: '5' }],
      area: { a: onA.box, b: onB.box },
    });
    expect(documentsOf(c)).toEqual(['A', 'B']);
    // Swapping the sides swaps the rectangles with them.
    expect(swapSides(c).area).toEqual({ a: onB.box, b: onA.box });
  });

  it('is named after the two files and pages', () => {
    const c = newAreaComparison('cmp-x', onA, onB);
    const names: Record<string, string> = { A: 'RevA.pdf', B: 'RevB.pdf' };
    expect(comparisonTitle(c, (d) => names[d])).toBe('RevA 3 ↔ RevB 5 (area)');
  });

  describe('opened from a result', () => {
    beforeEach(() => {
      areaStore.setState({ byId: {} });
      // The overlay result the rectangles are drawn in.
      documentStore
        .getState()
        .openComparison({ ...newComparison('host', 'overlay', ['A'], ['B']), stage: 'result' });
    });

    it('starts on A, then opens a tab of its own once both are drawn', () => {
      beginAreas('host');
      expect(areaStore.getState().byId.host?.drawing).toBe('a');
      expect(compareAreas('host')).toBeNull();
      updatePick('host', (p) => setArea(p, 'a', onA));
      // A drawn: B next.
      beginAreas('host');
      expect(areaStore.getState().byId.host?.drawing).toBe('b');
      updatePick('host', (p) => setArea(p, 'b', onB));
      const id = compareAreas('host');
      if (!id) throw new Error('not opened');
      const s = documentStore.getState();
      expect(s.activeTab).toBe(id);
      expect(s.comparisons[id]?.area).toEqual({ a: onA.box, b: onB.box });
      // The rectangles stay, to compare again or draw again.
      expect(areaStore.getState().byId.host).toEqual({ drawing: null, a: onA, b: onB });
    });
  });
});
