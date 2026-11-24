// Where the CRS review corpus lives, for tests and the generator (M13-07).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CRS_CORPUS_DIR = join(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'Synthetic PDF Corpus',
  'crs_review_corpus',
);

export function crsCorpusFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(CRS_CORPUS_DIR, name)));
}
