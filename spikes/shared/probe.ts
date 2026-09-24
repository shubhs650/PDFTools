// Page-side probes shared by the spikes: main-thread long tasks and CSP
// violations seen by the document. Results are read by Playwright.

export interface LongTaskEntry {
  start: number;
  duration: number;
}

export interface CspViolation {
  directive: string;
  blockedURI: string;
  sourceFile: string;
}

export const probe = {
  longTasks: [] as LongTaskEntry[],
  cspViolations: [] as CspViolation[],
};

export function installProbes(): void {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        probe.longTasks.push({ start: e.startTime, duration: e.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask is Chromium-only; Firefox has no entries to report.
  }
  document.addEventListener('securitypolicyviolation', (e) => {
    probe.cspViolations.push({
      directive: e.effectiveDirective,
      blockedURI: e.blockedURI,
      sourceFile: e.sourceFile,
    });
  });
}

/** Count "ink" pixels (dark red channel) in RGBA data. */
export function countInk(data: Uint8ClampedArray | Uint8Array): number {
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 128) ink++;
  return ink;
}
