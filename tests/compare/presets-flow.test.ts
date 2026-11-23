// Comparison presets in the app (M12-21, D-58, Q35): a result's settings as
// a preset holds them, the preset picked in the input window applied once
// when Compare runs (ignore zones placed on the result's sheets), and the
// default settings picked after a preset.
import { beforeEach, describe, expect, it } from 'vitest';
import { diffView, updateDiff, withZones } from '../../src/features/compare/diff/diffState';
import { newComparison } from '../../src/features/compare/model';
import {
  overlayView,
  setColour,
  updateView,
} from '../../src/features/compare/overlay/overlayState';
import { pairingStore, type PairingState } from '../../src/features/compare/pairingFlow';
import {
  DEFAULT_PRESET,
  applyPickedPreset,
  overlaySettings,
  pickPreset,
  presetStore,
  textSettings,
} from '../../src/features/compare/presets/presetStore';
import { textStore, updateTextView } from '../../src/features/compare/text/textFlow';
import { MAGENTA, BLUE, RED, GREEN } from '../../src/model/compare/overlay';
import type { ComparePreset } from '../../src/model/compare/presets';
import { DEFAULT_MARK_COLOURS } from '../../src/model/compare/textView';

const page = (docId: string, p: number) => ({ docId, page: p, file: 0 });

/** Three rows: a sheet, a page only B has, a second sheet. */
function paired(id: string): void {
  const state: PairingState = {
    key: 'k',
    status: 'done',
    done: 1,
    total: 1,
    pages: { a: [page('A', 0), page('A', 1)], b: [page('B', 0), page('B', 1), page('B', 2)] },
    result: null,
    rows: [
      { a: 0, b: 0, excluded: false },
      { a: null, b: 1, excluded: false },
      { a: 1, b: 2, excluded: false },
    ],
  };
  pairingStore.setState((s) => ({ byId: { ...s.byId, [id]: state } }));
}

const drawings: ComparePreset = {
  id: 'p1',
  name: 'Drawings',
  savedAt: 1,
  type: 'overlay',
  overlay: {
    colA: '#ff00ff',
    colB: '#0000ff',
    sensitivity: 'high',
    minSize: 2,
    zones: [
      { box: [0, 0, 50, 50], all: true },
      { box: [10, 10, 20, 20], all: false, sheet: 2 },
    ],
  },
};

const contracts: ComparePreset = {
  id: 'p2',
  name: 'Contracts',
  savedAt: 1,
  type: 'text',
  text: {
    colours: { ...DEFAULT_MARK_COLOURS, moved: '#7030a0' },
    headersFooters: false,
    renumbering: false,
  },
};

beforeEach(() => {
  presetStore.setState({ presets: [drawings, contracts], loaded: true, picked: {}, saving: null });
});

describe('a PDF overlay', () => {
  it('saves its colours, sensitivity, minimum size and zones by sheet number', () => {
    const id = 'cmp-save';
    paired(id);
    updateView(id, (v) => setColour(setColour(v, 'a', MAGENTA), 'b', BLUE));
    updateDiff(id, (v) =>
      withZones({ ...v, sensitivity: 'low', minSize: 1 }, [
        { pair: null, box: [1, 1, 9, 9] },
        { pair: 1, box: [2, 2, 8, 8] },
      ]),
    );
    expect(overlaySettings(id)).toEqual({
      colA: '#ff00ff',
      colB: '#0000ff',
      sensitivity: 'low',
      minSize: 1,
      zones: [
        { box: [1, 1, 9, 9], all: true },
        // Pair 1 is the third sheet (the second row has no A page).
        { box: [2, 2, 8, 8], all: false, sheet: 2 },
      ],
    });
  });

  it('applies the preset picked once, when Compare runs', () => {
    const c = newComparison('cmp-apply', 'overlay', ['A'], ['B']);
    paired(c.id);
    pickPreset(c.id, 'p1');
    applyPickedPreset(c);
    expect(overlayView(c.id).style.colA).toEqual(MAGENTA);
    expect(overlayView(c.id).style.colB).toEqual(BLUE);
    const d = diffView(c.id);
    expect(d.sensitivity).toBe('high');
    expect(d.minSize).toBe(2);
    expect(d.zones.map((z) => [z.pair, z.box])).toEqual([
      [null, [0, 0, 50, 50]],
      [1, [10, 10, 20, 20]],
    ]);
    // Edits in the result survive a second Compare from the revisited inputs.
    updateDiff(c.id, (v) => ({ ...v, sensitivity: 'normal' }));
    applyPickedPreset(c);
    expect(diffView(c.id).sensitivity).toBe('normal');
  });

  it('goes back to the shipped settings when Default settings is picked after a preset', () => {
    const c = newComparison('cmp-default', 'overlay', ['A'], ['B']);
    paired(c.id);
    pickPreset(c.id, 'p1');
    applyPickedPreset(c);
    pickPreset(c.id, DEFAULT_PRESET);
    applyPickedPreset(c);
    expect(overlayView(c.id).style.colA).toEqual(RED);
    expect(overlayView(c.id).style.colB).toEqual(GREEN);
    expect(diffView(c.id)).toMatchObject({ sensitivity: 'normal', minSize: 0, zones: [] });
  });

  it('does nothing when nothing was picked', () => {
    const c = newComparison('cmp-none', 'overlay', ['A'], ['B']);
    updateDiff(c.id, (v) => ({ ...v, sensitivity: 'low' }));
    applyPickedPreset(c);
    expect(diffView(c.id).sensitivity).toBe('low');
  });
});

describe('a text comparison', () => {
  it('saves and applies the mark colours and the header and renumbering handling', () => {
    const c = newComparison('cmp-text', 'text', ['A'], ['B']);
    pickPreset(c.id, 'p2');
    applyPickedPreset(c);
    const v = textStore.getState().views[c.id];
    expect(v?.colours.moved).toBe('#7030a0');
    expect(v?.options).toMatchObject({ headersFooters: false, renumbering: false });
    updateTextView(c.id, (x) => ({ ...x, options: { ...x.options, renumbering: true } }));
    expect(textSettings(c.id)).toEqual({
      colours: { ...DEFAULT_MARK_COLOURS, moved: '#7030a0' },
      headersFooters: false,
      renumbering: true,
    });
  });
});
