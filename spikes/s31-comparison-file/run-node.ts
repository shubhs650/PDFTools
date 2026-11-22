// Spike S31 (M12-06, D-65) — the comparison file. Runs every case on the
// corpus with the PDFium WASM the app ships and checks the results with other
// engines (all optional, outside the repository, never bundled):
//   qpdf          structure check (`qpdf --check`)
//   Poppler       pdfdetach (attachments), pdftoppm (marks drawn), pdfsig (signatures)
//   PDFJS_DIR     pdf.js 4.10.38 (attachments, annotations), run in Node
//
//   PDFJS_DIR=/path/with/node_modules/pdfjs-dist \
//     node --import ./spikes/shared/ts-ext.ts spikes/s31-comparison-file/run-node.ts
//
// Writes out/pack/ (the owner's sample pack) and test-results/s31-node.json.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  corpusBytes,
  corpusPair,
  corpusPairs,
} from '../../e2e/fixtures/comparison-corpus/index.ts';
import { makeSigner } from '../../e2e/fixtures/signed.ts';
import { isPrefix } from '../../src/workers/render/save/bytes.ts';
import { checkSignatures } from '../../src/workers/work/signatures.ts';
import { call, openDoc, pageSize } from '../s29-overlay/pdfiumKit.ts';
import { buildOverlayFile, buildTextFile, type Input } from './build.ts';
import { decodeData, keyOf, sha256Hex, type Mark } from './format.ts';
import { diffMarks, words } from './marks.ts';
import { detect, openComparison } from './read.ts';
import { addNote, updateOverlayFile, updateTextFile } from './review.ts';
import { Section } from './section.ts';
import { docMdpOf, signCopy } from './sign.ts';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PACK = join(HERE, 'out/pack/');
const RESULTS = join(ROOT, 'test-results/s31-node.json');
const PDFJS_DIR = process.env.PDFJS_DIR;
rmSync(PACK, { recursive: true, force: true });
mkdirSync(PACK, { recursive: true });
mkdirSync(join(ROOT, 'test-results'), { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), 's31-'));

const require = createRequire(import.meta.url);
const wasmBinary = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
const mod: WrappedPdfiumModule = await init({ wasmBinary });
call(mod, 'PDFiumExt_Init');

const results: Record<string, unknown> = {};
const note = (k: string, v: unknown) => {
  results[k] = v;
  console.log(k, JSON.stringify(v));
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const WHEN = new Date(Date.UTC(2026, 10, 22, 12));
const has = (cmd: string) => spawnSync('which', [cmd]).status === 0;

// ---------------------------------------------------------------------------
// Other engines
// ---------------------------------------------------------------------------
let seq = 0;
const tmpFile = (bytes: Uint8Array, name = 'f.pdf') => {
  const p = join(TMP, `${String(++seq)}-${name}`);
  writeFileSync(p, bytes);
  return p;
};

function qpdfCheck(bytes: Uint8Array, password?: string): string {
  if (!has('qpdf')) return 'skipped';
  const r = spawnSync(
    'qpdf',
    [...(password ? [`--password=${password}`] : []), '--check', tmpFile(bytes)],
    {
      encoding: 'utf8',
    },
  );
  return r.status === 0
    ? 'ok'
    : r.status === 3
      ? `warnings: ${r.stderr.trim().split('\n')[0] ?? ''}`
      : `errors: ${(r.stderr || r.stdout).trim().split('\n').slice(0, 2).join(' | ')}`;
}

/** Poppler's attachments: file name → SHA-256 of the saved bytes. */
async function popplerAttachments(
  bytes: Uint8Array,
  password?: string,
): Promise<Record<string, string> | string> {
  if (!has('pdfdetach')) return 'skipped';
  const f = tmpFile(bytes);
  const dir = mkdtempSync(join(TMP, 'detach-'));
  const pw = password ? ['-upw', password] : [];
  const r = spawnSync('pdfdetach', [...pw, '-saveall', '-o', dir, f], { encoding: 'utf8' });
  if (r.status !== 0) return `error: ${r.stderr.trim()}`;
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) out[name] = await sha256Hex(readFileSync(join(dir, name)));
  return out;
}

