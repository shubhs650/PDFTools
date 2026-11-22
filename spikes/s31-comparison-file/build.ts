// Spike S31 (M12-06, D-65): writing the two kinds of comparison file.
//
// Overlay: the vector overlay pages (S29's builder, route 2), then one section
//   by our object layer: Document A and B attached unchanged, the comparison
//   data, the catalog tagged. With a password-protected input the whole file
//   can then be encrypted (AES-256) by PDFium, as Password Security does.
// Text, route "prefix": Document B's own bytes, then one section: the change
//   marks on B's pages, Document A and the data attached, the catalog tagged.
//   B is recovered as the first `length` bytes and checked by SHA-256.
// Text, route "rewritten": PDFium's full rewrite of B with the same section;
//   B is not recoverable from the pages, so it is attached as well.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  PdfRef as PdfRefClass,
  isDict,
  nameOf,
  type PdfDict,
  type PdfRef,
} from '../../src/model/pdf/objects';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer';
import { call, openDoc } from '../s29-overlay/pdfiumKit';
import { buildVectorOverlay, type SheetSpec, type Source } from '../s29-overlay/vectorOverlay';
import {
  DATA_FILE_NAME,
  FORMAT,
  KEY_DATA,
  VERSION,
  encodeData,
  keyOf,
  revisionCount,
  sha256Hex,
  type ComparisonData,
  type Mark,
  type StoredFile,
} from './format';
import { writeMarks } from './marks';
import { Section } from './section';

export interface Input {
  name: string;
  bytes: Uint8Array;
  password?: string;
}

const APP = 'Triya PDF 1.1.0 (spike S31)';

function pageCount(mod: WrappedPdfiumModule, f: Input): number {
  const d = openDoc(mod, f.bytes, f.password);
  try {
    return call(mod, 'FPDF_GetPageCount', d.doc);
  } finally {
    d.close();
  }
}

async function stored(
  mod: WrappedPdfiumModule,
  f: Input,
  storage: StoredFile['storage'],
): Promise<StoredFile> {
  return {
    name: f.name,
    size: f.bytes.length,
    sha256: await sha256Hex(f.bytes),
    pages: pageCount(mod, f),
    storage,
  };
}

function baseData(kind: ComparisonData['kind'], when: Date): Omit<ComparisonData, 'documents'> {
  return {
    format: FORMAT,
    version: VERSION,
    kind,
    created: when.toISOString(),
    modified: when.toISOString(),
    app: APP,
    options: {},
    ignoreZones: [],
    checked: [],
    closeOut: [],
  };
}

const PDF_MIME = 'application/pdf';
const JSON_MIME = 'application/json';

/** Attaches the inputs and the data in `sec` and tags the catalog. */
async function attachAll(
  sec: Section,
  att: { key: string; input: Input; desc: string }[],
  data: ComparisonData,
  when: Date,
  pageMode?: string,
  edit?: (d: PdfDict) => void | Promise<void>,
): Promise<void> {
  const files: { key: string; ref: PdfRef }[] = [];
  for (const a of att) {
    files.push({
      key: a.key,
      ref: sec.embed({
        key: a.key,
        fileName: a.input.name,
        bytes: a.input.bytes,
        mime: PDF_MIME,
        desc: a.desc,
        relationship: 'Source',
        modified: when,
      }),
    });
  }
  const dataRef = sec.embed({
    key: KEY_DATA,
    fileName: DATA_FILE_NAME,
    bytes: encodeData(data),
    mime: JSON_MIME,
    desc: 'Triya PDF comparison data',
    relationship: 'Data',
    modified: when,
  });
  files.push({ key: KEY_DATA, ref: dataRef });
  await sec.tagCatalog({
    files,
    kind: data.kind,
    version: data.version,
    data: dataRef,
    modified: when,
    ...(pageMode ? { pageMode } : {}),
    ...(edit ? { edit } : {}),
  });
}

