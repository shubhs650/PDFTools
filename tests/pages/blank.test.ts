// M10-08·O4 (D-49): Create Blank PDF. The size math and names are pure; the
// document is built by real PDFium here, as in the Work worker.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BLANK_MAX_SIDE,
  BLANK_MIN_SIDE,
  blankPageSize,
  nextUntitled,
  pageCountOf,
  sideLimits,
  sideOk,
  sideToPoints,
} from '../../src/model/blankSize';
import { PdfReader } from '../../src/model/pdf/reader';
import { findTrailerId } from '../../src/storage/fingerprint';
import { checkBlankSpec, createBlank, withFreshId } from '../../src/workers/work/blank';

const require = createRequire(import.meta.url);
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
let mod: WrappedPdfiumModule;
const slice = { checkpoint: () => Promise.resolve(), signal: new AbortController().signal };

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
});

function qpdfOk(bytes: Uint8Array): boolean {
  if (!hasQpdf) return true;
  const f = join(mkdtempSync(join(tmpdir(), 'blank-')), 'out.pdf');
  writeFileSync(f, bytes);
  return spawnSync('qpdf', ['--check', f]).status === 0;
}

/** Each page's MediaBox, as numbers. */
async function boxes(bytes: Uint8Array): Promise<number[][]> {
  const reader = await PdfReader.open(bytes);
  const out: number[][] = [];
  for (const p of await reader.pages()) {
    const box = await reader.resolve(p.dict.get('MediaBox'));
    out.push((box as number[]).map((v) => Math.round(v * 100) / 100));
  }
  return out;
}

describe('blank page sizes', () => {
  it('paper sizes take the orientation', () => {
    const none = { width: 0, height: 0 };
    expect(blankPageSize('a4', 'portrait', none)).toEqual({ width: 595.28, height: 841.89 });
    expect(blankPageSize('a4', 'landscape', none)).toEqual({ width: 841.89, height: 595.28 });
    expect(blankPageSize('a3', 'portrait', none)).toEqual({ width: 841.89, height: 1190.55 });
    expect(blankPageSize('letter', 'portrait', none)).toEqual({ width: 612, height: 792 });
    expect(blankPageSize('legal', 'landscape', none)).toEqual({ width: 1008, height: 612 });
  });

  it('a custom size is used as typed, inside the limits', () => {
    expect(blankPageSize('custom', 'landscape', { width: 100, height: 200 })).toEqual({
      width: 100,
      height: 200,
    });
    expect(blankPageSize('custom', 'portrait', { width: 1, height: 1e6 })).toEqual({
      width: BLANK_MIN_SIDE,
      height: BLANK_MAX_SIDE,
    });
  });

  it('reads typed sides in mm and inches, with a comma or a point', () => {
    expect(sideToPoints('25.4', 'mm')).toBeCloseTo(72);
    expect(sideToPoints('25,4', 'mm')).toBeCloseTo(72);
    expect(sideToPoints('8.5', 'in')).toBe(612);
    expect(sideToPoints(' .5 ', 'in')).toBe(36);
    for (const bad of ['', 'abc', '-5', '1e3', '2..5']) expect(sideToPoints(bad, 'mm')).toBeNull();
    expect(sideOk(sideToPoints('841', 'mm'))).toBe(true);
    expect(sideOk(sideToPoints('5', 'mm'))).toBe(false);
    expect(sideOk(sideToPoints('201', 'in'))).toBe(false);
    expect(sideOk(sideToPoints('200', 'in'))).toBe(true);
  });

  it('states the limits in the unit, rounded inwards', () => {
    expect(sideLimits('in')).toEqual({ min: 0.5, max: 200 });
    expect(sideLimits('mm')).toEqual({ min: 12.7, max: 5080 });
  });

  it('accepts 1 to 1000 whole pages', () => {
    expect(pageCountOf('1')).toBe(1);
    expect(pageCountOf(' 1000 ')).toBe(1000);
    for (const bad of ['0', '1001', '2.5', '', 'x', '-1']) expect(pageCountOf(bad)).toBeNull();
  });

  it('names a new document after the first free "Untitled n"', () => {
    const nameOf = (n: number) => `Untitled ${String(n)}.pdf`;
    expect(nextUntitled([], nameOf)).toBe('Untitled 1.pdf');
    expect(nextUntitled(['untitled 1.pdf', 'Untitled 3.pdf', 'plan.pdf'], nameOf)).toBe(
      'Untitled 2.pdf',
    );
  });
});

describe('createBlank (Work worker)', () => {
  it('builds the pages at the size asked, qpdf-clean, with progress', async () => {
    const seen: number[] = [];
    const bytes = await createBlank(mod, { width: 612, height: 1008, count: 120 }, slice, (p) => {
      seen.push(p.done);
    });
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 8))).toBe('%PDF-1.7');
    const b = await boxes(bytes);
    expect(b).toHaveLength(120);
    expect(b[0]).toEqual([0, 0, 612, 1008]);
    expect(b[119]).toEqual([0, 0, 612, 1008]);
    expect(seen).toEqual([50, 100, 120]);
    expect(qpdfOk(bytes)).toBe(true);
  });

  it('gives every new document its own trailer ID', async () => {
    const spec = { width: 595.28, height: 841.89, count: 1 };
    const a = await createBlank(mod, spec, slice, () => undefined);
    const b = await createBlank(mod, spec, slice, () => undefined);
    const idA = findTrailerId(a);
    expect(idA).toMatch(/^[0-9a-f]{32}$/);
    expect(findTrailerId(b)).not.toBe(idA);
    expect(a.length).toBe(b.length);
    expect(qpdfOk(a)).toBe(true);
  });

  it('writes the new ID over both entries in place', () => {
    const text = 'trailer\r\n<</Size 6/ID[<AAAA><BBBB>]>>\r\nstartxref\r\n9\r\n%%EOF\r\n';
    const bytes = new TextEncoder().encode(text);
    const out = new TextDecoder().decode(withFreshId(bytes, new Uint8Array([0x12, 0xab])));
    expect(out).toBe(text.replace('<AAAA><BBBB>', '<12AB><12AB>'));
  });

  it('refuses sizes and counts outside the limits', () => {
    expect(() => {
      checkBlankSpec({ width: 10, height: 800, count: 1 });
    }).toThrow(/size/);
    expect(() => {
      checkBlankSpec({ width: 600, height: 800, count: 0 });
    }).toThrow(/number of pages/);
    expect(() => {
      checkBlankSpec({ width: 600, height: Number.NaN, count: 1 });
    }).toThrow(/size/);
  });

  it('stops at a cancel between slices', async () => {
    const cancelled = {
      checkpoint: () => Promise.reject(new DOMException('Cancelled', 'AbortError')),
      signal: new AbortController().signal,
    };
    await expect(
      createBlank(mod, { width: 600, height: 800, count: 5 }, cancelled, () => undefined),
    ).rejects.toThrow('Cancelled');
  });
});
