// Spike S26: the small fonts the test uses (committed under fixtures/, OFL-1.1,
// see fixtures/README.md): library faces (build-library.ts) cut to the
// characters of cases.ts plus printable ASCII, layout tables kept.
//   node spikes/s26-freetext-fonts/make-fixtures.ts
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ALL } from './cases.ts';
import { FLAG_NO_HINTING, Subsetter } from './hbsubset.ts';

const require = createRequire(import.meta.url);
const DIR = import.meta.dirname;
const OUT = join(DIR, 'fixtures');
mkdirSync(OUT, { recursive: true });
const sub = await Subsetter.load(
  readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')),
);
const chars = new Set<number>();
for (let c = 0x20; c < 0x7f; c++) chars.add(c);
for (const t of ALL) for (const ch of t) chars.add(ch.codePointAt(0) ?? 0);
chars.add(0x25cc);

const make = (from: string, to: string): void => {
  const bytes = new Uint8Array(readFileSync(from));
  const out = sub.subset(bytes, { unicodes: chars, flags: FLAG_NO_HINTING });
  if (!out) throw new Error(`${from}: subset failed`);
  writeFileSync(join(OUT, to), out);
  console.log(`${to} ${String(out.length)}`);
};
for (const f of [
  'roboto-regular',
  'roboto-bold',
  'roboto-italic',
  'roboto-boldItalic',
  'notosansdeva-regular',
  'notosansmath-regular',
  'notosanssc-regular',
  'tinos-regular',
])
  make(join(DIR, 'out', 'lib', `${f}.ttf`), `${f}.ttf`);
// The unsubset upstream Devanagari file, for route R1 (PDFium loads whole files).
copyFileSync(
  join(DIR, 'out', 'lib', 'notosansdeva-regular.ttf'),
  join(DIR, 'out', 'notosansdeva-regular-full.ttf'),
);
