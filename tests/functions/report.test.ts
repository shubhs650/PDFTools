// M2-18 (D-22, §10.2, M2-Q5): POST /api/report with in-memory stand-ins for
// D1 and the mail binding: a valid report, bad method, oversize, bad schema,
// cross-origin, rate limit, storage and mail failures.
import { describe, expect, it } from 'vitest';
import {
  handleReport,
  noticeMail,
  onRequest,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  SQL,
  type D1Like,
  type D1Statement,
  type Notice,
  type ReportDeps,
} from '../../functions/api/report';
import { buildReport } from '../../src/features/report/payload';
import { reportJson } from '../../src/features/report/payload';
import { LIMITS } from '../../src/model/report';

const URL_ = 'https://pdf-tools.openengtools.com/api/report';

/** Just enough of D1 for the handler's four statements. */
class FakeD1 implements D1Like {
  rate: { ip_hash: string; at: number }[] = [];
  reports: Record<string, string | number | null>[] = [];
  failOn: string | null = null;

  prepare(sql: string): D1Statement {
    let args: (string | number | null)[] = [];
    const check = () => {
      if (this.failOn && sql === this.failOn) throw new Error('D1 unavailable');
    };
    const stmt: D1Statement = {
      bind: (...v) => {
        args = v;
        return stmt;
      },
      first: <T>() => {
        check();
        if (sql !== SQL.count) throw new Error(`unexpected first(): ${sql}`);
        const [hash, since] = args as [string, number];
        const n = this.rate.filter((r) => r.ip_hash === hash && r.at >= since).length;
        return Promise.resolve({ n } as T);
      },
      run: () => {
        check();
        if (sql === SQL.prune) {
          const [before] = args as [number];
          this.rate = this.rate.filter((r) => r.at >= before);
        } else if (sql === SQL.hit) {
          const [ip_hash, at] = args as [string, number];
          this.rate.push({ ip_hash, at });
        } else if (sql === SQL.insert) {
          const cols = [
            'id',
            'received_at',
            'app',
            'browser',
            'os',
            'feature',
            'error_code',
            'session',
            'payload',
          ];
          this.reports.push(Object.fromEntries(cols.map((c, i) => [c, args[i] ?? null])));
        } else throw new Error(`unexpected run(): ${sql}`);
        return Promise.resolve({});
      },
    };
    return stmt;
  }
}

const payload = () =>
  buildReport({
    description: 'Printing froze',
    error: {
      code: 'internal',
      message: 'TypeError',
      at: 0,
      where: 'document',
      stack: '    at f (https://pdf-tools.openengtools.com/assets/i.js:1:2)',
    },
    feature: 'document',
    log: [],
    app: '0.1.0+abc1234',
    nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/151.0' },
    origin: 'https://pdf-tools.openengtools.com',
    session: '6f1c8e5a-1b2c-4d3e-8f90-123456789abc',
    now: 0,
  });

