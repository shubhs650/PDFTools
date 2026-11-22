// Spike S27 fixtures (M12-02): three dense A0 sheets, self-made (rule 13),
// built with the comparison corpus generator's drawing code (M12-01), plus
// copies of corpus pairs 15 (the same drawing at A1 and A3) and 19 (an old
// revision with review comments). Written to spikes/s27-linked-views/out/,
// which serve.ts serves under /corpus/. Never committed.
//
//   node spikes/s27-linked-views/make-fixtures.ts
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from '../../e2e/fixtures/comparison-corpus/canvas.ts';
import { densePlotPlan } from '../../e2e/fixtures/comparison-corpus/plans.ts';
import { Doc, MM, num } from '../../e2e/fixtures/comparison-corpus/pdf.ts';
import { frame, type Sheet } from '../../e2e/fixtures/comparison-corpus/sheet.ts';
import { corpusFile, corpusPair } from '../../e2e/fixtures/comparison-corpus/index.ts';
import { A0, A0_LINK } from './fixtures.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

// The sheet furniture code only reads the size; A0 is not one of its names.
const a0: Sheet = { name: 'A1', w: A0.wMm, h: A0.hMm };

function sheet(rev: 'A' | 'B'): { content: string; segments: number } {
  const c = new Canvas();
  const inner = frame(c, a0, true);
  densePlotPlan(
    c,
    { x: inner.x + 4, y: inner.y + 4, w: inner.w - 8, h: inner.h - 8 },
    {
      movePad: rev === 'B' ? 5 : 0,
      tag1204: rev === 'B' ? 'P-1204A' : 'P-1204',
      newBranch: rev === 'B',
      removeTankPad: rev === 'B',
    },
  );
  const content = c.toString();
  return { content, segments: (content.match(/ l$/gm) ?? []).length };
}

function write(name: string, content: string, seed: string): void {
  const d = new Doc();
  d.addPage({ width: A0.wMm * MM, height: A0.hMm * MM, content });
  const bytes = d.finish(
    {
      title: `S27 ${name}`,
      author: 'Triya PDF spike S27',
      subject: 'Self-made dense A0 sheet',
      creationDate: 'D:20261122000000Z',
      modDate: 'D:20261122000000Z',
    },
    seed,
  );
  writeFileSync(join(out, name), bytes);
  console.log(`${name}: ${(bytes.length / 1024).toFixed(0)} KB`);
}

const a = sheet('A');
const b = sheet('B');
console.log(`segments per sheet: ${String(a.segments)}`);
write('a0-a.pdf', a.content, 's27-a0-a');
write('a0-b.pdf', b.content, 's27-a0-b');
// Rev B again, moved by a known similarity transform (scale, rotation, shift)
// in PDF user space: the linked views must follow it.
const { k, deg, tx, ty } = A0_LINK;
const r = (deg * Math.PI) / 180;
const m = [k * Math.cos(r), k * Math.sin(r), -k * Math.sin(r), k * Math.cos(r), tx, ty].map(num);
write('a0-c.pdf', `q ${m.join(' ')} cm\n${b.content}\nQ`, 's27-a0-c');

for (const [id, tag] of [
  ['15', 'p15'],
  ['19', 'p19'],
] as const) {
  const pair = corpusPair('overlay', id);
  copyFileSync(corpusFile(pair, 'old'), join(out, `${tag}-old.pdf`));
  copyFileSync(corpusFile(pair, 'new'), join(out, `${tag}-new.pdf`));
}
console.log(`wrote ${out}`);
