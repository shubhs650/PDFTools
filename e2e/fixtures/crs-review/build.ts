// Writes the CRS review corpus (M13-07, D-71) and its README:
//   npm run corpus:crs            write the PDFs and the README
//   npm run corpus:crs -- --check exit 1 if a committed file is stale
// Every byte depends only on the script, so the files rebuild exactly.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'prettier';
import { REVIEW_DOCS } from './documents.ts';
import { CRS_CORPUS_DIR } from './index.ts';

const check = process.argv.includes('--check');
const stale: string[] = [];

const rows: string[] = [];
const write = (name: string, bytes: Uint8Array | string) => {
  const path = join(CRS_CORPUS_DIR, name);
  const next = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
  if (existsSync(path) && Buffer.compare(readFileSync(path), next) === 0) return;
  if (check) stale.push(name);
  else writeFileSync(path, next);
};

mkdirSync(CRS_CORPUS_DIR, { recursive: true });
for (const build of REVIEW_DOCS) {
  const d = build();
  rows.push(`| \`${d.file}\` | ${String(d.comments)} | ${String(d.seeThrough)} | ${d.summary} |`);
  console.log(`${d.file}: ${String(d.comments)} comments, ${(d.bytes.length / 1e3).toFixed(0)} kB`);
  write(d.file, d.bytes);
}

const readme = `# CRS review corpus

Self-made review copies (CLAUDE.md rule 13) carrying review comments of every kind, as a checking
engineer leaves them, to check the Comment Resolution Sheet exports (Standard CRS and project
templates, M13-07, D-71) against. Every comment is a standard PDF annotation with an appearance
stream. Replies and review statuses are reply annotations, as desktop PDF editors write them.

Rebuild with \`npm run corpus:crs\`; never edit these files by hand. The generator is
\`e2e/fixtures/crs-review/\`.

| File | Comments (CRS rows) | See-through (opacity < 70 %) | What it holds |
| :--- | ---: | ---: | :--- |
${rows.join('\n')}

"Comments" counts the rows a CRS lists with every comment type ticked and "Ignore highlights" off;
with "Ignore highlights" on, the see-through ones are left out.
`;
write('README.md', await format(readme, { parser: 'markdown' }));

if (stale.length) {
  console.error(`Stale: ${stale.join(', ')}. Run npm run corpus:crs.`);
  process.exit(1);
}
