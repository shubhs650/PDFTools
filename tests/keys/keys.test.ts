import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/app/commands';
import { INTERNAL_ACTIONS } from '../../src/app/commands/dispatch';
import { chordId, formatChord, matches, parseChord, type KeyLike } from '../../src/app/keys/chord';
import { KEYMAP, chordsOn } from '../../src/app/keys/keymap';
import { resolveBinding } from '../../src/app/keys/useShortcuts';

const ev = (key: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('chords', () => {
  it('parses modifiers and named keys, including "Ctrl++"', () => {
    expect(parseChord('Ctrl+Shift+S')).toEqual({ ctrl: true, shift: true, alt: false, key: 's' });
    expect(parseChord('Ctrl+Alt+PageDown')).toEqual({
      ctrl: true,
      shift: false,
      alt: true,
      key: 'PageDown',
    });
    expect(parseChord('Ctrl++').key).toBe('+');
    expect(parseChord('Escape').key).toBe('Escape');
    expect(() => parseChord('Hyper+X')).toThrow(/Unknown modifier/);
  });

  it('matches events exactly, Cmd for Ctrl on macOS, Shift-insensitive for + = -', () => {
    const save = parseChord('Ctrl+S');
    expect(matches(save, ev('s', { ctrlKey: true }), false)).toBe(true);
    expect(matches(save, ev('S', { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(matches(save, ev('s', { metaKey: true }), true)).toBe(true);
    expect(matches(save, ev('s', { ctrlKey: true }), true)).toBe(false);
    expect(matches(parseChord('Ctrl++'), ev('+', { ctrlKey: true, shiftKey: true }), false)).toBe(
      true,
    );
    expect(matches(parseChord('H'), ev('h'), false)).toBe(true);
    expect(matches(parseChord('H'), ev('h', { ctrlKey: true }), false)).toBe(false);
  });

  it('formats for Windows and macOS labels', () => {
    const win = {
      ctrl: 'Ctrl',
      shift: 'Shift',
      alt: 'Alt',
      named: (k: string) => (k === 'PageDown' ? 'Page Down' : k),
    };
    const mac = { ...win, ctrl: 'Cmd', alt: 'Option' };
    expect(formatChord(parseChord('Ctrl+Shift+S'), win)).toBe('Ctrl+Shift+S');
    expect(formatChord(parseChord('Ctrl+Alt+PageDown'), mac)).toBe('Cmd+Option+Page Down');
  });
});

describe('keymap (D-29, §8.1, M1-Q1)', () => {
  it('has no conflicting bindings (a chord once per scope; a global one nowhere else)', () => {
    const all = KEYMAP.flatMap((b) => b.chords.map((c) => `${b.scope}:${chordId(c)}`));
    expect(new Set(all).size).toBe(all.length);
    const global = new Set(
      KEYMAP.filter((b) => b.scope === 'global').flatMap((b) => b.chords.map(chordId)),
    );
    for (const b of KEYMAP.filter((x) => x.scope !== 'global'))
      for (const c of b.chords) expect(global.has(chordId(c)), chordId(c)).toBe(false);
  });

  it('targets only known commands or internal actions', () => {
    const known = new Set<string>([...COMMANDS.map((c) => c.id), ...INTERNAL_ACTIONS]);
    for (const b of KEYMAP) expect(known.has(b.target), b.target).toBe(true);
  });

  it('gives every browser-reserved binding an alternate', () => {
    for (const b of KEYMAP.filter((x) => x.reservedFirst))
      expect(b.chords.length).toBeGreaterThan(1);
  });

  it('covers the §8.1 M1 set', () => {
    const targets = KEYMAP.map((b) => b.target);
    for (const t of [
      'file.open',
      'file.save',
      'file.saveAs',
      'view.fitPage',
      'view.actualSize',
      'view.fitWidth',
      'view.zoomIn',
      'view.zoomOut',
      'home.hand',
      'home.select',
      'tool.cancel',
      'tab.close',
      'tab.next',
      'tab.prev',
    ]) {
      expect(targets).toContain(t);
    }
  });
});

describe('resolveBinding: scopes and text fields', () => {
  const focus = { editable: false, inDocument: false };
  it('ignores shortcuts while typing, except Esc and the inText file/find chords', () => {
    const typing = { ...focus, editable: true };
    for (const [key, mods] of [
      ['a', { ctrlKey: true }],
      ['c', { ctrlKey: true }],
      ['0', { ctrlKey: true }],
      ['h', {}],
      ['F3', {}],
    ] as const)
      expect(resolveBinding(ev(key, mods), typing, false)).toBeUndefined();
    // Ctrl+S in a form field saves (M2-19); Ctrl+O, Ctrl+P, Ctrl+F likewise.
    expect(resolveBinding(ev('s', { ctrlKey: true }), typing, false)?.target).toBe('file.save');
    expect(resolveBinding(ev('p', { ctrlKey: true }), typing, false)?.target).toBe('file.print');
    expect(resolveBinding(ev('f', { ctrlKey: true }), typing, false)?.target).toBe('home.find');
    expect(resolveBinding(ev('Escape'), { ...focus, editable: true }, false)?.target).toBe(
      'tool.cancel',
    );
  });
  it('fires single-letter keys only in the document', () => {
    expect(resolveBinding(ev('h'), focus, false)).toBeUndefined();
    expect(resolveBinding(ev('h'), { ...focus, inDocument: true }, false)?.target).toBe(
      'home.hand',
    );
  });
  it('gives the bookmark tree its own Delete, Ctrl+C and F2 (M6-11)', () => {
    const tree = { ...focus, inBookmarks: true };
    expect(resolveBinding(ev('Delete'), tree, false)?.target).toBe('bookmark.delete');
    expect(resolveBinding(ev('Delete'), { ...focus, inDocument: true }, false)?.target).toBe(
      'comment.delete',
    );
    expect(resolveBinding(ev('c', { ctrlKey: true }), tree, false)?.target).toBe('bookmark.copy');
    expect(resolveBinding(ev('F2'), tree, false)?.target).toBe('bookmark.rename');
    expect(resolveBinding(ev('F2'), focus, false)).toBeUndefined();
    // Global keys still work there.
    expect(resolveBinding(ev('z', { ctrlKey: true }), tree, false)?.target).toBe('qat.undo');
  });
  it('fires global keys anywhere', () => {
    expect(resolveBinding(ev('o', { ctrlKey: true }), focus, false)?.target).toBe('file.open');
  });
  it('opens Tell me with Alt+Q, Ctrl+Q off macOS and Option+Q on it (M10-08·O2)', () => {
    expect(resolveBinding(ev('q', { altKey: true }), focus, false)?.target).toBe('app.tellMe');
    expect(resolveBinding(ev('q', { ctrlKey: true }), focus, false)?.target).toBe('app.tellMe');
    // Option+Q types "œ" on a Mac: the physical key matches.
    expect(resolveBinding(ev('œ', { altKey: true, code: 'KeyQ' }), focus, true)?.target).toBe(
      'app.tellMe',
    );
    // Cmd+Q is the browser's (quit): never bound on macOS.
    expect(resolveBinding(ev('q', { metaKey: true }), focus, true)).toBeUndefined();
    // Not while typing; and Q alone is still Squiggly in the document.
    expect(resolveBinding(ev('q', { altKey: true }), { ...focus, editable: true }, false)).toBe(
      undefined,
    );
    expect(resolveBinding(ev('q'), { ...focus, inDocument: true }, false)?.target).toBe(
      'comment.squiggly',
    );
  });
  it('matches a physical key only for Alt+letter on macOS', () => {
    const altQ = parseChord('Alt+Q');
    expect(matches(altQ, ev('œ', { altKey: true, code: 'KeyQ' }), false)).toBe(false);
    expect(matches(altQ, ev('œ', { altKey: true, code: 'KeyW' }), true)).toBe(false);
    expect(matches(parseChord('Q'), ev('œ', { code: 'KeyQ' }), true)).toBe(false);
  });
});

describe('chordsOn', () => {
  it('drops Ctrl chords on macOS only for bindings that ask', () => {
    const tellMe = KEYMAP.find((b) => b.target === 'app.tellMe');
    expect(tellMe && chordsOn(tellMe, false).map(chordId)).toEqual(['Alt+q', 'Ctrl+q']);
    expect(tellMe && chordsOn(tellMe, true).map(chordId)).toEqual(['Alt+q']);
    const save = KEYMAP.find((b) => b.target === 'file.save');
    expect(save && chordsOn(save, true).map(chordId)).toEqual(['Ctrl+s']);
  });
});
