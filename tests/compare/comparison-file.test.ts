// M12-20 (D-65, ADR-032; format docs/formats/triya-comparison-v1.md): the
// comparison file written and read back by the Work worker's jobs on real
// PDFium, with documents held the way the Work worker holds them. Both kinds,
// a set of several files per side, the overlay notes, an encrypted pair (12),
// a signed and a certified Document B, a protected Document A, unsaved review
// comments, and the permission rule.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CORPUS_PASSWORDS,
  corpusBytes,
  corpusPair,
} from '../../e2e/fixtures/comparison-corpus/index';
import { buildPdf } from '../../e2e/fixtures/generate';
import { certifiedPdf, makeSigner, signedPdf, type Signer } from '../../e2e/fixtures/signed';
import {
  KEY_DATA,
  MARK_NM_PREFIX,
  decodeData,
  revisionCount,
  sha256Hex,
} from '../../src/model/compare/file/format';
import { IDENTITY } from '../../src/model/compare/material';
import { DEFAULT_STYLE } from '../../src/model/compare/overlay';
import { PdfRef, PdfString, isDict, nameOf } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { WorkDocs } from '../../src/workers/work/docs';
import type { DataFields, FileWords } from '../../src/workers/work/comparisonFile/build';
import {
  compareFileProbe,
  compareFileRead,
  compareFileSave,
  compareNotesSeed,
  type CompareFileRequest,
  type FileJobEnv,
} from '../../src/workers/work/comparisonFile/jobs';
import type { MarkSpec } from '../../src/workers/work/comparisonFile/marks';
import type { VectorSheet } from '../../src/workers/work/vectorOverlay';
import { checkSignatures } from '../../src/workers/work/signatures';
import { FaceStore } from '../../src/workers/render/commentFonts/faces';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import type { SummarySpec } from '../../src/model/compare/summary';

