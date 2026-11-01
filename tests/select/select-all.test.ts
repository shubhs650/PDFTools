// Ctrl+A then a markup key (M3-08): Select All reads the page's text in the
// Render worker before it sets the selection, and selectionSettled() lets the
// markup command wait for that instead of finding no selection.
import { describe, expect, it, vi } from 'vitest';

let releaseGeometry: () => void = () => undefined;
const setSelection = vi.fn(() => ({ toPromise: () => Promise.resolve() }));

vi.mock('../../src/features/view/host', () => ({
  hostStore: {
    getState: () => ({
      registry: {
        getStore: () => ({
          getState: () => ({
            core: { documents: { d1: { document: { pages: [{ index: 0 }] } } } },
          }),
        }),
      },
    }),
  },
  capability: () => ({ forDocument: () => ({ setSelection, clear: vi.fn() }) }),
  renderEngine: () => ({
    engine: {
      getPageGeometry: () => ({
        toPromise: () =>
          new Promise((resolve) => {
            releaseGeometry = () => {
              resolve({ runs: [{ charStart: 0, glyphs: [{}, {}, {}] }] });
            };
          }),
      }),
    },
  }),
}));
vi.mock('../../src/app/store/documentStore', () => ({
  documentStore: { getState: () => ({ docs: { d1: { view: { page: 0 } } } }) },
  selectActive: () => ({ meta: { id: 'd1' } }),
}));
vi.mock('../../src/features/annotate/transfer/copyPaste', () => ({}));

const { selectPageText, selectionSettled } = await import('../../src/features/select/commands');

describe('selectionSettled (M3-08)', () => {
  it('resolves at once with no Select All in flight', async () => {
    await expect(selectionSettled()).resolves.toBeUndefined();
  });

  it('waits for a Select All still reading the page text', async () => {
    void selectPageText();
    let settled = false;
    const wait = selectionSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(setSelection).not.toHaveBeenCalled();
    releaseGeometry();
    await wait;
    expect(setSelection).toHaveBeenCalledWith({
      start: { page: 0, index: 0 },
      end: { page: 0, index: 2 },
    });
  });
});
