// M0-S2 Node harness: write ISO 32000 measurement structures, read them back,
// check they survive EmbedPDF edits, and build the owner's interop pack.
//
// Usage: node spikes/s2-measure/run-node.ts
// Output: spikes/s2-measure/out/ (results JSON, interop pack). Needs the qpdf CLI.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { init } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { buildPdf } from '../shared/mini-pdf.ts';
import { narrowTail, saveWithFlags, docPtrOf, FPDF_INCREMENTAL } from '../s1-save/save-core.ts';
import {
  D,
  N,
  PdfDocument,
  PdfRef,
  PdfString,
  S,
  isDict,
  type PdfDict,
  type PdfValue,
} from './pdf-object.ts';
import { appendRevision } from './revision.ts';
import { readMeasurements } from './read-measure.ts';
import {
  MM_PER_POINT,
  chooseScale,
  format,
  measure,
  toMeasureRL,
  type Kind,
  type Pt,
  type Scale,
  type ScaleViewport,
} from './scale-math.ts';

const here = import.meta.dirname;
const root = join(here, '..', '..');
const out = join(here, 'out');
const pack = join(out, 'interop-pack');
mkdirSync(pack, { recursive: true });
const inflate = (b: Uint8Array): Uint8Array => new Uint8Array(inflateSync(b));
const mm = (v: number): number => v / MM_PER_POINT;

// ---- the self-made A1 sheet ------------------------------------------------------
const W = 2384;
const H = 1684;
const PAGE_SCALE: Scale = { paper: 1, real: 100, unit: 'm', precision: 2 };
const DETAIL_SCALE: Scale = { paper: 1, real: 5, unit: 'mm', precision: 1 };
// Building 20 × 10 m at 1:100 → 200 × 100 mm on paper.
const B0 = { x: mm(80), y: mm(250) };
const building: Pt[] = [
  B0,
  { x: B0.x + mm(200), y: B0.y },
  { x: B0.x + mm(200), y: B0.y + mm(100) },
  { x: B0.x, y: B0.y + mm(100) },
];
// Detail A region and a 400 × 200 mm plate at 1:5 → 80 × 40 mm on paper.
const DETAIL_BBOX: [number, number, number, number] = [mm(450), mm(200), mm(700), mm(420)];
const P0 = { x: mm(500), y: mm(280) };
const plate: Pt[] = [
  P0,
  { x: P0.x + mm(80), y: P0.y },
  { x: P0.x + mm(80), y: P0.y + mm(40) },
  { x: P0.x, y: P0.y + mm(40) },
];
const VIEWPORTS: ScaleViewport[] = [
  { name: 'Sheet 1:100', bbox: [0, 0, W, H], scale: PAGE_SCALE },
  { name: 'Detail A', bbox: DETAIL_BBOX, scale: DETAIL_SCALE },
];

