// M3-02 (ADR-015), browser part. Served by spikes/shared/serve.ts with the
// §10.1 CSP verbatim plus COOP/COEP. Needs ExcelJS installed for the run only:
//   npm install --no-save exceljs@4.4.0   (ADR-015; add the unzipper override first)
//   PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium SPIKE=s13 npm run spikes -- --project=s13
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init } from '@embedpdf/pdfium';
import { expect, test, type Page } from '@playwright/test';
import { simplePdf } from '../../e2e/fixtures/generate.ts';

type Api = Record<string, (...a: unknown[]) => Promise<unknown>> & {
  probe: { longTasks: { duration: number }[]; cspViolations: unknown[] };
};
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([name, args]) => (window as unknown as { __s13: Api }).__s13[name]?.(...args), [
    m,
    a,
  ] as const);
const probe = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __s13: Api }).__s13.probe;
    return { longTasks: p.longTasks.map((t) => Math.round(t.duration)), csp: p.cspViolations };
  });

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s13-results.json', JSON.stringify(results, null, 2));
});

const require = createRequire(import.meta.url);

/**
 * Edge softness of rendered text: the share of "mid-tone" pixels (neither
 * background nor full ink) among all non-background pixels. Vector text stays
 * low at any zoom; an upscaled bitmap grows soft edges.
 */
function softness(data: Uint8ClampedArray, inkRed: number): number {
  let ink = 0;
  let mid = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Position between the white page (0) and the ink colour (1), on red.
    const t = (255 - (data[i] ?? 255)) / (255 - inkRed);
    if (t < 0.1) continue;
    ink++;
    if (t < 0.9) mid++;
  }
  return ink ? Math.round((mid / ink) * 1000) / 1000 : 0;
}

test('dynamic stamp: PNG drawn in a worker, placed as an image stamp; sharpness vs vector text', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('S13 ready');
  const mod = await init({
    wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
  });
  const native = new PdfiumNative(mod, { fontFallback: null });
  const spec = {
    code: 'B',
    label: 'Approved as Noted',
    reviewer: 'A. Reviewer (MEC)',
    date: '2026-09-27',
    doc: 'DOC-1234-ME-001 Rev C',
    width: 170,
    height: 60,
    color: '#1E6B3A',
  };
  const out: Record<string, unknown> = {};
  for (const scale of [1, 2, 4, 8]) {
    const s = (await call(page, 'stamp', { ...spec, scale })) as {
      png: string;
      bytes: number;
      ms: number;
      w: number;
      h: number;
    };
    const doc: PdfDocumentObject = await native
      .openDocumentBuffer({ id: `s${String(scale)}`, content: simplePdf(1).slice().buffer })
      .toPromise();
    const pg = doc.pages[0];
    if (!pg) throw new Error('no page');
    const rect = { origin: { x: 100, y: 200 }, size: { width: spec.width, height: spec.height } };
    const png = Buffer.from(s.png, 'base64');
    const stamp: PdfAnnotationObject = {
      id: `stamp-${String(scale)}`,
      pageIndex: 0,
      type: PdfAnnotationSubtype.STAMP,
      rect,
      contents: `${spec.code} ${spec.label}`,
      flags: ['print'],
    };
    await native
      .createPageAnnotation(doc, pg, stamp, {
        data: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        mimeType: 'image/png',
      } as never)
      .toPromise();
    const zooms: Record<string, number> = {};
    for (const z of [1, 4, 16]) {
      const img = await native
        .renderPageRect(
          doc,
          pg,
          { origin: { x: 110, y: 205 }, size: { width: 60, height: 22 } },
          { scaleFactor: z, withAnnotations: true },
        )
        .toPromise();
      zooms[`zoom${String(z * 100)}`] = softness(img.data, 0x1e);
    }
    const saved = (await native.saveAsCopy(doc).toPromise()) as ArrayBuffer;
    await native.closeDocument(doc).toPromise();
    out[`png${String(scale)}x`] = {
      drawMs: Math.round(s.ms),
      pixels: `${String(s.w)}×${String(s.h)}`,
      pngBytes: s.bytes,
      fileBytes: saved.byteLength,
      softness: zooms,
    };
  }
  // Reference: the same first line as vector text (FreeText, PDFium appearance).
  const doc: PdfDocumentObject = await native
    .openDocumentBuffer({ id: 'ft', content: simplePdf(1).slice().buffer })
    .toPromise();
  const pg = doc.pages[0];
  if (!pg) throw new Error('no page');
  await native
    .createPageAnnotation(doc, pg, {
      id: 'ft',
      pageIndex: 0,
      type: PdfAnnotationSubtype.FREETEXT,
      rect: { origin: { x: 100, y: 200 }, size: { width: 170, height: 60 } },
      contents: `${spec.code}  ${spec.label}`,
      fontFamily: PdfStandardFont.Helvetica,
      fontSize: 18,
      fontColor: spec.color,
      textAlign: PdfTextAlignment.Left,
      verticalAlign: PdfVerticalAlignment.Top,
      color: 'transparent',
      opacity: 1,
      flags: ['print'],
    } satisfies PdfAnnotationObject)
    .toPromise();
  const ref: Record<string, number> = {};
  for (const z of [1, 4, 16]) {
    const img = await native
      .renderPageRect(
        doc,
        pg,
        { origin: { x: 110, y: 205 }, size: { width: 60, height: 22 } },
        { scaleFactor: z, withAnnotations: true },
      )
      .toPromise();
    ref[`zoom${String(z * 100)}`] = softness(img.data, 0x1e);
  }
  await native.closeDocument(doc).toPromise();
  out.vectorFreeText = ref;
  const p = await probe(page);
  results.stamps = { ...out, longTasks: p.longTasks, csp: p.csp };
  expect(p.csp).toEqual([]);
  expect(p.longTasks.filter((d) => d > 100)).toEqual([]);
});

