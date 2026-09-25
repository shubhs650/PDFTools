import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { init } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { A0, a0Sheet, cjkFallbackPdf, contractPdf, simplePdf } from '../e2e/fixtures/generate.ts';

// The self-made fixtures must open in the same PDFium build the app uses.
const require = createRequire(import.meta.url);
let native: PdfiumNative;
let seq = 0;

beforeAll(async () => {
  const wasmBinary = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  native = new PdfiumNative(await init({ wasmBinary }), { fontFallback: null });
});

async function open(bytes: Uint8Array) {
  const content = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const doc = await native
    .openDocumentBuffer({ id: `fixture-${String(++seq)}`, content: content as ArrayBuffer })
    .toPromise();
  await native.closeDocument(doc).toPromise();
  return doc;
}

describe('self-made fixtures (rule 13)', () => {
  it('simplePdf opens with the requested page count', async () => {
    expect((await open(simplePdf(3))).pageCount).toBe(3);
  });

  it('contractPdf is deterministic and opens (2,000-page contract profile)', async () => {
    const a = contractPdf(50);
    expect(Buffer.from(a).equals(Buffer.from(contractPdf(50)))).toBe(true);
    expect((await open(contractPdf(2000))).pageCount).toBe(2000);
  });

  it('a0Sheet is one A0 page', async () => {
    const doc = await open(a0Sheet(1000));
    expect(doc.pageCount).toBe(1);
    expect(doc.pages[0]?.size).toEqual({ width: A0.width, height: A0.height });
  });

  it('cjkFallbackPdf opens', async () => {
    expect((await open(cjkFallbackPdf())).pageCount).toBe(1);
  });
});