export interface OverlayResult {
  bytes: Uint8Array;
  overlayOnly: number;
  ms: { overlay: number; attach: number; encrypt: number };
}

/** The overlay comparison file: sheets paired page by page in order over the sets. */
export async function buildOverlayFile(
  mod: WrappedPdfiumModule,
  A: readonly Input[],
  B: readonly Input[],
  opts: { when: Date; protect?: { user: string; owner: string }; extra?: Partial<ComparisonData> },
): Promise<OverlayResult> {
  const t0 = performance.now();
  const open = (f: Input) => ({ f, d: openDoc(mod, f.bytes, f.password) });
  const oa = A.map(open);
  const ob = B.map(open);
  let overlay: Uint8Array;
  try {
    const pagesOf = (list: typeof oa) =>
      list.flatMap(({ f, d }) => {
        const src: Source = {
          doc: d.doc,
          bytes: f.bytes,
          label: f.name,
          ...(f.password ? { password: f.password } : {}),
        };
        return Array.from({ length: call(mod, 'FPDF_GetPageCount', d.doc) }, (_, index) => ({
          source: src,
          index,
        }));
      });
    const pa = pagesOf(oa);
    const pb = pagesOf(ob);
    const sheets: SheetSpec[] = Array.from({ length: Math.max(pa.length, pb.length) }, (_, i) => {
      const s: SheetSpec = {};
      const a = pa[i];
      const b = pb[i];
      if (a) s.a = a;
      if (b) s.b = b;
      return s;
    });
    overlay = (
      await buildVectorOverlay(mod, sheets, {
        route: 'recolour',
        colA: [255, 0, 0],
        colB: [0, 160, 0],
      })
    ).bytes;
  } finally {
    for (const { d } of [...oa, ...ob]) d.close();
  }
  const t1 = performance.now();
  const data: ComparisonData = {
    ...baseData('overlay', opts.when),
    documents: {
      A: await Promise.all(
        A.map((f, i) => stored(mod, f, { attachment: keyOf('A', i, A.length) })),
      ),
      B: await Promise.all(
        B.map((f, i) => stored(mod, f, { attachment: keyOf('B', i, B.length) })),
      ),
    },
    ...opts.extra,
  };
  const sec = await Section.open(overlay);
  await attachAll(
    sec,
    [
      ...A.map((input, i) => ({
        key: keyOf('A', i, A.length),
        input,
        desc: 'Document A (old revision), unchanged',
      })),
      ...B.map((input, i) => ({
        key: keyOf('B', i, B.length),
        input,
        desc: 'Document B (new revision), unchanged',
      })),
    ],
    data,
    opts.when,
  );
  let bytes = sec.finish();
  const t2 = performance.now();
  if (opts.protect) bytes = encryptCopy(mod, bytes, opts.protect.user, opts.protect.owner);
  return {
    bytes,
    overlayOnly: overlay.length,
    ms: { overlay: t1 - t0, attach: t2 - t1, encrypt: performance.now() - t2 },
  };
}

/** AES-256 encryption of a whole file by PDFium (the Password Security copy route, ADR-022). */
export function encryptCopy(
  mod: WrappedPdfiumModule,
  bytes: Uint8Array,
  user: string,
  owner: string,
  flags = -4,
): Uint8Array {
  const d = openDoc(mod, bytes);
  try {
    if (!call(mod, 'EPDF_SetEncryption', d.doc, user, owner, flags))
      throw new Error('PDFium did not encrypt');
    return saveWithFlags(mod, d.doc, FPDF_NO_INCREMENTAL);
  } finally {
    d.close();
  }
}

/**
 * prefix: B's own bytes plus our section. rewritten: PDFium's rewrite of B,
 * B attached too. unsigned: the rewrite without B's signature fields (a
 * certified B whose permissions forbid our changes), B attached unchanged.
 */
export type TextRoute = 'prefix' | 'rewritten' | 'unsigned';

