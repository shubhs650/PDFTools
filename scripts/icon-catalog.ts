// Reads the Fluent UI System Icons catalog from the installed
// @fluentui/react-icons package (lib/atoms/svg/*.d.ts, one file per base icon).
// Promoted from spikes/s6-icons/catalog.ts (ADR-010).

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export type IconStyle = 'Regular' | 'Filled';

export interface IconEntry {
  /** Atom file (kebab-case) exporting this base icon, for per-icon path imports. */
  atom: string;
  sizes: Record<IconStyle, Set<number>>;
}

// Base names may end in digits (Keyboard123), so the size is matched against the
// known grid sizes rather than "all trailing digits".
const EXPORT =
  /export declare const ([A-Za-z0-9]+?)(10|12|16|20|24|28|32|48)?(Color|Regular|Filled|Light)\b/g;

export function parseAtom(atom: string, dts: string, into: Map<string, IconEntry>): void {
  for (const m of dts.matchAll(EXPORT)) {
    const [, base = '', size = '', style = ''] = m;
    if (style !== 'Regular' && style !== 'Filled') continue;
    let e = into.get(base);
    if (!e) {
      e = { atom, sizes: { Regular: new Set(), Filled: new Set() } };
      into.set(base, e);
    }
    if (size) e.sizes[style].add(Number(size));
  }
}

export function loadCatalog(): Map<string, IconEntry> {
  const require = createRequire(import.meta.url);
  const dir = dirname(require.resolve('@fluentui/react-icons/package.json'));
  const atoms = join(dir, 'lib', 'atoms', 'svg');
  const cat = new Map<string, IconEntry>();
  for (const f of readdirSync(atoms)) {
    if (f.endsWith('.d.ts')) parseAtom(f.slice(0, -5), readFileSync(join(atoms, f), 'utf8'), cat);
  }
  return cat;
}

/** Small buttons, panes and the status bar use the 20 px glyph (ADR-010). */
export const SMALL_SIZE = 20;
/** Large (32 px) buttons use the native 32 px glyph, else 28 or 24 scaled up (ADR-010 d2). */
export const LARGE_SIZES = [32, 28, 24] as const;

export function largeSize(entry: IconEntry, style: IconStyle): number | undefined {
  return LARGE_SIZES.find((s) => entry.sizes[style].has(s));
}
