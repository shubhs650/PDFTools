import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Windows and macOS file systems ignore case. Two modules whose import paths
// differ only in case (e.g. `LocalData.tsx` and `localData.ts`, imported as
// `./LocalData`) resolve to the same file there, so the app breaks on Windows
// while Linux CI passes. Imports omit these extensions, so they count as one name.
const MODULE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);
const ROOTS = ['src', 'tests', 'e2e', 'scripts', 'functions', 'public'];

function collisions(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const seen = new Map<string, { base: string; name: string }>();
  for (const e of entries) {
    const ext = extname(e.name);
    const base = e.isFile() && MODULE_EXT.has(ext) ? e.name.slice(0, -ext.length) : e.name;
    const key = base.toLowerCase();
    const prev = seen.get(key);
    // Same spelling (e.g. `commands/` and `commands.ts`) resolves the same everywhere.
    if (prev === undefined) seen.set(key, { base, name: e.name });
    else if (prev.base !== base) out.push(`${join(dir, prev.name)} ↔ ${join(dir, e.name)}`);
    if (e.isDirectory() && e.name !== 'node_modules') collisions(join(dir, e.name), out);
  }
}

describe('file names are safe on case-insensitive file systems', () => {
  it('no two modules (or folders) differ only in case', () => {
    const out: string[] = [];
    for (const root of ROOTS) collisions(root, out);
    expect(out).toEqual([]);
  });
});
