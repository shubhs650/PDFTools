// M2-17 (D-22, §10.2, rule 10): the error report's sanitizer, payload builder,
// schema and sender. The sanitizer runs against a corpus of nasty inputs:
// anything that could be document content or name the user's files goes.
import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticEntry } from '../../src/app/diagnostics';
import {
  browserOf,
  buildReport,
  osOf,
  reportJson,
  type ReportInput,
} from '../../src/features/report/payload';
import { redact, redactStack } from '../../src/features/report/redact';
import { sendReport } from '../../src/features/report/send';
import { isReportPayload, LIMITS } from '../../src/model/report';

const ORIGIN = 'https://pdf-tools.openengtools.com';

describe('redact', () => {
  const cases: [string, string][] = [
    // Quoted text (page text, annotation text in messages)
    ['Unexpected token "Confidential bid" at 3', 'Unexpected token <text> at 3'],
    ["can't find 'Section 4.2 Pressure test'", "can't find <text>"],
    ['“Smart quotes” and «guillemets»', '<text> and <text>'],
    // blob:, data:, other origins
    ['at x (blob:https://pdf-tools.openengtools.com/0f1e-aa:1:2)', 'at x (<blob>)'],
    ['img data:image/png;base64,AAAA', 'img <data>'],
    ['at y (https://evil.example/assets/a.js:1:2)', 'at y (<url>)'],
    ['GET https://pdf-tools.openengtools.com/api/report?name=plan', 'GET <url>'],
    // Paths and file names
    ['at z (file:///C:/Users/alice/bid.pdf:1:1)', 'at z (<url>)'],
    ['open C:\\Users\\alice\\Documents\\bid 2026.pdf', 'open <path> <file>'],
    ['\\\\server\\share\\drawings\\P-101.dwg failed', '<path> failed'],
    ['at load (/home/alice/projects/plan.dwg:3:4)', 'at load (<path>:3:4)'],
    ['/Users/bob/Desktop/x', '<path>'],
    ['reading contract-final.PDF now', 'reading <file> now'],
    ['Files/secret plan.docx', 'Files/secret <file>'],
    ['mail alice@example.com please', 'mail <email> please'],
    // Control characters
    ['a\u0000b\u001fc', 'a b c'],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(redact(input, ORIGIN)).toBe(expected);
  });

  it("keeps the app's own script locations, without the origin", () => {
    expect(redact(`at f (${ORIGIN}/assets/index-abc123.js:1:2345)`, ORIGIN)).toBe(
      'at f (/assets/index-abc123.js:1:2345)',
    );
    expect(redact(`g@${ORIGIN}/assets/work.worker-x.js:10:20`, ORIGIN)).toBe(
      'g@/assets/work.worker-x.js:10:20',
    );
    expect(
      redact('at h (http://localhost:5173/src/app/App.tsx:5:6)', 'http://localhost:5173'),
    ).toBe('at h (/src/app/App.tsx:5:6)');
    // Same path on another origin: hidden.
    expect(redact('at f (https://x.test/assets/a.js:1:2)', ORIGIN)).toBe('at f (<url>)');
    // Function names that look like "name.ext" are not file names.
    expect(redact('at Object.keys (<anonymous>)', ORIGIN)).toBe('at Object.keys (<anonymous>)');
  });

  it('redactStack keeps frames only, sanitized and bounded', () => {
    const stack = [
      'Error: could not read "bid.pdf"',
      `    at a (${ORIGIN}/assets/i.js:1:2)`,
      '    at b (C:\\Users\\alice\\x.pdf:3:4)',
      ...Array.from({ length: 30 }, (_, i) => `    at f${String(i)} (${ORIGIN}/assets/i.js:1:2)`),
    ].join('\n');
    const frames = redactStack(stack, ORIGIN, 20, 300);
    expect(frames).toHaveLength(20);
    expect(frames[0]).toBe('at a (/assets/i.js:1:2)');
    expect(frames[1]).toBe('at b (<path>:3:4)');
    expect(frames.join('\n')).not.toMatch(/alice|bid|x\.pdf/);
    expect(redactStack('at ' + 'x'.repeat(400), ORIGIN, 5, 50)[0]).toHaveLength(50);
  });
});

