// Rebuilds the measure corpus (M14-01, spike S34, D-79):
//   npm run corpus:measure            write the PDFs, MEASURE_MANIFEST.json and README.md
//   npm run corpus:measure -- --check exit 1 if a committed file is stale
// Output: `Synthetic PDF Corpus/measure/`. Self-made drawings (rule 13).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'prettier';
import { MEASURE_DIR, manifestOf } from './index.ts';
import { measureSheets } from './sheets.ts';

const check = process.argv.includes('--check');
const stale: string[] = [];
const sheets = measureSheets();

const put = async (name: string, data: Uint8Array | string): Promise<void> => {
  const path = join(MEASURE_DIR, name);
  let bytes = data;
  if (typeof data === 'string') {
    const parser = name.endsWith('.json') ? 'json' : 'markdown';
    bytes = await format(data, { parser, singleQuote: true, printWidth: 100, endOfLine: 'lf' });
  }
  const buf = Buffer.from(bytes);
  if (check) {
    if (!existsSync(path) || !Buffer.from(readFileSync(path)).equals(buf)) stale.push(path);
  } else {
    mkdirSync(MEASURE_DIR, { recursive: true });
    writeFileSync(path, buf);
  }
};

for (const s of sheets) {
  await put(s.file, s.bytes);
  console.log(
    `${s.file}: ${(s.bytes.length / 1e3).toFixed(0)} kB, ${String(s.items.length)} items`,
  );
}
await put('MEASURE_MANIFEST.json', JSON.stringify(manifestOf(sheets)));

const fmt = (n: number): string => (Number.isNaN(n) ? 'none' : String(n));
const readme = [
  '# Measure corpus (self-made)',
  '',
  'Synthetic drawings with known true values for the measuring tools (M14, D-79). Built by `e2e/fixtures/measure-corpus/` (spike S34, M14-01); rebuild with `npm run corpus:measure`, never edit by hand. Tests read them through `e2e/fixtures/measure-corpus/index.ts`.',
  '',
  '`MEASURE_MANIFEST.json` lists, for every sheet, its scale areas and the items to measure: the points to click in PDF user space (points, origin bottom-left, before `/Rotate`), and the true value. Values come from the drawing geometry, not from reading the PDF.',
  '',
  ...sheets.flatMap((s) => [
    `## ${s.file}`,
    '',
    `${s.title}. ${s.scaleNote}.`,
    '',
    '| Item | Tool | True value | Note |',
    '| :-- | :-- | :-- | :-- |',
    ...s.items.map(
      (i) => `| ${i.id} | ${i.kind} | ${fmt(i.value)} ${i.unit} | ${i.note.replace(/\|/g, '/')} |`,
    ),
    '',
  ]),
].join('\n');
await put('README.md', readme);

if (check) {
  if (stale.length) {
    console.error(`Stale measure corpus files (run npm run corpus:measure):\n${stale.join('\n')}`);
    process.exit(1);
  }
  console.log('Measure corpus is up to date.');
}
