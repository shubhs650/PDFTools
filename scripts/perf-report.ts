// Perf report (M1-27, §11, §12, ADR-002): turns a Playwright JSON report of
// the `perf` project into a table of each scenario's outcome and the numbers
// it recorded as annotations (open time, scroll frames, sharp-tile latency,
// save time, …). The long-task gate itself is the tests' pass/fail; the
// numbers are reported, not gated (heavy-file targets are report-only).
//
// Usage: node scripts/perf-report.ts [results.json] [--markdown <file>] [--json <file>]
// In GitHub Actions the table is also appended to the job summary.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

interface Annotation {
  type: string;
  description?: string;
}
interface PwResult {
  status?: string;
  duration?: number;
  annotations?: Annotation[];
}
interface PwTest {
  projectName?: string;
  annotations?: Annotation[];
  results?: PwResult[];
}
interface PwSpec {
  title: string;
  file?: string;
  tests?: PwTest[];
}
interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
export interface PwReport {
  suites?: PwSuite[];
}

export interface PerfRow {
  file: string;
  title: string;
  status: string;
  durationMs: number;
  metrics: Record<string, string>;
}

const IGNORED = new Set(['tag', 'skip', 'fixme', 'fail', 'slow']);

export function perfRows(report: PwReport): PerfRow[] {
  const rows: PerfRow[] = [];
  const visit = (suite: PwSuite, file: string): void => {
    const f = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.at(-1);
        const metrics: Record<string, string> = {};
        for (const a of [...(t.annotations ?? []), ...(last?.annotations ?? [])]) {
          if (!IGNORED.has(a.type)) metrics[a.type] = a.description ?? '';
        }
        rows.push({
          file: spec.file ?? f,
          title: spec.title,
          status: last?.status ?? 'skipped',
          durationMs: Math.round(last?.duration ?? 0),
          metrics,
        });
      }
    }
    for (const s of suite.suites ?? []) visit(s, f);
  };
  for (const s of report.suites ?? []) visit(s, s.file ?? '');
  return rows;
}

const MAX_CELL = 300;
/** Table-safe, and long JSON shortened (the full values are in the --json output). */
const cell = (s: string): string => {
  const flat = s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return flat.length > MAX_CELL ? `${flat.slice(0, MAX_CELL)}…` : flat;
};

export function renderPerfMarkdown(rows: readonly PerfRow[]): string {
  const failed = rows.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
  const lines = [
    '### Perf gate (M1-27): no main-thread task > 100 ms after boot',
    '',
    '| Scenario | Result | Time | Recorded numbers (report-only) |',
    '| --- | --- | ---: | --- |',
    ...rows.map((r) => {
      const nums = Object.entries(r.metrics)
        .map(([k, v]) => `\`${k}\` ${cell(v)}`)
        .join('<br>');
      const mark = r.status === 'passed' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌';
      return `| ${cell(`${r.file}: ${r.title}`)} | ${mark} ${r.status} | ${(r.durationMs / 1000).toFixed(1)} s | ${nums || '—'} |`;
    }),
    '',
    failed.length ? `❌ ${String(failed.length)} scenario(s) failed.` : '✅ All scenarios passed.',
    '',
  ];
  return lines.join('\n');
}

function main(argv: string[]): void {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input =
    argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) ??
    'test-results/perf.json';
  if (!existsSync(input)) {
    console.error(`No Playwright JSON report at ${input}.`);
    process.exit(1);
  }
  const rows = perfRows(JSON.parse(readFileSync(input, 'utf8')) as PwReport);
  const md = renderPerfMarkdown(rows);
  console.log(md);
  const json = flag('--json');
  if (json) writeFileSync(json, `${JSON.stringify(rows, null, 2)}\n`);
  const markdown = flag('--markdown');
  if (markdown) writeFileSync(markdown, md);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, md);
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) main(process.argv.slice(2));
