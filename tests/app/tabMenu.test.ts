import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentStore, type DocumentSlice } from '../../src/app/store/documentStore';
import {
  renameTarget,
  sortedByName,
  STRIP_MENU,
  tabCommandState,
  tabMenuEntries,
  tabsToClose,
  type TabWorld,
} from '../../src/app/tabMenu';
import { commandState, runCommand } from '../../src/app/commands/dispatch';
import { registerTabCommands } from '../../src/app/tabCommands';
import {
  clearClosed,
  closedCount,
  rememberClosed,
  takeLastClosed,
} from '../../src/features/open/closedTabs';
import {
  closeDocument,
  nextClosePrompt,
  cancelClosePrompts,
  requestCloseMany,
} from '../../src/features/open/openDocument';
import { openStore } from '../../src/features/open/openStore';
import { sources } from '../../src/features/open/sources';

const slice = (id: string, name = `${id}.pdf`): DocumentSlice => ({
  meta: { id, name, pageCount: 1, permissions: -1, signatureCount: 0 },
  view: { page: 0, zoom: 'fitWidth', scale: 1, mode: 'continuous', rotation: 0 },
  dirty: false,
  edits: 0,
  save: 'idle',
  appendedBytes: 0,
});

const worldOf = (names: string[], closedCount = 0): TabWorld => {
  const docs: Record<string, DocumentSlice> = {};
  names.forEach((n, i) => (docs[`d${String(i)}`] = slice(`d${String(i)}`, n)));
  return { order: Object.keys(docs), docs, closedCount };
};

describe('tab menu model (M11-05, D-50)', () => {
  it('lists the plan’s items, Rename only where the file can be renamed in place', () => {
    const ids = (withRename: boolean) =>
      tabMenuEntries(withRename).flatMap((e) => (e.kind === 'separator' ? [] : [e.id]));
    expect(ids(true)).toEqual([
      'file.save',
      'file.saveAs',
      'tab.close',
      'tab.closeOthers',
      'tab.closeRight',
      'tab.closeAll',
      'tab.reopenClosed',
      'tab.moveLeft',
      'tab.moveRight',
      'tab.sortByName',
      'tab.copyName',
      'tab.rename',
      'file.properties',
    ]);
    expect(ids(false)).not.toContain('tab.rename');
    expect(STRIP_MENU.flatMap((e) => (e.kind === 'separator' ? [] : [e.id]))).toEqual([
      'file.open',
      'file.new',
      'tab.reopenClosed',
      'tab.closeAll',
    ]);
  });

  it('sorts in natural order, ignoring case, keeping equal names in place', () => {
    const names: Record<string, string> = {
      a: 'Sheet 10.pdf',
      b: 'sheet 2.pdf',
      c: 'Sheet 1.pdf',
      d: 'Áreas.pdf',
      e: 'areas.pdf',
    };
    expect(sortedByName(['a', 'b', 'c', 'd', 'e'], (id) => names[id] ?? '')).toEqual([
      'd',
      'e',
      'c',
      'b',
      'a',
    ]);
  });

  it('enables each command only where it does something, with a reason otherwise', () => {
    const w = worldOf(['b.pdf', 'a.pdf', 'c.pdf']);
    const st = (id: Parameters<typeof tabCommandState>[0], t: string | null) =>
      tabCommandState(id, t, w);
    expect(st('tab.moveLeft', 'd0')).toMatchObject({ enabled: false, reason: 'frame.menu.first' });
    expect(st('tab.moveRight', 'd0').enabled).toBe(true);
    expect(st('tab.moveRight', 'd2')).toMatchObject({ enabled: false, reason: 'frame.menu.last' });
    expect(st('tab.closeRight', 'd2').enabled).toBe(false);
    expect(st('tab.closeRight', 'd1').enabled).toBe(true);
    expect(st('tab.closeOthers', 'd1').enabled).toBe(true);
    expect(st('tab.sortByName', null).enabled).toBe(true);
    expect(st('tab.reopenClosed', null)).toMatchObject({
      enabled: false,
      reason: 'frame.menu.nothingClosed',
    });
    expect(tabCommandState('tab.reopenClosed', null, { ...w, closedCount: 1 }).enabled).toBe(true);
    const sorted = worldOf(['a.pdf', 'b.pdf']);
    expect(tabCommandState('tab.sortByName', null, sorted)).toMatchObject({
      enabled: false,
      reason: 'frame.menu.sorted',
    });
    const one = worldOf(['a.pdf']);
    expect(tabCommandState('tab.closeOthers', 'd0', one).enabled).toBe(false);
    expect(tabCommandState('tab.closeAll', null, one).enabled).toBe(true);
    expect(tabCommandState('tab.closeAll', null, worldOf([])).enabled).toBe(false);
  });

  it('picks the tabs to close', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(tabsToClose('others', 'b', order)).toEqual(['a', 'c', 'd']);
    expect(tabsToClose('right', 'b', order)).toEqual(['c', 'd']);
    expect(tabsToClose('all', null, order)).toEqual(order);
    expect(tabsToClose('right', 'zz', order)).toEqual([]);
  });

  it('checks a typed file name and keeps it a PDF', () => {
    expect(renameTarget('  Site report ')).toEqual({ name: 'Site report.pdf' });
    expect(renameTarget('Drawing rev B.PDF')).toEqual({ name: 'Drawing rev B.PDF' });
    expect(renameTarget('notes.v2')).toEqual({ name: 'notes.v2.pdf' });
    expect(renameTarget('   ')).toEqual({ error: 'empty' });
    expect(renameTarget('.pdf')).toEqual({ error: 'empty' });
    expect(renameTarget('a/b')).toEqual({ error: 'chars' });
    expect(renameTarget('what?')).toEqual({ error: 'chars' });
    expect(renameTarget('CON')).toEqual({ error: 'reserved' });
    expect(renameTarget('trailing dots...')).toEqual({ name: 'trailing dots.pdf' });
  });
});

