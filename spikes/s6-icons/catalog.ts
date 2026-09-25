// M0-S6: read the Fluent UI System Icons catalog from the installed
// @fluentui/react-icons package (lib/atoms/svg/*.d.ts, one file per base icon)
// and resolve which sizes and styles exist for a base name.

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Command } from './commands.ts';

export type Style = 'Color' | 'Regular' | 'Filled';
export const STYLES: Style[] = ['Color', 'Regular', 'Filled'];
/** Small buttons, panes and the status bar use Fluent's default 20 px grid. */
export const SMALL = 20;
/** Large ribbon buttons are 32 px (§8); Fluent often stops at 28 or 24 px. */
export const LARGE_PREFERENCE = [32, 28, 24];

export interface IconEntry {
  /** Atom file (kebab-case) that exports this base icon, for path imports. */
  atom: string;
  sizes: Record<Style, Set<number>>;
}

// Base names may end in digits (Keyboard123, TextHeader1Lines), so the size is
// matched against the known grid sizes rather than as "all trailing digits".
const EXPORT =
  /export declare const ([A-Za-z0-9]+?)(10|12|16|20|24|28|32|48)?(Color|Regular|Filled|Light)\b/g;

/** Parse one atom .d.ts into base name → sizes per style. */
export function parseAtom(atom: string, dts: string, into: Map<string, IconEntry>): void {
  for (const m of dts.matchAll(EXPORT)) {
    const [, base = '', size = '', style = ''] = m;
    if (style === 'Light') continue;
    let e = into.get(base);
    if (!e) {
      e = { atom, sizes: { Color: new Set(), Regular: new Set(), Filled: new Set() } };
      into.set(base, e);
    }
    // Unsized exports ("LightbulbColor") are the scalable 20-px-grid variants; skip them.
    if (size) e.sizes[style as Style].add(Number(size));
  }
}

export function fluentPackageDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@fluentui/react-icons/package.json')));
}

export function loadCatalog(dir = fluentPackageDir()): Map<string, IconEntry> {
  const atoms = join(dir, 'lib', 'atoms', 'svg');
  const cat = new Map<string, IconEntry>();
  for (const f of readdirSync(atoms)) {
    if (f.endsWith('.d.ts')) parseAtom(f.slice(0, -5), readFileSync(join(atoms, f), 'utf8'), cat);
  }
  return cat;
}

export interface StyleFit {
  /** The small (20 px) glyph exists. */
  small: boolean;
  /** Best native size for a large button (32, 28 or 24), or null. */
  large: number | null;
  /** Usable for this command: the needed glyphs exist (large may be scaled). */
  ok: boolean;
  /** Usable without scaling any glyph. */
  exact: boolean;
}

export interface Resolved {
  cmd: Command;
  entry: IconEntry | undefined;
  fit: Record<Style, StyleFit>;
}

export function resolve(cmd: Command, cat: Map<string, IconEntry>): Resolved {
  const entry = cat.get(cmd.fluent);
  const fitOf = (s: Style): StyleFit => {
    const have = entry?.sizes[s] ?? new Set<number>();
    const small = have.has(SMALL);
    const large = LARGE_PREFERENCE.find((x) => have.has(x)) ?? null;
    const ok = small && (cmd.size === 'small' || large !== null);
    return { small, large, ok, exact: ok && (cmd.size === 'small' || large === 32) };
  };
  return {
    cmd,
    entry,
    fit: { Color: fitOf('Color'), Regular: fitOf('Regular'), Filled: fitOf('Filled') },
  };
}
