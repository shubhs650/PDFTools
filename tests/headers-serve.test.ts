import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headersFor, matchPattern, parseHeadersFile } from '../scripts/headers.ts';
import { resolveInside, startServer } from '../scripts/serve.ts';

describe('_headers parser', () => {
  const text = [
    '# comment',
    '/*',
    '  X-A: 1',
    "  Content-Security-Policy: default-src 'self'; connect-src 'self'",
    '',
    '/assets/*',
    '  Cache-Control: max-age=31536000',
    '/exact',
    '  X-B: 2',
  ].join('\n');

  it('parses paths, headers with colons in values, and comments', () => {
    const rules = parseHeadersFile(text);
    expect(rules.map((r) => r.pattern)).toEqual(['/*', '/assets/*', '/exact']);
    expect(rules[0]?.headers[1]).toEqual([
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'",
    ]);
  });

  it('matches splats and exact paths, and later rules add to earlier ones', () => {
    expect(matchPattern('/assets/*', '/assets/a.js')).toBe(true);
    expect(matchPattern('/exact', '/exact/more')).toBe(false);
    const rules = parseHeadersFile(text);
    expect(headersFor(rules, '/assets/a.js').map(([k]) => k)).toEqual([
      'X-A',
      'Content-Security-Policy',
      'Cache-Control',
    ]);
  });

  it('rejects a header line before any path, and a line without a colon', () => {
    expect(() => parseHeadersFile('  X-A: 1')).toThrow(/before any path/);
    expect(() => parseHeadersFile('/*\n  nonsense')).toThrow(/Malformed/);
  });

  it('the shipped public/_headers has the §10.1 CSP and COOP/COEP on every path', async () => {
    const rules = parseHeadersFile(await readFile('public/_headers', 'utf8'));
    const h = Object.fromEntries(headersFor(rules, '/any/path.js'));
    expect(h['Content-Security-Policy']).toContain("connect-src 'self'");
    expect(h['Content-Security-Policy']).not.toMatch(/https?:/);
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Cross-Origin-Embedder-Policy']).toBe('require-corp');
  });
});

describe('scripts/serve.ts', () => {
  let root: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pdftools-serve-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>t</title>');
    await writeFile(join(root, 'assets', 'a.js'), 'export {}');
    await writeFile(join(root, '_headers'), "/*\n  Content-Security-Policy: default-src 'self'\n");
    await writeFile(join(tmpdir(), 'pdftools-secret.txt'), 'secret');
    server = await startServer({ root, port: 0, report: true });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    base = `http://localhost:${String(addr.port)}`;
  });
  afterAll(async () => {
    await new Promise((done) => server.close(done));
  });

  it('applies _headers and adds a Report-Only copy of the CSP', async () => {
    const res = await fetch(`${base}/assets/a.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(res.headers.get('content-security-policy-report-only')).toBe(
      "default-src 'self'; report-uri /__csp-report",
    );
  });

  it('never serves _headers, falls back to index.html for routes, 404s missing assets', async () => {
    // Like Pages: the file itself never leaks; an extensionless path gets the SPA page.
    expect(await (await fetch(`${base}/_headers`)).text()).not.toContain('Content-Security-Policy');
    const route = await fetch(`${base}/some/route`);
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('<title>t</title>');
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });

  it('does not escape the root', async () => {
    expect(await resolveInside(root, '/../pdftools-secret.txt')).toBeUndefined();
    expect(await resolveInside(root, '/%2e%2e/pdftools-secret.txt')).toBeUndefined();
    expect(await resolveInside(root, '/assets/a.js')).toBe(join(root, 'assets', 'a.js'));
  });

  it('collects and clears CSP reports', async () => {
    await fetch(`${base}/__csp-report`, { method: 'POST', body: '{"csp-report":{"x":1}}' });
    const got = (await (await fetch(`${base}/__csp-reports`)).json()) as unknown[];
    expect(got).toHaveLength(1);
    await fetch(`${base}/__csp-reports`, { method: 'DELETE' });
    expect(await (await fetch(`${base}/__csp-reports`)).json()).toEqual([]);
  });
});
