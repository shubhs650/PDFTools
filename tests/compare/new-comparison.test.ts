import { beforeEach, describe, expect, it } from 'vitest';
import { documentStore } from '../../src/app/store/documentStore';
import { newComparisonFrom } from '../../src/features/compare/compareFlow';
import { diffView, updateDiff } from '../../src/features/compare/diff/diffState';
import { newComparison, newAreaComparison } from '../../src/features/compare/model';
import { pairingStore } from '../../src/features/compare/pairingFlow';
import {
  CARRIED_PRESET,
  applyPickedPreset,
  carriedFor,
  presetStore,
} from '../../src/features/compare/presets/presetStore';
import { textStore, updateTextView } from '../../src/features/compare/text/textFlow';
import { cancelClosePrompts, requestCloseMany } from '../../src/features/open/openDocument';

// M12-24 (ADR-033): New comparison replaces "Change inputs": a new comparison
// tab with the same files, pages, type and settings; the result stays open in
// its own tab, and the two share their documents.

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

beforeEach(() => {
  cancelClosePrompts();
  documentStore.setState({ docs: {}, order: [], activeId: null, activeTab: null, comparisons: {} });
  presetStore.setState({ presets: [], loaded: true, picked: {}, carried: {}, saving: null });
  pairingStore.setState({ byId: {} });
});

describe('New comparison', () => {
  it('opens a new tab after the result with the same files, pages and type', () => {
    store().openWithoutTab(meta('A'));
    store().open(meta('B'));
    const c = { ...newComparison('cmp', 'overlay', ['A'], ['B']), stage: 'result' as const };
    store().openComparison({ ...c, a: [{ docId: 'A', range: '2-3' }] });
    const next = newComparisonFrom('cmp');
    expect(next).not.toBeNull();
    const made = store().comparisons[next ?? ''];
    expect(made).toMatchObject({
      type: 'overlay',
      stage: 'input',
      a: [{ docId: 'A', range: '2-3' }],
      b: [{ docId: 'B', range: '' }],
    });
    expect(made?.area).toBeUndefined();
    // Right after the result, and selected; the result is unchanged.
    expect(store().order).toEqual(['B', 'cmp', next]);
    expect(store().activeTab).toBe(next);
    expect(store().comparisons.cmp?.stage).toBe('result');
  });

  it('is not offered for an area comparison', () => {
    store().openWithoutTab(meta('A'));
    store().openWithoutTab(meta('B'));
    const box: [number, number, number, number] = [0, 0, 10, 10];
    store().openComparison(
      newAreaComparison('area', { docId: 'A', page: 0, box }, { docId: 'B', page: 0, box }),
    );
    expect(newComparisonFrom('area')).toBeNull();
    expect(Object.keys(store().comparisons)).toEqual(['area']);
  });

  it('closing either comparison keeps the documents the other one uses', async () => {
    store().openWithoutTab(meta('A'));
    store().openWithoutTab(meta('B'));
    store().openComparison({ ...newComparison('cmp', 'text', ['A'], ['B']), stage: 'result' });
    const next = newComparisonFrom('cmp') ?? '';
    requestCloseMany(['cmp']);
    await settle();
    expect(Object.keys(store().docs).sort()).toEqual(['A', 'B']);
    requestCloseMany([next]);
    await settle();
    expect(store().docs).toEqual({});
  });

  it('carries the overlay result’s settings, applied once when the new one is compared', () => {
    store().openWithoutTab(meta('A'));
    store().openWithoutTab(meta('B'));
    store().openComparison({ ...newComparison('cmp', 'overlay', ['A'], ['B']), stage: 'result' });
    updateDiff('cmp', (v) => ({ ...v, sensitivity: 'high', minSize: 2 }));
    const next = newComparisonFrom('cmp') ?? '';
    expect(presetStore.getState().picked[next]).toEqual({ id: CARRIED_PRESET, pending: true });
    const carried = carriedFor(presetStore.getState(), next, 'overlay');
    expect(carried?.type === 'overlay' && carried.overlay).toMatchObject({
      sensitivity: 'high',
      minSize: 2,
    });
    // Not for the other type (the input window's type switch).
    expect(carriedFor(presetStore.getState(), next, 'text')).toBeNull();
    const made = store().comparisons[next];
    if (made) applyPickedPreset(made);
    expect(diffView(next)).toMatchObject({ sensitivity: 'high', minSize: 2 });
    expect(presetStore.getState().picked[next]?.pending).toBe(false);
  });

  it('carries a text comparison’s options', () => {
    store().openWithoutTab(meta('A'));
    store().openWithoutTab(meta('B'));
    store().openComparison({ ...newComparison('cmp', 'text', ['A'], ['B']), stage: 'result' });
    updateTextView('cmp', (v) => ({ ...v, options: { ...v.options, renumbering: false } }));
    const next = newComparisonFrom('cmp') ?? '';
    const made = store().comparisons[next];
    if (made) applyPickedPreset(made);
    expect(textStore.getState().views[next]?.options.renumbering).toBe(false);
  });
  // The pairing table carried over as edited: e2e compare-pairing.spec.ts.
});
