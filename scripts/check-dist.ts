// Scans a production build for strings that must never ship (M1-02):
//   - the e2e test hook marker (M1-Q3).
// Usage: node scripts/check-dist.ts [dist]   (exit 1 on any finding)

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export const FORBIDDEN: readonly { marker: string; reason: string }[] = [
  { marker: '__pdftoolsTest', reason: 'e2e test hook in a production build (M1-Q3)' },
];

export interface Finding {
  file: string;
  marker: string;
  reason: string;
}

const TEXT = /\.(js|mjs|css|html|json|webmanifest|txt|svg)$/;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

export async function scanDist(dir: string): Promise<Finding[]> {
  const root = resolve(dir);
  const findings: Finding[] = [];
  for await (const file of walk(root)) {
    if (!TEXT.test(file)) continue;
    const text = await readFile(file, 'utf8');
    for (const f of FORBIDDEN) {
      if (text.includes(f.marker)) {
        findings.push({ file: relative(root, file), marker: f.marker, reason: f.reason });
      }
    }
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const dir = process.argv[2] ?? 'dist';
  const findings = await scanDist(dir);
  for (const f of findings) console.error(`✖ ${f.file}: ${f.marker} — ${f.reason}`);
  if (findings.length) process.exit(1);
  console.log(`✔ ${dir}: no forbidden strings`);
}