function sheet(): Uint8Array {
  const f = (n: number): string => n.toFixed(2);
  const poly = (pts: Pt[]): string =>
    `${pts.map((p, i) => `${f(p.x)} ${f(p.y)} ${i ? 'l' : 'm'}`).join(' ')} h S`;
  const [x1, y1, x2, y2] = DETAIL_BBOX;
  const content = [
    '0 G 2 w 20 20 2344 1644 re S',
    '1 w',
    poly(building),
    poly(plate),
    '[6 4] 0 d',
    `${f(x1)} ${f(y1)} ${f(x2 - x1)} ${f(y2 - y1)} re S`,
    '[] 0 d',
    'BT /F1 28 Tf 1600 80 Td (PDFTools M0-S2 test sheet - SCALE 1:100 - self-made) Tj ET',
    `BT /F1 20 Tf ${f(B0.x)} ${f(B0.y - 30)} Td (BUILDING 20 m x 10 m  \\(1:100\\)) Tj ET`,
    `BT /F1 20 Tf ${f(x1 + 10)} ${f(y2 - 30)} Td (DETAIL A  1:5  - plate 400 x 200 mm) Tj ET`,
  ].join('\n');
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(W)} ${String(H)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    { dict: '<< >>', stream: content },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

// ---- measurements -----------------------------------------------------------------
interface Spec {
  id: string;
  kind: Kind;
  pts: Pt[]; // user space
  expect: string; // value we display
}
const closed = (pts: Pt[]): Pt[] => [...pts, pts[0] ?? { x: 0, y: 0 }];
const SPECS: Spec[] = [
  {
    id: 's2-dist-page',
    kind: 'distance',
    pts: [building[0] ?? B0, building[1] ?? B0],
    expect: '20.00 m',
  },
  { id: 's2-perim-page', kind: 'distance', pts: closed(building), expect: '60.00 m' },
  { id: 's2-area-page', kind: 'area', pts: building, expect: '200.00 m²' },
  {
    id: 's2-dist-detail',
    kind: 'distance',
    pts: [plate[0] ?? P0, plate[1] ?? P0],
    expect: '400.0 mm',
  },
  { id: 's2-perim-detail', kind: 'distance', pts: closed(plate), expect: '1200.0 mm' },
  { id: 's2-area-detail', kind: 'area', pts: plate, expect: '80000.0 mm²' },
  { id: 's2-span', kind: 'distance', pts: [building[1] ?? B0, plate[0] ?? P0], expect: 'spanning' },
];
const IT: Record<string, string> = {
  line: 'LineDimension',
  polyline: 'PolyLineDimension',
  polygon: 'PolygonDimension',
};
const subtypeFor = (s: Spec): 'line' | 'polyline' | 'polygon' =>
  s.kind === 'area' ? 'polygon' : s.pts.length === 2 ? 'line' : 'polyline';

/** Scale + displayed value for a spec, per §7.4 (spanning → page default + warning). */
function valueFor(s: Spec): { scale: Scale; text: string; warning?: string } {
  const choice = chooseScale(s.pts, VIEWPORTS.slice(1), PAGE_SCALE);
  const scale = choice.kind === 'viewport' ? choice.viewport.scale : PAGE_SCALE;
  const v = measure(s.kind, s.pts, scale);
  const text = format(v, scale, s.kind);
  return choice.kind === 'spanning'
    ? { scale, text, warning: `spans ${choice.viewports.join(' + ')}` }
    : { scale, text };
}

const RED = '#E44234';
const toTop = (p: Pt): { x: number; y: number } => ({ x: p.x, y: H - p.y }); // EmbedPDF: top-left origin
function bboxRect(pts: Pt[], pad = 10) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => H - p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return {
    origin: { x, y },
    size: { width: Math.max(...xs) - x + pad, height: Math.max(...ys) - y + pad },
  };
}

function annotationFor(s: Spec): PdfAnnotationObject {
  const common = {
    id: s.id,
    pageIndex: 0,
    author: 'PDFTools S2',
    rect: bboxRect(s.pts),
    color: 'transparent',
    strokeColor: RED,
    opacity: 1,
    strokeWidth: 2,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
    flags: ['print'],
  };
  const t = subtypeFor(s);
  if (t === 'line') {
    const [a, b] = s.pts;
    return {
      ...common,
      type: PdfAnnotationSubtype.LINE,
      linePoints: { start: toTop(a ?? B0), end: toTop(b ?? B0) },
    } as PdfAnnotationObject;
  }
  return {
    ...common,
    type: t === 'polyline' ? PdfAnnotationSubtype.POLYLINE : PdfAnnotationSubtype.POLYGON,
    vertices: s.pts.map(toTop),
  } as PdfAnnotationObject;
}

function labelFor(s: Spec, text: string): PdfAnnotationObject {
  const mid = s.pts.reduce(
    (a, p) => ({ x: a.x + p.x / s.pts.length, y: a.y + p.y / s.pts.length }),
    { x: 0, y: 0 },
  );
  return {
    id: `${s.id}-label`,
    pageIndex: 0,
    type: PdfAnnotationSubtype.FREETEXT,
    author: 'PDFTools S2',
    rect: { origin: { x: mid.x - 60, y: H - mid.y - 30 }, size: { width: 160, height: 22 } },
    contents: text,
    fontFamily: PdfStandardFont.Helvetica,
    fontSize: 14,
    fontColor: RED,
    textAlign: PdfTextAlignment.Center,
    verticalAlign: PdfVerticalAlignment.Middle,
    opacity: 1,
    color: '#FFFFFF',
    flags: ['print'],
  };
}

// ---- helpers ----------------------------------------------------------------------
function qpdfCheck(file: string): string {
  const r = spawnSync('qpdf', ['--check', file], { encoding: 'utf8' });
  if (r.status === 0) return 'ok';
  return `${r.status === 3 ? 'warnings' : 'FAIL'}: ${(r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | ')}`;
}

