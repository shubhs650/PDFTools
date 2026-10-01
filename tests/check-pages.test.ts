import { mkdtemp, mkdir, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPages, PAGES_LIMITS } from '../scripts/check-pages.ts';

async function site(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pdftools-pages-'));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return dir;
}

const OK = {
  'index.html': '<!doctype html>',
  'sw.js': '',
  'manifest.webmanifest': '{}',
  _headers: "/*\n  Content-Security-Policy: default-src 'self'\n",
  'assets/a.js': '',
};

describe('checkPages (Cloudflare Pages limits)', () => {
  it('accepts a site within the limits', async () => {
    expect(await checkPages(await site(OK))).toEqual([]);
  });

  it('flags missing root files, a 404.html and a _headers file without a CSP', async () => {
    const dir = await site({ 'index.html': '', '404.html': '', _headers: '/*\n  X-A: 1\n' });
    expect(await checkPages(dir)).toEqual([
      'sw.js missing at the root',
      'manifest.webmanifest missing at the root',
      '404.html at the root turns off SPA fallback',
      '_headers has no Content-Security-Policy for /*',
    ]);
  });

  it('flags a file over the per-file size limit', async () => {
    const dir = await site(OK);
    await truncate(join(dir, 'assets/a.js'), PAGES_LIMITS.fileBytes + 1);
    const problems = await checkPages(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^assets\/a\.js: /);
  });

  it('flags too many header rules and over-long header lines', async () => {
    const rules = Array.from(
      { length: PAGES_LIMITS.headerRules + 1 },
      (_, i) => `/p${String(i)}\n  X: 1`,
    );
    const long = `  X-Long: ${'a'.repeat(PAGES_LIMITS.headerLineChars)}`;
    const dir = await site({ ...OK, _headers: `${OK._headers}${long}\n${rules.join('\n')}\n` });
    expect(await checkPages(dir)).toEqual([
      '_headers line 3 over 2000 characters',
      `_headers has ${String(PAGES_LIMITS.headerRules + 2)} rules (Pages allows ${String(PAGES_LIMITS.headerRules)})`,
    ]);
  });
});
