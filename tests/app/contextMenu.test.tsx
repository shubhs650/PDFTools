// @vitest-environment jsdom
// Context menus (M6-02, ADR-021 D-38): the items come from the command table
// (label, shortcut, disabled reason, toggles), the pointer becomes a page
// point on any view rotation, Paste at the pointer keeps the comments on the
// page, Cut pastes back without the offset, and a right click counts as on a
// comment only over a selected one.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { msg, t } from '../../src/i18n';
import { registerCommand, type CommandState } from '../../src/app/commands/dispatch';
import { KEYMAP } from '../../src/app/keys/keymap';
import { ContextMenu, UiProvider } from '../../src/ui/components';
import { menuItems } from '../../src/ui/components/contextMenuModel';
import { toOffset, toPagePoint } from '../../src/features/view/pagePoint';
import {
  boundsOf,
  pastePlan,
  PASTE_OFFSET,
  shiftTo,
} from '../../src/features/annotate/transfer/copyPaste';
import { onSelectedComment, PAGE_MENU, commentMenu } from '../../src/features/view/documentMenus';

afterEach(cleanup);

const off = (reason = msg('protect.restricted')): CommandState => ({
  enabled: false,
  pressed: false,
  reason,
});

describe('menu model', () => {
  it('labels, shortcuts and disabled reasons come from the commands; separators never lead, trail or repeat', () => {
    const items = menuItems(
      [
        { kind: 'separator', key: 'a' },
        { kind: 'command', id: 'edit.cut' },
        { kind: 'separator', key: 'b' },
        { kind: 'separator', key: 'c' },
        { kind: 'command', id: 'home.hand' },
        { kind: 'separator', key: 'd' },
      ],
      (id) => (id === 'edit.cut' ? off() : { enabled: true, pressed: true }),
      (id) => (id === 'edit.cut' ? 'Ctrl+X' : 'H'),
    );
    expect(items.map((i) => (i.kind === 'separator' ? '-' : i.id))).toEqual([
      'edit.cut',
      '-',
      'home.hand',
    ]);
    expect(items[0]).toMatchObject({
      label: 'command.edit.cut',
      shortcut: 'Ctrl+X',
      enabled: false,
      reason: 'protect.restricted',
      toggle: false,
    });
    expect(items[2]).toMatchObject({ toggle: true, pressed: true, reason: null });
  });

  it('every menu item is a known command with a label, and Cut/Copy/Paste have their keys', () => {
    const ids = [...commentMenu('doc'), ...PAGE_MENU].flatMap((e) =>
      e.kind === 'separator' ? [] : [e.id],
    );
    for (const id of ids) expect(t(`command.${id}` as never), id).not.toBe(`command.${id}`);
    const keys = (target: string) =>
      KEYMAP.find((b) => b.target === target)?.chords.map((c) => c.key);
    expect(keys('edit.cut')).toEqual(['x']);
    expect(keys('edit.copy')).toEqual(['c']);
    expect(keys('edit.paste')).toEqual(['v']);
    expect(KEYMAP.find((b) => b.target === 'menu.context')?.scope).toBe('document');
  });

  it('renders the commands with their state; a disabled item stays focusable, says why and runs nothing', () => {
    let ran = 0;
    const offs = [
      registerCommand('edit.cut', {
        run: () => {
          ran++;
        },
      }),
      registerCommand('edit.copy', {
        disabledReason: () => msg('transfer.copy.none'),
        run: () => {
          ran++;
        },
      }),
    ];
    try {
      render(
        <UiProvider>
          <ContextMenu
            label="Comment"
            entries={[
              { kind: 'command', id: 'edit.cut' },
              { kind: 'command', id: 'edit.copy' },
            ]}
          >
            <div data-testid="area" />
          </ContextMenu>
        </UiProvider>,
      );
      act(() => {
        fireEvent.contextMenu(screen.getByTestId('area'), { clientX: 10, clientY: 10 });
      });
      expect(screen.getByRole('menu', { name: 'Comment' })).toBeTruthy();
      const cut = screen.getByRole('menuitem', { name: 'Cut' });
      const copy = screen.getByRole('menuitem', { name: 'Copy' });
      expect(cut.textContent).toContain('Ctrl+X');
      expect(copy.getAttribute('aria-disabled')).toBe('true');
      const why = document.getElementById(copy.getAttribute('aria-describedby') ?? '');
      expect(why?.textContent).toBe(t('transfer.copy.none'));
      act(() => {
        fireEvent.click(copy);
      });
      expect(ran).toBe(0);
    } finally {
      for (const o of offs) o();
    }
  });
});

