// M1 acceptance table (M1-28, §12, D-27, ADR-002): reads Playwright JSON
// reports (the perf project, plus the @offline run for the offline proof)
// and checks the M1-relevant §12 targets on typical, self-made files.
//
// Usage: node scripts/acceptance.ts <report.json>... [--json <file>] [--markdown <file>]
// Missing numbers are "not measured" and fail the table, like a missed target.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { perfRows, type PerfRow, type PwReport } from './perf-report.ts';

export type Verdict = 'met' | 'missed' | 'not measured';

export interface TargetResult {
  area: string;
  target: string;
  measured: string;
  verdict: Verdict;
  source: string;
}

type Metrics = Map<string, string>;

function metric(rows: readonly PerfRow[]): Metrics {
  const m: Metrics = new Map();
  for (const r of rows) for (const [k, v] of Object.entries(r.metrics)) m.set(k, v);
  return m;
}

const num = (m: Metrics, key: string): number | undefined => {
  const v = m.get(key);
  const n = v === undefined ? NaN : Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

function json(m: Metrics, key: string): unknown {
  const v = m.get(key);
  if (v === undefined) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

function under(
  area: string,
  target: string,
  value: number | undefined,
  limit: number,
  source: string,
): TargetResult {
  if (value === undefined) return { area, target, measured: '—', verdict: 'not measured', source };
  return {
    area,
    target,
    measured: `${String(Math.round(value))} ms`,
    verdict: value < limit ? 'met' : 'missed',
    source,
  };
}

interface ScrollResult {
  firstPreviewMs?: number;
  scroll900?: { blankFrames: number; frames: number };
  scroll3000?: { blankFrames: number; frames: number };
}

export function evaluate(rows: readonly PerfRow[]): TargetResult[] {
  const m = metric(rows);
  const scroll = json(m, 'm1-scroll') as ScrollResult | undefined;
  const sharp = json(m, 'sharp-after-zoom-ms') as Record<string, number> | undefined;
  const perf = rows.filter((r) => r.file.includes('perf/'));
  const offline = rows.filter((r) => r.title.includes('zero outbound requests'));
  const blank = scroll?.scroll900 && scroll.scroll3000;
  const out: TargetResult[] = [
    under(
      'App start (offline, from the service worker cache)',
      'usable UI < 2 s',
      num(m, 'app-start-offline-ms'),
      2000,
      'perf/acceptance.spec.ts',
    ),
    under(
      'Open 2,000-page stand-in',
      'first page visible < 1.5 s',
      scroll?.firstPreviewMs,
      1500,
      'perf/scroll.spec.ts',
    ),
    {
      area: 'Scroll 2,000-page stand-in (900 and 3,000 px/s)',
      target: 'smooth, no blank page frames',
      measured: blank
        ? `${String(scroll.scroll900?.blankFrames)} / ${String(scroll.scroll3000?.blankFrames)} blank of ${String(scroll.scroll900?.frames)} / ${String(scroll.scroll3000?.frames)} frames`
        : '—',
      verdict: !blank
        ? 'not measured'
        : scroll.scroll900?.blankFrames === 0 && scroll.scroll3000?.blankFrames === 0
          ? 'met'
          : 'missed',
      source: 'perf/scroll.spec.ts',
    },
    under(
      'Dense A0 drawing (self-made)',
      'first view < 2 s',
      num(m, 'a0-first-view-ms'),
      2000,
      'perf/acceptance.spec.ts',
    ),
    under(
      'Dense A0 drawing: zoom 100 %, 800 %, 6400 %',
      'sharp tiles < 0.5 s',
      sharp ? Math.max(...Object.values(sharp)) : undefined,
      500,
      'perf/zoom.spec.ts',
    ),
    {
      area: 'Dense A0 drawing',
      target: 'zoom up to 6400 %',
      measured:
        sharp?.['6400'] !== undefined ? `6400 %: sharp in ${String(sharp['6400'])} ms` : '—',
      verdict: sharp?.['6400'] !== undefined ? 'met' : 'not measured',
      source: 'perf/zoom.spec.ts',
    },
    under(
      'Save (Ctrl+S, incremental, 100 markups)',
      '< 1 s',
      num(m, 'save-100-markups-ms'),
      1000,
      'perf/save.spec.ts',
    ),
    {
      area: 'UI responsiveness',
      target: 'no main-thread task > 100 ms (after boot)',
      measured: perf.length
        ? `${String(perf.filter((r) => r.status === 'passed').length)} of ${String(perf.length)} perf scenarios passed`
        : '—',
      verdict: !perf.length
        ? 'not measured'
        : perf.every((r) => r.status === 'passed' || r.status === 'skipped')
          ? 'met'
          : 'missed',
      source: 'e2e/perf/*',
    },
    {
      area: 'Offline proof',
      target: 'network off → M1 features work; zero outbound requests',
      measured: offline.length ? offline.map((r) => r.status).join(', ') : '—',
      verdict: !offline.length
        ? 'not measured'
        : offline.every((r) => r.status === 'passed')
          ? 'met'
          : 'missed',
      source: 'offline.spec.ts',
    },
  ];
  return out;
}

const MARK: Record<Verdict, string> = { met: '✅', missed: '❌', 'not measured': '⚠️' };

export function renderAcceptance(results: readonly TargetResult[]): string {
  return [
    '### M1 acceptance: §12 targets on typical (self-made) files',
    '',
    '| Area | Target | Measured | Result |',
    '| --- | --- | --- | --- |',
    ...results.map(
      (r) => `| ${r.area} | ${r.target} | ${r.measured} | ${MARK[r.verdict]} ${r.verdict} |`,
    ),
    '',
  ].join('\n');
}

function main(argv: string[]): void {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const inputs = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const rows = inputs.flatMap((f) => perfRows(JSON.parse(readFileSync(f, 'utf8')) as PwReport));
  const results = evaluate(rows);
  const md = renderAcceptance(results);
  console.log(md);
  const out = flag('--json');
  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify({ generated: new Date().toISOString(), results, scenarios: rows }, null, 2)}\n`,
    );
  }
  const markdown = flag('--markdown');
  if (markdown) writeFileSync(markdown, md);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, md);
  if (results.some((r) => r.verdict !== 'met')) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) main(process.argv.slice(2));