describe('closing several tabs (M11-05)', () => {
  beforeEach(() => {
    cancelClosePrompts();
    for (const id of documentStore.getState().order) documentStore.getState().close(id);
    for (const id of ['a', 'b', 'c', 'd']) documentStore.getState().open(slice(id).meta);
  });

  it('closes the saved ones at once and asks about the unsaved ones one by one', async () => {
    documentStore.getState().markDirty('b');
    documentStore.getState().markDirty('d');
    requestCloseMany(['a', 'b', 'c', 'd']);
    await Promise.resolve();
    expect(documentStore.getState().order).toEqual(['b', 'd']);
    expect(openStore.getState()).toMatchObject({ closePrompt: 'b', closeQueue: ['d'] });
    // Don't Save on b: it closes and d is asked about next.
    await closeDocument('b');
    nextClosePrompt();
    expect(openStore.getState()).toMatchObject({ closePrompt: 'd', closeQueue: [] });
    // Cancel on d: it stays, nothing more is asked.
    cancelClosePrompts();
    expect(openStore.getState().closePrompt).toBeNull();
    expect(documentStore.getState().order).toEqual(['d']);
  });

  it('Cancel keeps every unsaved tab still queued', () => {
    for (const id of ['a', 'b', 'c']) documentStore.getState().markDirty(id);
    requestCloseMany(['a', 'b', 'c']);
    cancelClosePrompts();
    expect(documentStore.getState().order).toEqual(['a', 'b', 'c', 'd']);
    expect(openStore.getState().closeQueue).toEqual([]);
  });
});

describe('tab commands act on the menu’s tab (M11-05)', () => {
  let off: () => void = () => undefined;
  beforeEach(() => {
    off = registerTabCommands();
    cancelClosePrompts();
    for (const id of documentStore.getState().order) documentStore.getState().close(id);
    for (const id of ['a', 'b', 'c']) documentStore.getState().open(slice(id).meta);
    documentStore.getState().activate('a');
  });
  afterEach(() => {
    off();
  });

  it('moves the tab it was opened on, not the active one', async () => {
    // The active tab is first: its own Move Left is disabled, but c's is not.
    expect(commandState('tab.moveLeft').enabled).toBe(false);
    expect(await runCommand('tab.moveLeft', { tab: 'c' })).toBe(true);
    expect(documentStore.getState().order).toEqual(['a', 'c', 'b']);
    expect(documentStore.getState().activeId).toBe('a');
  });

  it('Close Other Tabs keeps that tab and selects it', async () => {
    expect(await runCommand('tab.closeOthers', { tab: 'b' })).toBe(true);
    await Promise.resolve();
    expect(documentStore.getState().order).toEqual(['b']);
    expect(documentStore.getState().activeId).toBe('b');
  });

  it('Sort Tabs by Name reorders the row', async () => {
    documentStore.getState().rename('a', 'zeta.pdf');
    expect(await runCommand('tab.sortByName')).toBe(true);
    expect(documentStore.getState().order).toEqual(['b', 'c', 'a']);
    expect(commandState('tab.sortByName').enabled).toBe(false);
  });
});

describe('closed tabs list (M11-05)', () => {
  beforeEach(() => {
    clearClosed();
  });

  it('remembers only tabs with a file handle, newest last, at most 25', () => {
    rememberClosed({ name: 'new.pdf', handle: undefined, source: 'created', index: 0 });
    expect(closedCount()).toBe(0);
    const handle = {} as FileSystemFileHandle;
    for (let i = 0; i < 30; i++)
      rememberClosed({ name: `f${String(i)}.pdf`, handle, source: 'recovered', index: i });
    expect(closedCount()).toBe(25);
    expect(takeLastClosed()).toMatchObject({ name: 'f29.pdf', source: 'picked', index: 29 });
  });

  it('closing a document with a handle lists it', async () => {
    documentStore.getState().open(slice('h').meta);
    sources.set('h', {
      file: new File([], 'h.pdf'),
      handle: {} as FileSystemFileHandle,
      fingerprint: 'x',
      size: 0,
    });
    await closeDocument('h');
    expect(takeLastClosed()).toMatchObject({ name: 'h.pdf' });
  });
});
