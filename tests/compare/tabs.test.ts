import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandState, runCommand } from '../../src/app/commands/dispatch';
import { documentStore, inComparison } from '../../src/app/store/documentStore';
import { registerTabCommands, tabName } from '../../src/app/tabCommands';
import { COMPARISON_TAB_MENU, tabCommandState } from '../../src/app/tabMenu';
import { registerCompareCommands } from '../../src/features/compare/commands';
import { addOpenDocument, updateInputs } from '../../src/features/compare/compareFlow';
import { newComparison, removeFile } from '../../src/features/compare/model';
import { clearClosed, closedCount } from '../../src/features/open/closedTabs';
import { cancelClosePrompts, requestCloseMany } from '../../src/features/open/openDocument';
import { openStore } from '../../src/features/open/openStore';

// M12-08 (D-58, S27 change 1): comparison tabs in the strip, the active tab apart from
// the active document, documents without a tab of their own, and what closing closes.

const meta = (id: string) => ({
  id,
  name: `${id}.pdf`,
  pageCount: 2,
  permissions: -1,
  signatureCount: 0,
});
const store = () => documentStore.getState();
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let offs: (() => void)[] = [];
beforeEach(() => {
  cancelClosePrompts();
  clearClosed();
  documentStore.setState({ docs: {}, order: [], activeId: null, activeTab: null, comparisons: {} });
  offs = [registerTabCommands(), registerCompareCommands()];
});
afterEach(() => {
  for (const off of offs) off();
});

describe('the active tab and the active document (S27 change 1)', () => {
  it('a document tab is both; a comparison tab is the tab shown with no document', () => {
    store().open(meta('a'));
    expect(store()).toMatchObject({ activeTab: 'a', activeId: 'a' });
    store().openComparison(newComparison('cmp', 'overlay'));
    expect(store().order).toEqual(['a', 'cmp']);
    expect(store()).toMatchObject({ activeTab: 'cmp', activeId: null });
    store().activate('a');
    expect(store()).toMatchObject({ activeTab: 'a', activeId: 'a' });
  });

  it('opens a comparison after the selected tab, or at a given place', () => {
    store().open(meta('a'));
    store().open(meta('b'));
    store().activate('a');
    store().openComparison(newComparison('c1', 'text'));
    expect(store().order).toEqual(['a', 'c1', 'b']);
    store().openComparison(newComparison('c2', 'text'), 0);
    expect(store().order).toEqual(['c2', 'a', 'c1', 'b']);
  });

  it('a document without a tab is open but not in the strip, and selecting it does nothing', () => {
    store().open(meta('a'));
    store().openWithoutTab(meta('x'));
    expect(Object.keys(store().docs)).toEqual(['a', 'x']);
    expect(store().order).toEqual(['a']);
    store().activate('x');
    expect(store().activeTab).toBe('a');
    store().showTab('x');
    expect(store()).toMatchObject({ order: ['a', 'x'], activeTab: 'x', activeId: 'x' });
  });

  it('focusDocument makes a comparison’s document the one commands act on, the tab stays', () => {
    store().openWithoutTab(meta('x'));
    store().openComparison(newComparison('cmp', 'overlay', ['x']));
    store().focusDocument('x');
    expect(store()).toMatchObject({ activeTab: 'cmp', activeId: 'x' });
  });

  it('closing the selected comparison selects its neighbour', async () => {
    store().open(meta('a'));
    store().openComparison(newComparison('cmp', 'overlay'));
    store().open(meta('b'));
    store().activate('a');
    expect(await runCommand('tab.moveRight', { tab: 'a' })).toBe(true);
    expect(store().order).toEqual(['cmp', 'a', 'b']);
    store().activate('cmp');
    store().closeComparison('cmp');
    expect(store()).toMatchObject({ order: ['a', 'b'], activeTab: 'a', activeId: 'a' });
  });

  it('a closed document leaves every comparison it was on', () => {
    store().openWithoutTab(meta('x'));
    store().openComparison(newComparison('cmp', 'overlay', ['x']));
    expect(inComparison(store(), 'x')).toBe(true);
    store().close('x');
    expect(store().comparisons.cmp?.a).toEqual([]);
  });
});

