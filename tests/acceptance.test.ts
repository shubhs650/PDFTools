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
  row('perf/search.spec.ts', 'search', {
    'm2-search': JSON.stringify({ common: { firstHitMs: 120, totalMs: 5400 } }),
  }),
  row('offline.spec.ts', 'M2 offline: protected open, … zero outbound requests'),
];

describe('M1 + M2 acceptance table (M1-28, M2-19)', () => {
  it('meets every target with good numbers', () => {
    const results = evaluate(GOOD);
    expect(results).toHaveLength(12);
    expect(results.find((r) => r.target === 'first hits < 1 s')?.measured).toBe('120 ms');
    expect(results.find((r) => r.target === 'complete < 15 s')?.measured).toBe('5400 ms');
    expect(results.filter((r) => r.verdict !== 'met')).toEqual([]);
    expect(results.find((r) => r.target === 'sharp tiles < 0.5 s')?.measured).toBe('290 ms');
  });

  it('a slow number is missed, a missing one is not measured, a failed perf test fails responsiveness', () => {
    const rows = GOOD.map((r) =>
      r.file === 'perf/save.spec.ts'
        ? { ...r, status: 'failed', metrics: { 'save-100-markups-ms': '1500' } }
        : r,
    ).filter((r) => r.file !== 'offline.spec.ts' && r.file !== 'perf/search.spec.ts');
    const byArea = new Map(evaluate(rows).map((r) => [r.target, r.verdict]));
    expect(byArea.get('< 1 s')).toBe('missed');
    expect(byArea.get('no main-thread task > 100 ms (after boot)')).toBe('missed');
    expect(byArea.get('network off → M1 features work; zero outbound requests')).toBe(
      'not measured',
    );
    expect(byArea.get('first hits < 1 s')).toBe('not measured');
    expect(byArea.get('complete < 15 s')).toBe('not measured');
    expect(renderAcceptance(evaluate(rows))).toContain('❌ missed');
  });
});
