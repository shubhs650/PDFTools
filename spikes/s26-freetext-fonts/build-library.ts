// Spike S26: builds the library's faces from out/src/ (fetch-fonts.ts) into
// out/lib/ and measures them (ADR-028, S26 amendment):
//   raw      the upstream files as they are (variable fonts, every script);
//   static   each face pinned to one instance, every glyph kept;
//   shipped  each face pinned and cut to the scripts it is used for (catalogue.ts),
//            layout tables kept so it can be shaped, hinting dropped; a family whose
//            license reserves its name ships its upstream files unmodified (counted once).
// Also writes the per-face JSON the test and M11-07 read. Run after fetch-fonts.ts:
//   node spikes/s26-freetext-fonts/build-library.ts
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { codepoints, FAMILIES, rangesFor } from './catalogue.ts';
import { FLAG_NO_HINTING, Subsetter } from './hbsubset.ts';

const require = createRequire(import.meta.url);
const DIR = join(import.meta.dirname, 'out');
mkdirSync(join(DIR, 'lib'), { recursive: true });
const sub = await Subsetter.load(
  readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')),
);

interface Row {
  family: string;
  group: string;
  face: string;
  file: string;
  static: number;
  shipped: number;
  gz: number;
}
const rows: Row[] = [];
let raw = 0;
const seen = new Set<string>();
const shippedFiles = new Set<string>();
for (const fam of FAMILIES) {
  for (const [face, src] of Object.entries(fam.faces)) {
    const bytes = new Uint8Array(readFileSync(join(DIR, 'src', src.file)));
    if (!seen.has(src.file)) {
      seen.add(src.file);
      raw += bytes.length;
    }
    const pin = src.pin;
    const all = sub.subset(bytes, {
      unicodes: codepoints([[0, 0x10ffff]]),
      ...(pin ? { pin } : { instance: true }),
    });
    const cut = sub.subset(bytes, {
      unicodes: codepoints(rangesFor(fam.scripts)),
      ...(pin ? { pin } : { instance: true }),
      flags: FLAG_NO_HINTING,
      drop: ['DSIG', 'STAT', 'hdmx', 'LTSH', 'VDMX'],
    });
    if (!all || !cut) throw new Error(`${src.file} ${face}: subset failed`);
    const out = `${fam.id}-${face}.ttf`;
    writeFileSync(join(DIR, 'lib', out), cut);
    // A reserved name ships the unmodified upstream file, counted with its first face only.
    const firstUse = !shippedFiles.has(src.file);
    shippedFiles.add(src.file);
    const ship = fam.reserved ? (firstUse ? bytes : new Uint8Array(0)) : cut;
    rows.push({
      family: fam.name,
      group: fam.group,
      face,
      file: fam.reserved ? src.file : out,
      static: all.length,
      shipped: ship.length,
      gz: ship.length ? gzipSync(ship, { level: 9 }).length : 0,
    });
  }
}

const sum = (k: 'static' | 'shipped' | 'gz', f: (r: Row) => boolean = () => true): number =>
  rows.filter(f).reduce((n, r) => n + r[k], 0);
const mb = (n: number): string => (n / 1048576).toFixed(2);
const notCjk = (r: Row): boolean => r.group !== 'chinese';
const hans = statSync(
  join(import.meta.dirname, '../../node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Regular.otf'),
).size;
const summary = {
  faces: rows.length,
  families: FAMILIES.length,
  rawMB: mb(raw),
  staticMB: mb(sum('static')),
  shippedMB: mb(sum('shipped')),
  shippedWithoutCjkMB: mb(sum('shipped', notCjk)),
  shippedWithoutCjkGzMB: mb(sum('gz', notCjk)),
  cjkInstancedMB: mb(sum('shipped', (r) => !notCjk(r))),
  alreadyShippedNotoSansHansMB: mb(hans),
};
writeFileSync(join(DIR, 'library.json'), JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const g of [...new Set(rows.map((r) => r.group))])
  console.log(
    `${g.padEnd(10)} ${mb(sum('shipped', (r) => r.group === g)).padStart(6)} MB  ${String(rows.filter((r) => r.group === g).length)} faces`,
  );