describe('browser and OS families', () => {
  it('reads client hints first, then the user agent', () => {
    expect(
      browserOf({
        userAgent: '',
        userAgentData: {
          brands: [
            { brand: 'Not.A/Brand', version: '99' },
            { brand: 'Chromium', version: '151' },
            { brand: 'Microsoft Edge', version: '151.0.1' },
          ],
          platform: 'Windows',
        },
      }),
    ).toBe('Edge 151');
    const ff = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
    expect(browserOf({ userAgent: ff })).toBe('Firefox 140');
    expect(osOf({ userAgent: ff })).toBe('Linux');
    const safari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    expect(browserOf({ userAgent: safari })).toBe('Safari 18');
    expect(osOf({ userAgent: safari })).toBe('macOS');
    expect(osOf({ userAgent: 'x', userAgentData: { platform: 'Windows' } })).toBe('Windows');
    expect(osOf({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/151' })).toBe('Android');
    expect(browserOf({ userAgent: 'curl/8' })).toBe('Other');
  });
});

const entry = (over: Partial<DiagnosticEntry> = {}): DiagnosticEntry => ({
  code: 'internal',
  message: 'TypeError',
  at: 1_000,
  where: 'document',
  stack: `    at render (${ORIGIN}/assets/index.js:1:2)\n    at z (/home/alice/bid.pdf:1:1)`,
  ...over,
});

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  description: '',
  error: null,
  feature: 'help',
  log: [],
  app: '0.1.0+abc1234',
  nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/151.0 Safari/537.36' },
  origin: ORIGIN,
  session: '6f1c8e5a-1b2c-4d3e-8f90-123456789abc',
  now: 61_000,
  ...over,
});

describe('buildReport', () => {
  it('is exactly the schema, with the caught error sanitized and the log as ages', () => {
    const p = buildReport(
      input({
        description: 'Clicked Print',
        error: entry(),
        feature: 'document',
        log: [
          entry({
            code: 'save-fallback:form',
            where: 'save',
            counts: { objectCount: 3, size: 900 },
          }),
        ],
      }),
    );
    expect(p).toEqual({
      v: 1,
      description: 'Clicked Print',
      app: '0.1.0+abc1234',
      browser: 'Chrome 151',
      os: 'Windows',
      feature: 'document',
      error: {
        code: 'internal',
        where: 'document',
        stack: ['at render (/assets/index.js:1:2)', 'at z (<path>:1:1)'],
      },
      session: '6f1c8e5a-1b2c-4d3e-8f90-123456789abc',
      log: [
        {
          ago: 60,
          where: 'save',
          code: 'save-fallback:form',
          counts: { objectCount: 3, size: 900 },
        },
      ],
    });
    expect(isReportPayload(p)).toBe(true);
    expect(isReportPayload(JSON.parse(reportJson(p)))).toBe(true);
  });

  it('codes and names that carry content are reduced to tokens', () => {
    const p = buildReport(
      input({ error: entry({ code: 'bad "Secret" C:\\a\\b.pdf', where: 'x@y.com' }) }),
    );
    expect(p.error?.code).toBe('bad text path');
    expect(p.error?.where).toBe('email');
    expect(isReportPayload(p)).toBe(true);
  });

  it('bounds the description and the log, and keeps the JSON under the body limit', () => {
    const long = buildReport(
      input({
        description: 'x'.repeat(5000),
        log: Array.from({ length: 60 }, (_, i) => entry({ at: i, code: `c${String(i)}` })),
      }),
    );
    expect(long.description).toHaveLength(LIMITS.description);
    expect(long.log).toHaveLength(LIMITS.log);
    expect(long.log[0]?.code).toBe('c40'); // the newest are kept
    const json = reportJson(long);
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(LIMITS.bodyBytes);
    expect(isReportPayload(JSON.parse(json))).toBe(true);
  });
});

describe('isReportPayload', () => {
  const good = buildReport(input());
  it('rejects extra, missing or ill-typed fields', () => {
    expect(isReportPayload(good)).toBe(true);
    expect(isReportPayload({ ...good, extra: 1 })).toBe(false);
    const missing: Record<string, unknown> = { ...good };
    delete missing.os;
    expect(isReportPayload(missing)).toBe(false);
    expect(isReportPayload({ ...good, v: 2 })).toBe(false);
    expect(isReportPayload({ ...good, session: 'not a uuid!' })).toBe(false);
    expect(isReportPayload({ ...good, browser: 'Chrome "evil"' })).toBe(false);
    expect(isReportPayload({ ...good, description: 'x'.repeat(2001) })).toBe(false);
    expect(isReportPayload({ ...good, error: { code: 'a', where: 'b', stack: [1] } })).toBe(false);
    expect(isReportPayload({ ...good, log: [{ ago: -1, where: 'a', code: 'b' }] })).toBe(false);
    expect(isReportPayload({ ...good, log: [{ ago: 1, where: 'a', code: 'b', text: 'x' }] })).toBe(
      false,
    );
    expect(isReportPayload(null)).toBe(false);
    expect(isReportPayload([])).toBe(false);
  });
});

describe('sendReport', () => {
  it('posts the JSON to the same-origin endpoint only', async () => {
    const f = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await sendReport('{"v":1}', f as unknown as typeof fetch, () => true)).toBe('sent');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/report');
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"v":1}',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });

  it('offline, rate-limited and failures', async () => {
    const never = vi.fn();
    expect(await sendReport('{}', never as unknown as typeof fetch, () => false)).toBe('offline');
    expect(never).not.toHaveBeenCalled();
    const status = (s: number) => () => Promise.resolve(new Response(null, { status: s }));
    expect(await sendReport('{}', status(429) as typeof fetch, () => true)).toBe('rateLimited');
    expect(await sendReport('{}', status(500) as typeof fetch, () => true)).toBe('failed');
    const reject = () => Promise.reject(new TypeError('network'));
    // A request that never reaches the server is offline, whatever navigator.onLine says.
    expect(await sendReport('{}', reject as typeof fetch, () => true)).toBe('offline');
  });
});