describe('closing (D-58: one document in its tab and in a comparison)', () => {
  it('closing a comparison closes its documents that have no tab, and keeps the others', async () => {
    store().open(meta('tabbed'));
    store().openWithoutTab(meta('dropped'));
    store().openComparison(newComparison('cmp', 'overlay', ['dropped'], ['tabbed']));
    requestCloseMany(['cmp']);
    await settle();
    expect(store().comparisons).toEqual({});
    expect(Object.keys(store().docs)).toEqual(['tabbed']);
    expect(closedCount()).toBe(0); // a document that only had a comparison has no tab to reopen
  });

  it('closing a document’s tab while a comparison shows it only takes the tab away', async () => {
    store().open(meta('a'));
    store().openComparison(newComparison('cmp', 'text', ['a']));
    store().activate('a');
    store().markDirty('a');
    requestCloseMany(['a']);
    await settle();
    expect(openStore.getState().closePrompt).toBeNull(); // nothing to ask: it stays open
    expect(store().order).toEqual(['cmp']);
    expect(store().docs.a).toBeDefined();
    expect(store().activeTab).toBe('cmp');
    // Taking it off the comparison then closes it, with the unsaved-changes prompt.
    updateInputs('cmp', (c) => removeFile(c, 'a', 'a'));
    expect(openStore.getState().closePrompt).toBe('a');
    // Cancel keeps it open, with a tab so it can be reached.
    cancelClosePrompts();
    expect(store().order).toEqual(['cmp', 'a']);
  });

  it('Close All closes comparisons and documents, in any order', async () => {
    store().openWithoutTab(meta('x'));
    store().open(meta('a'));
    store().openComparison(newComparison('cmp', 'overlay', ['a'], ['x']), 0);
    expect(await runCommand('tab.closeAll')).toBe(true);
    await settle();
    expect(store()).toMatchObject({ docs: {}, order: [], comparisons: {}, activeTab: null });
  });
});

describe('commands for comparison tabs (M12-08)', () => {
  it('Compare → PDF Overlay and Text Comparison open a comparison tab, no document needed', async () => {
    expect(commandState('compare.overlay').enabled).toBe(true);
    expect(await runCommand('compare.text')).toBe(true);
    const id = store().activeTab ?? '';
    expect(store().comparisons[id]).toMatchObject({ type: 'text', stage: 'input', a: [], b: [] });
    expect(tabName(id)).toBe('Text Comparison');
  });

  it('Compare with… puts the tab’s document on Document A', async () => {
    store().open(meta('rev-a'));
    store().open(meta('rev-b'));
    expect(await runCommand('tab.compareWith', { tab: 'rev-a' })).toBe(true);
    const id = store().activeTab ?? '';
    expect(store().comparisons[id]?.a.map((f) => f.docId)).toEqual(['rev-a']);
    addOpenDocument(id, 'b', 'rev-b');
    expect(tabName(id)).toBe('rev-a ↔ rev-b');
    // On a comparison tab, Compare with… has no document to start from.
    expect(commandState('tab.compareWith', undefined, { tab: id }).enabled).toBe(false);
  });

  it('a comparison tab’s menu has the tab commands, which work on it', async () => {
    store().open(meta('a'));
    store().openComparison(newComparison('cmp', 'overlay'));
    const ids = COMPARISON_TAB_MENU.flatMap((e) => (e.kind === 'separator' ? [] : [e.id]));
    expect(ids).not.toContain('file.save');
    expect(ids).toContain('tab.closeOthers');
    const world = {
      order: store().order,
      docs: store().docs,
      comparisons: store().comparisons,
      closedCount: 0,
    };
    expect(tabCommandState('tab.moveLeft', 'cmp', world).enabled).toBe(true);
    expect(tabCommandState('tab.rename', 'cmp', world).enabled).toBe(false);
    expect(await runCommand('tab.moveLeft', { tab: 'cmp' })).toBe(true);
    expect(store().order).toEqual(['cmp', 'a']);
    expect(await runCommand('tab.closeOthers', { tab: 'cmp' })).toBe(true);
    await settle();
    expect(store().order).toEqual(['cmp']);
  });
});