function measureDict(scale: Scale): PdfDict {
  const m = toMeasureRL(scale);
  const nf = (x: { U: string; C: number; D: number }): PdfDict =>
    D({ Type: N('NumberFormat'), U: S(x.U), C: x.C, D: x.D, F: N('D'), SS: S(''), O: N('S') });
  return D({
    Type: N('Measure'),
    Subtype: N('RL'),
    R: S(m.R),
    X: m.X.map(nf),
    D: m.D.map(nf),
    A: m.A.map(nf),
    O: [0, 0],
    CYX: 1,
  });
}

/** Annotations on page 1 keyed by /NM (EmbedPDF writes the annotation id there). */
function annotsByNM(doc: PdfDocument): Map<string, { num: number; dict: PdfDict }> {
  const page = doc.pages()[0];
  const outMap = new Map<string, { num: number; dict: PdfDict }>();
  for (const ref of (doc.resolve(page?.dict.get('Annots')) as PdfValue[] | undefined) ?? []) {
    if (!(ref instanceof PdfRef)) continue;
    const d = doc.get(ref);
    const nm = isDict(d) ? d.get('NM') : undefined;
    if (isDict(d) && nm instanceof PdfString) outMap.set(nm.text(), { num: ref.num, dict: d });
  }
  return outMap;
}

type Variant = 'cap' | 'freetext' | 'noap';

