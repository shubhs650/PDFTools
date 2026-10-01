// M1 … M4 acceptance table (M1-28, M2-19, M3-20, M4-22, §12, D-27, ADR-002):
// reads Playwright JSON reports (the perf project, plus the @offline run for the
// offline proofs) and checks the §12 targets on typical, self-made files. M4's
// bulk jobs have no §12 time target: their times are reported, and each must
// pass its no-long-task scenario.
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

interface SearchRun {
  firstHitMs: number | null;
  totalMs: number;
}

interface ScrollResult {
  firstPreviewMs?: number;
  scroll900?: { blankFrames: number; frames: number };
  scroll3000?: { blankFrames: number; frames: number };
}

/** The M4 perf scenarios (e2e/perf/<name>.spec.ts), each a no-long-task gate. */
export const M4_PERF = [
  'oxide',
  'export-images',
  'tables',
  'tables-review',
  'pages',
  'comment-transfer',
  'redact',
  'annotation-export',
] as const;

/** The M4 offline proofs: "M4 offline: …" and "M4 exports offline: …". */
const M4_OFFLINE = /^M4 [\w ]*offline\b/u;

export function evaluate(rows: readonly PerfRow[]): TargetResult[] {
  const m = metric(rows);
  const scroll = json(m, 'm1-scroll') as ScrollResult | undefined;
  const sharp = json(m, 'sharp-after-zoom-ms') as Record<string, number> | undefined;
  const perf = rows.filter((r) => r.file.includes('perf/'));
  const offline = rows.filter(
    (r) =>
      r.title.includes('zero outbound requests') &&
      !r.title.startsWith('M2 offline') &&
      !r.title.startsWith('M3 offline') &&
      !M4_OFFLINE.test(r.title),
  );
  const offlineM2 = rows.filter((r) => r.title.startsWith('M2 offline'));
  const offlineM3 = rows.filter((r) => r.title.startsWith('M3 offline'));
  const offlineM4 = rows.filter((r) => M4_OFFLINE.test(r.title));
  const perfM4 = rows.filter((r) => M4_PERF.some((f) => r.file.endsWith(`perf/${f}.spec.ts`)));
  const m4Files = new Set(perfM4.map((r) => r.file.replace(/^.*perf\//u, '')));
  const statusOf = (metricKey: string) =>
    rows.find((r) => metricKey in r.metrics)?.status ?? 'passed';
  const reported = (area: string, key: string, value: number | undefined, source: string) =>
    ({
      area,
      target: 'reported; no main-thread task > 100 ms',
      measured: value === undefined ? '—' : `${String(Math.round(value))} ms`,
      verdict: value === undefined ? 'not measured' : statusOf(key) === 'passed' ? 'met' : 'missed',
      source,
    }) satisfies TargetResult;
  const ms = (key: string, field: string): number | undefined => {
    const v = json(m, key) as Record<string, unknown> | undefined;
    const n = v?.[field];
    return typeof n === 'number' ? n : undefined;
  };
  const tables = json(m, 'm4-tables') as { detectMs?: number; saveMs?: number } | undefined;
  const snapP95 = num(m, 'snap-rtt-p95-ms');
  const search = (json(m, 'm2-search') as { common?: SearchRun } | undefined)?.common;
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
    // M2 (M2-19)
    under(
      'Search the 2,000-page stand-in (common word, cold)',
      'first hits < 1 s',
      search?.firstHitMs ?? undefined,
      1000,
      'perf/search.spec.ts',
    ),
    under(
      'Search the 2,000-page stand-in (common word, cold)',
      'complete < 15 s',
      search?.totalMs,
      15_000,
      'perf/search.spec.ts',
    ),
    {
      area: 'Offline proof (M2)',
      target:
        'network off → protected open, search, panes, forms save, print, export work; report fails gracefully; zero outbound requests',
      measured: offlineM2.length ? offlineM2.map((r) => r.status).join(', ') : '—',
      verdict: !offlineM2.length
        ? 'not measured'
        : offlineM2.every((r) => r.status === 'passed')
          ? 'met'
          : 'missed',
      source: 'offline.spec.ts',
    },
    // M3 (M3-20)
    under(
      'Save (Ctrl+S, 100 mixed M3 markups: shapes, measurements, stamps)',
      '< 1 s (M3 markups)',
      num(m, 'save-100-m3-markups-ms'),
      1000,
      'perf/save-m3.spec.ts',
    ),
    {
      area: 'Snapping on the dense A0 sheet (while another page is extracted)',
      target: 'query round trip p95 ≤ 16 ms',
      measured: snapP95 === undefined ? '—' : `${snapP95.toFixed(2)} ms`,
      verdict: snapP95 === undefined ? 'not measured' : snapP95 <= 16 ? 'met' : 'missed',
      source: 'perf/snap.spec.ts',
    },
    {
      area: 'Offline proof (M3)',
      target:
        'network off → markups, measurement with snapping, stamps, CRS export, Ctrl+S; zero outbound requests',
      measured: offlineM3.length ? offlineM3.map((r) => r.status).join(', ') : '—',
      verdict: !offlineM3.length
        ? 'not measured'
        : offlineM3.every((r) => r.status === 'passed')
          ? 'met'
          : 'missed',
      source: 'offline.spec.ts',
    },
    // M4 (M4-22)
    {
      area: 'UI responsiveness during M4 jobs (exports, tables, page operations, redaction, comment transfer)',
      target: 'no main-thread task > 100 ms in every M4 perf scenario',
      measured: perfM4.length
        ? `${String(perfM4.filter((r) => r.status === 'passed').length)} of ${String(perfM4.length)} scenarios passed (${String(m4Files.size)} of ${String(M4_PERF.length)} files)`
        : '—',
      verdict:
        m4Files.size < M4_PERF.length
          ? 'not measured'
          : perfM4.every((r) => r.status === 'passed')
            ? 'met'
            : 'missed',
      source: 'e2e/perf (M4)',
    },
    reported(
      'Markdown export, 2,000-page stand-in (while scrolling)',
      'm4-markdown',
      ms('m4-markdown', 'ms'),
      'perf/oxide.spec.ts',
    ),
    reported(
      'Express Extract to XLSX, 200 pages (while scrolling)',
      'm4-tables',
      tables?.detectMs !== undefined && tables.saveMs !== undefined
        ? tables.detectMs + tables.saveMs
        : undefined,
      'perf/tables.spec.ts',
    ),
    reported(
      'Delete 1,000 of 2,000 pages',
      'pages-delete-1000-ms',
      num(m, 'pages-delete-1000-ms'),
      'perf/pages.spec.ts',
    ),
    reported(
      'Merge 10 files of 200 pages',
      'merge-10x200-ms',
      num(m, 'merge-10x200-ms'),
      'perf/pages.spec.ts',
    ),
    reported(
      'Apply + verify redaction, 200 pages × 3 marks',
      'm4-redact',
      ms('m4-redact', 'ms'),
      'perf/redact.spec.ts',
    ),
    reported(
      'Import 1,000 comments into the 2,000-page stand-in',
      'transfer-import-1000-ms',
      num(m, 'transfer-import-1000-ms'),
      'perf/comment-transfer.spec.ts',
    ),
    {
      area: 'Offline proof (M4)',
      target:
        'network off → exports, tables, page operations, comment import, verified redaction; zero outbound requests',
      measured: offlineM4.length ? offlineM4.map((r) => r.status).join(', ') : '—',
      verdict: !offlineM4.length
        ? 'not measured'
        : offlineM4.every((r) => r.status === 'passed')
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
    '### M1 … M4 acceptance: §12 targets on typical (self-made) files',
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
