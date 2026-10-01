// PDF Oxide in the Work worker (M4-04, ADR-009): the host (lazy load, warm-up,
// per-document cache), the Map converter, the permission gate and the text job,
// on the real Oxide build for Node (the browser uses the web build of the same
// version, e2e/oxide.spec.ts).
import { describe, expect, it, vi } from 'vitest';
import * as nodeOxide from 'pdf-oxide-wasm';
import { contractPdf, simplePdf } from '../../e2e/fixtures/generate.ts';
import { RpcError } from '../../src/engine/errors';
import { PERM_COPY, PERM_PRINT } from '../../src/model/permissions';
import { extract, PAGE_BREAK, type ExtractOptions } from '../../src/workers/work/extract';
import {
  OxideHost,
  toPlain,
  warmUpPdf,
  type OxideDocument,
  type OxideLibrary,
} from '../../src/workers/work/oxide';
import { requireCapability } from '../../src/workers/work/permissionGate';
import type { JobSlice } from '../../src/workers/work/scheduler';

const nodeLibrary = (): OxideLibrary => ({
  open: (bytes, password) =>
    new (
      nodeOxide as unknown as {
        WasmPdfDocument: new (d: Uint8Array, p?: string | null) => OxideDocument;
      }
    ).WasmPdfDocument(bytes, password ?? null),
  memoryBytes: () => 0,
});

const slice = (onCheckpoint: () => void = () => undefined): JobSlice =>
  ({
    checkpoint: () => {
      onCheckpoint();
      return Promise.resolve();
    },
  }) as unknown as JobSlice;

describe('PDF Oxide host (M4-04, ADR-009)', () => {
  it('loads once, lazily, and warms up with a throwaway extraction', async () => {
    const loader = vi.fn(() => Promise.resolve(nodeLibrary()));
    const host = new OxideHost(loader);
    expect(host.loaded).toBe(false);
    expect(loader).not.toHaveBeenCalled();
    const ms = await host.warmUp();
    expect(ms).toBeGreaterThan(0);
    await host.warmUp();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(host.warmUpMs).toBe(ms);
  });

  it('the warm-up document is a valid PDF Oxide reads', () => {
    const doc = nodeLibrary().open(warmUpPdf());
    expect(doc.pageCount()).toBe(1);
    expect(doc.toPlainText(0)).toContain('Warm up');
    doc.free();
  });

  it('a failed load can be retried (offline before the background precache)', async () => {
    let n = 0;
    const host = new OxideHost(() =>
      ++n === 1 ? Promise.reject(new Error('fetch failed')) : Promise.resolve(nodeLibrary()),
    );
    await expect(host.warmUp()).rejects.toThrow('fetch failed');
    await expect(host.warmUp()).resolves.toBeGreaterThan(0);
  });

  it('keeps one Oxide document per open document until its key changes', async () => {
    const lib = nodeLibrary();
    const open = vi.spyOn(lib, 'open');
    const host = new OxideHost(() => Promise.resolve(lib));
    const bytes = vi.fn(() => simplePdf(3));
    const a = await host.document('d1', 'k1', bytes);
    const b = await host.document('d1', 'k1', bytes);
    expect(b).toBe(a);
    const c = await host.document('d1', 'k2', bytes); // a new tail was applied
    expect(c).not.toBe(a);
    expect(bytes).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(3); // warm-up + two documents
    host.drop('d1');
    host.drop('d1');
  });

  it('turns Oxide Maps into plain objects, keeping typed arrays', () => {
    const inner = new Map<string, unknown>([['x', 1]]);
    const v = new Map<string, unknown>([
      ['cells', [inner, new Map([['y', [new Map([['z', true]])]]])]],
      ['bytes', new Uint8Array([1, 2])],
      ['name', 'n'],
    ]);
    expect(toPlain(v)).toEqual({
      cells: [{ x: 1 }, { y: [{ z: true }] }],
      bytes: new Uint8Array([1, 2]),
      name: 'n',
    });
  });
});

describe('permission gate (M4-04, ADR-009 decision 3, rule 9)', () => {
  it('allows unencrypted files and files that grant copy; refuses otherwise', () => {
    expect(() => {
      requireCapability({ permissions: 0, revision: -1 }, 'copy');
    }).not.toThrow();
    expect(() => {
      requireCapability({ permissions: PERM_COPY | PERM_PRINT, revision: 4 }, 'copy');
    }).not.toThrow();
    let caught: unknown;
    try {
      requireCapability({ permissions: PERM_PRINT, revision: 4 }, 'copy');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RpcError);
    expect((caught as RpcError).code).toBe('permission-denied:copy');
  });
});

const textOptions: ExtractOptions = {
  format: 'text',
  images: false,
  baseName: 'b',
  title: 'b',
  lang: 'en',
  labels: { page: 'Page %P', image: 'Image %N on page %P', noText: 'No text on page %P' },
};
const extractText = async (
  doc: OxideDocument,
  pages: number[],
  s: JobSlice,
  progress: (p: { done: number; total: number }) => void,
) => {
  const r = await extract(doc, pages, textOptions, s, progress);
  const main = r.files[0];
  return { ...r, blob: new Blob([String(main?.data)]) };
};

describe('text extraction job (M4-04)', () => {
  it('extracts the chosen pages in document order, one checkpoint and progress step per page', async () => {
    const doc = nodeLibrary().open(simplePdf(5));
    let checkpoints = 0;
    const progress: number[] = [];
    const r = await extractText(
      doc,
      [0, 2, 4, 9],
      slice(() => checkpoints++),
      (p) => progress.push(p.done),
    );
    const text = await r.blob.text();
    expect(r.pages).toBe(3); // page 10 does not exist
    expect(
      text
        .split(PAGE_BREAK)
        .filter((t) => t.trim())
        .map((t) => t.trim()),
    ).toEqual(['Page 1', 'Page 3', 'Page 5']);
    expect(r.chars).toBe('Page 1Page 3Page 5'.length);
    expect(checkpoints).toBe(3);
    expect(progress).toEqual([0, 1, 2, 3]);
    doc.free();
  });

  it('stops at a checkpoint when cancelled', async () => {
    const doc = nodeLibrary().open(contractPdf(50));
    let n = 0;
    const cancelling = slice(() => {
      if (++n === 5) throw new DOMException('cancelled', 'AbortError');
    });
    await expect(
      extractText(doc, [...Array(50).keys()], cancelling, () => undefined),
    ).rejects.toThrow('cancelled');
    expect(n).toBe(5);
    doc.free();
  });
});
