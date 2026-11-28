// M14-10 on real PDFium (D-76, ADR-035): the summary /FreeText drawn as a
// table in the app's own font, its /Rect the laid-out size from its top-left
// corner, its rows in /Contents; and Attach to this PDF — one copy of the
// export as a document attachment with its stamp, replaced (not added) when
// attached again, saved by Ctrl+S's tail and read back after a reopen.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfAttachmentObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { unzlibSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { summaryLayout, summaryText, type SummaryMeta } from '../../src/model/measureSummary';
import { PdfStream } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { FaceStore } from '../../src/workers/render/commentFonts/faces';
import {
  attachExport,
  numbered,
  readExportAttachment,
} from '../../src/workers/render/exportAttachment';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { applySummaryAppearance, prepareSummary } from '../../src/workers/render/summaryAppearance';

const require = createRequire(import.meta.url);
const VENDOR = fileURLToPath(new URL('../../vendor/fonts/files/', import.meta.url));
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let faces: FaceStore;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  tracker = new SaveTracker(mod, native);
  faces = new FaceStore({
    harfbuzz: () => import('harfbuzzjs'),
    subsetWasm: () =>
      Promise.resolve(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'))),
    fontFile: (file) => Promise.resolve(new Uint8Array(readFileSync(join(VENDOR, file)))),
  });
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `x${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

const ROWS = [
  ['Measurements, all pages', 'Count', 'Total'],
  ['Length', '3', '12.50 m'],
  ['Area', '1', '42.00 m²'],
];

/** Every appearance stream drawn by the page's annotations, inflated, as text. */
async function appearances(bytes: Uint8Array): Promise<string> {
  const r = await PdfReader.open(bytes, (b) => Promise.resolve(unzlibSync(b)));
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = async (v: unknown, depth: number): Promise<void> => {
    const x = await r.resolve(v as never);
    if (depth > 16 || !x || seen.has(x)) return;
    seen.add(x);
    if (x instanceof PdfStream) {
      out.push(Buffer.from(await r.decode(x)).toString('latin1'));
      await walk(x.dict.get('Resources'), depth + 1);
      return;
    }
    if (x instanceof Map) for (const e of x.values()) await walk(e, depth + 1);
  };
  for (const p of await r.pages()) {
    const annots = await r.resolve(p.dict.get('Annots'));
    if (!Array.isArray(annots)) continue;
    for (const a of annots) {
      const d = await r.resolve(a);
      if (d instanceof Map) await walk(d.get('AP'), 0);
    }
  }
  return out.join('\n');
}

describe('the summary table (M14-10, D-76)', () => {
  it('is one FreeText drawn as a table, sized as laid out, its rows in /Contents', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const size = summaryLayout(ROWS);
    const meta: SummaryMeta = { scope: 'all', rows: ROWS };
    const annot = {
      type: PdfAnnotationSubtype.FREETEXT,
      id: 'sum-1',
      pageIndex: 0,
      flags: ['print'],
      // EmbedPDF's page space (top-left origin); the worker keeps the top-left corner.
      rect: { origin: { x: 300, y: 100 }, size: { width: 50, height: 20 } },
      contents: summaryText(ROWS),
      fontFamily: PdfStandardFont.Helvetica,
      fontSize: 8.5,
      fontColor: '#1A1A1A',
      textAlign: PdfTextAlignment.Left,
      verticalAlign: PdfVerticalAlignment.Top,
      color: 'transparent',
      opacity: 1,
      summary: meta,
    };
    const args: unknown[] = [doc, page, annot];
    const f = await prepareSummary(faces, 'createPageAnnotation', args);
    expect(f).not.toBeNull();
    await native.createPageAnnotation(doc, page, annot as never).toPromise();
    expect(applySummaryAppearance(mod, native, 'createPageAnnotation', args, f)).toBe('drawn');
    tracker.recordMutation('createPageAnnotation', args);

    const read = (await native.getPageAnnotations(doc, page).toPromise()) as { id: string }[];
    const ft = read.find((a: { id: string }) => a.id === 'sum-1') as
      | {
          type: number;
          contents?: string;
          rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
        }
      | undefined;
    expect(ft?.type).toBe(PdfAnnotationSubtype.FREETEXT);
    expect(ft?.contents).toBe(
      'Measurements, all pages\tCount\tTotal\nLength\t3\t12.50 m\nArea\t1\t42.00 m²',
    );
    expect(ft?.rect.origin.x).toBeCloseTo(300, 0);
    expect(ft?.rect.origin.y).toBeCloseTo(100, 0);
    expect(ft?.rect.size.width).toBeCloseTo(size.width, 0);
    expect(ft?.rect.size.height).toBeCloseTo(size.height, 0);

    const s = await tracker.save(doc.id);
    const saved = concatBytes([original, s.tail]);
    const ap = await appearances(saved);
    // The grid, the head row's shade and each cell's text in embedded Inter.
    expect(ap).toMatch(/0\.93 0\.93 0\.93 rg/u);
    expect(ap).toMatch(/ActualText <FEFF004C0065006E006700740068>/u); // "Length"
    expect(ap).toMatch(/ActualText <FEFF00340032002E003000300020006D00B2>/u); // "42.00 m²"
    expect(Buffer.from(saved).toString('latin1')).toMatch(/\/FontFile2/u);
  });
});

describe('Attach to this PDF (M14-10, Q17, Q18)', () => {
  const XLSX = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7) & 255));

  it('replaces our earlier copy, keeps other attachments, and reads back after a save', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    // Someone else's attachment of the same name is left alone.
    await native
      .addAttachment(doc, {
        name: 'plan (Measurements).xlsx',
        description: 'theirs',
        mimeType: 'text/plain',
        data: new TextEncoder().encode('not ours'),
      })
      .toPromise();
    const first = attachExport(mod, native, doc.id, {
      name: 'plan (Measurements).xlsx',
      description: 'Measurements export',
      bytes: XLSX(300).slice().buffer,
      stamp: 'v1;p0;all;00000001',
    });
    expect(first).toBe('plan (Measurements) 2.xlsx');
    const second = attachExport(mod, native, doc.id, {
      name: 'plan (Measurements).xlsx',
      description: 'Measurements export',
      bytes: XLSX(500).slice().buffer,
      stamp: 'v1;p1;page2;00000002',
    });
    expect(second).toBe('plan (Measurements) 2.xlsx');
    expect(readExportAttachment(mod, native, doc.id)).toEqual({
      name: 'plan (Measurements) 2.xlsx',
      stamp: 'v1;p1;page2;00000002',
    });
    const list = (await native.getAttachments(doc).toPromise()) as PdfAttachmentObject[];
    expect(list.map((a) => a.name).sort()).toEqual([
      'plan (Measurements) 2.xlsx',
      'plan (Measurements).xlsx',
    ]);
    tracker.recordMutation('addAttachment', [{ id: doc.id }]);
    const s = await tracker.save(doc.id);
    const saved = concatBytes([original, s.tail]);
    const again = await open(saved);
    expect(readExportAttachment(mod, native, again.id)?.stamp).toBe('v1;p1;page2;00000002');
    const back = (await native.getAttachments(again).toPromise()) as PdfAttachmentObject[];
    const ours = back.find((a) => a.name === 'plan (Measurements) 2.xlsx');
    if (!ours) throw new Error('not attached');
    const bytes = (await native.readAttachmentContent(again, ours).toPromise()) as ArrayBuffer;
    expect(new Uint8Array(bytes)).toEqual(XLSX(500));
    expect(rawCall(mod, 'FPDFDoc_GetAttachmentCount', docPtrOf(native, again.id))).toBe(2);
  });

  it('numbers a name that is taken', () => {
    expect(numbered('plan (Measurements).xlsx', 3)).toBe('plan (Measurements) 3.xlsx');
    expect(numbered('noext', 2)).toBe('noext 2');
  });
});
