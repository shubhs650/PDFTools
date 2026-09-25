// Writes the S9 self-made fixtures to spikes/s9-plugins/out/ (git-ignored):
// the S5 2,000-page contract stand-in and two synthetic A0 sheets (typical and
// dense). No real documents are used (rule 13, ADR-001 B15).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractPdf } from '../s5-search/make-contract.ts';
import { denseSheet } from '../s7-snap/test-sheet.ts';

const out = join(import.meta.dirname, 'out');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'contract-2000.pdf'), contractPdf(2000));
writeFileSync(join(out, 'a0-20k.pdf'), denseSheet(20_000));
writeFileSync(join(out, 'a0-200k.pdf'), denseSheet(200_000));
console.log('wrote contract-2000.pdf, a0-20k.pdf, a0-200k.pdf');
