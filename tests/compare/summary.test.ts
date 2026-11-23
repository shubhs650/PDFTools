// M12-21 (D-65): the counts of an overlay comparison file's summary page.
import { describe, expect, it } from 'vitest';
import {
  multiplied,
  overlayFacts,
  type SummaryResult,
  type SummarySheet,
} from '../../src/model/compare/summary';

const sheet = (
  pair: number | null,
  a = true,
  b = true,
  status: SummarySheet['status'] = 'asIs',
) => ({
  pair,
  a,
  b,
  status,
});

describe('overlayFacts', () => {
  const sheets: SummarySheet[] = [
    sheet(0),
    sheet(null, true, false),
    sheet(1, true, true, 'aligned'),
    sheet(2, true, true, 'manual'),
    sheet(null, false, true),
    sheet(3, true, true, 'lowConfidence'),
  ];
  const results: Record<number, SummaryResult> = {
    0: {
      entries: [
        { key: 'k1', kind: 'added', type: 'text' },
        { key: 'k2', kind: 'removed', type: 'geometry' },
      ],
    },
    1: { entries: [] },
    3: { entries: [{ key: 'k3', kind: 'changed', type: 'both' }] },
  };

  it('counts sheets, differences by kind and type, and ticks', () => {
    const f = overlayFacts(sheets, results, (p, k) => p === 0 && k === 'k2', []);
    expect(f).toMatchObject({
      sheets: 6,
      compared: 4,
      onlyA: 1,
      onlyB: 1,
      changed: 2,
      unchanged: 1,
      pending: 1,
      differences: 3,
      kinds: { added: 1, removed: 1, changed: 1 },
      types: { text: 1, geometry: 1, both: 1 },
      checked: 1,
      placement: { asIs: 1, aligned: 1, manual: 1, lowConfidence: 1 },
    });
  });

  it('names ignore zones by sheet number (1-based, in the sheet list)', () => {
    const f = overlayFacts(sheets, results, () => false, [
      { pair: null },
      { pair: 3 },
      { pair: 1 },
      { pair: 3 },
      { pair: 9 },
    ]);
    // pair 1 is sheet 3; pair 3 is sheet 6; an unknown pair is left out.
    expect(f.zones).toEqual({
      every: 1,
      sheets: [
        [3, 1],
        [6, 2],
      ],
    });
  });

  it('is all zero for an empty comparison', () => {
    const f = overlayFacts([], {}, () => false, []);
    expect(f.differences).toBe(0);
    expect(f.zones).toEqual({ every: 0, sheets: [] });
  });
});

describe('multiplied', () => {
  it('is black for red over green, and the colour itself over white', () => {
    expect(multiplied([255, 0, 0], [0, 255, 0])).toEqual([0, 0, 0]);
    expect(multiplied([0, 102, 255], [255, 255, 255])).toEqual([0, 102, 255]);
    expect(multiplied([255, 128, 0], [0, 128, 255])).toEqual([0, 64, 0]);
  });
});
