import { describe, expect, it } from 'vitest';
import {
  checkPackages,
  evaluateLicense,
  licenseFromManifest,
  parseSpdx,
} from '../scripts/license-policy.ts';

describe('parseSpdx', () => {
  it('parses a single identifier', () => {
    expect(parseSpdx('MIT')).toEqual({ type: 'license', id: 'MIT' });
  });

  it('parses OR / AND with correct precedence (AND binds tighter)', () => {
    expect(parseSpdx('MIT OR Apache-2.0 AND BSD-3-Clause')).toEqual({
      type: 'or',
      left: { type: 'license', id: 'MIT' },
      right: {
        type: 'and',
        left: { type: 'license', id: 'Apache-2.0' },
        right: { type: 'license', id: 'BSD-3-Clause' },
      },
    });
  });

  it('parses parentheses', () => {
    expect(parseSpdx('(MIT OR GPL-3.0) AND ISC')).toEqual({
      type: 'and',
      left: {
        type: 'or',
        left: { type: 'license', id: 'MIT' },
        right: { type: 'license', id: 'GPL-3.0' },
      },
      right: { type: 'license', id: 'ISC' },
    });
  });

  it('treats "X WITH exception" as X', () => {
    expect(parseSpdx('GPL-2.0-only WITH Classpath-exception-2.0')).toEqual({
      type: 'license',
      id: 'GPL-2.0-only',
    });
  });

  it('accepts lowercase operators', () => {
    expect(parseSpdx('MIT or ISC')).toEqual({
      type: 'or',
      left: { type: 'license', id: 'MIT' },
      right: { type: 'license', id: 'ISC' },
    });
  });

  it('throws on malformed expressions', () => {
    expect(() => parseSpdx('MIT OR')).toThrow();
    expect(() => parseSpdx('(MIT')).toThrow();
    expect(() => parseSpdx('')).toThrow();
  });
});

describe('evaluateLicense', () => {
  it.each([
    'MIT',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    '0BSD',
    'BlueOak-1.0.0',
    'CC0-1.0',
    'Python-2.0',
    'CC-BY-4.0',
    'Unlicense',
    'Zlib',
    'FTL',
    'IJG',
    'mit',
  ])('allows permissive license %s', (id) => {
    expect(evaluateLicense(id).status).toBe('allowed');
  });

  it.each([
    'GPL-3.0',
    'GPL-2.0-or-later',
    'GPL-2.0+',
    'LGPL-2.1',
    'AGPL-3.0-only',
    'SSPL-1.0',
    'MPL-2.0',
    'CC-BY-NC-4.0',
    'CC-BY-SA-4.0',
    'EUPL-1.2',
    'BUSL-1.1',
  ])('forbids %s', (id) => {
    expect(evaluateLicense(id).status).toBe('forbidden');
  });

  it('marks unrecognised or proprietary licenses as unknown', () => {
    expect(evaluateLicense('UNLICENSED').status).toBe('unknown');
    expect(evaluateLicense('SEE LICENSE IN LICENSE.md').status).toBe('unknown');
    expect(evaluateLicense('Some-Custom-License').status).toBe('unknown');
    expect(evaluateLicense(undefined).status).toBe('unknown');
  });

  it('allows an OR expression if any branch is allowed', () => {
    expect(evaluateLicense('(MIT OR GPL-3.0)').status).toBe('allowed');
    expect(evaluateLicense('MIT OR Apache-2.0').status).toBe('allowed');
  });

  it('requires every AND branch to be allowed', () => {
    expect(evaluateLicense('MIT AND ISC').status).toBe('allowed');
    expect(evaluateLicense('MIT AND GPL-3.0').status).toBe('forbidden');
    expect(evaluateLicense('MIT AND Some-Custom').status).toBe('unknown');
  });

  it('reports forbidden over unknown when no OR branch is allowed', () => {
    expect(evaluateLicense('GPL-3.0 OR Some-Custom').status).toBe('forbidden');
  });
});

describe('licenseFromManifest', () => {
  it('reads a string license field', () => {
    expect(licenseFromManifest({ license: 'MIT' })).toBe('MIT');
  });

  it('reads a legacy object license field', () => {
    expect(licenseFromManifest({ license: { type: 'ISC' } })).toBe('ISC');
  });

  it('joins a legacy licenses array with OR', () => {
    expect(licenseFromManifest({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      '(MIT) OR (Apache-2.0)',
    );
  });

  it('returns undefined when missing', () => {
    expect(licenseFromManifest({})).toBeUndefined();
  });
});

describe('checkPackages', () => {
  const pkgs = [
    { name: 'good', version: '1.0.0', license: 'MIT', path: 'node_modules/good' },
    { name: 'bad', version: '2.0.0', license: 'GPL-3.0', path: 'node_modules/bad' },
    { name: 'odd', version: '0.1.0', license: 'Custom', path: 'node_modules/odd' },
  ];

  it('fails forbidden and unknown packages', () => {
    const result = checkPackages(pkgs, {});
    expect(result.failures.map((f) => f.name)).toEqual(['bad', 'odd']);
    expect(result.allowed).toHaveLength(1);
  });

  it('accepts a package covered by an exception with a reason and matching license', () => {
    const result = checkPackages(pkgs, {
      odd: { license: 'Custom', reason: 'Reviewed: permissive custom text, see ADR-00X' },
    });
    expect(result.failures.map((f) => f.name)).toEqual(['bad']);
    expect(result.excepted.map((f) => f.name)).toEqual(['odd']);
  });

  it('ignores an exception whose license no longer matches', () => {
    const result = checkPackages(pkgs, {
      odd: { license: 'Other', reason: 'stale' },
    });
    expect(result.failures.map((f) => f.name)).toContain('odd');
  });

  it('rejects exceptions without a reason', () => {
    const result = checkPackages(pkgs, { odd: { license: 'Custom', reason: '' } });
    expect(result.failures.map((f) => f.name)).toContain('odd');
    expect(result.configErrors).toHaveLength(1);
  });

  it('reports unused exceptions', () => {
    const result = checkPackages(pkgs, { ghost: { license: 'MIT', reason: 'x' } });
    expect(result.unusedExceptions).toEqual(['ghost']);
  });
});