const require = createRequire(import.meta.url);
const VENDOR = join(import.meta.dirname, '..', '..', 'vendor', 'fonts', 'files');
const fontsLoaded: string[] = [];
const faces = new FaceStore({
  harfbuzz: () => import('harfbuzzjs'),
  subsetWasm: () =>
    Promise.resolve(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'))),
  fontFile: (file) => {
    fontsLoaded.push(file);
    return Promise.resolve(new Uint8Array(readFileSync(join(VENDOR, file))));
  },
});
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let docs: WorkDocs;
let signer: Signer;
let seq = 0;

const inflate = (b: Uint8Array): Promise<Uint8Array> => Promise.resolve(inflateSync(b));

const slice = {
  checkpoint: () => Promise.resolve(),
  signal: new AbortController().signal,
};

function env(progress: { done: number; total: number }[] = []): FileJobEnv {
  return {
    mod,
    native,
    docs,
    inflate,
    liveReader: async (docId) => {
      await docs.get(docId);
      const pw = docs.passwordOf(docId);
      return PdfReader.open(
        docs.liveBytes(docId),
        inflate,
        pw === undefined ? {} : { password: pw },
      );
    },
    slice,
    progress: (p) => progress.push(p),
    faces,
  };
}

/** Opens bytes as a Work worker document; its id. */
async function open(bytes: Uint8Array, password?: string): Promise<string> {
  const id = `doc${String(++seq)}`;
  await docs.open(id, bytes.slice().buffer, undefined, password);
  return id;
}

async function openCorpus(kind: 'overlay' | 'text', p: string, side: 'old' | 'new') {
  const pair = corpusPair(kind, p);
  const name = side === 'old' ? pair.oldFile : pair.newFile;
  const pw = CORPUS_PASSWORDS[name]?.user;
  const bytes = corpusBytes(pair, side);
  return { id: await open(bytes, pw === '' ? undefined : pw), name, bytes };
}

const words: FileWords = {
  descA: 'Document A (old revision), unchanged',
  descB: 'Document B (new revision), unchanged',
  descData: 'Triya PDF comparison data',
  author: 'Triya PDF comparison',
};

const fields = (extra: Partial<DataFields> = {}): DataFields => ({
  created: '',
  app: 'Triya PDF test',
  options: {},
  ignoreZones: [],
  checked: [],
  closeOut: [],
  ...extra,
});

function overlayRequest(
  a: { id: string; name: string }[],
  b: { id: string; name: string }[],
  sheets: VectorSheet[],
  extra: Partial<CompareFileRequest> = {},
): CompareFileRequest {
  return {
    kind: 'overlay',
    A: a.map((f) => ({ docId: f.id, name: f.name, range: '' })),
    B: b.map((f) => ({ docId: f.id, name: f.name, range: '' })),
    fields: fields(),
    words,
    when: '2026-11-23T10:00:00.000Z',
    vector: {
      sheets,
      colA: DEFAULT_STYLE.colA,
      colB: DEFAULT_STYLE.colB,
      labels: { a: {}, b: {} },
    },
    ...extra,
  };
}

const sheet = (a: string, b: string, page = 0): VectorSheet => ({
  a: { docId: a, pageIndex: page },
  b: { docId: b, pageIndex: page },
  place: IDENTITY,
});

/** Opens a written comparison file as a document and reads it back through the jobs. */
async function reopen(bytes: ArrayBuffer, password?: string) {
  const id = await open(new Uint8Array(bytes), password);
  const probe = await compareFileProbe(env(), id);
  const read = await compareFileRead(env(), id);
  return { id, probe, read, data: decodeData(new TextEncoder().encode(read.data)) };
}

/** Every annotation of every page: subtype, /NM, /Contents. */
async function annotations(bytes: Uint8Array, password?: string) {
  const r = await PdfReader.open(bytes, inflate, password ? { password } : {});
  const out: { page: number; subtype: string; nm: string; contents: string; ap: boolean }[] = [];
  for (const [i, p] of (await r.pages()).entries()) {
    const list = await r.resolve(p.dict.get('Annots'));
    for (const ref of Array.isArray(list) ? list : []) {
      const d = await r.resolve(ref);
      if (!isDict(d)) continue;
      const s = (k: string) => {
        const v = d.get(k);
        return v instanceof PdfString ? v.text() : '';
      };
      out.push({
        page: i,
        subtype: nameOf(d.get('Subtype')) ?? '',
        nm: s('NM'),
        contents: s('Contents'),
        ap: isDict(d.get('AP')) || d.get('AP') instanceof PdfRef,
      });
    }
  }
  return out;
}

/** PDFium opens the file (with the password, when given) and counts its pages. */
async function pdfiumPages(bytes: Uint8Array, password?: string): Promise<number> {
  const doc = await native
    .openDocumentBuffer(
      { id: `check${String(++seq)}`, content: bytes.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();
  try {
    return doc.pageCount;
  } finally {
    await native.closeDocument(doc).toPromise();
  }
}

/** A small text page (Helvetica) with the given lines. */
function textPdf(lines: string[]): Uint8Array {
  const stream = lines
    .map((l, i) => `BT /F1 14 Tf 72 ${String(760 - i * 24)} Td (${l}) Tj ET`)
    .join('\n');
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

const MARKS: MarkSpec[] = [
  {
    page: 0,
    kind: 'replaced',
    rects: [[72, 70, 200, 88]],
    shape: 'highlight',
    colour: [1, 0.8, 0.3],
    subject: 'Replaced',
    contents: 'was: 1,450.00',
    old: '1,450.00',
    new: '1,520.00',
  },
  {
    page: 0,
    kind: 'deleted',
    rects: [[60, 94, 70, 110]],
    shape: 'caret',
    colour: [0.9, 0.1, 0.1],
    subject: 'Deleted',
    contents: 'Deleted: the old clause',
    old: 'the old clause',
  },
  {
    page: 0,
    kind: 'figure',
    rects: [[300, 300, 400, 380]],
    shape: 'frame',
    colour: [0.2, 0.4, 1],
    subject: 'Changed figure',
    contents: 'Changed figure',
  },
];

function textRequest(
  a: { id: string; name: string },
  b: { id: string; name: string },
  extra: Partial<CompareFileRequest> = {},
): CompareFileRequest {
  return {
    kind: 'text',
    A: [{ docId: a.id, name: a.name, range: '' }],
    B: [{ docId: b.id, name: b.name, range: '' }],
    fields: fields(),
    words,
    when: '2026-11-23T10:00:00.000Z',
    marks: MARKS,
    ...extra,
  };
}

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  docs = new WorkDocs(() => native);
  signer = await makeSigner('Comparison Test Signer');
}, 60_000);

describe('the overlay comparison file', () => {
  it('holds the overlay pages, both files unchanged and the data; reopens exactly', async () => {
    const a = await openCorpus('overlay', '01', 'old');
    const b = await openCorpus('overlay', '01', 'new');
    const progress: { done: number; total: number }[] = [];
    const r = await compareFileSave(env(progress), overlayRequest([a], [b], [sheet(a.id, b.id)]));
    expect(r.route).toBeNull();
    const bytes = new Uint8Array(r.bytes);
    expect(await pdfiumPages(bytes)).toBe(1);
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 });
    const { probe, read, data } = await reopen(r.bytes);
    expect(probe).toEqual({ kind: 'overlay', version: 1, via: 'pieceInfo' });
    expect(read.A.map((f) => f.exact)).toEqual([true]);
    expect(read.B.map((f) => f.exact)).toEqual([true]);
    expect(new Uint8Array(read.A[0]?.bytes ?? new ArrayBuffer(0))).toEqual(a.bytes);
    expect(new Uint8Array(read.B[0]?.bytes ?? new ArrayBuffer(0))).toEqual(b.bytes);
    expect(data.documents.A[0]).toMatchObject({
      name: a.name,
      size: a.bytes.length,
      sha256: await sha256Hex(a.bytes),
      storage: { attachment: 'TriyaCompare-A' },
    });
    expect(data.documents.B[0]?.storage).toEqual({ attachment: 'TriyaCompare-B' });
    expect(data.created).toBe('2026-11-23T10:00:00.000Z');
    expect(read.notes).toBeNull();
    expect(read.foreignRevisions).toBe(0);
  });

  it('puts the summary page first, in a font shipped with the app, and reopens past it', async () => {
    const a = await openCorpus('overlay', '01', 'old');
    const b = await openCorpus('overlay', '01', 'new');
    const geo = await PdfReader.open(b.bytes, inflate);
    const box = (await geo.resolve((await geo.pages())[0]?.dict.get('MediaBox'))) as number[];
    const notes = await open(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [${box.join(' ')}] /Annots [4 0 R] >>`,
        '<< /Type /Annot /Subtype /Text /Rect [100 100 120 120] /Contents (On the sheet) /NM (note-1) /T (Reviewer) /F 4 >>',
      ]),
    );
    const summary: SummarySpec = {
      blocks: [
        { kind: 'title', text: 'Comparison summary' },
        { kind: 'row', label: 'Document A (old)', value: 'Flange Ø120 – रेखाचित्र 图纸.pdf' },
        { kind: 'heading', text: 'Legend' },
        { kind: 'swatch', colour: [255, 0, 0], text: 'Only in Document A (old)' },
        { kind: 'note', text: 'The overlay sheets follow this page.' },
      ],
    };
    const r = await compareFileSave(
      env(),
      overlayRequest([a], [b], [sheet(a.id, b.id)], {
        notesDocId: notes,
        summary,
        fields: fields({ leadingPages: 5 }),
      }),
    );
    const bytes = new Uint8Array(r.bytes);
    expect(await pdfiumPages(bytes)).toBe(2);
    // The note stays on the sheet (now page 2); the summary page has none.
    expect(await annotations(bytes)).toEqual([
      expect.objectContaining({ page: 1, subtype: 'Text', contents: 'On the sheet' }),
    ]);
    // Library fonts only (Noto Sans, and the fallbacks the file name needs), embedded.
    expect(fontsLoaded).toEqual(
      expect.arrayContaining(['notosans-regular.ttf', 'notosans-bold.ttf']),
    );
    expect(fontsLoaded.every((f) => f.startsWith('noto'))).toBe(true);
    // The page's text reads back as typed (searchable, copyable).
    const id = await open(bytes);
    const { doc } = await docs.get(id);
    const page = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, doc.id), 0);
    const tp = rawCall(mod, 'FPDFText_LoadPage', page);
    const n = rawCall(mod, 'FPDFText_CountChars', tp);
    const heap = mod.pdfium as unknown as {
      wasmExports: { malloc(n: number): number; free(p: number): void };
      UTF16ToString(p: number): string;
    };
    const buf = heap.wasmExports.malloc((n + 1) * 2);
    rawCall(mod, 'FPDFText_GetText', tp, 0, n, buf);
    const text = heap.UTF16ToString(buf);
    heap.wasmExports.free(buf);
    rawCall(mod, 'FPDFText_ClosePage', tp);
    rawCall(mod, 'FPDF_ClosePage', page);
    for (const s of ['Comparison summary', 'Flange Ø120', 'Legend', 'follow this page'])
      expect(text).toContain(s);
    const fonts =
      Buffer.from(bytes)
        .toString('latin1')
        .match(/\/FontFile2/g) ?? [];
    expect(fonts.length).toBeGreaterThanOrEqual(2);
    // Reopened: the data says one page comes first; the notes are the sheet's.
    const { read, data } = await reopen(r.bytes);
    expect(data.leadingPages).toBe(1);
    expect(read.notes).not.toBeNull();
    const seeded = await PdfReader.open(new Uint8Array(read.notes ?? new ArrayBuffer(0)), inflate);
    expect((await seeded.pages()).length).toBe(1);
    expect(new Uint8Array(read.B[0]?.bytes ?? new ArrayBuffer(0))).toEqual(b.bytes);
  });

  it('goes on over more pages when its lists are long; every one comes before the sheets', async () => {
    const a = await openCorpus('overlay', '01', 'old');
    const b = await openCorpus('overlay', '01', 'new');
    const zones = Array.from(
      { length: 160 },
      (_, i) => `${String(i + 1)} on sheet ${String(i + 2)}`,
    );
    const r = await compareFileSave(
      env(),
      overlayRequest([a], [b], [sheet(a.id, b.id)], {
        summary: {
          blocks: [
            { kind: 'title', text: 'Comparison summary' },
            { kind: 'heading', text: 'Settings' },
            { kind: 'row', label: 'Ignore zones', value: zones.join('\n') },
            { kind: 'note', text: 'The overlay sheets follow this page.' },
          ],
        },
      }),
    );
    const pages = await pdfiumPages(new Uint8Array(r.bytes));
    const { data } = await reopen(r.bytes);
    expect(data.leadingPages).toBeGreaterThanOrEqual(3);
    expect(pages).toBe((data.leadingPages ?? 0) + 1);
  });

  it('writes no summary page and no leadingPages unless asked', async () => {
    const a = await openCorpus('overlay', '01', 'old');
    const b = await openCorpus('overlay', '01', 'new');
    const r = await compareFileSave(
      env(),
      overlayRequest([a], [b], [sheet(a.id, b.id)], { fields: fields({ leadingPages: 2 }) }),
    );
    expect(await pdfiumPages(new Uint8Array(r.bytes))).toBe(1);
    const { data } = await reopen(r.bytes);
    expect(data.leadingPages).toBeUndefined();
  });

  it('keeps a set of several files per side, each byte for byte', async () => {
    const a1 = await openCorpus('overlay', '01', 'old');
    const a2 = await openCorpus('overlay', '07', 'old');
    const b1 = await openCorpus('overlay', '01', 'new');
    const b2 = await openCorpus('overlay', '07', 'new');
    const r = await compareFileSave(
      env(),
      overlayRequest(
        [a1, a2],
        [b1, b2],
        [sheet(a1.id, b1.id), sheet(a2.id, b2.id, 0), sheet(a2.id, b2.id, 1)],
      ),
    );
    expect(await pdfiumPages(new Uint8Array(r.bytes))).toBe(3);
    const { read, data } = await reopen(r.bytes);
    expect(data.documents.A.map((f) => f.storage)).toEqual([
      { attachment: 'TriyaCompare-A1' },
      { attachment: 'TriyaCompare-A2' },
    ]);
    expect([...read.A, ...read.B].every((f) => f.exact)).toBe(true);
    expect(new Uint8Array(read.B[1]?.bytes ?? new ArrayBuffer(0))).toEqual(b2.bytes);
  });

  it('writes the overlay notes as comments on its pages, and seeds them back into notes', async () => {
    const a = await openCorpus('overlay', '01', 'old');
    const b = await openCorpus('overlay', '01', 'new');
    const geo = await PdfReader.open(b.bytes, inflate);
    const box = (await geo.resolve((await geo.pages())[0]?.dict.get('MediaBox'))) as number[];
    const notesPdf = (note: boolean) =>
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [${box.join(' ')}]${note ? ' /Annots [4 0 R]' : ''} >>`,
        '<< /Type /Annot /Subtype /Text /Rect [100 100 120 120] /Contents (Check this flange) /NM (note-1) /T (Reviewer) /F 4 >>',
      ]);
    const notes = await open(notesPdf(true));
    const r = await compareFileSave(
      env(),
      overlayRequest([a], [b], [sheet(a.id, b.id)], { notesDocId: notes }),
    );
    expect(r.notes).toBe(1);
    const list = await annotations(new Uint8Array(r.bytes));
    expect(list).toEqual([
      expect.objectContaining({ page: 0, subtype: 'Text', contents: 'Check this flange' }),
    ]);
    const { read } = await reopen(r.bytes);
    expect(read.notes).not.toBeNull();
    const seeded = await compareNotesSeed(
      env(),
      notesPdf(false).slice().buffer,
      read.notes ?? new ArrayBuffer(0),
    );
    const back = await annotations(new Uint8Array(seeded));
    expect(back).toEqual([
      expect.objectContaining({ page: 0, subtype: 'Text', contents: 'Check this flange' }),
    ]);
  });

  it('carries the review comments not saved yet into the copy, as an incremental tail', async () => {
    const a = await openCorpus('overlay', '19', 'old');
    const b = await openCorpus('overlay', '19', 'new');
    const tail = new TextEncoder().encode('\n% review comments would be here\n');
    const req = overlayRequest([a], [b], [sheet(a.id, b.id)]);
    const first = req.A[0] ?? { docId: '', name: '', range: '' };
    req.A = [{ ...first, tail: tail.slice().buffer, baseLength: a.bytes.length }];
    const r = await compareFileSave(env(), req);
    const { read } = await reopen(r.bytes);
    const got = new Uint8Array(read.A[0]?.bytes ?? new ArrayBuffer(0));
    expect(got.length).toBe(a.bytes.length + tail.length);
    expect(got.subarray(0, a.bytes.length)).toEqual(a.bytes);
    expect(read.A[0]?.exact).toBe(true);
    // A tail prepared for another length is refused.
    const stale = req.A[0] ?? { docId: '', name: '', range: '' };
    req.A = [{ ...stale, baseLength: 1 }];
    await expect(compareFileSave(env(), req)).rejects.toMatchObject({ code: 'compare-file-stale' });
  });

  it('locks the file when an input needs an open password (pair 12); the inputs stay encrypted inside', async () => {
    const a = await openCorpus('overlay', '12', 'old');
    const b = await openCorpus('overlay', '12', 'new');
    // A restricts copying: its permissions password lifts that (rule 9).
    await expect(
      compareFileSave(env(), overlayRequest([a], [b], [sheet(a.id, b.id)], { lock: 'x' })),
    ).rejects.toMatchObject({ code: expect.stringContaining('copy') as unknown });
    expect(await docs.unlock(a.id, 'overlay_owner_2026')).toBe(true);
    const r = await compareFileSave(
      env(),
      overlayRequest([a], [b], [sheet(a.id, b.id)], { lock: 'cmp-secret' }),
    );
    const bytes = new Uint8Array(r.bytes);
    await expect(pdfiumPages(bytes)).rejects.toBeDefined();
    expect(await pdfiumPages(bytes, 'cmp-secret')).toBe(1);
    const { read, probe } = await reopen(r.bytes, 'cmp-secret');
    expect(probe?.kind).toBe('overlay');
    expect([...read.A, ...read.B].every((f) => f.exact)).toBe(true);
    // Document B inside still needs its own password.
    const inner = new Uint8Array(read.B[0]?.bytes ?? new ArrayBuffer(0));
    await expect(pdfiumPages(inner)).rejects.toBeDefined();
    expect(await pdfiumPages(inner, 'test1234')).toBeGreaterThan(0);
  });

  it('refuses a file that does not allow copying content (rule 9)', async () => {
    const pair = corpusPair('overlay', '01');
    const a = await openCorpus('overlay', '01', 'old');
    // Copying not allowed: an owner password with /P without the copy bit.
    const doc = await native
      .openDocumentBuffer({ id: 'nocopy-src', content: corpusBytes(pair, 'new').slice().buffer })
      .toPromise();
    await native.setDocumentEncryption(doc, '', 'owner-only', 4).toPromise();
    const locked = (await native.saveAsCopy(doc).toPromise()) as ArrayBuffer;
    await native.closeDocument(doc).toPromise();
    const b = { id: await open(new Uint8Array(locked)), name: 'b.pdf' };
    await expect(
      compareFileSave(env(), overlayRequest([a], [b], [sheet(a.id, b.id)])),
    ).rejects.toMatchObject({ code: expect.stringContaining('copy') as unknown });
  });
});