test('CRS workbook: ExcelJS in a worker under the §10.1 CSP', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await expect(page).toHaveTitle('S13 ready');
  const small = (await call(page, 'xlsx', 50, true)) as { b64: string; bytes: number };
  const text = (await call(page, 'xlsx', 1000, false)) as Record<string, number>;
  const withImages = (await call(page, 'xlsx', 1000, true)) as Record<string, number>;
  const cancelled = (await call(page, 'xlsx', 1000, true, 300)) as Record<string, number>;
  const memory = await call(page, 'memory');
  const p = await probe(page);

  // Read back in Node (ExcelJS's JSZip reader): header, columns, merged cells, images.
  // Not a committed dependency (ADR-015): resolved at run time only.
  const excel = 'exceljs';
  const { default: ExcelJS } = (await import(excel)) as {
    default: {
      Workbook: new () => {
        xlsx: { load(b: Buffer): Promise<unknown> };
        getWorksheet(n: string): {
          rowCount: number;
          getCell(a: string): { value: unknown; isMerged: boolean };
          getRow(n: number): { values: unknown[] };
          getImages(): { range: { tl: { nativeRow: number; nativeCol: number } } }[];
        };
      };
    };
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(small.b64, 'base64'));
  const ws = wb.getWorksheet('CRS');
  const images = ws.getImages();
  const readBack = {
    rows: ws.rowCount,
    title: ws.getCell('A1').value,
    titleMerged: ws.getCell('K1').isMerged,
    header: ws.getRow(9).values.filter(Boolean),
    images: images.length,
    firstImageAt: images[0]
      ? { row: images[0].range.tl.nativeRow, col: images[0].range.tl.nativeCol }
      : null,
  };

  // Bundle size of the worker chunk that holds ExcelJS.
  const dir = join(import.meta.dirname, 'dist', 'assets');
  const chunk = readdirSync(dir)
    .filter((f) => f.startsWith('xlsx.worker') && f.endsWith('.js'))
    .map((f) => readFileSync(join(dir, f)))[0];
  const size = chunk
    ? {
        raw: chunk.length,
        gzip: gzipSync(chunk).length,
        brotli: brotliCompressSync(chunk).length,
      }
    : null;

  results.xlsx = {
    text,
    withImages,
    cancelled,
    memory,
    readBack,
    workerChunk: size,
    longTasks: p.longTasks,
    csp: p.csp,
  };
  expect(p.csp).toEqual([]);
  expect(p.longTasks.filter((d) => d > 100)).toEqual([]);
  expect(readBack.images).toBe(50);
  expect(cancelled.cancelledAt).toBe(300);
});