const mod = await init({
  wasmBinary: readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
let seq = 0;
const open = async (b: Uint8Array): Promise<PdfDocumentObject> =>
  await native
    .openDocumentBuffer({ id: `d${String(++seq)}`, content: new Uint8Array(b).buffer })
    .toPromise();
const saveNarrow = (orig: Uint8Array, doc: PdfDocumentObject): Uint8Array =>
  narrowTail(orig, saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_INCREMENTAL).bytes).bytes;

/** Build one variant: EmbedPDF annotations → narrow save → our patch revision. */
async function build(variant: Variant | 'vp-only'): Promise<Uint8Array> {
  const base = sheet();
  let bytes = base;
  if (variant !== 'vp-only') {
    const doc = await open(base);
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    for (const s of SPECS) {
      await native.createPageAnnotation(doc, page, annotationFor(s)).toPromise();
      if (variant === 'freetext') {
        await native.createPageAnnotation(doc, page, labelFor(s, valueFor(s).text)).toPromise();
      }
    }
    bytes = saveNarrow(base, doc);
    await native.closeDocument(doc).toPromise();
  }
  const rd = new PdfDocument(bytes, inflate);
  const patch = new Map<number, PdfValue>();
  const byNM = annotsByNM(rd);
  for (const s of SPECS) {
    const a = byNM.get(s.id);
    if (!a) continue;
    const v = valueFor(s);
    const d: PdfDict = new Map(a.dict);
    d.set('IT', N(IT[subtypeFor(s)] ?? 'LineDimension'));
    d.set('Measure', measureDict(v.scale));
    d.set('Contents', S(v.warning ? `${v.text} (${v.warning})` : v.text));
    if (subtypeFor(s) === 'line') {
      d.set('Cap', true);
      d.set('CP', N('Top'));
    }
    if (variant === 'noap') d.delete('AP');
    patch.set(a.num, d);
    const label = byNM.get(`${s.id}-label`);
    if (label) {
      const l: PdfDict = new Map(label.dict);
      l.set('IRT', new PdfRef(a.num));
      l.set('RT', N('Group'));
      patch.set(label.num, l);
    }
  }
  const pg = rd.pages()[0];
  if (!pg) throw new Error('no page');
  const pageDict: PdfDict = new Map(pg.dict);
  pageDict.set(
    'VP',
    VIEWPORTS.map((v) =>
      D({ Type: N('Viewport'), BBox: v.bbox, Name: S(v.name), Measure: measureDict(v.scale) }),
    ),
  );
  patch.set(pg.num, pageDict);
  return appendRevision(bytes, rd, patch);
}

interface ReadBack {
  viewports: { name: string; scale: Scale | null }[];
  measurements: {
    nm: string;
    subtype: string;
    it: string;
    scale: Scale | null;
    value: string;
    contents: string;
    hasAP: boolean;
    viewportChoice: string;
  }[];
}

/** Read measurements back with the shared reader (also the owner's CLI). */
function readBack(bytes: Uint8Array): ReadBack {
  const r = readMeasurements(bytes);
  return {
    viewports: (r.pages[0]?.viewports ?? []).map((v) => ({ name: v.name, scale: v.scale })),
    measurements: r.measurements.map((m) => ({
      nm: m.nm,
      subtype: m.subtype,
      it: m.it,
      scale: m.ownScale,
      value: m.value,
      contents: m.contents,
      hasAP: m.hasAP,
      viewportChoice: m.viewportChoice,
    })),
  };
}

const report: Record<string, unknown> = {};
const variants: (Variant | 'vp-only')[] = ['cap', 'freetext', 'noap', 'vp-only'];
for (const v of variants) {
  const bytes = await build(v);
  const file = join(pack, `s2-${v}.pdf`);
  writeFileSync(file, bytes);
  const rb = readBack(bytes);
  // PDFium view of the result: annotation count, still opens.
  const doc = await open(bytes);
  const page = doc.pages[0];
  const pdfiumAnnots = page
    ? ((await native.getPageAnnotations(doc, page).toPromise()) as PdfAnnotationObject[]).length
    : 0;
  await native.closeDocument(doc).toPromise();
  report[v] = {
    bytes: bytes.length,
    qpdfCheck: qpdfCheck(file),
    pdfiumAnnots,
    viewports: rb.viewports,
    measurements: rb.measurements.map((m) => ({
      ...m,
      expected: SPECS.find((s) => s.id === m.nm)?.expect,
      ok: m.value === SPECS.find((s) => s.id === m.nm)?.expect || m.nm === 's2-span',
    })),
  };
}

// ---- survival: EmbedPDF edits a measurement and adds a note; is /Measure kept? ----
{
  const bytes = new Uint8Array(readFileSync(join(pack, 's2-cap.pdf')));
  const doc = await open(bytes);
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const annots = (await native.getPageAnnotations(doc, page).toPromise()) as PdfAnnotationObject[];
  const line = annots.find((a) => a.id === 's2-dist-page');
  if (line) {
    await native
      .updatePageAnnotation(doc, page, { ...line, strokeColor: '#0000FF' } as PdfAnnotationObject)
      .toPromise();
  }
  await native
    .createPageAnnotation(doc, page, {
      id: 's2-note',
      pageIndex: 0,
      type: PdfAnnotationSubtype.TEXT,
      rect: { origin: { x: 100, y: 100 }, size: { width: 24, height: 24 } },
      contents: 'later edit',
      author: 'PDFTools S2',
    })
    .toPromise();
  const saved = saveNarrow(bytes, doc);
  await native.closeDocument(doc).toPromise();
  const file = join(pack, 's2-cap-edited-by-embedpdf.pdf');
  writeFileSync(file, saved);
  const rb = readBack(saved);
  report.survival = {
    qpdfCheck: qpdfCheck(file),
    editedLine: rb.measurements.find((m) => m.nm === 's2-dist-page') ?? 'LOST',
    measurementsKept: rb.measurements.length,
    viewportsKept: rb.viewports.length,
  };
}

// ---- reader vs qpdf oracle on public corpus files (unencrypted ones) ----------------
{
  const oracle: Record<string, unknown> = {};
  const files = [
    ...readdirSync(join(root, 'corpus'))
      .filter((f) => f.endsWith('.pdf'))
      .map((f) => join(root, 'corpus', f)),
    ...['objstm.pdf', 'form.pdf']
      .map((f) => join(root, 'spikes/s1-save/out/fixtures', f))
      .filter(existsSync),
  ];
  for (const f of files) {
    const bytes = new Uint8Array(readFileSync(f));
    const name = f.split('/').pop() ?? f;
    try {
      const doc = new PdfDocument(bytes, inflate);
      if (doc.encrypted) {
        oracle[name] = 'encrypted: not read (ADR-007)';
        continue;
      }
      const q = spawnSync('qpdf', ['--show-npages', f], { encoding: 'utf8' });
      const pages = doc.pages();
      // Read every page's /Annots and each annotation dict (exercises objstm + xref).
      let annots = 0;
      for (const p of pages) {
        for (const a of (doc.resolve(p.dict.get('Annots')) as PdfValue[] | undefined) ?? []) {
          if (isDict(doc.resolve(a))) annots++;
        }
      }
      oracle[name] = {
        pages: pages.length,
        qpdfPages: Number(q.stdout.trim()),
        annots,
        ok: pages.length === Number(q.stdout.trim()),
      };
    } catch (e) {
      oracle[name] = `ERROR ${String(e)}`;
    }
  }
  report.readerOracle = oracle;
}

writeFileSync(join(out, 's2-node.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