describe('the text comparison file', () => {
  it('is Document B byte for byte plus one section with the marks, A and the data', async () => {
    const a = await openCorpus('text', '01', 'old');
    const b = await openCorpus('text', '01', 'new');
    const r = await compareFileSave(env(), textRequest(a, b));
    expect(r.route).toBe('prefix');
    const bytes = new Uint8Array(r.bytes);
    expect(bytes.subarray(0, b.bytes.length)).toEqual(b.bytes);
    expect(revisionCount(bytes)).toBe(revisionCount(b.bytes) + 1);
    const { probe, read, data } = await reopen(r.bytes);
    expect(probe).toEqual({ kind: 'text', version: 1, via: 'pieceInfo' });
    expect(data.documents.B[0]?.storage).toEqual({
      prefix: { length: b.bytes.length, revisions: revisionCount(b.bytes) },
    });
    expect(read.B[0]?.exact).toBe(true);
    expect(read.A[0]?.exact).toBe(true);
    expect(read.foreignRevisions).toBe(0);
    expect(data.marks?.map((m) => [m.kind, m.nm, m.page])).toEqual([
      ['replaced', `${MARK_NM_PREFIX}1`, 1],
      ['deleted', `${MARK_NM_PREFIX}2`, 1],
      ['figure', `${MARK_NM_PREFIX}3`, 1],
    ]);
    const list = await annotations(bytes);
    expect(list.map((x) => [x.subtype, x.contents, x.ap])).toEqual([
      ['Highlight', 'was: 1,450.00', true],
      ['Caret', 'Deleted: the old clause', true],
      ['Square', 'Changed figure', true],
    ]);
    // The quads are in B's user space: the displayed top-left 72,70 is y = height − 70.
    const geo = await PdfReader.open(b.bytes, inflate);
    const mb = (await geo.resolve((await geo.pages())[0]?.dict.get('MediaBox'))) as number[];
    const [qx = 0, qy = 0] = data.marks?.[0]?.quads[0] ?? [];
    expect(qx).toBeCloseTo(72 + (mb[0] ?? 0), 2);
    expect(qy).toBeCloseTo((mb[3] ?? 0) - 70, 2);
  });

  it('notices revisions another program appended after ours', async () => {
    const a = await openCorpus('text', '06', 'old');
    const b = await openCorpus('text', '06', 'new');
    const r = await compareFileSave(env(), textRequest(a, b));
    const more = new Uint8Array(r.bytes);
    const r2 = await PdfReader.open(more, inflate);
    const size = Number(r2.trailer.get('Size'));
    const prev = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(new TextDecoder('latin1').decode(more))?.[1];
    const body = `\n${String(size)} 0 obj\n<< /Note (another program) >>\nendobj\n`;
    const xrefAt = more.length + body.length;
    const tail = `${body}xref\n${String(size)} 1\n${String(more.length + 1).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${String(size + 1)} /Root ${String((r2.trailer.get('Root') as PdfRef).num)} 0 R /Prev ${String(prev)} >>\nstartxref\n${String(xrefAt)}\n%%EOF\n`;
    const changed = new Uint8Array([...more, ...new TextEncoder().encode(tail)]);
    const { read } = await reopen(changed.slice().buffer);
    expect(read.foreignRevisions).toBe(1);
    expect(read.B[0]?.exact).toBe(true);
  });

  it('keeps an approval-signed B in place: its signature still covers its revision', async () => {
    const a = { id: await open(textPdf(['Old signed text'])), name: 'a.pdf' };
    const signed = await signedPdf(signer);
    const b = { id: await open(signed), name: 'signed.pdf' };
    const r = await compareFileSave(env(), textRequest(a, b));
    expect(r.route).toBe('prefix');
    const bytes = new Uint8Array(r.bytes);
    const sigs = await checkSignatures(bytes, slice, () => undefined);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ integrity: 'unchanged' });
  });

  it('uses the unsigned copy for a B certified without comments (DocMDP 1, 2); B attached intact', async () => {
    for (const p of [1, 2] as const) {
      const a = { id: await open(textPdf(['Old certified text'])), name: 'a.pdf' };
      const cert = await certifiedPdf(signer, p);
      const b = { id: await open(cert), name: 'certified.pdf' };
      const r = await compareFileSave(env(), textRequest(a, b));
      expect(r.route).toBe('copy');
      const bytes = new Uint8Array(r.bytes);
      expect(await checkSignatures(bytes, slice, () => undefined)).toEqual([]);
      const { read, data } = await reopen(r.bytes);
      expect(data.documents.B[0]?.storage).toEqual({ attachment: 'TriyaCompare-B' });
      const inner = new Uint8Array(read.B[0]?.bytes ?? new ArrayBuffer(0));
      expect(inner).toEqual(cert);
      expect(await checkSignatures(inner, slice, () => undefined)).toEqual([
        expect.objectContaining({ integrity: 'unchanged' }),
      ]);
      expect((await annotations(bytes)).map((x) => x.subtype)).toEqual([
        'Highlight',
        'Caret',
        'Square',
      ]);
    }
    // Level 3 allows comments: the prefix route.
    const a = { id: await open(textPdf(['Old'])), name: 'a.pdf' };
    const b = { id: await open(await certifiedPdf(signer, 3)), name: 'c3.pdf' };
    expect((await compareFileSave(env(), textRequest(a, b))).route).toBe('prefix');
  });

  it('locks the file with the given password when A is protected and B is not', async () => {
    const plain = textPdf(['Protected old text']);
    const doc = await native
      .openDocumentBuffer({ id: 'lock-src', content: plain.slice().buffer })
      .toPromise();
    await native.setDocumentEncryption(doc, 'a-pass', 'a-owner', -4).toPromise();
    const lockedA = new Uint8Array((await native.saveAsCopy(doc).toPromise()) as ArrayBuffer);
    await native.closeDocument(doc).toPromise();
    const a = { id: await open(lockedA, 'a-pass'), name: 'a.pdf' };
    const b = { id: await open(textPdf(['New text'])), name: 'b.pdf' };
    const r = await compareFileSave(env(), textRequest(a, b, { lock: 'cmp-pass' }));
    expect(r.route).toBe('copy');
    const bytes = new Uint8Array(r.bytes);
    await expect(pdfiumPages(bytes)).rejects.toBeDefined();
    const { read } = await reopen(r.bytes, 'cmp-pass');
    expect([...read.A, ...read.B].every((f) => f.exact)).toBe(true);
    expect(new Uint8Array(read.A[0]?.bytes ?? new ArrayBuffer(0))).toEqual(lockedA);
  });

  it('keeps an encrypted B under its own password (the file opens with it)', async () => {
    const plain = textPdf(['Encrypted new text']);
    const doc = await native
      .openDocumentBuffer({ id: 'enc-b', content: plain.slice().buffer })
      .toPromise();
    await native.setDocumentEncryption(doc, 'b-pass', 'b-owner', -4).toPromise();
    const encB = new Uint8Array((await native.saveAsCopy(doc).toPromise()) as ArrayBuffer);
    await native.closeDocument(doc).toPromise();
    const a = { id: await open(textPdf(['Old text'])), name: 'a.pdf' };
    const b = { id: await open(encB, 'b-pass'), name: 'b.pdf' };
    const r = await compareFileSave(env(), textRequest(a, b));
    expect(r.route).toBe('prefix');
    const bytes = new Uint8Array(r.bytes);
    expect(bytes.subarray(0, encB.length)).toEqual(encB);
    await expect(pdfiumPages(bytes)).rejects.toBeDefined();
    const { read } = await reopen(r.bytes, 'b-pass');
    expect(read.B[0]?.exact).toBe(true);
    expect((await annotations(bytes, 'b-pass')).map((x) => x.contents)).toContain('was: 1,450.00');
  });

  it('needs commenting in B (rule 9)', async () => {
    const plain = textPdf(['No comments here']);
    const doc = await native
      .openDocumentBuffer({ id: 'noannot', content: plain.slice().buffer })
      .toPromise();
    // Copying allowed (bit 5), commenting not (bit 6).
    await native.setDocumentEncryption(doc, '', 'owner-x', 4 | 16).toPromise();
    const bytes = new Uint8Array((await native.saveAsCopy(doc).toPromise()) as ArrayBuffer);
    await native.closeDocument(doc).toPromise();
    const a = { id: await open(textPdf(['Old'])), name: 'a.pdf' };
    const b = { id: await open(bytes), name: 'b.pdf' };
    await expect(compareFileSave(env(), textRequest(a, b))).rejects.toMatchObject({
      code: expect.stringContaining('annotate') as unknown,
    });
  });
});

