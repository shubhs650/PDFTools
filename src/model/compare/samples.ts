// Sample comparisons (M13-01, D-67, ADR-034): two self-made pairs per comparison
// type from `Synthetic PDF Corpus/` (rule 13) ship with the app. The build copies
// them from the corpus (scripts/vite-assets.ts), so the copies can never go stale,
// and serves them from our own origin under `samples/`; the service worker caches
// them in the background (src/sw/precacheSplit.ts), so they work offline. Pure:
// shared by the build, the input window and the tests.

/** PDF Overlay or Text Comparison (as `CompareType`, kept literal for the build script). */
export type SampleType = 'overlay' | 'text';

export type SampleId = 'flange' | 'checkedPrint' | 'tender' | 'invoice';

/** Document A (old) or Document B (new). */
export type SampleSide = 'a' | 'b';

export interface Sample {
  id: SampleId;
  type: SampleType;
  /** The corpus pair it is copied from: its manifest's Pair_ID. */
  pair: string;
  /** The pair's folder in its corpus, and its old and new files. */
  corpus: { dir: string; a: string; b: string };
}

/** The corpus folders, under `Synthetic PDF Corpus/`. */
export const SAMPLE_CORPUS_DIRS: Readonly<Record<SampleType, string>> = {
  overlay: 'engineering_pdf_overlay_test_corpus',
  text: 'text_comparison_pdf_corpus',
};

/** The samples, in the order the menu offers them (two per type, owner choice P1). */
export const SAMPLES: readonly Sample[] = [
  {
    id: 'flange',
    type: 'overlay',
    pair: '01',
    corpus: {
      dir: 'pair_01_mech_flange_baseline',
      a: '01_mech_flange_RevA_OLD.pdf',
      b: '01_mech_flange_RevB_NEW.pdf',
    },
  },
  {
    id: 'checkedPrint',
    type: 'overlay',
    pair: '19',
    corpus: {
      dir: 'pair_19_review_comments_closeout',
      a: '19_review_comments_RevA_OLD.pdf',
      b: '19_review_comments_RevB_NEW.pdf',
    },
  },
  {
    id: 'tender',
    type: 'text',
    pair: '05',
    corpus: {
      dir: 'pair_05_tender_clause_renumber',
      a: '05_tender_clause_renumber_RevA_OLD.pdf',
      b: '05_tender_clause_renumber_RevB_NEW.pdf',
    },
  },
  {
    id: 'invoice',
    type: 'text',
    pair: '01',
    corpus: {
      dir: 'pair_01_invoice_numeric',
      a: '01_invoice_numeric_RevA_OLD.pdf',
      b: '01_invoice_numeric_RevB_NEW.pdf',
    },
  },
];

export const samplesOf = (type: SampleType): Sample[] => SAMPLES.filter((s) => s.type === type);

export function sampleById(id: string): Sample | undefined {
  return SAMPLES.find((s) => s.id === id);
}

/** Where the app serves a sample file, relative to the app's base (no leading slash). */
export const samplePath = (s: Sample, side: SampleSide): string =>
  `samples/${s.type}-${s.pair}-${side}.pdf`;

/** The corpus file a sample file is copied from, relative to `Synthetic PDF Corpus/`. */
export const sampleSource = (s: Sample, side: SampleSide): string =>
  `${SAMPLE_CORPUS_DIRS[s.type]}/${s.corpus.dir}/${s.corpus[side]}`;

/** A sample put into a comparison: which one, and the documents it opened as. */
export interface PlacedSample {
  sample: SampleId;
  a: string;
  b: string;
}

/**
 * The sample a comparison still shows: its sides hold exactly the sample's two
 * documents (A on A, B on B). Once a file is added, removed, replaced or the
 * sides are swapped, it is the person's own comparison and the hint goes.
 */
export function shownSample(
  sides: { a: readonly { docId: string }[]; b: readonly { docId: string }[] },
  placed: PlacedSample | undefined,
): Sample | undefined {
  if (!placed) return undefined;
  const one = (files: readonly { docId: string }[], docId: string): boolean =>
    files.length === 1 && files[0]?.docId === docId;
  return one(sides.a, placed.a) && one(sides.b, placed.b) ? sampleById(placed.sample) : undefined;
}
