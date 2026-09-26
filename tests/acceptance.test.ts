import { describe, expect, it } from 'vitest';
import { evaluate, renderAcceptance } from '../scripts/acceptance.ts';
import type { PerfRow } from '../scripts/perf-report.ts';

const row = (file: string, title: string, metrics: Record<string, string> = {}): PerfRow => ({
  file,
  title,
  status: 'passed',
  durationMs: 1000,
  metrics,
});

const GOOD: PerfRow[] = [
  row('perf/acceptance.spec.ts', 'app start', { 'app-start-offline-ms': '420' }),
  row('perf/acceptance.spec.ts', 'a0', { 'a0-first-view-ms': '600' }),
  row('perf/scroll.spec.ts', 'scroll', {
    'm1-scroll': JSON.stringify({
      firstPreviewMs: 850,
      scroll900: { frames: 300, blankFrames: 0 },
      scroll3000: { frames: 180, blankFrames: 0 },
    }),
  }),
  row('perf/zoom.spec.ts', 'zoom', {
    'sharp-after-zoom-ms': JSON.stringify({ '100': 290, '800': 185, '6400': 240 }),
  }),
  row('perf/save.spec.ts', 'save', { 'save-100-markups-ms': '128' }),
  row('offline.spec.ts', 'offline: open, save with zero outbound requests'),
];

describe('M1 acceptance table (M1-28)', () => {
  it('meets every target with good numbers', () => {
    const results = evaluate(GOOD);
    expect(results).toHaveLength(9);
    expect(results.filter((r) => r.verdict !== 'met')).toEqual([]);
    expect(results.find((r) => r.target === 'sharp tiles < 0.5 s')?.measured).toBe('290 ms');
  });

  it('a slow number is missed, a missing one is not measured, a failed perf test fails responsiveness', () => {
    const rows = GOOD.map((r) =>
      r.file === 'perf/save.spec.ts'
        ? { ...r, status: 'failed', metrics: { 'save-100-markups-ms': '1500' } }
        : r,
    ).filter((r) => r.file !== 'offline.spec.ts');
    const byArea = new Map(evaluate(rows).map((r) => [r.target, r.verdict]));
    expect(byArea.get('< 1 s')).toBe('missed');
    expect(byArea.get('no main-thread task > 100 ms (after boot)')).toBe('missed');
    expect(byArea.get('network off → M1 features work; zero outbound requests')).toBe(
      'not measured',
    );
    expect(renderAcceptance(evaluate(rows))).toContain('❌ missed');
  });
});
