import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { FontCharset } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { FONT_FILES, localFontConfig } from '../../src/engine/fonts';
import {
  docPtrOf,
  isNormalized,
  openedBytes,
  purgePageCache,
  rawCall,
} from '../../src/workers/render/pdfium';

const require = createRequire(import.meta.url);
const S1 = 'e2e/fixtures/self-made/s1-interop';

let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

async function open(file: string) {
  const b = readFileSync(join(S1, file));
  const content = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return native.openDocumentBuffer({ id: `t${String(++seq)}`, content }).toPromise();
}

describe('docPtrOf (ADR-005 decision 4: the single private accessor)', () => {
  it('returns the FPDF_DOCUMENT pointer of an open document', async () => {
    const doc = await open('original__plain.pdf');
    const ptr = docPtrOf(native, doc.id);
    expect(ptr).toBeGreaterThan(0);
    expect(rawCall(mod, 'FPDF_GetPageCount', ptr)).toBe(doc.pageCount);
    await native.closeDocument(doc).toPromise();
    expect(() => docPtrOf(native, doc.id)).toThrow(/not open/);
  });

  it('fails loudly if EmbedPDF internals change', () => {
    expect(() => docPtrOf({} as PdfiumNative, 'x')).toThrow(/internals changed/);
    const fake = { cache: { getContext: () => ({ docPtr: 0 }) } } as unknown as PdfiumNative;
    expect(() => docPtrOf(fake, 'x')).toThrow(/internals changed/);
  });

  it('reaches the opened bytes, the page cache and the rotation mode (ADR-016 d4)', async () => {
    const doc = await open('original__plain.pdf');
    const file = readFileSync(join(S1, 'original__plain.pdf'));
    const view = openedBytes(mod, native, doc.id, file.length);
    expect(Buffer.from(view).equals(file)).toBe(true);
    expect(() => {
      purgePageCache(native, doc.id);
    }).not.toThrow();
    expect(isNormalized(native, doc.id)).toBe(false);
    await native.closeDocument(doc).toPromise();
  });

  it('reports a missing PDFium export by name', () => {
    expect(() => rawCall(mod, 'FPDF_NoSuchFunction')).toThrow(/FPDF_NoSuchFunction is missing/);
  });
});

describe('document record fields (rule 9, D-06) on self-made S1 fixtures', () => {
  const info = async (file: string) => {
    const doc = await open(file);
    const ptr = docPtrOf(native, doc.id);
    const out = {
      permissions: rawCall(mod, 'FPDF_GetDocPermissions', ptr) >>> 0,
      signatures: rawCall(mod, 'FPDF_GetSignatureCount', ptr),
    };
    await native.closeDocument(doc).toPromise();
    return out;
  };
  const ANNOTATE = 1 << 5; // PDF permission bit 6: modify annotations / fill forms

  it('an unencrypted file is unrestricted and unsigned', async () => {
    expect(await info('original__plain.pdf')).toEqual({ permissions: 0xffffffff, signatures: 0 });
  });

  it('an owner-password file with annotations denied lacks bit 6', async () => {
    const { permissions } = await info('original__encrypted-noannotate.pdf');
    expect(permissions & ANNOTATE).toBe(0);
  });

  it('an owner-password file allowing annotations keeps bit 6', async () => {
    const { permissions } = await info('original__encrypted-aes256.pdf');
    expect(permissions & ANNOTATE).toBe(ANNOTATE);
  });

  it('a signed file reports its signature', async () => {
    expect((await info('original__signed.pdf')).signatures).toBe(1);
  });
});

describe('self-hosted fallback fonts (ADR-003 decision 3)', () => {
  it('every configured font file exists in its package, with a license', () => {
    for (const [pkg, file] of Object.entries(FONT_FILES)) {
      const dir = join('node_modules', '@embedpdf', `fonts-${pkg}`);
      expect(existsSync(join(dir, 'fonts', file)), `${pkg}/${file}`).toBe(true);
      expect(existsSync(join(dir, 'LICENSE')), `${pkg}/LICENSE`).toBe(true);
    }
  });

  it('uses absolute same-origin URLs, never a CDN', () => {
    const cfg = localFontConfig('https://pdf-tools.openengtools.com');
    const urls = Object.values(cfg.fonts) as string[];
    expect(urls.length).toBeGreaterThan(5);
    for (const u of urls)
      expect(u.startsWith('https://pdf-tools.openengtools.com/fonts/')).toBe(true);
    expect(cfg.fonts[FontCharset.GB2312]).toContain('NotoSansHans-Regular.otf');
  });
});
