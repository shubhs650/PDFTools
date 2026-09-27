// M2-16: Export Print-Ready PDF on real PDFium (as in the Work worker):
// flatten a copy, full rewrite, /AcroForm and unreachable objects dropped.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { hasQpdf, qpdfEncrypt } from '../../e2e/fixtures/encrypted';
import { fullFormPdf, printPdf } from '../../e2e/fixtures/generate';
import { RpcError } from '../../src/engine/errors';
import { prunePrintReady, PrintReadyFormatError, removeKey } from '../../src/model/printReady';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { flattenCopy, type FlattenOptions } from '../../src/workers/work/flatten';
import { renderBand } from '../../src/workers/work/print';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

const slice = { checkpoint: () => Promise.resolve(), signal: new AbortController().signal };
const text = (u: Uint8Array) => Buffer.from(u).toString('latin1');

async function open(bytes: Uint8Array, password?: string) {
  const doc = await native
    .openDocumentBuffer(
      { id: `d${String(++seq)}`, content: bytes.slice().buffer },
      password ? { password } : {},
    )
    .toPromise();
  return { doc, ptr: docPtrOf(native, doc.id) };
}

async function exportOf(
  bytes: Uint8Array,
  opts: FlattenOptions = { pages: null, markups: 'on' },
  password?: string,
) {
  const { doc, ptr } = await open(bytes, password);
  const steps: number[] = [];
  try {
    const out = await flattenCopy(mod, ptr, opts, slice, (p) => steps.push(p.done));
    return { out, steps };
  } finally {
    await native.closeDocument(doc).toPromise();
  }
}

/** Annotations per page and the form type of a file. */
async function facts(bytes: Uint8Array, password?: string) {
  const { doc, ptr } = await open(bytes, password);
  try {
    const annots = doc.pages.map((p) => {
      const page = rawCall(mod, 'FPDF_LoadPage', ptr, p.index);
      const n = rawCall(mod, 'FPDFPage_GetAnnotCount', page);
      rawCall(mod, 'FPDF_ClosePage', page);
      return n;
    });
    return { pages: doc.pageCount, annots, formType: rawCall(mod, 'FPDF_GetFormType', ptr) };
  } finally {
    await native.closeDocument(doc).toPromise();
  }
}

/** Page `i` rendered for print at 1 px/pt, markups on. */
async function pixels(bytes: Uint8Array, i = 0): Promise<Uint8ClampedArray> {
  const { doc, ptr } = await open(bytes);
  try {
    const h = Math.round(doc.pages[i]?.size.height ?? 0);
    return renderBand(mod, ptr, {
      pageIndex: i,
      scale: 1,
      region: null,
      top: 0,
      rows: h,
      markups: 'on',
    }).data;
  } finally {
    await native.closeDocument(doc).toPromise();
  }
}

/** Share of pixels whose channels differ by more than 16. */
function diff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(
      Math.abs((a[i] ?? 0) - (b[i] ?? 0)),
      Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)),
      Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)),
    );
    if (d > 16) n++;
  }
  return n / (a.length / 4);
}

function qpdfCheck(bytes: Uint8Array, password?: string): number | null {
  if (!hasQpdf()) return null;
  const dir = mkdtempSync(join(tmpdir(), 'pdftools-pr-'));
  const f = join(dir, 'out.pdf');
  writeFileSync(f, bytes);
  const args = password ? [`--password=${password}`, '--check', f] : ['--check', f];
  return spawnSync('qpdf', args).status;
}

