import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { init } from '@embedpdf/pdfium';
import { describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate.ts';
import { HELVETICA_WIDTHS, helveticaWidth } from '../../src/model/ocr/helveticaWidths';
import { winAnsiByte } from '../../src/model/ocr/winAnsi';
import { rawCall, withWideString } from '../../src/workers/render/pdfium';

// The generated Helvetica width table (ADR-020 d4) against PDFium's standard
// font: 20 copies of a glyph minus 10 copies gives ten advances exactly.
const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
(mod as unknown as { PDFiumExt_Init(): void }).PDFiumExt_Init();
const heap = mod.pdfium as unknown as {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  getValue(ptr: number, t: 'float'): number;
};
const call = (name: string, ...a: (number | string)[]) => rawCall(mod, name, ...a);

/** Every WinAnsi byte with its character (the Latin-1 ones and the 0x80–0x9F slots). */
function winAnsiChars(): [number, string][] {
  const out: [number, string][] = [];
  for (let cp = 0x20; cp <= 0x2122; cp++) {
    const ch = String.fromCodePoint(cp);
    const b = winAnsiByte(ch);
    if (b !== undefined && !out.some(([x]) => x === b)) out.push([b, ch]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

describe('Helvetica widths (ADR-020 d4)', () => {
  it('matches PDFium for every WinAnsi byte; undefined slots are 0', () => {
    const bytes = simplePdf(1);
    const p = heap.wasmExports.malloc(bytes.length);
    heap.HEAPU8.set(bytes, p);
    const doc = call('FPDF_LoadMemDocument', p, bytes.length, '');
    const font = call('FPDFText_LoadStandardFont', doc, 'Helvetica');
    const bounds = heap.wasmExports.malloc(16);
    const widthOf = (text: string): number => {
      const obj = call('FPDFPageObj_CreateTextObj', doc, font, 10);
      withWideString(mod, text, (q) => call('FPDFText_SetText', obj, q));
      call('FPDFPageObj_GetBounds', obj, bounds, bounds + 4, bounds + 8, bounds + 12);
      const w = heap.getValue(bounds + 8, 'float') - heap.getValue(bounds, 'float');
      call('FPDFPageObj_Destroy', obj);
      return w;
    };
    const mismatches: string[] = [];
    const chars = winAnsiChars();
    expect(chars.length).toBe(218); // 95 (0x20–0x7E) + 96 (0xA0–0xFF) + 27 slots in 0x80–0x9F
    for (const [b, ch] of chars) {
      const advance = Math.round(
        ((widthOf(ch.repeat(20)) - widthOf(ch.repeat(10))) / 10 / 10) * 1000,
      );
      if (advance !== helveticaWidth(b))
        mismatches.push(
          `${ch} (0x${b.toString(16)}): table ${String(helveticaWidth(b))}, PDFium ${String(advance)}`,
        );
    }
    heap.wasmExports.free(bounds);
    call('FPDF_CloseDocument', doc);
    heap.wasmExports.free(p);
    expect(mismatches).toEqual([]);
    expect(HELVETICA_WIDTHS.length).toBe(256);
    for (const b of [0, 31, 0x7f, 0x81, 0x8d, 0x8f, 0x90, 0x9d]) expect(helveticaWidth(b)).toBe(0);
    expect(helveticaWidth(0x20)).toBe(278);
    expect(helveticaWidth(0x41)).toBe(667);
  });
});
