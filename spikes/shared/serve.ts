// Static server for spike builds that applies `_headers` the way Cloudflare
// Pages does (M0-S8, stand-in for `wrangler pages dev` — see ADR-003).
//
// Usage: node spikes/shared/serve.ts --root <dist> --port <n> [--report]
//          [--corpus <dir>] [--coi]
//
// --report adds a *Report-Only* copy of the CSP with `report-uri` pointing at
// this server, so violations from the page, its workers and the service worker
// are collected server-side. The enforced policy is left byte-for-byte as in
// `_headers`. Collected reports: GET /__csp-reports, clear: DELETE.
//
// --corpus serves a local directory under /corpus/ (test PDFs; never deployed).
// --coi adds COOP/COEP so performance.measureUserAgentSpecificMemory() works
// (S3 question: would cross-origin isolation be acceptable?).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { headersFor, parseHeadersFile } from './headers.ts';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    port: { type: 'string', default: '4180' },
    report: { type: 'boolean', default: false },
    corpus: { type: 'string' },
    coi: { type: 'boolean', default: false },
  },
});
if (!values.root) throw new Error('--root is required');
const root = resolve(values.root);
const port = Number(values.port);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const corpus = values.corpus ? resolve(values.corpus) : undefined;
const rules = parseHeadersFile(await readFile(join(root, '_headers'), 'utf8'));
const reports: unknown[] = [];

async function resolveFile(urlPath: string): Promise<string | undefined> {
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let base = root;
  let rel = safe;
  if (corpus && safe.startsWith('/corpus/')) {
    base = corpus;
    rel = safe.slice('/corpus'.length);
  }
  const candidates = [join(base, rel), join(base, rel, 'index.html')];
  for (const c of candidates) {
    if (!c.startsWith(base)) continue;
    try {
      if ((await stat(c)).isFile()) return c;
    } catch {
      // try next
    }
  }
  return undefined;
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${String(port)}`);

    if (url.pathname === '/__csp-report' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try {
        reports.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reports.push({ unparsable: Buffer.concat(chunks).toString('utf8') });
      }
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/__csp-reports') {
      if (req.method === 'DELETE') reports.length = 0;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reports));
      return;
    }
    // _headers itself is not served by Cloudflare Pages.
    const file = url.pathname === '/_headers' ? undefined : await resolveFile(url.pathname);
    // SPA fallback like Pages: unknown paths without an extension get index.html.
    const target =
      file ?? (extname(url.pathname) === '' ? await resolveFile('/index.html') : undefined);
    if (!target) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const body = await readFile(target);
    const headers: Record<string, string> = {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    };
    for (const [k, v] of headersFor(rules, url.pathname)) headers[k] = v;
    if (values.coi) {
      headers['Cross-Origin-Opener-Policy'] = 'same-origin';
      headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    }
    const csp = headers['Content-Security-Policy'];
    if (values.report && csp) {
      headers['Content-Security-Policy-Report-Only'] = `${csp}; report-uri /__csp-report`;
    }
    res.writeHead(200, headers).end(body);
  })().catch((err: unknown) => {
    console.error(err);
    res.writeHead(500).end();
  });
});

server.listen(port, () => {
  console.log(`serving ${root} on http://localhost:${String(port)}`);
});
