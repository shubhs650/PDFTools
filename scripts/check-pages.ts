// Checks a production build against Cloudflare Pages' deployment limits and
// the files the app needs at the site root (D-11), so a build that Pages
// would reject or serve wrongly fails in CI instead of at deploy time.
// Limits: https://developers.cloudflare.com/pages/platform/limits/
// Usage: node scripts/check-pages.ts [dist]   (exit 1 on any problem)

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseHeadersFile } from './headers.ts';

export const PAGES_LIMITS = {
  /** Files per deployment (Free plan). */
  files: 20_000,
  /** Size of a single asset. */
  fileBytes: 25 * 1024 * 1024,
  /** Header rules in `_headers`. */
  headerRules: 100,
  /** Characters per `_headers` line. */
  headerLineChars: 2_000,
} as const;

/** Files the app needs at the root of the deployment. */
export const REQUIRED = ['index.html', 'sw.js', 'manifest.webmanifest', '_headers'] as const;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

export async function checkPages(dir: string): Promise<string[]> {
  const root = resolve(dir);
  const problems: string[] = [];
  const files: string[] = [];
  for await (const file of walk(root)) files.push(relative(root, file).split('\\').join('/'));

  if (files.length > PAGES_LIMITS.files) {
    problems.push(`${String(files.length)} files (Pages allows ${String(PAGES_LIMITS.files)})`);
  }
  for (const file of files) {
    const { size } = await stat(join(root, file));
    if (size > PAGES_LIMITS.fileBytes) {
      problems.push(
        `${file}: ${String(size)} bytes (Pages allows ${String(PAGES_LIMITS.fileBytes)} per file)`,
      );
    }
  }
  for (const name of REQUIRED) {
    if (!files.includes(name)) problems.push(`${name} missing at the root`);
  }
  // Without a top-level 404.html, Pages serves index.html for unknown paths
  // (single-page app behaviour), which the app relies on.
  if (files.includes('404.html')) problems.push('404.html at the root turns off SPA fallback');

  if (files.includes('_headers')) {
    const text = await readFile(join(root, '_headers'), 'utf8');
    const long = text.split(/\r?\n/).findIndex((l) => l.length > PAGES_LIMITS.headerLineChars);
    if (long >= 0) {
      problems.push(
        `_headers line ${String(long + 1)} over ${String(PAGES_LIMITS.headerLineChars)} characters`,
      );
    }
    const rules = parseHeadersFile(text);
    if (rules.length > PAGES_LIMITS.headerRules) {
      problems.push(
        `_headers has ${String(rules.length)} rules (Pages allows ${String(PAGES_LIMITS.headerRules)})`,
      );
    }
    const all = rules.find((r) => r.pattern === '/*');
    if (!all?.headers.some(([k]) => k.toLowerCase() === 'content-security-policy')) {
      problems.push('_headers has no Content-Security-Policy for /*');
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const dir = process.argv[2] ?? 'dist';
  const problems = await checkPages(dir);
  for (const p of problems) console.error(`✖ ${p}`);
  if (problems.length) process.exit(1);
  console.log(`✔ ${dir}: within Cloudflare Pages limits`);
}
