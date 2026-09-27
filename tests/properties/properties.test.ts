import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { encryptedVariants, hasQpdf, USER_PW } from '../../e2e/fixtures/encrypted';
import { PROPERTIES, propertiesPdf } from '../../e2e/fixtures/generate';
import { readProperties } from '../../src/workers/work/properties';

// M2-12: Document Properties facts from a self-made file with known values.

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

async function props(bytes: Uint8Array, password?: string) {
  const doc = await native
    .openDocumentBuffer(
      { id: `p${String(++seq)}`, content: bytes.slice().buffer },
      password ? { password } : {},
    )
    .toPromise();
  try {
    return readProperties(mod, native, doc, bytes);
  } finally {
    await native.closeDocument(doc).toPromise();
  }
}

describe('readProperties', () => {
  it('reads the Info dictionary, dates, version, tagging and file facts', async () => {
    const bytes = propertiesPdf();
    expect(await props(bytes)).toEqual({
      title: PROPERTIES.title,
      author: PROPERTIES.author,
      subject: PROPERTIES.subject,
      keywords: PROPERTIES.keywords,
      creator: PROPERTIES.creator,
      producer: PROPERTIES.producer,
      created: '2024-01-02T02:04:05.000Z',
      modified: '2024-06-07T08:09:10.000Z',
      version: '1.7',
      tagged: true,
      linearized: false,
      revisions: 1,
      fileBytes: bytes.byteLength,
      encryption: null,
    });
  });

  it.skipIf(!hasQpdf())('reports the encryption method of RC4 and AES files', async () => {
    const [rc4, , , aes] = encryptedVariants(propertiesPdf());
    if (!rc4 || !aes) throw new Error('fixtures');
    expect((await props(rc4.bytes, USER_PW)).encryption).toMatchObject({
      method: 'RC4',
      keyBits: 40,
    });
    const p = await props(aes.bytes, USER_PW);
    expect(p.encryption).toMatchObject({ method: 'AES-256', keyBits: 256 });
    expect(p.title).toBe(PROPERTIES.title); // decrypted by PDFium
  });
});
