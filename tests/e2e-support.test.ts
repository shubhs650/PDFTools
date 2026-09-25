import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gatedLongTasks, isThirdParty, type PageProbe } from '../e2e/support/probes.ts';
import { scanDist } from '../scripts/check-dist.ts';

describe('isThirdParty (rule 4)', () => {
  const app = 'http://localhost:4173';
  it.each([
    ['http://localhost:4173/assets/a.js', false],
    ['blob:http://localhost:4173/0f7a', false],
    ['data:image/png;base64,AAAA', false],
    ['https://cdn.jsdelivr.net/npm/x', true],
    ['http://localhost:9999/', true],
    ['blob:https://evil.example/1', true],
    ['chrome-extension://abc/x.js', false],
  ])('%s → %s', (url, expected) => {
    expect(isThirdParty(url, app)).toBe(expected);
  });
});

describe('gatedLongTasks (ADR-001 B4)', () => {
  const probe = (measureFrom: number | null): PageProbe => ({
    measureFrom,
    cspViolations: [],
    longTasks: [
      { start: 10, duration: 400 }, // cold boot
      { start: 500, duration: 90 },
      { start: 600, duration: 101 },
    ],
  });
  it('ignores everything until measuring starts', () => {
    expect(gatedLongTasks(probe(null))).toEqual([]);
  });
  it('gates only tasks over 100 ms after the mark', () => {
    expect(gatedLongTasks(probe(100))).toEqual([{ start: 600, duration: 101 }]);
  });
});

describe('scanDist', () => {
  it('finds the test-hook marker in text assets only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdftools-dist-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets', 'ok.js'), 'console.log(1)');
    await writeFile(join(dir, 'assets', 'bad.js'), 'window.__pdftoolsTest={}');
    await writeFile(join(dir, 'assets', 'bin.wasm'), '__pdftoolsTest');
    const findings = await scanDist(dir);
    expect(findings.map((f) => f.file)).toEqual([join('assets', 'bad.js')]);
  });
});
