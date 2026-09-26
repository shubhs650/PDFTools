// M2-01 spike, Node part: what EmbedPDF 2.15.1's PdfiumNative gives us for the
// M2 panes and the text layer, and what each call costs. Real PDFium (the same
// WASM the workers load), self-made fixtures. Writes out/s10-node.json.
//
//   node spikes/s10-read/run-node.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init } from '@embedpdf/pdfium';
import type {
  PdfAnnotationObject,
  PdfAttachmentObject,
  PdfBookmarksObject,
  PdfDocumentObject,
  PdfLinkAnnoObject,
} from '@embedpdf/models';
import { a0Sheet, contractPdf, simplePdf } from '../../e2e/fixtures/generate.ts';
import { OUTLINE_ENTRIES, attachmentsPdf, layersPdf, outlinePdf } from './make-fixtures.ts';

const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
let seq = 0;

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  return native
    .openDocumentBuffer({ id: `d${String(++seq)}`, content: bytes.slice().buffer })
    .toPromise();
}
async function timed<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const v = await f();
  return [v, Math.round((performance.now() - t) * 100) / 100];
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const stats = (xs: number[]) => ({
  n: xs.length,
  p50: pct(xs, 50),
  p95: pct(xs, 95),
  max: pct(xs, 100),
});
const page = (doc: PdfDocumentObject, i: number) => {
  const p = doc.pages[i];
  if (!p) throw new Error(`no page ${String(i)}`);
  return p;
};
const memory = (mod.pdfium.wasmExports as unknown as { memory: WebAssembly.Memory }).memory;
const wasmMb = () => Math.round((memory.buffer.byteLength / 1048576) * 10) / 10;

const out: Record<string, unknown> = {};

// ---------------------------------------------------------------- Q1 text layer
{
  const doc = await open(contractPdf(2000));
  const geoCold: number[] = [];
  const geoWarm: number[] = [];
  const rects: number[] = [];
  let glyphs = 0;
  let runs = 0;
  for (let i = 0; i < 40; i++) {
    const [g, ms] = await timed(() => native.getPageGeometry(doc, page(doc, i * 50)).toPromise());
    geoCold.push(ms);
    runs += g.runs.length;
    glyphs += g.runs.reduce((n, r) => n + r.glyphs.length, 0);
    geoWarm.push(
      (await timed(() => native.getPageGeometry(doc, page(doc, i * 50)).toPromise()))[1],
    );
    rects.push((await timed(() => native.getPageTextRects(doc, page(doc, i * 50)).toPromise()))[1]);
  }
  const [slice, sliceMs] = await timed(() =>
    native.getTextSlices(doc, [{ pageIndex: 0, charIndex: 0, charCount: 400 }]).toPromise(),
  );
  const sheet = await open(a0Sheet(200_000));
  const [, a0Geo] = await timed(() => native.getPageGeometry(sheet, page(sheet, 0)).toPromise());
  const [, a0GeoWarm] = await timed(() =>
    native.getPageGeometry(sheet, page(sheet, 0)).toPromise(),
  );
  out.q1TextLayer = {
    contractGeometryColdMs: stats(geoCold),
    contractGeometryWarmMs: stats(geoWarm),
    contractTextRectsMs: stats(rects),
    glyphsPerPage: Math.round(glyphs / 40),
    runsPerPage: Math.round(runs / 40),
    textSlice400Ms: sliceMs,
    textSliceSample: slice[0]?.slice(0, 60),
    a0Dense200kGeometryColdMs: a0Geo,
    a0Dense200kGeometryWarmMs: a0GeoWarm,
    wasmMb: wasmMb(),
  };
  await native.closeDocument(doc).toPromise();
  await native.closeDocument(sheet).toPromise();
}