describe('pointer → page point (any view rotation)', () => {
  const size = { width: 600, height: 800 };
  it('maps the four corners of the turned page to the page’s own corners', () => {
    // Unturned: offset / scale.
    expect(toPagePoint({ x: 30, y: 60 }, size, 0, 2)).toEqual({ x: 15, y: 30 });
    // 90° clockwise: the page's top-left corner is at the top right of its box.
    expect(toPagePoint({ x: 800, y: 0 }, size, 1, 1)).toEqual({ x: 0, y: 0 });
    expect(toPagePoint({ x: 0, y: 0 }, size, 1, 1)).toEqual({ x: 0, y: 800 });
    expect(toPagePoint({ x: 600, y: 800 }, size, 2, 1)).toEqual({ x: 0, y: 0 });
    expect(toPagePoint({ x: 0, y: 600 }, size, 3, 1)).toEqual({ x: 0, y: 0 });
  });

  it('round-trips with toOffset and stays on the page', () => {
    for (const r of [0, 1, 2, 3]) {
      const p = { x: 123, y: 456 };
      expect(toPagePoint(toOffset(p, size, r, 1.5), size, r, 1.5)).toEqual(p);
    }
    expect(toPagePoint({ x: -5, y: 9999 }, size, 0, 1)).toEqual({ x: 0, y: 800 });
  });
});

describe('paste placement (M6-02)', () => {
  it('puts the group’s top-left corner at the pointer, kept on the page', () => {
    const b = boundsOf([
      { origin: { x: 100, y: 162 }, size: { width: 150, height: 80 } },
      { origin: { x: 300, y: 100 }, size: { width: 20, height: 20 } },
    ]);
    expect(b).toEqual({ x: 100, y: 100, width: 220, height: 142 });
    if (!b) return;
    const page = { width: 595, height: 842 };
    expect(shiftTo(b, { x: 50, y: 60 }, page)).toEqual({ dx: -50, dy: -40 });
    // Near the bottom-right corner: moved back so all of it stays on the page.
    expect(shiftTo(b, { x: 590, y: 840 }, page)).toEqual({ dx: 375 - 100, dy: 700 - 100 });
    expect(boundsOf([])).toBeNull();
  });

  it('a cut pastes back onto its own page without the 10 pt offset', () => {
    const clip = { pages: [0], sourceDocId: 'a' };
    const target = { docId: 'a', page: 0, pageCount: 3 };
    expect(pastePlan(clip, target, 'current').shift).toBe(true);
    expect(pastePlan({ ...clip, cut: true }, target, 'current').shift).toBe(false);
    expect(PASTE_OFFSET).toBe(10);
  });

  it('a right click is on a comment only over a selected one, on its page', () => {
    const sel = [
      { pageIndex: 1, rect: { origin: { x: 100, y: 100 }, size: { width: 50, height: 20 } } },
    ];
    expect(onSelectedComment({ page: 1, x: 120, y: 110 }, sel)).toBe(true);
    expect(onSelectedComment({ page: 1, x: 97, y: 118 }, sel)).toBe(true); // slack
    expect(onSelectedComment({ page: 0, x: 120, y: 110 }, sel)).toBe(false);
    expect(onSelectedComment({ page: 1, x: 200, y: 110 }, sel)).toBe(false);
    expect(onSelectedComment({ page: 1, x: 120, y: 110 }, [])).toBe(false);
  });
});