export interface TextResult {
  bytes: Uint8Array;
  route: TextRoute;
  marks: number;
  sectionBytes: number;
  ms: { build: number };
}

/** The text comparison file over B (with B's password when it has one). */
export async function buildTextFile(
  mod: WrappedPdfiumModule,
  A: Input,
  B: Input,
  marks: readonly Mark[],
  opts: { when: Date; route: TextRoute; pageMode?: string },
): Promise<TextResult> {
  const t0 = performance.now();
  let base = B.bytes;
  if (opts.route !== 'prefix') {
    const d = openDoc(mod, B.bytes, B.password);
    try {
      base = saveWithFlags(mod, d.doc, FPDF_NO_INCREMENTAL);
    } finally {
      d.close();
    }
  }
  const bStorage: StoredFile['storage'] =
    opts.route === 'prefix'
      ? { prefix: { length: B.bytes.length, revisions: revisionCount(B.bytes) } }
      : { attachment: keyOf('B', 0, 1) };
  const data: ComparisonData = {
    ...baseData('text', opts.when),
    documents: {
      A: [await stored(mod, A, { attachment: keyOf('A', 0, 1) })],
      B: [await stored(mod, B, bStorage)],
    },
    marks: [...marks],
  };
  const sec = await Section.open(base, B.password);
  const sigWidgets = opts.route === 'unsigned' ? await signatureWidgets(sec) : new Set<number>();
  const written = await writeMarks(sec, marks, opts.when, sigWidgets);
  const att = [{ key: keyOf('A', 0, 1), input: A, desc: 'Document A (old revision), unchanged' }];
  if (opts.route !== 'prefix')
    att.push({ key: keyOf('B', 0, 1), input: B, desc: 'Document B (new revision), unchanged' });
  await attachAll(sec, att, data, opts.when, opts.pageMode, async (d) => {
    if (opts.route !== 'unsigned') return;
    // The visible copy carries no signature: B's own, intact, is the attachment.
    d.delete('Perms');
    const form = await sec.reader.resolve(d.get('AcroForm'));
    if (!isDict(form)) return;
    const f: PdfDict = new Map(form);
    const fields = await sec.reader.resolve(f.get('Fields'));
    f.set(
      'Fields',
      (Array.isArray(fields) ? fields : []).filter(
        (r) => !(r instanceof PdfRefClass && sigWidgets.has(r.num)),
      ),
    );
    f.delete('SigFlags');
    d.set('AcroForm', f);
  });
  let bytes = sec.finish();
  if (opts.route === 'unsigned') {
    // Compact, so the dropped signature objects are not left in the file.
    const d = openDoc(mod, bytes, B.password);
    try {
      bytes = saveWithFlags(mod, d.doc, FPDF_NO_INCREMENTAL);
    } finally {
      d.close();
    }
  }
  return {
    bytes,
    route: opts.route,
    marks: written,
    sectionBytes: bytes.length - base.length,
    ms: { build: performance.now() - t0 },
  };
}

/** Object numbers of the signature fields' widgets (a field and its widget merged, or kids). */
async function signatureWidgets(sec: Section): Promise<Set<number>> {
  const out = new Set<number>();
  const cat = await sec.catalog();
  const form = await sec.reader.resolve(cat.dict.get('AcroForm'));
  const fields = isDict(form) ? await sec.reader.resolve(form.get('Fields')) : undefined;
  for (const r of Array.isArray(fields) ? fields : []) {
    if (!(r instanceof PdfRefClass)) continue;
    const f = await sec.reader.resolve(r);
    if (!isDict(f) || nameOf(f.get('FT')) !== 'Sig') continue;
    out.add(r.num);
    const kids = await sec.reader.resolve(f.get('Kids'));
    for (const k of Array.isArray(kids) ? kids : []) if (k instanceof PdfRefClass) out.add(k.num);
  }
  return out;
}
