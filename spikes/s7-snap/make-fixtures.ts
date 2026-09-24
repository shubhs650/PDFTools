// Writes the S7 self-made fixtures to spikes/s7-snap/out/ for the browser spec.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { denseSheet, testSheet } from './test-sheet.ts';

const out = join(import.meta.dirname, 'out');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'test-sheet.pdf'), testSheet());
writeFileSync(join(out, 'dense-1m.pdf'), denseSheet(1_000_000));
console.log('wrote test-sheet.pdf, dense-1m.pdf');
