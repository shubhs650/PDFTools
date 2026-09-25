import { describe, expect, it } from 'vitest';
import { createAppStore } from '../../src/app/store/appStore';
import { DEFAULT_VIEW, createDocumentStore, selectActive } from '../../src/app/store/documentStore';

const meta = (id: string) => ({
  id,
  name: `${id}.pdf`,
  pageCount: 3,
  permissions: -1,
  signatureCount: 0,
});

describe('document store', () => {
  it('opens documents in order and activates the newest; reopening activates the existing tab', () => {
    const s = createDocumentStore();
    s.getState().open(meta('a'));
    s.getState().open(meta('b'));
    expect(s.getState().order).toEqual(['a', 'b']);
    expect(s.getState().activeId).toBe('b');
    s.getState().open(meta('a'));
    expect(s.getState().order).toEqual(['a', 'b']);
    expect(s.getState().activeId).toBe('a');
    expect(selectActive(s.getState())?.view).toEqual(DEFAULT_VIEW);
  });

  it('closing the active tab activates the right neighbour, else the left one', () => {
    const s = createDocumentStore();
    for (const id of ['a', 'b', 'c']) s.getState().open(meta(id));
    s.getState().activate('b');
    s.getState().close('b');
    expect(s.getState().activeId).toBe('c');
    s.getState().close('c');
    expect(s.getState().activeId).toBe('a');
    s.getState().close('a');
    expect(s.getState().activeId).toBeNull();
    expect(s.getState().docs).toEqual({});
  });

  it('closing an inactive tab keeps the active one', () => {
    const s = createDocumentStore();
    for (const id of ['a', 'b']) s.getState().open(meta(id));
    s.getState().close('a');
    expect(s.getState().activeId).toBe('b');
  });

  it('moves tabs, clamping the index', () => {
    const s = createDocumentStore();
    for (const id of ['a', 'b', 'c']) s.getState().open(meta(id));
    s.getState().move('c', 0);
    expect(s.getState().order).toEqual(['c', 'a', 'b']);
    s.getState().move('c', 99);
    expect(s.getState().order).toEqual(['a', 'b', 'c']);
  });

  it('tracks view state, dirty flag, save state and appended bytes per document', () => {
    const s = createDocumentStore();
    s.getState().open(meta('a'));
    s.getState().open(meta('b'));
    s.getState().setView('a', { page: 5, zoom: 2 });
    s.getState().markDirty('a');
    s.getState().setSaveState('a', 'saving');
    expect(s.getState().docs.a?.view).toEqual({ ...DEFAULT_VIEW, page: 5, zoom: 2 });
    expect(s.getState().docs.b?.view).toEqual(DEFAULT_VIEW);
    s.getState().markSaved('a', 1044);
    s.getState().markSaved('a', 1000);
    expect(s.getState().docs.a).toMatchObject({ dirty: false, save: 'idle', appendedBytes: 2044 });
  });

  it('ignores actions on unknown documents', () => {
    const s = createDocumentStore();
    const before = s.getState();
    s.getState().setView('x', { page: 1 });
    s.getState().markDirty('x');
    s.getState().activate('x');
    s.getState().close('x');
    expect(s.getState().docs).toBe(before.docs);
    expect(s.getState().activeId).toBeNull();
  });
});

describe('app store', () => {
  it('toggles panes and the ribbon', () => {
    const s = createAppStore();
    expect(s.getState()).toMatchObject({
      leftPaneOpen: true,
      propertiesOpen: false,
      ribbonCollapsed: false,
    });
    s.getState().toggleLeftPane();
    s.getState().toggleProperties();
    s.getState().toggleRibbon();
    expect(s.getState()).toMatchObject({
      leftPaneOpen: false,
      propertiesOpen: true,
      ribbonCollapsed: true,
    });
    s.getState().setProperties(false);
    expect(s.getState().propertiesOpen).toBe(false);
  });
});
