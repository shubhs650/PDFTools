// Layer switches in the comparison's session (follow-up to M12-11, D-59,
// Q24): a document's switches make every sheet it is in be analysed again,
// its analysis rasters drawn from the copy with those layers shown, and the
// sheet's facts start again; going back to the defaults analyses it once
// more. The alignment found stays. Real PDFium on corpus pair 11.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import type { SheetFacts } from '../../src/engine/compareApi';
import { CompareClient } from '../../src/engine/compareClient';
import { CompareSession, oneFile } from '../../src/features/compare/engine/session';
import { readLayers } from '../../src/model/ocg';
import { layerCopy, layerKey } from '../../src/workers/shared/layerCopy';
import { compareSpawn, fakeWork } from './support/inProcess';

const inflate = (b: Uint8Array) => Promise.resolve(new Uint8Array(inflateSync(b)));
const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let fire = 0;
const ports: MessagePort[] = [];
const copies = new Map<string, Promise<string>>();
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

const bytesOf = (side: 'old' | 'new'): Uint8Array => corpusBytes(corpusPair('overlay', '11'), side);

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  for (const side of ['old', 'new'] as const)
    await native
      .openDocumentBuffer(
        { id: `11${side}`, content: bytesOf(side).slice().buffer },
        { normalizeRotation: true },
      )
      .toPromise();
  const list = await readLayers(bytesOf('old'), inflate);
  fire = list.layers.find((l) => l.name === 'FIRE_PROTECTION')?.id ?? 0;
});

/** Opens (once) the copy of a document with `layers`, as the Work worker does. */
function layered(docId: string, layers: Readonly<Record<number, boolean>>): Promise<string> {
  const key = `${docId}\n${layerKey(layers)}`;
  let job = copies.get(key);
  if (!job) {
    job = (async () => {
      const side = docId === '11old' ? 'old' : 'new';
      const copy = await layerCopy(bytesOf(side), layers, inflate);
      const id = `${docId}#layers${String(copies.size)}`;
      await native
        .openDocumentBuffer({ id, content: copy.buffer }, { normalizeRotation: true })
        .toPromise();
      return id;
    })();
    copies.set(key, job);
  }
  return job;
}

describe('layer switches in a session', () => {
  it('analyse the sheets of that document again with the layers shown, and back', async () => {
    expect(fire).toBeGreaterThan(0);
    const facts: [number, SheetFacts][] = [];
    const log: string[] = [];
    const compare = new CompareClient({
      spawn: compareSpawn({ spawned: 0, terminated: 0 }, ports),
    });
    const s = new CompareSession(oneFile('11old', [0, 1]), oneFile('11new', [0, 1]), {
      work: fakeWork(mod, native, log, layered),
      compare,
      dpi: 18,
      onSheet: (i, f) => facts.push([i, f]),
    });
    // Before the start: kept and used once the sheets are analysed.
    s.setLayers('11new', null);
    await s.start();
    await s.whenDone();
    const first = facts.find(([i]) => i === 0)?.[1];
    expect(first?.rows).toBe(first?.height);
    const al = s.alignment(0);

    s.setLayers('11old', { [fire]: true });
    expect(s.layersOf('11old')).toEqual({ [fire]: true });
    await s.whenDone();
    const shown = facts.filter(([i]) => i === 0).at(-1)?.[1];
    // FIRE_PROTECTION is drawn in A now: more ink, and the facts started again (rows not doubled).
    expect(shown?.inkA).toBeGreaterThan(first?.inkA ?? Infinity);
    expect(shown?.inkB).toBe(first?.inkB);
    expect(shown?.rows).toBe(shown?.height);
    // Both sheets of A were analysed again; the alignment found stays.
    expect(facts.filter(([i]) => i === 1)).toHaveLength(2);
    expect(s.alignment(0)).toEqual(al);

    // The same switches again change nothing.
    const n = facts.length;
    s.setLayers('11old', { [fire]: true });
    await s.whenDone();
    expect(facts).toHaveLength(n);

    // Back to the defaults: the first facts again.
    s.setLayers('11old', null);
    await s.whenDone();
    expect(facts.filter(([i]) => i === 0).at(-1)?.[1]).toEqual(first);
    expect(s.progress().failed).toBe(0);
    await s.close();
  });
});