function setup(over: Partial<ReportDeps> = {}) {
  const db = new FakeD1();
  const sent: Notice[] = [];
  let clock = 1_000_000;
  let seq = 0;
  const deps: ReportDeps = {
    db,
    notify: (n) => {
      sent.push(n);
      return Promise.resolve();
    },
    salt: 'test-salt',
    now: () => clock,
    newId: () => `r${String(++seq)}`,
    ...over,
  };
  return {
    db,
    sent,
    deps,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const post = (body: string, headers: Record<string, string> = {}, method = 'POST'): Request =>
  new Request(URL_, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  });

describe('POST /api/report', () => {
  it('a valid report: 204 without echo, stored (no IP), one short notification', async () => {
    const { db, sent, deps } = setup();
    const json = reportJson(payload());
    const res = await handleReport(
      post(json, { origin: 'https://pdf-tools.openengtools.com' }),
      deps,
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(db.reports).toHaveLength(1);
    const row = db.reports[0];
    expect(row).toMatchObject({
      id: 'r1',
      received_at: 1_000_000,
      app: '0.1.0+abc1234',
      browser: 'Chrome 151',
      os: 'Windows',
      feature: 'document',
      error_code: 'internal',
      session: '6f1c8e5a-1b2c-4d3e-8f90-123456789abc',
    });
    expect(JSON.parse(String(row?.payload))).toEqual(JSON.parse(json));
    // The rate limiter keeps a salted hash, never the IP.
    expect(db.rate).toHaveLength(1);
    expect(db.rate[0]?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(db)).not.toContain('203.0.113.7');
    expect(sent).toEqual([
      {
        id: 'r1',
        app: '0.1.0+abc1234',
        code: 'internal',
        feature: 'document',
        browser: 'Chrome 151',
        os: 'Windows',
      },
    ]);
  });

  it('only POST with application/json', async () => {
    const { deps, db } = setup();
    const get = await handleReport(post('', {}, 'GET'), deps);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await handleReport(post('{}', {}, 'PUT'), deps)).status).toBe(405);
    const form = await handleReport(
      post(reportJson(payload()), { 'content-type': 'text/plain' }),
      deps,
    );
    expect(form.status).toBe(415);
    const withCharset = post(reportJson(payload()), {
      'content-type': 'application/json; charset=utf-8',
    });
    expect((await handleReport(withCharset, deps)).status).toBe(204);
    expect(db.reports).toHaveLength(1);
  });

  it('oversize bodies are refused, declared or not', async () => {
    const { deps, db } = setup();
    const big = JSON.stringify({ ...payload(), description: 'x'.repeat(LIMITS.bodyBytes) });
    expect((await handleReport(post(big), deps)).status).toBe(413);
    // A lying Content-Length doesn't help: the body is counted as it is read.
    const lying = post(big, { 'content-length': '100' });
    expect((await handleReport(lying, deps)).status).toBe(413);
    expect(db.reports).toHaveLength(0);
    expect(db.rate).toHaveLength(0);
  });

  it('bad JSON, extra fields or a wrong schema: 400, nothing stored or echoed', async () => {
    const { deps, db } = setup();
    for (const body of [
      'not json',
      '[]',
      JSON.stringify({ ...payload(), extra: 'x' }),
      JSON.stringify({ ...payload(), v: 2 }),
      JSON.stringify({ ...payload(), browser: '<script>alert(1)</script>' }),
      JSON.stringify({ ...payload(), error: { code: 'x', where: 'y', stack: 'nope' } }),
    ]) {
      const res = await handleReport(post(body), deps);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('bad request');
    }
    expect(db.reports).toHaveLength(0);
  });

  it('a cross-origin browser POST is refused', async () => {
    const { deps, db } = setup();
    const res = await handleReport(
      post(reportJson(payload()), { origin: 'https://evil.example' }),
      deps,
    );
    expect(res.status).toBe(403);
    expect(db.reports).toHaveLength(0);
  });

  it(`rate limit: ${String(RATE_LIMIT)} per IP per hour, then 429; other IPs and the next hour are fine`, async () => {
    const { deps, db, tick } = setup();
    const json = reportJson(payload());
    for (let i = 0; i < RATE_LIMIT; i++)
      expect((await handleReport(post(json), deps)).status).toBe(204);
    const limited = await handleReport(post(json), deps);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('3600');
    expect(
      (await handleReport(post(json, { 'cf-connecting-ip': '198.51.100.1' }), deps)).status,
    ).toBe(204);
    tick(RATE_WINDOW_MS + 1);
    expect((await handleReport(post(json), deps)).status).toBe(204);
    expect(db.reports).toHaveLength(RATE_LIMIT + 2);
    // Old rate rows are pruned.
    expect(db.rate.every((r) => r.at >= 1_000_000 + 1)).toBe(true);
  });

  it('storage failure: 500 without details; a mail failure still stores the report', async () => {
    const failing = setup();
    failing.db.failOn = SQL.insert;
    const res = await handleReport(post(reportJson(payload())), failing.deps);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('server error');

    const mailDown = setup({ notify: () => Promise.reject(new Error('mail down')) });
    expect((await handleReport(post(reportJson(payload())), mailDown.deps)).status).toBe(204);
    expect(mailDown.db.reports).toHaveLength(1);

    const noMail = setup({ notify: null });
    expect((await handleReport(post(reportJson(payload())), noMail.deps)).status).toBe(204);
  });

  it('the Pages entry wires the bindings (no mail binding: stored only)', async () => {
    const db = new FakeD1();
    const res = await onRequest({
      request: post(reportJson(payload())),
      env: { REPORT_DB: db, REPORT_SALT: 's' },
    });
    expect(res.status).toBe(204);
    expect(db.reports).toHaveLength(1);
    expect(String(db.reports[0]?.id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the notification mail has no description or stack', () => {
    const mail = noticeMail(
      {
        id: 'r1',
        app: '0.1.0',
        code: 'internal',
        feature: 'document',
        browser: 'Chrome 151',
        os: 'Windows',
      },
      'reports@example.org',
      'dev@example.org',
      new Date(0),
    );
    expect(mail).toContain('Subject: PDFTools error report r1');
    expect(mail).toContain('Error: internal');
    expect(mail).not.toContain('Printing froze');
    expect(mail).not.toContain('assets/i.js');
    expect(mail.split('\r\n\r\n')[0]).toMatch(/^From: .*\r\nTo: .*\r\nSubject: /);
  });
});
