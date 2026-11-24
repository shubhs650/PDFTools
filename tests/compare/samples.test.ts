// Sample comparisons (M13-01, D-67): the four pairs that ship with the app are
// corpus pairs (rule 13: self-made), copied at build time from the very files
// the corpus loader reads, served under samples/ and cached in the background.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORPUS_ROOT, corpusFile, corpusPair } from '../../e2e/fixtures/comparison-corpus/index.ts';
import {
  SAMPLES,
  samplePath,
  samplesOf,
  sampleSource,
  shownSample,
} from '../../src/model/compare/samples';
import { splitPrecache } from '../../src/sw/precacheSplit';
import { moduleOf } from '../../scripts/bundle-report';

const sides = ['a', 'b'] as const;

describe('sample comparisons (M13-01, D-67)', () => {
  it('two per type, in the order of the plan (owner choice P1)', () => {
    expect(samplesOf('overlay').map((s) => s.pair)).toEqual(['01', '19']);
    expect(samplesOf('text').map((s) => s.pair)).toEqual(['05', '01']);
  });

  it.each(SAMPLES.map((s) => [s.id, s] as const))(
    '%s is its corpus pair, file for file, and small',
    (_, s) => {
      const pair = corpusPair(s.type, s.pair);
      expect(pair.atTestTime).toBe(false);
      for (const side of sides) {
        const fromCorpus = readFileSync(corpusFile(pair, side === 'a' ? 'old' : 'new'));
        const copied = readFileSync(join(CORPUS_ROOT, sampleSource(s, side)));
        expect(copied.equals(fromCorpus)).toBe(true);
        expect(copied.byteLength).toBeLessThan(32 * 1024);
      }
    },
  );

  it('served under samples/, one path per file, cached in the background', () => {
    const paths = SAMPLES.flatMap((s) => sides.map((side) => samplePath(s, side)));
    expect(new Set(paths).size).toBe(paths.length);
    const { core, background, onDemand } = splitPrecache(
      paths.map((url) => ({ url, revision: null })),
    );
    expect(core).toEqual([]);
    expect(onDemand).toEqual([]);
    expect(background.map((e) => e.url)).toEqual(paths);
    expect(paths.every((p) => moduleOf(p) === 'samples')).toBe(true);
  });

  describe('the "what to look for" line', () => {
    const placed = { sample: 'flange' as const, a: 'd1', b: 'd2' };
    const f = (...ids: string[]) => ids.map((docId) => ({ docId, range: '' }));

    it('shows while the sides hold exactly the sample', () => {
      expect(shownSample({ a: f('d1'), b: f('d2') }, placed)?.id).toBe('flange');
    });

    it('goes once the comparison is the person’s own', () => {
      expect(shownSample({ a: f('d1'), b: f('d2') }, undefined)).toBeUndefined();
      expect(shownSample({ a: f('d2'), b: f('d1') }, placed)).toBeUndefined(); // swapped
      expect(shownSample({ a: f('d1', 'd3'), b: f('d2') }, placed)).toBeUndefined(); // added
      expect(shownSample({ a: f('d1'), b: f() }, placed)).toBeUndefined(); // removed
      expect(shownSample({ a: f('d1'), b: f('d4') }, placed)).toBeUndefined(); // replaced
    });
  });
});
