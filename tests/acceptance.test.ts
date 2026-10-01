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
  row('perf/save-m3.spec.ts', 'save m3', { 'save-100-m3-markups-ms': '166' }),
  row('perf/snap.spec.ts', 'snap', { 'snap-rtt-p95-ms': '3.45' }),
  row('offline.spec.ts', 'M3 offline: markups, … zero outbound requests'),
  row('perf/oxide.spec.ts', 'markdown', { 'm4-markdown': JSON.stringify({ ms: 21_500 }) }),
  row('perf/export-images.spec.ts', 'images'),
  row('perf/tables.spec.ts', 'tables', {
    'm4-tables': JSON.stringify({ detectMs: 4000, saveMs: 600 }),
  }),
  row('perf/tables-review.spec.ts', 'review'),
  row('perf/pages.spec.ts', 'delete', { 'pages-delete-1000-ms': '2100' }),
  row('perf/pages.spec.ts', 'merge', { 'merge-10x200-ms': '3300' }),
  row('perf/comment-transfer.spec.ts', 'import', { 'transfer-import-1000-ms': '5200' }),
  row('perf/redact.spec.ts', 'redact', { 'm4-redact': JSON.stringify({ ms: 9000 }) }),
  row('perf/annotation-export.spec.ts', 'annotation export'),
  row('offline.spec.ts', 'M4 offline: tables, … zero outbound requests'),
  row('export.spec.ts', 'M4 exports offline: PDF Oxide from the cache, zero outbound requests'),
];

describe('M1 … M4 acceptance table (M1-28, M2-19, M3-20, M4-22)', () => {
  it('meets every target with good numbers', () => {
    const results = evaluate(GOOD);
    expect(results).toHaveLength(23);
    expect(results.find((r) => r.area.startsWith('Express Extract'))?.measured).toBe('4600 ms');
    expect(results.find((r) => r.area.startsWith('Markdown export'))?.measured).toBe('21500 ms');
    expect(results.find((r) => r.target === 'query round trip p95 ≤ 16 ms')?.measured).toBe(
      '3.45 ms',
    );
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
    const slowSnap = GOOD.map((r) =>
      r.file === 'perf/snap.spec.ts' ? { ...r, metrics: { 'snap-rtt-p95-ms': '21' } } : r,
    );
    expect(evaluate(slowSnap).find((r) => r.target.startsWith('query round trip'))?.verdict).toBe(
      'missed',
    );
    expect(new Map(evaluate(rows).map((r) => [r.area, r.verdict])).get('Offline proof (M3)')).toBe(
      'not measured',
    );
  });

  it('M4: a missing perf file is not measured, a failed scenario misses its row and responsiveness', () => {
    const noImages = GOOD.filter((r) => r.file !== 'perf/export-images.spec.ts');
    const byArea = (rows: PerfRow[]) => new Map(evaluate(rows).map((r) => [r.area, r.verdict]));
    const m4 = (a: string) => a.startsWith('UI responsiveness during M4');
    expect([...byArea(noImages)].find(([a]) => m4(a))?.[1]).toBe('not measured');
    const failedMerge = GOOD.map((r) => (r.title === 'merge' ? { ...r, status: 'failed' } : r));
    expect(byArea(failedMerge).get('Merge 10 files of 200 pages')).toBe('missed');
    expect([...byArea(failedMerge)].find(([a]) => m4(a))?.[1]).toBe('missed');
    const noM4Offline = GOOD.filter((r) => !r.title.startsWith('M4 '));
    expect(byArea(noM4Offline).get('Offline proof (M4)')).toBe('not measured');
    // The M4 offline runs are not counted as the M1 proof.
    expect(byArea(noM4Offline).get('Offline proof')).toBe('met');
    const failedExports = GOOD.map((r) =>
      r.title.startsWith('M4 exports') ? { ...r, status: 'failed' } : r,
    );
    expect(byArea(failedExports).get('Offline proof (M4)')).toBe('missed');
    expect(byArea(failedExports).get('Offline proof')).toBe('met');
  });
});
