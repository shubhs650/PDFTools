// Comparison presets (M12-21, D-58, Q35): validated on the way in from
// IndexedDB, saved again under the same name, ignore zones kept by sheet
// number and placed on another result's sheets.
import { describe, expect, it } from 'vitest';
import { namedPreset, presetOf, presetsFor, presetsOf } from '../../src/model/compare/presets';
import { placeZones, storeZones } from '../../src/model/compare/detect/zoneSets';
import { DEFAULT_MARK_COLOURS } from '../../src/model/compare/textView';

const overlay = {
  id: 'p1',
  name: 'Title block',
  savedAt: 5,
  type: 'overlay',
  overlay: {
    colA: '#FF0000',
    colB: '#00ff00',
    sensitivity: 'high',
    minSize: 1,
    zones: [
      { box: [10, 20, 30, 40], all: true },
      { box: [0, 0, 5, 5], all: false, sheet: 2 },
    ],
  },
};

const text = {
  id: 'p2',
  name: 'Contracts',
  savedAt: 6,
  type: 'text',
  text: { colours: DEFAULT_MARK_COLOURS, headersFooters: false, renumbering: true },
};

describe('presetOf: a stored record', () => {
  it('keeps a valid overlay preset, colours in lower case', () => {
    const p = presetOf(overlay);
    expect(p).toMatchObject({ type: 'overlay', name: 'Title block' });
    expect(p?.type === 'overlay' && p.overlay.colA).toBe('#ff0000');
    expect(p?.type === 'overlay' && p.overlay.zones).toHaveLength(2);
  });

  it('keeps a valid text preset', () => {
    expect(presetOf(text)).toEqual(text);
  });

  it('turns away what is not a preset', () => {
    expect(presetOf(null)).toBeNull();
    expect(presetOf({ ...overlay, name: '   ' })).toBeNull();
    expect(presetOf({ ...overlay, type: 'other' })).toBeNull();
    expect(presetOf({ ...overlay, overlay: { ...overlay.overlay, colA: 'red' } })).toBeNull();
    expect(
      presetOf({ ...overlay, overlay: { ...overlay.overlay, sensitivity: 'max' } }),
    ).toBeNull();
    expect(presetOf({ ...overlay, overlay: { ...overlay.overlay, minSize: -1 } })).toBeNull();
    expect(
      presetOf({ ...text, text: { ...text.text, colours: { ...DEFAULT_MARK_COLOURS, moved: 1 } } }),
    ).toBeNull();
    expect(presetOf({ ...text, text: { ...text.text, renumbering: 'yes' } })).toBeNull();
  });

  it('drops zones that are not zones and cuts a long name', () => {
    const p = presetOf({
      ...overlay,
      name: 'x'.repeat(200),
      overlay: { ...overlay.overlay, zones: [{ box: [1, 1, 1, 9], all: true }, { box: 'no' }] },
    });
    expect(p?.name).toHaveLength(80);
    expect(p?.type === 'overlay' && p.overlay.zones).toEqual([]);
  });
});

describe('presetsOf and presetsFor', () => {
  it('keeps valid ones by name and picks a type', () => {
    const list = presetsOf([text, overlay, { id: 'bad' }]);
    expect(list.map((p) => p.name)).toEqual(['Contracts', 'Title block']);
    expect(presetsFor(list, 'text').map((p) => p.id)).toEqual(['p2']);
  });
});

describe('namedPreset: saving from a result', () => {
  const have = presetsOf([overlay, text]);
  const settings = {
    type: 'overlay' as const,
    overlay: {
      colA: '#ff00ff',
      colB: '#00ff00',
      sensitivity: 'normal' as const,
      minSize: 0,
      zones: [],
    },
  };

  it('replaces a preset of the same type and name, keeping its id', () => {
    const p = namedPreset(have, ' Title block ', settings, () => 'new', 9);
    expect(p).toMatchObject({ id: 'p1', name: 'Title block', savedAt: 9 });
  });

  it('makes a new one for a new name, or the same name of the other type', () => {
    expect(namedPreset(have, 'Other', settings, () => 'new', 9)?.id).toBe('new');
    expect(namedPreset(have, 'Contracts', settings, () => 'new', 9)?.id).toBe('new');
  });

  it('needs a name', () => {
    expect(namedPreset(have, '  ', settings, () => 'new', 9)).toBeNull();
  });

  it('round-trips through the validation', () => {
    const p = namedPreset(have, 'Again', settings, () => 'new', 9);
    expect(p).not.toBeNull();
    expect(presetOf(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe('storeZones and placeZones: zones by sheet number', () => {
  it('stores a sheet’s zone by its number and leaves out a pair not shown', () => {
    const sheetOf = (pair: number): number => [0, 2][pair] ?? -1;
    expect(
      storeZones(
        [
          { pair: null, box: [0, 0, 9, 9] },
          { pair: 1, box: [1, 1, 5, 5] },
          { pair: 7, box: [2, 2, 6, 6] },
        ],
        sheetOf,
      ),
    ).toEqual([
      { box: [0, 0, 9, 9], all: true },
      { box: [1, 1, 5, 5], all: false, sheet: 2 },
    ]);
  });

  it('places them on another result: a missing sheet or a one-sided sheet is left out', () => {
    const pairs = [0, null, 1];
    expect(
      placeZones(
        [
          { box: [0, 0, 9, 9], all: true },
          { box: [1, 1, 5, 5], all: false, sheet: 2 },
          { box: [1, 1, 5, 5], all: false, sheet: 1 },
          { box: [1, 1, 5, 5], all: false, sheet: 8 },
        ],
        (k) => pairs[k],
      ),
    ).toEqual([
      { pair: null, box: [0, 0, 9, 9] },
      { pair: 1, box: [1, 1, 5, 5] },
    ]);
  });
});
