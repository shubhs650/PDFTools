// ADR-013 decision 7 (M2-16): §10.1 allows `frame-src blob:` for one use only,
// the browser-viewer print route. This keeps the CSP line and its users as the
// ADR states: only two modules make frames, and only viewerRoute.ts loads a
// URL into one (the raster print frame stays about:blank).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHeadersFile } from '../../scripts/headers';

const ROOT = join(import.meta.dirname, '../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('frame-src blob: (ADR-013 decision 7)', () => {
  it('the CSP adds exactly frame-src blob:', () => {
    const rules = parseHeadersFile(readFileSync(join(ROOT, 'public/_headers'), 'utf8'));
    const csp = Object.fromEntries(rules.flatMap((r) => r.headers))['Content-Security-Policy'];
    const frame = csp
      ?.split(';')
      .map((d) => d.trim())
      .filter((d) => d.startsWith('frame-src'));
    expect(frame).toEqual(['frame-src blob:']);
  });

  it('only the print modules make frames, and only viewerRoute.ts gives one a URL', () => {
    const makers: string[] = [];
    const loaders: string[] = [];
    for (const file of sources(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(ROOT, file);
      if (/createElement\(\s*['"]iframe['"]/.test(text) || /<iframe/i.test(text)) makers.push(rel);
      if (/\.src\s*=|setAttribute\(\s*['"]src['"]/.test(text) && /iframe/i.test(text))
        loaders.push(rel);
    }
    expect(makers.sort()).toEqual([
      'src/features/print/printFrame.ts',
      'src/features/print/viewerRoute.ts',
    ]);
    // printFrame.ts sets src on its <img> elements inside the frame, not on the frame.
    expect(loaders.sort()).toEqual([
      'src/features/print/printFrame.ts',
      'src/features/print/viewerRoute.ts',
    ]);
    const printFrame = readFileSync(join(ROOT, 'src/features/print/printFrame.ts'), 'utf8');
    expect(printFrame).not.toMatch(/frame\.src\s*=/);
    const viewer = readFileSync(join(ROOT, 'src/features/print/viewerRoute.ts'), 'utf8');
    expect(viewer).toMatch(/type: 'application\/pdf'/);
  });
});
