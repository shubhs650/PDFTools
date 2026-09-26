import { describe, expect, it } from 'vitest';
import { perfRows, renderPerfMarkdown, type PwReport } from '../scripts/perf-report.ts';

const REPORT: PwReport = {
  suites: [
    {
      file: 'perf/open.spec.ts',
      specs: [
        {
          title: 'open three files',
          tests: [
            {
              annotations: [{ type: 'open-ready-ms', description: '350' }],
              results: [{ status: 'passed', duration: 4200 }],
            },
          ],
        },
      ],
      suites: [
        {
          title: 'nested',
          specs: [
            {
              title: 'save 100 markups',
              file: 'perf/save.spec.ts',
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 900,
                      annotations: [
                        { type: 'save-100-markups-ms', description: '134' },
                        { type: 'tag', description: '@x' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('perf report (M1-27)', () => {
  it('collects every scenario with its status and recorded numbers, nested suites included', () => {
    expect(perfRows(REPORT)).toEqual([
      {
        file: 'perf/open.spec.ts',
        title: 'open three files',
        status: 'passed',
        durationMs: 4200,
        metrics: { 'open-ready-ms': '350' },
      },
      {
        file: 'perf/save.spec.ts',
        title: 'save 100 markups',
        status: 'failed',
        durationMs: 900,
        metrics: { 'save-100-markups-ms': '134' },
      },
    ]);
  });

  it('renders a table and a verdict', () => {
    const md = renderPerfMarkdown(perfRows(REPORT));
    expect(md).toContain('`open-ready-ms` 350');
    expect(md).toContain('❌ failed');
    expect(md).toContain('❌ 1 scenario(s) failed.');
    expect(renderPerfMarkdown(perfRows(REPORT).slice(0, 1))).toContain('✅ All scenarios passed.');
  });
});
