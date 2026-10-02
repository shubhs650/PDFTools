// Key chords: parsing, matching KeyboardEvents and formatting for display
// (D-29, §8.1). Chords are written like "Ctrl+Shift+S", "Ctrl+PageDown", "H".
// On macOS, Ctrl in a chord means Cmd (the platform's command key).

export interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Normalized key: lower-case letter/digit, or a named key ("PageDown", "F4", "Escape", "=", "-"). */
  key: string;
}

const NAMED: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  plus: '+',
  minus: '-',
  home: 'Home',
  end: 'End',
  space: ' ',
};

export function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase();
  return NAMED[key.toLowerCase()] ?? key;
}

export function parseChord(text: string): Chord {
  // "Ctrl++" → modifiers "Ctrl" and key "+".
  const parts = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
  const key = parts.pop();
  if (!key) throw new Error(`Empty chord: ${text}`);
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  for (const m of mods) {
    if (!['ctrl', 'shift', 'alt'].includes(m)) throw new Error(`Unknown modifier ${m} in ${text}`);
  }
  return {
    ctrl: mods.has('ctrl'),
    shift: mods.has('shift'),
    alt: mods.has('alt'),
    key: normalizeKey(key),
  };
}

export const chordId = (c: Chord): string =>
  `${c.ctrl ? 'Ctrl+' : ''}${c.shift ? 'Shift+' : ''}${c.alt ? 'Alt+' : ''}${c.key}`;

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Does the event match the chord? Shift is ignored for punctuation that needs
 * it on some layouts ("+" is Shift+= on US keyboards).
 */
export function matches(chord: Chord, e: KeyLike, mac: boolean): boolean {
  const ctrl = mac ? e.metaKey : e.ctrlKey;
  if (ctrl !== chord.ctrl || e.altKey !== chord.alt) return false;
  const key = normalizeKey(e.key);
  if (key !== chord.key) return false;
  const shiftInsensitive = key === '+' || key === '=' || key === '-';
  return shiftInsensitive || e.shiftKey === chord.shift;
}

export interface KeyLabels {
  ctrl: string;
  shift: string;
  alt: string;
  named: (key: string) => string;
}

/** Display text for a chord ("Ctrl+Shift+S"; "Cmd+Shift+S" on macOS via labels). */
export function formatChord(chord: Chord, labels: KeyLabels): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push(labels.ctrl);
  if (chord.shift) parts.push(labels.shift);
  if (chord.alt) parts.push(labels.alt);
  parts.push(
    chord.key.length === 1 && !/[+\-]/.test(chord.key)
      ? chord.key.toUpperCase()
      : labels.named(chord.key),
  );
  return parts.join('+');
}

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);
