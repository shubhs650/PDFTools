// Spike S34 (M14-01, D-74): builds the interop pack and checks it.
//   node --import ./spikes/shared/ts-ext.ts spikes/s34-measure-markups/run-node.ts [--pictures <dir>]
// Writes:
//   Synthetic PDF Corpus/measure/interop/S34_interop_pack.pdf  (committed: the owner's test file)
//   test-results/s34-node.json                                 (the numbers in RESULTS.md)
//   <dir>/redraw-p<N>-{before,after}.png with --pictures       (PDFium pictures, not committed)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../../src/workers/work/png.ts';
import { check } from './check.ts';
import { engine } from './engine.ts';
import { buildPack } from './pack.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PACK_PATH = join(ROOT, 'Synthetic PDF Corpus/measure/interop/S34_interop_pack.pdf');
const JSON_OUT = join(ROOT, 'test-results/s34-node.json');
const picAt = process.argv.indexOf('--pictures');
const PICS = picAt > 0 ? process.argv[picAt + 1] : undefined;

const e = await engine();
const t0 = performance.now();
const pack = await buildPack(e);
const ms = performance.now() - t0;
mkdirSync(join(PACK_PATH, '..'), { recursive: true });
writeFileSync(PACK_PATH, pack.bytes);
console.log(
  `pack: ${String(pack.items.length)} markups, ${(pack.bytes.length / 1e3).toFixed(0)} kB (Ctrl+S tail ${(pack.tail / 1e3).toFixed(0)} kB), built in ${ms.toFixed(0)} ms; fonts: ${[...new Set(e.fontFiles)].join(', ')}`,
);
for (const i of pack.items)
  console.log(
    `  p${String(i.page + 1)} ${i.tool.padEnd(20)} ${i.subtype.padEnd(9)} ${i.variant.padEnd(11)} ${(i.fontBytes / 1e3).toFixed(1).padStart(5)} kB fonts  ${i.contents.replace(/\n/g, ' | ').replace(/\t/g, ' ')}`,
  );

const r = await check(e, pack);
const bad = r.oneEach.filter((x) => x.found !== 1);
console.log(`one annotation per item: ${bad.length ? `NO ${JSON.stringify(bad)}` : 'yes'}`);
console.log(
  `/PieceInfo on pages ${r.pieceInfoPages.join(', ')}; /LastModified on ${r.lastModifiedPages.join(', ')}`,
);
console.log(
  `second Ctrl+S (a comment added on each page): tail ${(r.secondSave.tail / 1e3).toFixed(1)} kB, Triya entries ${String(r.secondSave.entriesBefore)} → ${String(r.secondSave.entriesAfter)}`,
);
const embedded = r.markups.filter((m) => m.fonts.embedded > 0 && m.fonts.standard === 0).length;
console.log(
  `markups whose appearance uses only embedded fonts: ${String(embedded)} of ${String(r.markups.length)}`,
);
const tally = (xs: { state: string }[]) =>
  Object.entries(
    xs.reduce<Record<string, number>>((o, x) => ({ ...o, [x.state]: (o[x.state] ?? 0) + 1 }), {}),
  )
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(', ');
console.log(`read back with data: ${tally(r.readFull)}`);
console.log(
  `read back after a move elsewhere: ${tally(r.readMoved)}; dropped: ${[...new Set(r.readMoved.flatMap((x) => x.dropped))].join(', ')}`,
);
console.log(`read back with no data: ${tally(r.readNoData)}`);
for (const x of r.readNoData) {
  const i = pack.items.find((p) => p.id === x.nm);
  console.log(
    `    ${(i?.tool ?? '').padEnd(10)} ${(i?.subtype ?? '').padEnd(9)} → ${x.tool ?? 'plain markup'}`,
  );
}
console.log('redraw from the dictionary (PDFium), our ink kept:');
for (const x of r.redraw)
  console.log(
    `    ${x.tool.padEnd(10)} ${String(Math.round((100 * x.inkAfter) / Math.max(1, x.inkBefore))).padStart(4)} %`,
  );

mkdirSync(join(JSON_OUT, '..'), { recursive: true });
writeFileSync(
  JSON_OUT,
  JSON.stringify(
    {
      packBytes: pack.bytes.length,
      tail: pack.tail,
      ms,
      fonts: [...new Set(e.fontFiles)],
      items: pack.items,
      ...r,
      redrawPictures: undefined,
    },
    null,
    1,
  ),
);
if (PICS) {
  mkdirSync(PICS, { recursive: true });
  for (const p of r.redrawPictures) {
    for (const [k, img] of [
      ['before', p.before],
      ['after', p.after],
    ] as const) {
      const png = await encodePng(img.rgba, img.width, img.height);
      writeFileSync(join(PICS, `redraw-p${String(p.page + 1)}-${k}.png`), png);
    }
  }
}