// ---------------------------------------------------------------- Q2 thumbnails
{
  const inputs: [string, Uint8Array][] = [
    ['contract', contractPdf(200)],
    ['a0Typical20k', a0Sheet(20_000)],
    ['a0Dense200k', a0Sheet(200_000)],
  ];
  const res: Record<string, unknown> = {};
  for (const [name, bytes] of inputs) {
    const doc = await open(bytes);
    const p = page(doc, 0);
    const scale = 150 / p.size.width; // the stock plugin's 150 px default width
    const [img, cold] = await timed(() =>
      native
        .renderPageRect(doc, p, { origin: { x: 0, y: 0 }, size: p.size }, { scaleFactor: scale })
        .toPromise(),
    );
    const [, warm] = await timed(() =>
      native
        .renderPageRect(doc, p, { origin: { x: 0, y: 0 }, size: p.size }, { scaleFactor: scale })
        .toPromise(),
    );
    const [, thumb] = await timed(() =>
      native.renderThumbnailRaw(doc, p, { scaleFactor: scale }).toPromise(),
    );
    res[name] = {
      px: `${String(img.width)}x${String(img.height)}`,
      coldMs: cold,
      warmMs: warm,
      renderThumbnailRawMs: thumb,
    };
    await native.closeDocument(doc).toPromise();
  }
  out.q2Thumbnails = res;
}

// ---------------------------------------------------------------- Q3 bookmarks and links
{
  const doc = await open(outlinePdf());
  const [bm, ms] = await timed<PdfBookmarksObject>(() => native.getBookmarks(doc).toPromise());
  let count = 0;
  let depth = 0;
  const walk = (list: typeof bm.bookmarks, d: number) => {
    for (const b of list) {
      count++;
      depth = Math.max(depth, d);
      walk(b.children ?? [], d + 1);
    }
  };
  walk(bm.bookmarks, 1);
  const annots = (await native
    .getPageAnnotations(doc, page(doc, 0))
    .toPromise()) as PdfLinkAnnoObject[];
  out.q3Bookmarks = {
    expected: OUTLINE_ENTRIES(),
    count,
    depth,
    ms,
    firstTarget: bm.bookmarks[0]?.target,
    secondTarget: bm.bookmarks[1]?.target,
    links: annots.map((a) => ({ type: a.type, rect: a.rect, target: a.target })),
  };
  await native.closeDocument(doc).toPromise();
}

// ---------------------------------------------------------------- Q4 attachments
{
  const bytes = attachmentsPdf(20, 20, simplePdf(2));
  const doc = await open(bytes);
  const [list, listMs] = await timed<PdfAttachmentObject[]>(() =>
    native.getAttachments(doc).toPromise(),
  );
  const big = list.find((a) => a.name === 'big.bin');
  const inner = list.find((a) => a.name === 'inner.pdf');
  const before = wasmMb();
  const [bigBytes, bigMs] = big
    ? await timed<ArrayBuffer>(() => native.readAttachmentContent(doc, big).toPromise())
    : [new ArrayBuffer(0), 0];
  const [innerBytes] = inner
    ? await timed<ArrayBuffer>(() => native.readAttachmentContent(doc, inner).toPromise())
    : [new ArrayBuffer(0)];
  const innerHead = new TextDecoder().decode(new Uint8Array(innerBytes).slice(0, 5));
  const annots = (await native
    .getPageAnnotations(doc, page(doc, 0))
    .toPromise()) as PdfAnnotationObject[];
  out.q4Attachments = {
    fileBytes: bytes.length,
    listed: list.length,
    listMs,
    sample: list.slice(0, 2),
    big: {
      reportedSize: big?.size,
      readBytes: bigBytes.byteLength,
      readMs: bigMs,
      wasmMbBefore: before,
      wasmMbAfter: wasmMb(),
    },
    innerPdfHeader: innerHead,
    annotationAttachmentListed: list.some((a) => a.name === 'on-page.txt'),
    pageAnnotations: annots.map((a) => a.type),
  };
  await native.closeDocument(doc).toPromise();
}

// ---------------------------------------------------------------- Q5 layers
{
  const doc = await open(layersPdf());
  const img = await native.renderPageRaw(doc, page(doc, 0), { scaleFactor: 1 }).toPromise();
  const dark = (x: number, yTop: number) => {
    const i = (yTop * img.width + x) * 4;
    return (img.data[i] ?? 255) < 128;
  };
  // Grid block: x 50..150, y (PDF) 700..800 → top 42..142. Notes: x 400..500, y 50..150 → top 692..792.
  out.q5Layers = {
    gridOnDrawn: dark(100, 92),
    notesOffDrawn: dark(450, 742),
    ocgExportsInWasm: Object.keys(mod).filter((k) =>
      /OCG|OCProperties|OptionalContent|Layer/.test(k),
    ),
  };
  await native.closeDocument(doc).toPromise();
}

mkdirSync('spikes/s10-read/out', { recursive: true });
writeFileSync('spikes/s10-read/out/s10-node.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
