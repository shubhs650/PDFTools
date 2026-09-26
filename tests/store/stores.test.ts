import { describe, expect, it } from 'vitest';
import {
  createAppStore,
  PANE_WIDTH_DEFAULT,
  PANE_WIDTH_MAX,
  PANE_WIDTH_MIN,
} from '../../src/app/store/appStore';
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

  it('an edit made during a save keeps the document dirty; Save As renames the tab', () => {
    const s = createDocumentStore();
    s.getState().open(meta('a'));
    s.getState().markDirty('a');
    const atStart = s.getState().docs.a?.edits ?? 0;
    s.getState().markDirty('a'); // while saving
    s.getState().markSaved('a', 10, atStart);
    expect(s.getState().docs.a?.dirty).toBe(true);
    s.getState().markSaved('a', 10, s.getState().docs.a?.edits);
    expect(s.getState().docs.a?.dirty).toBe(false);
    s.getState().rename('a', 'copy.pdf');
    expect(s.getState().docs.a?.meta.name).toBe('copy.pdf');
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

  it('chooses a left pane; choosing the pane shown closes the area (M2-08)', () => {
    const s = createAppStore();
    expect(s.getState()).toMatchObject({ leftPaneOpen: true, leftPane: 'rail.thumbnails' });
    s.getState().choosePane('rail.thumbnails');
    expect(s.getState().leftPaneOpen).toBe(false);
    s.getState().choosePane('rail.bookmarks');
    expect(s.getState()).toMatchObject({ leftPaneOpen: true, leftPane: 'rail.bookmarks' });
    s.getState().choosePane('rail.thumbnails');
    expect(s.getState()).toMatchObject({ leftPaneOpen: true, leftPane: 'rail.thumbnails' });
  });

  it('clamps the left pane width', () => {
    const s = createAppStore();
    expect(s.getState().leftPaneWidth).toBe(PANE_WIDTH_DEFAULT);
    s.getState().setLeftPaneWidth(10);
    expect(s.getState().leftPaneWidth).toBe(PANE_WIDTH_MIN);
    s.getState().setLeftPaneWidth(9999);
    expect(s.getState().leftPaneWidth).toBe(PANE_WIDTH_MAX);
    s.getState().setLeftPaneWidth(250.4);
    expect(s.getState().leftPaneWidth).toBe(250);
  });
});
