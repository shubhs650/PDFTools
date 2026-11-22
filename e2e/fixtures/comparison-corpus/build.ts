// Rebuilds the generated corpus pairs and their manifest rows (M12-01):
//   npm run corpus            write the committed pairs, the manifests and READMEs
//   npm run corpus -- --check exit 1 if a committed file or manifest row is stale
// Pairs marked atTestTime are not written: the loader builds them on use.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'prettier';
import { GENERATED_PAIRS, type CorpusKind } from './catalog.ts';
import { CORPUS_ROOT, manifestPath, pageCount } from './index.ts';

const check = process.argv.includes('--check');
const DIR: Record<CorpusKind, string> = {
  overlay: 'engineering_pdf_overlay_test_corpus',
  text: 'text_comparison_pdf_corpus',
};

const csvField = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const stale: string[] = [];
let added = 0;
const rows: Record<CorpusKind, string[]> = { overlay: [], text: [] };
const readme: Record<CorpusKind, string[]> = { overlay: [], text: [] };

for (const g of GENERATED_PAIRS) {
  const t0 = performance.now();
  const files = g.build();
  const ms = performance.now() - t0;
  const oldPages = pageCount(files.old);
  const newPages = pageCount(files.new);
  const r = g.row(files.facts);
  rows[g.kind].push(
    [
      g.id,
      r.type,
      g.oldFile,
      g.newFile,
      String(oldPages),
      String(newPages),
      r.layout,
      r.edge,
      r.expected,
    ]
      .map(csvField)
      .join(','),
  );
  readme[g.kind].push(
    `| **${g.id}** | ${r.type} | ${String(oldPages)} → ${String(newPages)} | ${r.layout} | ${r.edge} | ${r.expected.replace(/\|/g, '/')} |`,
  );
  const size = files.old.length + files.new.length;
  console.log(
    `${g.kind} ${g.id} ${g.folder}: ${String(oldPages)} → ${String(newPages)} pages, ${(size / 1e6).toFixed(2)} MB, ${ms.toFixed(0)} ms${g.atTestTime ? ' (built at test time, not written)' : ''}`,
  );
  if (g.atTestTime) continue;
  added += size;
  const dir = join(CORPUS_ROOT, DIR[g.kind], g.folder);
  for (const [name, bytes] of [
    [g.oldFile, files.old],
    [g.newFile, files.new],
  ] as const) {
    const path = join(dir, name);
    if (check) {
      if (!existsSync(path) || !Buffer.from(readFileSync(path)).equals(Buffer.from(bytes)))
        stale.push(path);
    } else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, bytes);
    }
  }
}

const START = '<!-- corpus-generator:start -->';
const END = '<!-- corpus-generator:end -->';

for (const kind of ['overlay', 'text'] as const) {
  // Manifest: the hand-made rows stay as they are; generated rows follow.
  const path = manifestPath(kind);
  const ids = new Set(GENERATED_PAIRS.filter((g) => g.kind === kind).map((g) => g.id));
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const kept = lines.filter((l, i) => i === 0 || !ids.has(l.split(',')[0] ?? ''));
  const csv = `${[...kept, ...rows[kind]].join('\n')}\n`;

  const readmePath = join(CORPUS_ROOT, DIR[kind], 'README.md');
  const md = readFileSync(readmePath, 'utf8');
  const block = [
    START,
    '',
    `## Generated pairs (${kind === 'overlay' ? '14' : '13'} onward)`,
    '',
    'Self-made by `e2e/fixtures/comparison-corpus/` (M12-01). Rebuild with `npm run corpus`; never edit these files by hand. Tests read every pair through the loader in `e2e/fixtures/comparison-corpus/index.ts`. Pairs marked "generated at test time" are built by the loader on first use and are not in the repository.',
    '',
    `| Pair | ${kind === 'overlay' ? 'Discipline' : 'Document Type'} | Pages (Old→New) | ${kind === 'overlay' ? 'Sheet Size' : 'Layout'} | Edge Case Tested | Expected Changes |`,
    '| :-- | :-- | :-- | :-- | :-- | :-- |',
    ...readme[kind],
    '',
    END,
  ].join('\n');
  const at = md.indexOf(START);
  const end = md.indexOf(END);
  const next =
    at >= 0 && end > at
      ? `${md.slice(0, at)}${block}${md.slice(end + END.length)}`
      : `${md.trimEnd()}\n\n${block}\n`;
  const formatted = await format(next, {
    parser: 'markdown',
    singleQuote: true,
    printWidth: 100,
    endOfLine: 'lf',
  });

  if (check) {
    if (readFileSync(path, 'utf8') !== csv) stale.push(path);
    if (md !== formatted) stale.push(readmePath);
  } else {
    writeFileSync(path, csv);
    writeFileSync(readmePath, formatted);
  }
}

if (check) {
  if (stale.length) {
    console.error(`Stale corpus files (run npm run corpus):\n${stale.join('\n')}`);
    process.exit(1);
  }
  console.log('Generated corpus files are up to date.');
} else {
  console.log(`Committed generated pairs: ${(added / 1e6).toFixed(2)} MB`);
  // The whole corpus folder, for the size report (target under 25 MB added).
  let total = 0;
  const walk = (d: string): void => {
    for (const e of readdirSafe(d)) {
      const p = join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else total += s.size;
    }
  };
  walk(CORPUS_ROOT);
  console.log(`Corpus folder total: ${(total / 1e6).toFixed(2)} MB`);
}

function readdirSafe(d: string): string[] {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}
