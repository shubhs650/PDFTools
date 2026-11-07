// Static server that applies `_headers` the way Cloudflare Pages does. It is
// the local and CI stand-in for `wrangler pages dev`, which is blocked by an
// LGPL dependency (ADR-003 decision 4). Test tooling only; never deployed.
//
// Usage: node scripts/serve.ts --root <dist> [--port 4173] [--report] [--corpus <dir>]
//
// --report   adds a Report-Only copy of the CSP whose `report-uri` points at this
//            server, so violations from the page, its workers and the service
//            worker are collected here. The enforced policy stays byte-for-byte
//            as in `_headers`. Read: GET /__csp-reports; clear: DELETE.
// --corpus   serves a local directory under /corpus/ (owner-supplied test PDFs).

import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { headersFor, parseHeadersFile } from './headers.ts';

export interface ServeOptions {
  root: string;
  port: number;
  report?: boolean;
  corpus?: string | undefined;
}

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

/** Resolves a URL path inside `base`; never escapes it. */
export async function resolveInside(base: string, urlPath: string): Promise<string | undefined> {
  const rel = normalize(decodeURIComponent(urlPath));
  // `/help` → help.html, as Cloudflare's `auto-trailing-slash` serves it (ADR-026).
  const candidates = [join(base, rel), join(base, rel, 'index.html')];
  if (extname(rel) === '' && !rel.endsWith(sep)) candidates.push(join(base, `${rel}.html`));
  for (const candidate of candidates) {
    if (candidate !== base && !candidate.startsWith(base + sep)) continue;
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export async function startServer(opts: ServeOptions): Promise<Server> {
  const root = resolve(opts.root);
  const corpus = opts.corpus ? resolve(opts.corpus) : undefined;
  const rules = parseHeadersFile(await readFile(join(root, '_headers'), 'utf8'));
  const reports: unknown[] = [];

  const lookup = async (path: string): Promise<string | undefined> =>
    corpus && path.startsWith('/corpus/')
      ? resolveInside(corpus, path.slice('/corpus'.length))
      : resolveInside(root, path);

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname === '/__csp-report' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          reports.push(JSON.parse(text));
        } catch {
          reports.push({ unparsable: text });
        }
        res.writeHead(204).end();
        return;
      }
      if (url.pathname === '/__csp-reports') {
        if (req.method === 'DELETE') reports.length = 0;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reports));
        return;
      }
      // Cloudflare Pages never serves `_headers` itself.
      const file = url.pathname === '/_headers' ? undefined : await lookup(url.pathname);
      // SPA fallback like Pages: unknown paths without an extension get index.html.
      const target =
        file ?? (extname(url.pathname) === '' ? await lookup('/index.html') : undefined);
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
      const csp = headers['Content-Security-Policy'];
      if (opts.report && csp) {
        headers['Content-Security-Policy-Report-Only'] = `${csp}; report-uri /__csp-report`;
      }
      res.writeHead(200, headers).end(body);
    })().catch((err: unknown) => {
      console.error(err);
      res.writeHead(500).end();
    });
  });

  // Playwright reuses keep-alive connections across a worker's tests; with
  // Node's default 5 s idle close, a request sent as the server closes the
  // socket fails with ECONNRESET. Tests never idle this long.
  server.keepAliveTimeout = 10 * 60_000;
  server.headersTimeout = server.keepAliveTimeout + 1000;
  await new Promise<void>((done) => server.listen(opts.port, done));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      port: { type: 'string', default: '4173' },
      report: { type: 'boolean', default: false },
      corpus: { type: 'string' },
    },
  });
  if (!values.root) throw new Error('--root is required');
  const server = await startServer({
    root: values.root,
    port: Number(values.port),
    report: values.report,
    corpus: values.corpus,
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : values.port;
  console.log(`serving ${resolve(values.root)} on http://localhost:${String(port)}`);
}
