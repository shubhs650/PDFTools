import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectNotices,
  renderNotices,
  runtimePaths,
  standardText,
} from '../../scripts/notices.ts';

const root = join(import.meta.dirname, '..', '..');

describe('third-party notices (M1-26)', () => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as Parameters<
    typeof runtimePaths
  >[0];
  const notices = collectNotices(root);
  const text = renderNotices(notices);

  it('lists every installed runtime package, each with a license text', () => {
    const expected = new Set<string>();
    for (const path of runtimePaths(lock)) {
      try {
        const m = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')) as {
          name: string;
          version: string;
        };
        expected.add(`${m.name}@${m.version}`);
      } catch {
        // optional package not installed on this platform
      }
    }
    expect(new Set(notices.map((p) => `${p.name}@${p.version}`))).toEqual(expected);
    for (const p of notices) {
      expect(p.texts.length, p.name).toBeGreaterThan(0);
      expect(text).toContain(`${p.name} ${p.version}\nLicense: ${p.license}`);
    }
  });

  it('covers every direct dependency, EmbedPDF, PDFium and the fonts OFL text', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const names = new Set(notices.map((p) => p.name));
    for (const dep of Object.keys(pkg.dependencies)) expect(names).toContain(dep);
    expect(text).toContain('LICENSE.pdfium:');
    expect(text).toContain('PDFium Authors');
    expect(text).toContain('SIL Open Font License, Version 1.1');
    expect(text).toContain('Reserved Font Name');
  });

  it('leaves out dev-only packages', () => {
    const names = new Set(notices.map((p) => p.name));
    for (const dev of ['vite', 'vitest', 'eslint', 'typescript', '@playwright/test']) {
      expect(names).not.toContain(dev);
    }
  });

  it('prints an identical text once and refers back to it', () => {
    const mit = 'MIT License\n\nCopyright (c) Someone\n';
    const out = renderNotices([
      { name: 'a', version: '1.0.0', license: 'MIT', texts: [{ source: 'LICENSE', text: mit }] },
      { name: 'b', version: '2.0.0', license: 'MIT', texts: [{ source: 'LICENSE', text: mit }] },
    ]);
    expect(out.split('Copyright (c) Someone')).toHaveLength(2);
    expect(out).toContain('LICENSE: same text as a 1.0.0 (LICENSE).');
  });

  it('uses the standard text only when a package ships no license file', () => {
    expect(standardText('MIT', { author: 'Jane Doe' }, 'x')?.text).toContain(
      'Copyright (c) Jane Doe',
    );
    expect(standardText('MIT OR Apache-2.0', {}, 'y')?.text).toContain(
      'Copyright (c) the y authors',
    );
    expect(standardText('Apache-2.0', {}, 'z')).toBeUndefined();
    expect(standardText('MIT AND BSD-3-Clause', {}, 'z')).toBeUndefined();
  });

  it('fails when a runtime package has no license text at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'notices-'));
    mkdirSync(join(dir, 'node_modules', 'bare'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules', 'bare', 'package.json'),
      JSON.stringify({ name: 'bare', version: '1.0.0', license: 'Apache-2.0' }),
    );
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({ packages: { '': {}, 'node_modules/bare': {} } }),
    );
    expect(() => collectNotices(dir)).toThrow(/bare@1\.0\.0/);
  });
});