function pdfsig(bytes: Uint8Array): string {
  if (!has('pdfsig')) return 'skipped';
  const r = spawnSync('pdfsig', ['-nocert', tmpFile(bytes)], { encoding: 'utf8' });
  return (r.stdout + r.stderr)
    .split('\n')
    .filter((l) => /Signature #|Signature Validation|Total document signed|Signed Ranges/.test(l))
    .map((l) => l.trim())
    .join(' | ');
}

interface PdfjsDoc {
  numPages: number;
  getAttachments(): Promise<Record<string, { filename: string; content: Uint8Array }> | null>;
  getPage(n: number): Promise<{ getAnnotations(): Promise<{ subtype: string }[]> }>;
  destroy(): Promise<void>;
}
let pdfjs: { getDocument(o: object): { promise: Promise<PdfjsDoc> } } | null = null;
if (PDFJS_DIR && existsSync(join(PDFJS_DIR, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'))) {
  pdfjs = (await import(
    pathToFileURL(join(PDFJS_DIR, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href
  )) as typeof pdfjs;
}

async function pdfjsCheck(bytes: Uint8Array, password?: string) {
  if (!pdfjs) return 'skipped';
  try {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise;
    const att = (await doc.getAttachments()) ?? {};
    const files: Record<string, string> = {};
    for (const a of Object.values(att)) files[a.filename] = await sha256Hex(a.content);
    let annots = 0;
    for (let i = 1; i <= Math.min(doc.numPages, 30); i++)
      annots += (await (await doc.getPage(i)).getAnnotations()).filter((a) =>
        ['Highlight', 'Caret', 'Text'].includes(a.subtype),
      ).length;
    const pages = doc.numPages;
    await doc.destroy();
    return { pages, files, annots };
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

/** PDFium: opens? pages? and how many coloured pixels a page has with comments drawn. */
function pdfiumColoured(bytes: Uint8Array, page: number, password?: string): number {
  const d = openDoc(mod, bytes, password);
  try {
    const s = pageSize(mod, d.doc, page);
    const z = 0.75;
    const w = Math.round(s.w * z);
    const h = Math.round(s.h * z);
    const heap = mod.pdfium as unknown as {
      wasmExports: { malloc(n: number): number; free(p: number): void };
      HEAPU8: Uint8Array;
    };
    const px = heap.wasmExports.malloc(w * h * 4);
    const bmp = call(mod, 'FPDFBitmap_CreateEx', w, h, 4, px, w * 4);
    call(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
    const pg = call(mod, 'FPDF_LoadPage', d.doc, page);
    call(mod, 'FPDF_RenderPageBitmap', bmp, pg, 0, 0, w, h, 0, 0x01 | 0x10);
    call(mod, 'FPDF_ClosePage', pg);
    const rgba = heap.HEAPU8.slice(px, px + w * h * 4);
    call(mod, 'FPDFBitmap_Destroy', bmp);
    heap.wasmExports.free(px);
    return colouredRgb(rgba, 4);
  } finally {
    d.close();
  }
}

function colouredRgb(px: Uint8Array, step: number): number {
  let n = 0;
  for (let i = 0; i + 2 < px.length; i += step) {
    const r = px[i] ?? 0;
    const g = px[i + 1] ?? 0;
    const b = px[i + 2] ?? 0;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 60) n++;
  }
  return n;
}

/** Poppler: coloured pixels of one page (comments drawn), from pdftoppm's PPM. */
function popplerColoured(bytes: Uint8Array, page: number, password?: string): number | 'skipped' {
  if (!has('pdftoppm')) return 'skipped';
  const f = tmpFile(bytes);
  const out = join(TMP, `ppm-${String(++seq)}`);
  execFileSync('pdftoppm', [
    ...(password ? ['-upw', password] : []),
    '-r',
    '54',
    '-f',
    String(page + 1),
    '-l',
    String(page + 1),
    '-singlefile',
    f,
    out,
  ]);
  const ppm = readFileSync(`${out}.ppm`);
  // P6\n<w> <h>\n255\n<data>
  let nl = 0;
  let at = 0;
  while (nl < 3 && at < ppm.length) if (ppm[at++] === 10) nl++;
  return colouredRgb(ppm.subarray(at), 3);
}

const pdfiumOpens = (bytes: Uint8Array, password?: string): boolean => {
  try {
    openDoc(mod, bytes, password).close();
    return true;
  } catch {
    return false;
  }
};

const slice = { checkpoint: () => Promise.resolve() } as unknown as Parameters<
  typeof checkSignatures
>[1];
const ignore = (): void => undefined;
const sigSummary = async (bytes: Uint8Array) =>
  (await checkSignatures(bytes, slice, ignore)).map(
    (s) =>
      `${s.integrity}, revision ${String(s.revision)}/${String(s.revisions)}${s.changedAfter ? ', changed after' : ''}`,
  );

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
const overlayInput = (id: string, side: 'old' | 'new', password?: string): Input => {
  const p = corpusPair('overlay', id);
  const i: Input = { name: side === 'old' ? p.oldFile : p.newFile, bytes: corpusBytes(p, side) };
  if (password) i.password = password;
  return i;
};
const textInput = (id: string, side: 'old' | 'new'): Input => {
  const p = corpusPair('text', id);
  return { name: side === 'old' ? p.oldFile : p.newFile, bytes: corpusBytes(p, side) };
};

const marksCache = new Map<string, { marks: Mark[]; ms: number }>();
function marksFor(A: Input, B: Input, key: string) {
  const hit = marksCache.get(key);
  if (hit) return hit;
  const t0 = performance.now();
  const da = openDoc(mod, A.bytes, A.password);
  const db = openDoc(mod, B.bytes, B.password);
  try {
    const marks = diffMarks(words(mod, da.doc), words(mod, db.doc));
    const out = { marks, ms: performance.now() - t0 };
    marksCache.set(key, out);
    return out;
  } finally {
    da.close();
    db.close();
  }
}

async function verify(bytes: Uint8Array, password?: string) {
  const o = await openComparison(bytes, password);
  return {
    via: o.detected.via,
    kind: o.detected.kind,
    exactA: o.A.every((x) => x.exact),
    exactB: o.B.every((x) => x.exact),
    foreignRevisions: o.foreignRevisions,
    detectMs: r1(o.ms.detect),
    openMs: r1(o.ms.open),
  };
}

const pack: { file: string; what: string; password?: string }[] = [];
const toPack = (file: string, bytes: Uint8Array, what: string, password?: string) => {
  writeFileSync(join(PACK, file), bytes);
  pack.push(password ? { file, what, password } : { file, what });
};

// ---------------------------------------------------------------------------
// 1. Overlay comparison files
// ---------------------------------------------------------------------------
const overlayRows: unknown[] = [];
const OVERLAY: {
  id: string;
  A: Input[];
  B: Input[];
  protect?: { user: string; owner: string };
  open?: string;
}[] = [
  { id: '01', A: [overlayInput('01', 'old')], B: [overlayInput('01', 'new')] },
  { id: '07', A: [overlayInput('07', 'old')], B: [overlayInput('07', 'new')] },
  { id: '14', A: [overlayInput('14', 'old')], B: [overlayInput('14', 'new')] },
  { id: '19', A: [overlayInput('19', 'old')], B: [overlayInput('19', 'new')] },
  {
    id: 'set 01+07+08',
    A: ['01', '07', '08'].map((p) => overlayInput(p, 'old')),
    B: ['01', '07', '08'].map((p) => overlayInput(p, 'new')),
  },
  {
    id: '12 unprotected',
    A: [overlayInput('12', 'old')],
    B: [overlayInput('12', 'new', 'test1234')],
  },
  {
    id: '12 protected',
    A: [overlayInput('12', 'old')],
    B: [overlayInput('12', 'new', 'test1234')],
    protect: { user: 'test1234', owner: 'compare_owner_2026' },
    open: 'test1234',
  },
];
const overlayFiles = new Map<string, Uint8Array>();
for (const c of OVERLAY) {
  const res = await buildOverlayFile(mod, c.A, c.B, {
    when: WHEN,
    ...(c.protect ? { protect: c.protect } : {}),
  });
  overlayFiles.set(c.id, res.bytes);
  const inputs = [...c.A, ...c.B];
  const shaIn = new Set(await Promise.all(inputs.map((i) => sha256Hex(i.bytes))));
  const pop = await popplerAttachments(res.bytes, c.open);
  const pj = await pdfjsCheck(res.bytes, c.open);
  const row = {
    case: c.id,
    sheets: Math.max(...[c.A, c.B].map((l) => l.reduce((n, f) => n + (pdfiumPages(f) ?? 0), 0))),
    inputs: inputs.reduce((n, f) => n + f.bytes.length, 0),
    overlayOnly: res.overlayOnly,
    file: res.bytes.length,
    ms: { overlay: r1(res.ms.overlay), attach: r1(res.ms.attach), encrypt: r1(res.ms.encrypt) },
    ours: await verify(res.bytes, c.open),
    pdfiumOpensWithoutPassword: pdfiumOpens(res.bytes),
    qpdf: qpdfCheck(res.bytes, c.open),
    poppler:
      typeof pop === 'string'
        ? pop
        : `${String(Object.keys(pop).length)} files, inputs exact: ${String(Object.values(pop).filter((h) => shaIn.has(h)).length)}`,
    pdfjs:
      typeof pj === 'string'
        ? pj
        : `${String(pj.pages)} pages, ${String(Object.keys(pj.files).length)} files, inputs exact: ${String(Object.values(pj.files).filter((h) => shaIn.has(h)).length)}`,
  };
  overlayRows.push(row);
  console.log('overlay', JSON.stringify(row));
}
note('overlay', overlayRows);
toPack(
  'overlay_01_flange.pdf',
  overlayFiles.get('01') ?? new Uint8Array(),
  'Overlay comparison file, pair 01',
);
toPack(
  'overlay_set_01-07-08.pdf',
  overlayFiles.get('set 01+07+08') ?? new Uint8Array(),
  'Overlay of a set: three files per side, six attachments',
);
toPack(
  'overlay_12_protected.pdf',
  overlayFiles.get('12 protected') ?? new Uint8Array(),
  'Overlay with a protected input: the comparison file is encrypted too',
  'test1234',
);

function pdfiumPages(f: Input): number | undefined {
  try {
    const d = openDoc(mod, f.bytes, f.password);
    const n = call(mod, 'FPDF_GetPageCount', d.doc);
    d.close();
    return n;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 2. Text comparison files: prefix against rewritten copy
// ---------------------------------------------------------------------------
const textRows: unknown[] = [];
const textFiles = new Map<string, Uint8Array>();
for (const p of corpusPairs('text')) {
  const A = textInput(p.id, 'old');
  const B = textInput(p.id, 'new');
  const { marks, ms: marksMs } = marksFor(A, B, p.id);
  const pre = await buildTextFile(mod, A, B, marks, { when: WHEN, route: 'prefix' });
  const rew = await buildTextFile(mod, A, B, marks, { when: WHEN, route: 'rewritten' });
  textFiles.set(p.id, pre.bytes);
  const firstMarkPage = (marks[0]?.page ?? 1) - 1;
  const t0 = performance.now();
  const plain = await detect(B.bytes);
  const plainMs = performance.now() - t0;
  const shaA = await sha256Hex(A.bytes);
  const pop = await popplerAttachments(pre.bytes);
  const pj = await pdfjsCheck(pre.bytes);
  const row = {
    pair: p.id,
    pages: p.newPages || pdfiumPages(B),
    marks: pre.marks,
    marksMs: r1(marksMs),
    dataJson: (await openComparison(pre.bytes)).dataBytes,
    A: A.bytes.length,
    B: B.bytes.length,
    prefix: {
      file: pre.bytes.length,
      section: pre.sectionBytes,
      ms: r1(pre.ms.build),
      bIsPrefix: isPrefix(B.bytes, pre.bytes),
    },
    rewritten: {
      file: rew.bytes.length,
      ms: r1(rew.ms.build),
      bIsPrefix: isPrefix(B.bytes, rew.bytes),
    },
    ours: await verify(pre.bytes),
    oursRewritten: await verify(rew.bytes),
    plainFileDetected: plain !== null,
    plainDetectMs: r1(plainMs),
    qpdf: qpdfCheck(pre.bytes),
    poppler:
      typeof pop === 'string'
        ? pop
        : `${String(Object.keys(pop).length)} files, A exact: ${String(Object.values(pop).includes(shaA))}`,
    pdfjs:
      typeof pj === 'string'
        ? pj
        : `${String(Object.keys(pj.files).length)} files, A exact: ${String(Object.values(pj.files).includes(shaA))}, marks (first 30 pages): ${String(pj.annots)}`,
    markPixels: {
      pdfium: [pdfiumColoured(B.bytes, firstMarkPage), pdfiumColoured(pre.bytes, firstMarkPage)],
      poppler: [popplerColoured(B.bytes, firstMarkPage), popplerColoured(pre.bytes, firstMarkPage)],
    },
  };
  textRows.push(row);
  console.log('text', JSON.stringify(row));
}
note('text', textRows);
toPack(
  'text_01_invoice.pdf',
  textFiles.get('01') ?? new Uint8Array(),
  'Text comparison file, pair 01 (B plus one section)',
);
toPack(
  'text_05_clauses.pdf',
  textFiles.get('05') ?? new Uint8Array(),
  'Text comparison file, pair 05',
);
toPack(
  'text_10_tender_20p.pdf',
  textFiles.get('10') ?? new Uint8Array(),
  'Text comparison file, pair 10 (20 pages)',
);
{
  const A = textInput('01', 'old');
  const B = textInput('01', 'new');
  const rew = await buildTextFile(mod, A, B, marksFor(A, B, '01').marks, {
    when: WHEN,
    route: 'rewritten',
  });
  toPack(
    'text_01_invoice_rewritten.pdf',
    rew.bytes,
    'Text comparison file, pair 01, the rewritten-copy route (B attached too)',
  );
}

// ---------------------------------------------------------------------------
// 3. Encrypted inputs (text): B encrypted with qpdf (self-made copies)
// ---------------------------------------------------------------------------
const encRows: unknown[] = [];
if (has('qpdf')) {
  const CASES: { id: string; args: string[]; label: string }[] = [
    { id: 'aes256', label: 'AES-256 (R6)', args: ['--encrypt', 'user1', 'owner1', '256', '--'] },
    {
      id: 'aes128',
      label: 'AES-128 (R4)',
      args: ['--encrypt', 'user1', 'owner1', '128', '--use-aes=y', '--'],
    },
    {
      id: 'rc4',
      label: 'RC4-128 (R3)',
      args: ['--allow-weak-crypto', '--encrypt', 'user1', 'owner1', '128', '--use-aes=n', '--'],
    },
    {
      id: 'aes256-nocomment',
      label: 'AES-256, commenting not allowed',
      args: ['--encrypt', 'user1', 'owner1', '256', '--annotate=n', '--modify=none', '--'],
    },
  ];
  for (const pairId of ['01', '10']) {
    const A = textInput(pairId, 'old');
    const plainB = textInput(pairId, 'new');
    const marks = marksFor(A, plainB, pairId).marks;
    for (const c of CASES) {
      const src = tmpFile(plainB.bytes);
      const dst = join(TMP, `enc-${c.id}-${pairId}.pdf`);
      execFileSync('qpdf', [...c.args, src, dst]);
      const B: Input = {
        name: plainB.name,
        bytes: new Uint8Array(readFileSync(dst)),
        password: 'user1',
      };
      // Rule 9: commenting must be allowed by B's own flags (P bit 6) to write marks.
      const perms = call(mod, 'FPDF_GetDocPermissions', openDocKeep(B));
      const canAnnotate = (perms & 0x20) !== 0;
      const res = await buildTextFile(mod, A, B, marks, { when: WHEN, route: 'prefix' });
      const row = {
        pair: pairId,
        case: c.label,
        canAnnotate,
        file: res.bytes.length,
        bIsPrefix: isPrefix(B.bytes, res.bytes),
        ours: await verify(res.bytes, 'user1'),
        pdfiumWithout: pdfiumOpens(res.bytes),
        pdfiumWith: pdfiumOpens(res.bytes, 'user1'),
        qpdf: qpdfCheck(res.bytes, 'user1'),
        poppler: await popplerAttachments(res.bytes, 'user1').then((x) =>
          typeof x === 'string' ? x : `${String(Object.keys(x).length)} files`,
        ),
        pdfjs: await pdfjsCheck(res.bytes, 'user1').then((x) =>
          typeof x === 'string'
            ? x
            : `${String(Object.keys(x.files).length)} files, ${String(x.annots)} marks`,
        ),
        markPixels: [pdfiumColoured(B.bytes, 0, 'user1'), pdfiumColoured(res.bytes, 0, 'user1')],
        popplerMarkPixels: [
          popplerColoured(B.bytes, 0, 'user1'),
          popplerColoured(res.bytes, 0, 'user1'),
        ],
      };
      encRows.push(row);
      console.log('encrypted', JSON.stringify(row));
      if (pairId === '01' && c.id === 'aes256')
        toPack(
          'text_01_encrypted_aes256.pdf',
          res.bytes,
          'Text comparison file over an AES-256 B: same password as B',
          'user1',
        );
    }
  }
  // A protected with a different password from B: A is attached as is.
  {
    const plainA = textInput('01', 'old');
    const src = tmpFile(plainA.bytes);
    const dst = join(TMP, 'encA.pdf');
    execFileSync('qpdf', ['--encrypt', 'userA', 'ownerA', '256', '--', src, dst]);
    const A: Input = {
      name: plainA.name,
      bytes: new Uint8Array(readFileSync(dst)),
      password: 'userA',
    };
    const B = textInput('01', 'new');
    const res = await buildTextFile(mod, A, B, marksFor(plainA, B, '01').marks, {
      when: WHEN,
      route: 'prefix',
    });
    const o = await openComparison(res.bytes);
    encRows.push({
      pair: '01',
      case: 'A protected (own password), B plain',
      exactA: o.A[0]?.exact,
      attachedAOpensWithItsPassword: pdfiumOpens(o.A[0]?.bytes ?? new Uint8Array(), 'userA'),
      attachedAOpensWithout: pdfiumOpens(o.A[0]?.bytes ?? new Uint8Array()),
    });
  }
}
note('encrypted', encRows);

function openDocKeep(i: Input): number {
  // A document kept open for the run (permissions read); closed at exit.
  return openDoc(mod, i.bytes, i.password).doc;
}

// ---------------------------------------------------------------------------
// 4. Signed inputs
// ---------------------------------------------------------------------------
const signer = await makeSigner('Spike S31 Signer');
const sigRows: unknown[] = [];
{
  const A = textInput('01', 'old');
  const plainB = textInput('01', 'new');
  const marks = marksFor(A, plainB, '01').marks;
  for (const docMdp of [undefined, 3, 2, 1] as const) {
    const signedB: Input = {
      name: plainB.name,
      bytes: await signCopy(plainB.bytes, signer, docMdp ? { docMdp } : {}),
    };
    const mdp = await docMdpOf(await Section.open(signedB.bytes));
    for (const route of docMdp
      ? (['prefix', 'rewritten', 'unsigned'] as const)
      : (['prefix', 'rewritten'] as const)) {
      const res = await buildTextFile(mod, A, signedB, marks, { when: WHEN, route });
      const o = await openComparison(res.bytes);
      const row = {
        case: docMdp ? `certified P=${String(docMdp)}` : 'approval signature',
        route,
        mdpRead: mdp,
        signedB: await sigSummary(signedB.bytes),
        comparisonFile: await sigSummary(res.bytes),
        recoveredB: await sigSummary(o.B[0]?.bytes ?? new Uint8Array()),
        exactB: o.B[0]?.exact,
        pdfsigFile: pdfsig(res.bytes),
      };
      sigRows.push(row);
      console.log('signed', JSON.stringify(row));
      if (route === 'unsigned' && docMdp === 2)
        toPack(
          'text_01_certified-P2_unsigned-copy.pdf',
          res.bytes,
          'Certified B (P=2): visible copy without the signature, B attached unchanged',
        );
      if (route === 'prefix' && (docMdp === undefined || docMdp === 2))
        toPack(
          `text_01_signed_${docMdp ? 'certified-P2' : 'approval'}.pdf`,
          res.bytes,
          docMdp
            ? 'Text comparison file over a certified B (P=2), prefix route: readers should flag the change'
            : 'Text comparison file over an approval-signed B: the signature covers revision 2 of 3',
        );
    }
  }
  // Overlay with signed inputs: the copies inside keep their signatures.
  const sa: Input = {
    name: 'signed_A.pdf',
    bytes: await signCopy(overlayInput('01', 'old').bytes, signer),
  };
  const sb: Input = {
    name: 'signed_B.pdf',
    bytes: await signCopy(overlayInput('01', 'new').bytes, signer),
  };
  const ov = await buildOverlayFile(mod, [sa], [sb], { when: WHEN });
  const o = await openComparison(ov.bytes);
  sigRows.push({
    case: 'overlay, both inputs signed',
    route: 'attachments',
    comparisonFile: await sigSummary(ov.bytes),
    recoveredA: await sigSummary(o.A[0]?.bytes ?? new Uint8Array()),
    recoveredB: await sigSummary(o.B[0]?.bytes ?? new Uint8Array()),
    exact: [o.A[0]?.exact, o.B[0]?.exact],
  });
  overlayFiles.set('signed', ov.bytes);
}
note('signed', sigRows);

// ---------------------------------------------------------------------------
// 5. Save review into the copies inside; files changed by other programs
// ---------------------------------------------------------------------------
const reviewRows: unknown[] = [];
{
  // Overlay pair 19: three rounds of review comments into A and B.
  let file = overlayFiles.get('19') ?? new Uint8Array();
  let compact = file;
  const first = await openComparison(file);
  const a0 = first.A[0]?.bytes ?? new Uint8Array();
  for (let round = 1; round <= 3; round++) {
    const o = await openComparison(file);
    const a = await addNote(
      o.A[0]?.bytes ?? new Uint8Array(),
      0,
      `Round ${String(round)}: checked`,
      { when: WHEN, nm: `rev-a-${String(round)}` },
    );
    const b = await addNote(o.B[0]?.bytes ?? new Uint8Array(), 0, `Round ${String(round)}: see A`, {
      when: WHEN,
      nm: `rev-b-${String(round)}`,
    });
    const next = new Map([
      [keyOf('A', 0, 1), a],
      [keyOf('B', 0, 1), b],
    ]);
    const t0 = performance.now();
    file = await updateOverlayFile(mod, file, next, { when: WHEN, compact: false });
    const tInc = performance.now() - t0;
    const t1 = performance.now();
    compact = await updateOverlayFile(mod, compact, next, { when: WHEN, compact: true });
    const tCompact = performance.now() - t1;
    const vi = await openComparison(file);
    const vc = await openComparison(compact);
    reviewRows.push({
      case: `overlay 19, review round ${String(round)}`,
      incremental: {
        file: file.length,
        ms: r1(tInc),
        exact: vi.A.every((x) => x.exact) && vi.B.every((x) => x.exact),
        qpdf: qpdfCheck(file),
      },
      compact: {
        file: compact.length,
        ms: r1(tCompact),
        exact: vc.A.every((x) => x.exact) && vc.B.every((x) => x.exact),
        via: vc.detected.via,
        qpdf: qpdfCheck(compact),
      },
      aKeepsOriginalPrefix: isPrefix(a0, vi.A[0]?.bytes ?? new Uint8Array()),
      aNotes: [a.length - (o.A[0]?.bytes.length ?? 0)],
    });
  }
  console.log('review', JSON.stringify(reviewRows));
  toPack(
    'overlay_19_after_review.pdf',
    compact,
    'Overlay file after three rounds of Save review (compacted)',
  );

  // The dense A1 overlay (1 MB file): one Save review, incremental and compacted.
  {
    const f = overlayFiles.get('14') ?? new Uint8Array();
    const o = await openComparison(f);
    const b = await addNote(o.B[0]?.bytes ?? new Uint8Array(), 0, 'Dense sheet note', {
      when: WHEN,
      nm: 'rev-14',
    });
    const next = new Map([[keyOf('B', 0, 1), b]]);
    const t0 = performance.now();
    const inc = await updateOverlayFile(mod, f, next, { when: WHEN, compact: false });
    const t1 = performance.now();
    const cmp = await updateOverlayFile(mod, f, next, { when: WHEN, compact: true });
    const t2 = performance.now();
    reviewRows.push({
      case: 'overlay 14 (dense A1), one Save review into B',
      before: f.length,
      incremental: { file: inc.length, ms: r1(t1 - t0) },
      compact: {
        file: cmp.length,
        ms: r1(t2 - t1),
        exact: (await openComparison(cmp)).B[0]?.exact,
      },
    });
  }

  // Overlay with signed inputs: review into the signed copy, signature stays.
  {
    const sf = overlayFiles.get('signed') ?? new Uint8Array();
    const o = await openComparison(sf);
    const a = await addNote(o.A[0]?.bytes ?? new Uint8Array(), 0, 'Reviewed', {
      when: WHEN,
      nm: 'rev-signed',
    });
    const up = await updateOverlayFile(mod, sf, new Map([[keyOf('A', 0, 1), a]]), {
      when: WHEN,
      compact: true,
    });
    const v = await openComparison(up);
    reviewRows.push({
      case: 'overlay, signed A, review then compact',
      recoveredA: await sigSummary(v.A[0]?.bytes ?? new Uint8Array()),
      exact: v.A[0]?.exact,
    });
  }

  // Text pair 05: review into B (and A), rebuild, reopen.
  for (const id of ['05', '10', '17']) {
    const f0 = textFiles.get(id) ?? new Uint8Array();
    const o = await openComparison(f0);
    const b0 = o.B[0]?.bytes ?? new Uint8Array();
    const b1 = await addNote(b0, 0, 'Check the new clause', { when: WHEN, nm: 'rev-text-b' });
    const a1 = await addNote(o.A[0]?.bytes ?? new Uint8Array(), 0, 'Old wording', {
      when: WHEN,
      nm: 'rev-text-a',
    });
    const t0 = performance.now();
    const f1 = await updateTextFile(mod, f0, { A: a1, B: b1 }, { when: WHEN });
    const ms = performance.now() - t0;
    const v = await openComparison(f1);
    reviewRows.push({
      case: `text ${id}, Save review into A and B`,
      before: f0.length,
      after: f1.length,
      ms: r1(ms),
      exact: [v.A[0]?.exact, v.B[0]?.exact],
      bStartsWithOriginalB: isPrefix(b0, v.B[0]?.bytes ?? new Uint8Array()),
      fileStartsWithNewB: isPrefix(b1, f1),
      marksKept: (v.data.marks ?? []).length === (o.data.marks ?? []).length,
      foreignRevisions: v.foreignRevisions,
      qpdf: qpdfCheck(f1),
    });
    if (id === '05')
      toPack('text_05_after_review.pdf', f1, 'Text comparison file after Save review into A and B');
  }

  // Encrypted text: review into an AES-256 B.
  if (has('qpdf')) {
    const A = textInput('01', 'old');
    const plainB = textInput('01', 'new');
    const dst = join(TMP, 'enc-review.pdf');
    execFileSync('qpdf', ['--encrypt', 'user1', 'owner1', '256', '--', tmpFile(plainB.bytes), dst]);
    const B: Input = {
      name: plainB.name,
      bytes: new Uint8Array(readFileSync(dst)),
      password: 'user1',
    };
    const f0 = (
      await buildTextFile(mod, A, B, marksFor(A, plainB, '01').marks, {
        when: WHEN,
        route: 'prefix',
      })
    ).bytes;
    const o = await openComparison(f0, 'user1');
    const b1 = await addNote(o.B[0]?.bytes ?? new Uint8Array(), 0, 'Encrypted note', {
      when: WHEN,
      nm: 'rev-enc',
      password: 'user1',
    });
    const f1 = await updateTextFile(mod, f0, { B: b1 }, { when: WHEN, password: 'user1' });
    const v = await openComparison(f1, 'user1');
    reviewRows.push({
      case: 'text 01, AES-256 B, Save review into B',
      exact: [v.A[0]?.exact, v.B[0]?.exact],
      pdfiumWith: pdfiumOpens(f1, 'user1'),
      pdfiumWithout: pdfiumOpens(f1),
      recoveredBOpens: pdfiumOpens(v.B[0]?.bytes ?? new Uint8Array(), 'user1'),
      qpdf: qpdfCheck(f1, 'user1'),
    });
  }

  // Another program saves into the text comparison file.
  {
    const f0 = textFiles.get('01') ?? new Uint8Array();
    const appended = await addNote(f0, 0, 'Added in another reader', {
      when: WHEN,
      nm: 'foreign-1',
    });
    const va = await openComparison(appended);
    const rewrites: Record<string, Uint8Array> = {};
    {
      const d = openDoc(mod, f0);
      const { saveWithFlags, FPDF_NO_INCREMENTAL } =
        await import('../../src/workers/render/save/writer.ts');
      rewrites.pdfiumRewrite = saveWithFlags(mod, d.doc, FPDF_NO_INCREMENTAL);
      d.close();
    }
    if (has('qpdf')) {
      const dst = join(TMP, 'qpdf-rewrite.pdf');
      execFileSync('qpdf', ['--object-streams=generate', tmpFile(f0), dst]);
      rewrites.qpdfRewrite = new Uint8Array(readFileSync(dst));
    }
    const foreign: Record<string, unknown> = {
      appendedComment: {
        via: va.detected.via,
        exactB: va.B[0]?.exact,
        exactA: va.A[0]?.exact,
        foreignRevisions: va.foreignRevisions,
      },
    };
    for (const [k, bytes] of Object.entries(rewrites)) {
      const v = await openComparison(bytes);
      foreign[k] = {
        via: v.detected.via,
        exactB: v.B[0]?.exact,
        exactA: v.A[0]?.exact,
        foreignRevisions: v.foreignRevisions,
      };
    }
    // A reader that drops /PieceInfo: detection falls back to the data attachment.
    {
      const sec = await Section.open(f0);
      const cat = await sec.catalog();
      const d = new Map(cat.dict);
      d.delete('PieceInfo');
      sec.value(cat.num, d);
      const v = await openComparison(sec.finish());
      foreign.pieceInfoDropped = {
        via: v.detected.via,
        exactB: v.B[0]?.exact,
        foreignRevisions: v.foreignRevisions,
      };
    }
    reviewRows.push({ case: 'text 01, saved by another program', ...foreign });
  }
}
note('review', reviewRows);

// ---------------------------------------------------------------------------
// 6. Detection cost on large plain files and the data's own checks
// ---------------------------------------------------------------------------
{
  const big = overlayInput('14', 'new');
  const t0 = performance.now();
  const d = await detect(big.bytes);
  const ms = performance.now() - t0;
  const data = decodeData(
    new TextEncoder().encode(
      JSON.stringify({
        format: 'triya-comparison',
        version: 1,
        kind: 'overlay',
        documents: {
          A: [{ sha256: 'a'.repeat(64), storage: { attachment: 'x' } }],
          B: [{ sha256: 'b'.repeat(64), storage: { attachment: 'y' } }],
        },
      }),
    ),
  );
  let newer = '';
  try {
    decodeData(
      new TextEncoder().encode(
        JSON.stringify({ format: 'triya-comparison', version: 2, kind: 'overlay' }),
      ),
    );
  } catch (e) {
    newer = (e as Error).message;
  }
  note('detection', {
    denseA1Plain: { detected: d !== null, ms: r1(ms) },
    minimalDataAccepted: data.kind,
    newerVersion: newer,
  });
}

writeFileSync(
  join(PACK, 'CHECKLIST.md'),
  `# Spike S31 sample pack (M12-06)

Open each file in Acrobat Reader and a second desktop PDF editor (and, if you like, the
browsers' built-in viewers). For each file:

1. It opens without a warning or a repair message (the protected ones ask for the password).
2. The attachments panel lists the files: overlay "Document A" and "Document B" (a set: three
   of each) and comparison.json; text: Document A and comparison.json (the unsigned copy: also
   Document B). Each PDF attachment opens and is the original revision.
3. Overlay files: red, green and black lines as in the S29 pack.
4. Text files: the changes are highlighted (green inserted, amber replaced, red caret for
   deleted text); hovering or opening a mark shows "was: …" or "Deleted: …".
5. Signed files: the signature panel. Approval signature: valid, "changed after signing"
   (comments added). Certified P=2 with the prefix route: how does the reader report it? The
   unsigned copy: no signature on the pages; the attached Document B shows its certification
   as valid.
6. Add a comment and save in that reader; send the saved file back if you can (it tells us
   what Triya PDF must cope with when reopening).

| File | What | Password |
| --- | --- | --- |
${pack.map((p) => `| ${p.file} | ${p.what} | ${p.password ?? ''} |`).join('\n')}
`,
);
note('pack', pack);
writeFileSync(RESULTS, JSON.stringify(results, null, 2));
rmSync(TMP, { recursive: true, force: true });
console.log(`wrote ${RESULTS} and ${PACK}`);