describe('detection', () => {
  it('says null for an ordinary PDF and finds a file by its data when /PieceInfo is gone', async () => {
    const plain = await open(textPdf(['Just a PDF']));
    expect(await compareFileProbe(env(), plain)).toBeNull();
    const a = await openCorpus('text', '01', 'old');
    const b = await openCorpus('text', '01', 'new');
    const r = await compareFileSave(env(), textRequest(a, b));
    // Another program rewrites the whole file and drops our page-piece dictionary.
    const doc = await native
      .openDocumentBuffer({ id: 'rewrite', content: r.bytes.slice(0) })
      .toPromise();
    const rewritten = new Uint8Array((await native.saveAsCopy(doc).toPromise()) as ArrayBuffer);
    await native.closeDocument(doc).toPromise();
    const noPiece = rewritten.slice();
    const at = Buffer.from(noPiece).indexOf('/PieceInfo');
    expect(at).toBeGreaterThan(0);
    noPiece[at + 9] = 'X'.charCodeAt(0);
    const { probe, read, data } = await reopen(noPiece.slice().buffer);
    expect(probe).toEqual({ kind: 'text', version: 1, via: 'attachment' });
    expect(read.A[0]?.exact).toBe(true);
    // B was the prefix: a full rewrite cannot give it back byte for byte.
    expect(read.B[0]?.exact).toBe(false);
    expect(data.kind).toBe('text');
    expect(KEY_DATA).toBe('TriyaCompare-data');
  });
});
