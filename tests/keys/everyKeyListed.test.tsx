// @vitest-environment jsdom
// M13-09 (D-29, plan M13 §7): every key the app reads is on the shortcut sheet. The
// keymap's bindings each have a row with all their keys; the keys that a pane or
// window reads with its own listener (held keys, a comparison's F8, Review & Extract)
// are in WINDOW_KEYS and have rows too; and a scan of src/ finds no listener that
// compares a key the sheet does not list (navigation keys aside).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/i18n';
import { t } from '../../src/i18n';
import { formatChord, normalizeKey, parseChord } from '../../src/app/keys/chord';
import { keyLabels } from '../../src/app/keys/labels';
import { KEYMAP } from '../../src/app/keys/keymap';
import { ShortcutSheet } from '../../src/app/keys/ShortcutSheet';
import { WINDOW_KEYS } from '../../src/app/keys/windowKeys';
import { appStore } from '../../src/app/store/appStore';
import { UiProvider } from '../../src/ui/components';

afterEach(cleanup);

const labels = keyLabels(t, false);

function openSheet(): HTMLElement {
  render(
    <UiProvider>
      <ShortcutSheet />
    </UiProvider>,
  );
  act(() => {
    appStore.getState().setShortcutsOpen(true);
  });
  return screen.getByTestId('shortcut-sheet');
}

/** Keys that move, pick or leave in any list or field: not shortcuts of their own. */
const NAVIGATION = new Set([
  'Escape',
  'Enter',
  'Tab',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Delete',
  'Backspace',
  'Shift',
  'Control',
  'Alt',
  'Meta',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** Keys compared in listeners (`e.key === 'x'`) and key constants (`const NEXT_KEY = 'F8'`). */
function keysRead(): { file: string; key: string }[] {
  const compare = /\b(?:e|ev|evt|event)\.key(?:\.toLowerCase\(\))?\s*[!=]==\s*'([^']+)'/g;
  const constant = /\bconst\s+\w*_KEYS?\s*=\s*'([^']+)'/g;
  const out: { file: string; key: string }[] = [];
  for (const file of sourceFiles('src')) {
    if (file.includes(join('app', 'keys'))) continue; // the keymap and the sheet themselves
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(compare)) out.push({ file, key: normalizeKey(m[1] ?? '') });
    for (const m of text.matchAll(constant)) {
      const value = m[1] ?? '';
      // Only what spells a key ("F8", "Shift+F8", "x"); a storage key is not one.
      if (/^(?:(?:Ctrl|Shift|Alt)\+)*(?:[A-Za-z0-9]|F\d{1,2}|Insert|Space)$/.test(value))
        out.push({ file, key: parseChord(value).key });
    }
  }
  return out;
}

describe('every key is on the shortcut sheet', () => {
  it('lists every chord of every keymap binding', () => {
    const table = openSheet();
    const rows = [...table.querySelectorAll('tbody[data-part="keymap"] tr')];
    expect(rows).toHaveLength(KEYMAP.length);
    KEYMAP.forEach((binding, i) => {
      const keys = [...(rows[i]?.querySelectorAll('kbd') ?? [])].map((k) => k.textContent);
      for (const chord of binding.chords)
        expect(keys, binding.target).toContain(formatChord(chord, labels));
    });
  });

  it('lists the keys panes and windows read themselves, with a label', () => {
    const table = openSheet();
    const part = table.querySelector<HTMLElement>('tbody[data-part="window"]');
    expect(part).not.toBeNull();
    if (!part) return;
    expect(within(part).getByRole('columnheader').textContent).toBe('Keys in a pane or window');
    for (const w of WINDOW_KEYS) {
      const row = part.querySelector(`tr[data-window-key="${w.id}"]`);
      expect(row, w.id).not.toBeNull();
      expect(row?.querySelector('th')?.textContent, w.id).not.toMatch(/^shortcuts\./u);
      for (const chord of w.chords)
        expect(row?.textContent, w.id).toContain(formatChord(chord, labels));
    }
  });

  it("names M13's keys: Thin Lines, the loupe, Previous and Next View", () => {
    const table = openSheet();
    for (const [label, key] of [
      ['Thin Lines', 'Ctrl+5'],
      ['Thin Lines', 'Ctrl+Alt+5'],
      ['Show or Hide the Loupe', 'M'],
      ['Previous View', 'Alt+Left Arrow'],
      ['Next View', 'Alt+Right Arrow'],
      ['Next Difference or Change (in a comparison)', 'F8'],
      ['Blink between Old and New (in a PDF overlay)', 'X'],
    ] as const) {
      const row = within(table)
        .getAllByRole('row')
        .find((r) => r.querySelector('th')?.textContent === label);
      expect(row, label).toBeDefined();
      expect(row?.textContent, label).toContain(key);
    }
  });

  it('finds no listener in src/ that reads a key the sheet does not list', () => {
    const listed = new Set<string>([
      ...KEYMAP.flatMap((b) => b.chords.map((c) => c.key)),
      ...WINDOW_KEYS.flatMap((w) => w.chords.map((c) => c.key)),
    ]);
    const found = keysRead();
    // The scan sees the listeners it is meant to see.
    expect(found.some((f) => f.key === ' ')).toBe(true);
    expect(found.some((f) => f.key === 'z')).toBe(true);
    const missing = found.filter((f) => !NAVIGATION.has(f.key) && !listed.has(f.key));
    expect(missing).toEqual([]);
  });
});
