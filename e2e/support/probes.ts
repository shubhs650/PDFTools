// Page-side probes, injected by Playwright with `page.addInitScript` before any
// app code runs, so the shipped app carries no probe code. They record
// main-thread long tasks and CSP violations seen by the document. Violations in
// workers and the service worker reach the server's Report-Only endpoint
// instead (scripts/serve.ts --report).

export interface LongTask {
  start: number;
  duration: number;
}

export interface DocumentCspViolation {
  directive: string;
  blockedURI: string;
  sourceFile: string;
}

export interface PageProbe {
  longTasks: LongTask[];
  cspViolations: DocumentCspViolation[];
  /** `performance.now()` when the test said boot is over (perf gate starts here). */
  measureFrom: number | null;
}

/** Runs in the page. Must be self-contained: Playwright serializes it. */
export function installPageProbe(): void {
  const probe: PageProbe = { longTasks: [], cspViolations: [], measureFrom: null };
  (window as unknown as { __probe: PageProbe }).__probe = probe;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        probe.longTasks.push({ start: e.startTime, duration: e.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // `longtask` is Chromium-only.
  }
  document.addEventListener('securitypolicyviolation', (e) => {
    probe.cspViolations.push({
      directive: e.effectiveDirective,
      blockedURI: e.blockedURI,
      sourceFile: e.sourceFile,
    });
  });
}

/**
 * True for a request that leaves the app's origin (CLAUDE.md rule 4). `blob:`
 * and `data:` URLs are local; `blob:` URLs carry their creator's origin.
 */
export function isThirdParty(url: string, appOrigin: string): boolean {
  if (url.startsWith('data:')) return false;
  const bare = url.startsWith('blob:') ? url.slice('blob:'.length) : url;
  let parsed: URL;
  try {
    parsed = new URL(bare);
  } catch {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return parsed.origin !== appOrigin;
}

/** Long tasks that count against the perf gate (> 100 ms, after boot; ADR-001 B4). */
export function gatedLongTasks(probe: PageProbe, limitMs = 100): LongTask[] {
  if (probe.measureFrom === null) return [];
  const from = probe.measureFrom;
  return probe.longTasks.filter((t) => t.start >= from && t.duration > limitMs);
}
