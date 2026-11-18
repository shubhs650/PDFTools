import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// D-57 (ADR-029): the public repository never names another PDF product as the
// model for the app's UI, in any file, comment, test name or Help text. The
// pattern is built from parts so this file does not match itself.
const NAME = new RegExp(
  [
    ['pdf', '[\\s_-]?', 'x', '[\\s_-]?', 'change'].join(''),
    ['\\b', 'x', 'change'].join(''),
    ['\\b', 'px', 'ce\\b'].join(''),
    ['tracker', '\\s+', 'software'].join(''),
  ].join('|'),
  'i',
);

/** Every tracked file (git is present wherever the tests run: CI and local clones). */
function trackedFiles(): string[] {
  const out = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`);
  return out.stdout.split('\0').filter(Boolean);
}

/** Binary files (PDFs, images, fonts, archives) hold no prose: a NUL byte marks them. */
function isText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 8000).includes(0);
}

describe('no other PDF product is named (D-57)', () => {
  it('no tracked text file mentions it', () => {
    const hits: string[] = [];
    for (const file of trackedFiles()) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(file);
      } catch {
        continue; // deleted in the working tree
      }
      if (!isText(bytes)) continue;
      bytes
        .toString('utf8')
        .split('\n')
        .forEach((line, i) => {
          if (NAME.test(line)) hits.push(`${file}:${String(i + 1)}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('the pattern catches the spellings it is meant to', () => {
    const name = ['PDF', ['X', 'Change'].join('')];
    expect(NAME.test(name.join('-'))).toBe(true);
    expect(NAME.test(name.join(' '))).toBe(true);
    expect(NAME.test(name.join('').toLowerCase())).toBe(true);
    expect(NAME.test('data exchange')).toBe(false);
  });
});
