// Shared Playwright fixtures (M1-02). Import `test` and `expect` from here, not
// from @playwright/test, so every test:
//   - runs against the built app (`vite build --mode e2e`, see global-setup.ts),
//     served by scripts/serve.ts with the production `_headers` (CSP, COOP/COEP);
//   - fails on any CSP violation (document or Report-Only endpoint) and on any
//     request that leaves the app's origin (CLAUDE.md rule 4, D-22);
//   - in the `perf` project, fails on any main-thread long task > 100 ms after
//     `guard.startMeasuring()` (cold boot is exempt, ADR-001 B4).
// Each Playwright worker gets its own server, so CSP reports never mix
// between tests running in parallel.

import type { Server } from 'node:http';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { startServer } from '../../scripts/serve.ts';
import { E2E_DIST } from './paths.ts';
import {
  gatedLongTasks,
  installPageProbe,
  isThirdParty,
  type DocumentCspViolation,
  type LongTask,
  type PageProbe,
} from './probes.ts';
import {
  a0Sheet,
  annotatedPdf,
  cjkFallbackPdf,
  contractPdf,
  simplePdf,
} from '../fixtures/generate.ts';

export class Guard {
  readonly thirdPartyRequests: string[] = [];

  private readonly page: Page;
  private readonly request: APIRequestContext;
  readonly origin: string;

  constructor(page: Page, request: APIRequestContext, origin: string) {
    this.page = page;
    this.request = request;
    this.origin = origin;
  }

  private probe(): Promise<PageProbe | undefined> {
    return this.page
      .evaluate(() => (window as unknown as { __probe?: PageProbe }).__probe)
      .catch(() => undefined);
  }

  /** Call once the app has booted; long tasks before this are not gated. */
  async startMeasuring(): Promise<void> {
    await this.page.evaluate(() => {
      const p = (window as unknown as { __probe: PageProbe }).__probe;
      p.measureFrom = performance.now();
      p.longTasks.length = 0;
    });
  }

  async documentCspViolations(): Promise<DocumentCspViolation[]> {
    return (await this.probe())?.cspViolations ?? [];
  }

  /** Reports from the page, its workers and the service worker (Report-Only copy). */
  async reportedCspViolations(): Promise<unknown[]> {
    const res = await this.request.get(`${this.origin}/__csp-reports`);
    return (await res.json()) as unknown[];
  }

  async longTasksOverLimit(): Promise<LongTask[]> {
    const p = await this.probe();
    return p ? gatedLongTasks(p) : [];
  }

  async measuring(): Promise<boolean> {
    return ((await this.probe())?.measureFrom ?? null) !== null;
  }

  /**
   * Everything the guard objects to, keyed by kind. The fixture teardown fails
   * the test unless this is empty; negative controls assert on it directly.
   */
  async problems(perf: boolean): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    const add = (kind: string, items: unknown[]): void => {
      if (items.length) out[kind] = items;
    };
    add('third-party requests (rule 4)', this.thirdPartyRequests);
    add('CSP violations in the document', await this.documentCspViolations());
    add(
      'CSP violations reported (page, workers, service worker)',
      await this.reportedCspViolations(),
    );
    if (perf) {
      if (!(await this.measuring())) add('perf test never called guard.startMeasuring()', [true]);
      add('main-thread tasks > 100 ms after boot (rule 1)', await this.longTasksOverLimit());
    }
    return out;
  }

  /** For negative controls: forget what was recorded so far. */
  async acknowledge(): Promise<void> {
    this.thirdPartyRequests.length = 0;
    await this.request.delete(`${this.origin}/__csp-reports`);
    await this.page
      .evaluate(() => {
        const p = (window as unknown as { __probe?: PageProbe }).__probe;
        if (p) {
          p.cspViolations.length = 0;
          p.longTasks.length = 0;
        }
      })
      .catch(() => undefined);
  }
}

/** Lazily generated, cached self-made PDFs (never written to the repo). */
export interface Pdfs {
  simple(pages?: number): Buffer;
  contract(pages?: number): Buffer;
  /** Sticky-note comment and a two-entry outline (M2-09). */
  annotated(): Buffer;
  a0(segments: number): Buffer;
  cjk(): Buffer;
}

function makePdfs(): Pdfs {
  const cache = new Map<string, Buffer>();
  const memo = (key: string, make: () => Uint8Array): Buffer => {
    let b = cache.get(key);
    if (!b) {
      b = Buffer.from(make());
      cache.set(key, b);
    }
    return b;
  };
  return {
    simple: (pages = 1) => memo(`simple-${String(pages)}`, () => simplePdf(pages)),
    contract: (pages = 2000) => memo(`contract-${String(pages)}`, () => contractPdf(pages)),
    annotated: () => memo('annotated', annotatedPdf),
    a0: (segments) => memo(`a0-${String(segments)}`, () => a0Sheet(segments)),
    cjk: () => memo('cjk', () => cjkFallbackPdf()),
  };
}

export const test = base.extend<{ guard: Guard }, { appServer: string; pdfs: Pdfs }>({
  appServer: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form
    async ({}, use) => {
      const server: Server = await startServer({ root: E2E_DIST, port: 0, report: true });
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('server has no port');
      await use(`http://localhost:${String(addr.port)}`);
      await new Promise((done) => server.close(done));
    },
    { scope: 'worker' },
  ],
  pdfs: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form
    async ({}, use) => {
      await use(makePdfs());
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ appServer }, use) => {
    await use(appServer);
  },
  guard: [
    async ({ page, context, appServer }, use, testInfo) => {
      await context.request.delete(`${appServer}/__csp-reports`);
      const guard = new Guard(page, context.request, appServer);
      context.on('request', (r) => {
        if (isThirdParty(r.url(), appServer)) guard.thirdPartyRequests.push(r.url());
      });
      await page.addInitScript(installPageProbe);

      await use(guard);

      expect(await guard.problems(testInfo.project.name === 'perf')).toEqual({});
    },
    { auto: true },
  ],
});

export { expect };
