// @vitest-environment jsdom
// M6-15: the keyboard sheet (Help → Keyboard Shortcuts) after M6 (M7-12: and M7). It is
// generated from the keymap, so every binding — including M6's full screen,
// cut, context menu and the Bookmarks pane's keys — must have a row with a
// real label (not a raw i18n key) and its chords, and no two rows may read
// the same (label and keys together).
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/i18n';
import { KEYMAP } from '../../src/app/keys/keymap';
import { ShortcutSheet } from '../../src/app/keys/ShortcutSheet';
import { appStore } from '../../src/app/store/appStore';
import { UiProvider } from '../../src/ui/components';

afterEach(cleanup);

describe('keyboard sheet', () => {
  it('has one labelled row per binding, M6 and M7 keys included', () => {
    render(
      <UiProvider>
        <ShortcutSheet />
      </UiProvider>,
    );
    act(() => {
      appStore.getState().setShortcutsOpen(true);
    });
    const table = screen.getByTestId('shortcut-sheet');
    const rows = within(table).getAllByRole('row').slice(1); // the header row
    expect(rows).toHaveLength(KEYMAP.length);
    const names = rows.map((r) => within(r).getByRole('rowheader').textContent);
    for (const n of names) {
      expect(n).toBeTruthy();
      // A missing string would show its key (command.x.y / shortcuts.action.x).
      expect(n).not.toMatch(/^(command|shortcuts)\.[\w.]+$/u);
    }
    // The four nudge rows share a label; label and keys together never repeat.
    const texts = rows.map((r) => r.textContent);
    expect(texts.filter((x, i) => texts.indexOf(x) !== i)).toEqual([]);
    // Every row shows at least one key.
    for (const r of rows) expect(r.querySelectorAll('kbd').length).toBeGreaterThan(0);
    // M6's keys (M6-01, M6-02, M6-11).
    for (const [label, key] of [
      ['Full Screen', 'Ctrl+Shift+F11'],
      ['Cut', 'Ctrl+X'],
      ['Rename (Bookmarks pane)', 'F2'],
      ['New Bookmark (Bookmarks pane)', 'Insert'],
      ['Bookmark Properties… (Bookmarks pane)', 'Alt+Enter'],
      // M7's keys (M7-03 edit the selected text comment, M7-11 dark theme).
      ['Edit the Selected Text Comment', 'F2'],
      ['Dark Theme', 'Ctrl+Shift+D'],
    ] as const) {
      const row = rows.find((r) => within(r).getByRole('rowheader').textContent === label);
      expect(row, label).toBeDefined();
      expect(row?.textContent).toContain(key);
    }
  });
});