describe('flattenCopy', () => {
  it('form: 0 annotations, 0 fields, no /AcroForm, same pixels, vector, qpdf clean', async () => {
    const src = fullFormPdf();
    const { out, steps } = await exportOf(src);
    expect(steps).toEqual([0, 1]);
    expect(await facts(out)).toEqual({ pages: 1, annots: [0], formType: 0 });
    expect(text(out)).not.toContain('/AcroForm');
    // The field objects and their values are gone, not just unreachable.
    expect(text(out)).not.toContain('(Initial)');
    expect(text(out)).not.toMatch(/\/FT\s*\/Tx/);
    expect(text(out)).not.toMatch(/\/Subtype\s*\/Image/);
    expect(diff(await pixels(src), await pixels(out))).toBeLessThan(0.002);
    expect(qpdfCheck(out)).toBe(hasQpdf() ? 0 : null);
  });

  it('markups: printable ones burned in, screen-only dropped; off keeps page content only', async () => {
    const src = printPdf();
    const on = (await exportOf(src)).out;
    expect((await facts(on)).annots).toEqual([0, 0, 0]);
    const at = (px: Uint8ClampedArray, x: number, y: number) => {
      const i = (y * 595 + x) * 4;
      return [...px.subarray(i, i + 4)];
    };
    const pOn = await pixels(on);
    expect(at(pOn, 100, 90)).toEqual([255, 0, 0, 255]); // printable red square
    expect(at(pOn, 450, 740)).toEqual([255, 255, 255, 255]); // screen-only: not printed
    expect(at(pOn, 100, 220)).toEqual([0, 0, 0, 255]);
    const off = (await exportOf(src, { pages: null, markups: 'off' })).out;
    const pOff = await pixels(off);
    expect(at(pOff, 100, 90)).toEqual([255, 255, 255, 255]);
    expect(at(pOff, 100, 220)).toEqual([0, 0, 0, 255]);
    expect(qpdfCheck(on)).toBe(hasQpdf() ? 0 : null);
  });

  it('a page subset keeps those pages in order and drops the others’ objects', async () => {
    const src = printPdf();
    const all = (await exportOf(src)).out;
    const { out, steps } = await exportOf(src, { pages: [2, 1], markups: 'on' });
    expect(steps).toEqual([0, 1, 2]);
    const f = await facts(out);
    expect(f.pages).toBe(2);
    expect(out.length).toBeLessThan(all.length);
    expect(text(out)).not.toContain('50 602 250 40 re f'); // page 1's content stream
    expect(qpdfCheck(out)).toBe(hasQpdf() ? 0 : null);
  });

  it.runIf(hasQpdf())('a source with object streams and an xref stream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdftools-os-'));
    writeFileSync(join(dir, 'in.pdf'), fullFormPdf());
    spawnSync('qpdf', ['--object-streams=generate', join(dir, 'in.pdf'), join(dir, 'os.pdf')]);
    const src = new Uint8Array(readFileSync(join(dir, 'os.pdf')));
    expect(text(src)).toContain('/ObjStm');
    const { out } = await exportOf(src);
    expect(await facts(out)).toEqual({ pages: 1, annots: [0], formType: 0 });
    expect(text(out)).not.toContain('/AcroForm');
    expect(qpdfCheck(out)).toBe(0);
  });

  it.runIf(hasQpdf())(
    'an encrypted source stays encrypted and opens with its password',
    async () => {
      const src = qpdfEncrypt(fullFormPdf(), 'u', 'o', ['256']);
      const { out } = await exportOf(src, { pages: null, markups: 'on' }, 'u');
      expect(text(out)).toContain('/Encrypt');
      expect(await facts(out, 'u')).toEqual({ pages: 1, annots: [0], formType: 0 });
      expect(qpdfCheck(out, 'u')).toBe(0);
    },
  );

  it.runIf(hasQpdf())('print denied: refused (rule 9)', async () => {
    const src = qpdfEncrypt(fullFormPdf(), 'u', 'o', ['256', '--print=none']);
    await expect(exportOf(src, { pages: null, markups: 'on' }, 'u')).rejects.toMatchObject({
      code: 'print-denied',
    });
    expect(RpcError).toBeDefined();
  });
});

describe('prunePrintReady', () => {
  const pdf = (objs: string[], trailer = '/Root 1 0 R'): Uint8Array => {
    let body = '%PDF-1.7\n';
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(body.length);
      body += `${String(i + 1)} 0 obj\n${o}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f\r\n`;
    for (const o of offs) body += `${String(o).padStart(10, '0')} 00000 n\r\n`;
    body += `trailer\n<< /Size ${String(objs.length + 1)} ${trailer} >>\nstartxref\n${String(xref)}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
  };

  it('drops /AcroForm (a reference) and what only it reached; keeps streams verbatim', () => {
    const src = pdf([
      '<< /Type /Catalog /Pages 2 0 R /AcroForm 4 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 99 99] /Contents 6 0 R >>',
      '<< /Fields [5 0 R] >>',
      '<< /T (secret) >>',
      '<< /Length 13 >>\nstream\n(7 0 R) Tj xx\nendstream',
      '<< /Unused true >>',
    ]);
    const { bytes, dropped } = prunePrintReady(src);
    const t = text(bytes);
    expect(dropped).toBe(3);
    expect(t).not.toContain('AcroForm');
    expect(t).not.toContain('secret');
    expect(t).not.toContain('Unused'); // "7 0 R" inside stream data is not a reference
    expect(t).toContain('(7 0 R) Tj xx');
    expect(t).toMatch(/xref\n0 8\n/);
    if (hasQpdf()) expect(qpdfCheck(bytes)).toBe(0);
  });

  it('drops an inline /AcroForm dictionary and keeps /Info', () => {
    const src = pdf(
      [
        '<< /Type /Catalog /AcroForm << /Fields [3 0 R] /DR << /Font << >> >> >> /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [] /Count 0 >>',
        '<< /T (x) >>',
        '<< /Title (kept) >>',
      ],
      '/Root 1 0 R /Info 4 0 R',
    );
    const t = text(prunePrintReady(src).bytes);
    expect(t).toContain('/Pages 2 0 R');
    expect(t).toContain('(kept)');
    expect(t).not.toContain('/T (x)');
  });

  it('removeKey handles references, dictionaries, arrays and tokens', () => {
    expect(removeKey('<< /A 1 0 R /B 2 >>', 'A')).toBe('<<   /B 2 >>');
    expect(removeKey('<< /A << /X (>>) >> /B 2 >>', 'A')).toBe('<<   /B 2 >>');
    expect(removeKey('<< /A [1 [2]] /B 2 >>', 'A')).toBe('<<   /B 2 >>');
    expect(removeKey('<< /A true /B 2 >>', 'A')).toBe('<<   /B 2 >>');
    expect(removeKey('<< /AB 1 >>', 'A')).toBe('<< /AB 1 >>');
  });

  it('refuses files it does not understand', () => {
    expect(() => prunePrintReady(Buffer.from('%PDF-1.7\nno xref'))).toThrow(PrintReadyFormatError);
    const prev = pdf(['<< /Type /Catalog >>'], '/Root 1 0 R /Prev 5');
    expect(() => prunePrintReady(prev)).toThrow(PrintReadyFormatError);
  });
});
