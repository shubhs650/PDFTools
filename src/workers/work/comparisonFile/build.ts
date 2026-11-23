// Writing the two kinds of comparison file (M12-20, D-65; ADR-032, spike S31;
// format docs/formats/triya-comparison-v1.md). Runs in the Work worker
// (rule 1); the job in work.worker.ts gathers the inputs first.
//
// Overlay: the vector overlay pages (M12-16's builder) with the overlay notes
//   copied onto them as comments, then one section by our object layer:
//   every file of side A and side B attached unchanged, the comparison data,
//   the catalog tagged.
// Text, "prefix" route: Document B's own bytes, then one section: the change
//   marks on B's pages, Document A and the data attached, the catalog tagged.
//   B comes back as the file's first `length` bytes, checked by SHA-256, and
//   keeps its signature and its own encryption.
// Text, "copy" route: PDFium's rewrite of B without its signature fields (a
//   certified B that forbids comments, ADR-032 decision 4; or a B that must be
//   locked by the comparison file's own password), B attached unchanged.
// A password-protected input locks the whole file with an open password
// (AES-256, the Password Security route; ADR-032 decision 1) unless the file
// is already B's own bytes under B's password.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
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
  type StoredFile,
} from '../../../model/compare/file/format';
import { ALL_ALLOWED, permissionFlags } from '../../../model/passwordSecurity';
import { PdfRef, isDict, nameOf, numOf, type PdfDict } from '../../../model/pdf/objects';
import type { PdfReader } from '../../../model/pdf/reader';
import { docPtrOf } from '../../render/pdfium';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../render/save/writer';
import { writeMarks, type MarkSpec } from './marks';
import { Section, type Inflate } from './section';

/** An input file as it goes into the comparison file. */
export interface InputFile {
  name: string;
  /** Exactly the bytes stored: the file as saved plus the review comments not saved yet. */
  bytes: Uint8Array;
  pages: number;
  range: string;
  /** A password that decrypts it, when it is encrypted (memory only). */
  password?: string;
  /** It needs an open password (a protected input, ADR-032 decision 1). */
  locked?: boolean;
}

/** The data's fields the main thread fills in (the rest is worked out here). */
export type DataFields = Omit<
  ComparisonData,
  'format' | 'version' | 'kind' | 'documents' | 'marks' | 'modified'
>;

/** Words written into the file (localized on the main thread, rule 11). */
export interface FileWords {
  /** "Document A (old revision), unchanged" … per side. */
  descA: string;
  descB: string;
  descData: string;
  /** The marks' author (text comparison). */
  author: string;
}

export interface FileEnv {
  mod: WrappedPdfiumModule;
  native: PdfiumNative;
  inflate?: Inflate;
  /** Between steps: may throw to cancel (rule 2). */
  checkpoint(): Promise<void>;
}

const PDF_MIME = 'application/pdf';
const JSON_MIME = 'application/json';

async function stored(f: InputFile, storage: StoredFile['storage']): Promise<StoredFile> {
  return {
    name: f.name,
    size: f.bytes.length,
    sha256: await sha256Hex(f.bytes),
    pages: f.pages,
    range: f.range,
    storage,
  };
}

/** Attaches the inputs and the data in `sec` and tags the catalog. */
async function attachAll(
  sec: Section,
  att: { key: string; input: InputFile; desc: string }[],
  data: ComparisonData,
  words: FileWords,
  when: Date,
  edit?: (d: PdfDict) => void | Promise<void>,
): Promise<void> {
  const files: { key: string; ref: PdfRef }[] = att.map((a) => ({
    key: a.key,
    ref: sec.embed({
      fileName: a.input.name,
      bytes: a.input.bytes,
      mime: PDF_MIME,
      desc: a.desc,
      relationship: 'Source',
      modified: when,
    }),
  }));
  const dataRef = sec.embed({
    fileName: DATA_FILE_NAME,
    bytes: encodeData(data),
    mime: JSON_MIME,
    desc: words.descData,
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
    ...(edit ? { edit } : {}),
  });
}

let copySeq = 0;

/** Opens `bytes` in PDFium as a scratch document, runs `fn`, closes it. */
async function withCopy<T>(
  env: FileEnv,
  bytes: Uint8Array,
  password: string | undefined,
  fn: (doc: PdfDocumentObject, id: string) => T | Promise<T>,
): Promise<T> {
  const id = `cmpfile-${String(++copySeq)}`;
  const doc = await env.native
    .openDocumentBuffer(
      { id, content: bytes.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();
  try {
    return await fn(doc, id);
  } finally {
    await env.native
      .closeDocument(doc)
      .toPromise()
      .catch(() => undefined);
  }
}

/** PDFium's full rewrite (one compact revision; the file's own encryption kept). */
function rewrite(env: FileEnv, bytes: Uint8Array, password?: string): Promise<Uint8Array> {
  return withCopy(env, bytes, password, (_doc, id) =>
    saveWithFlags(env.mod, docPtrOf(env.native, id), FPDF_NO_INCREMENTAL),
  );
}

/**
 * Locks a whole file with an open password, AES-256 (the Password Security
 * copy route, ADR-022): every permission is allowed, and the same password is
 * the owner password, so whoever opens it can also take the lock off again.
 */
export function lockFile(env: FileEnv, bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return withCopy(env, bytes, undefined, async (doc, id) => {
    const ok = await env.native
      .setDocumentEncryption(doc, password, password, permissionFlags(ALL_ALLOWED))
      .toPromise()
      .catch(() => false);
    if (!ok) throw new Error('PDFium did not encrypt the comparison file');
    return saveWithFlags(env.mod, docPtrOf(env.native, id), FPDF_NO_INCREMENTAL);
  });
}

function baseData(
  kind: ComparisonData['kind'],
  fields: DataFields,
  when: Date,
): Omit<ComparisonData, 'documents'> {
  return {
    ...fields,
    format: FORMAT,
    version: VERSION,
    kind,
    created: fields.created || when.toISOString(),
    modified: when.toISOString(),
  };
}

export interface OverlayFileRequest {
  /** The vector overlay pages (with the overlay notes on them). */
  pages: Uint8Array;
  A: InputFile[];
  B: InputFile[];
  fields: DataFields;
  words: FileWords;
  when: Date;
  /** The open password of a comparison file that must be locked (a protected input). */
  lock?: string;
}

/** The overlay comparison file. */
export async function buildOverlayFile(env: FileEnv, req: OverlayFileRequest): Promise<Uint8Array> {
  const data: ComparisonData = {
    ...baseData('overlay', req.fields, req.when),
    documents: {
      A: await Promise.all(
        req.A.map((f, i) => stored(f, { attachment: keyOf('A', i, req.A.length) })),
      ),
      B: await Promise.all(
        req.B.map((f, i) => stored(f, { attachment: keyOf('B', i, req.B.length) })),
      ),
    },
  };
  await env.checkpoint();
  const sec = await Section.open(req.pages, undefined, env.inflate);
  await attachAll(
    sec,
    [
      ...req.A.map((input, i) => ({
        key: keyOf('A', i, req.A.length),
        input,
        desc: req.words.descA,
      })),
      ...req.B.map((input, i) => ({
        key: keyOf('B', i, req.B.length),
        input,
        desc: req.words.descB,
      })),
    ],
    data,
    req.words,
    req.when,
  );
  const bytes = sec.finish();
  await env.checkpoint();
  return req.lock === undefined ? bytes : lockFile(env, bytes, req.lock);
}

/** The text comparison file's routes (ADR-032). */
export type TextRoute = 'prefix' | 'copy';

export interface TextFileRequest {
  A: InputFile;
  B: InputFile;
  marks: MarkSpec[];
  route: TextRoute;
  fields: DataFields;
  words: FileWords;
  when: Date;
  /** Copy route only: lock the result with this open password. */
  lock?: string;
}

/**
 * The certification level of a document: `/Perms /DocMDP` → its signature's
 * DocMDP transform `/P` (1 no changes, 2 form filling and signing, 3 also
 * comments); null for a file that is not certified.
 */
export async function certificationLevel(reader: PdfReader): Promise<number | null> {
  const root = await reader.resolve(reader.trailer.get('Root'));
  if (!isDict(root)) return null;
  const perms = await reader.resolve(root.get('Perms'));
  if (!isDict(perms)) return null;
  const sig = await reader.resolve(perms.get('DocMDP'));
  if (!isDict(sig)) return null;
  const refs = await reader.resolve(sig.get('Reference'));
  for (const r of Array.isArray(refs) ? refs : []) {
    const ref = await reader.resolve(r);
    if (!isDict(ref) || nameOf(ref.get('TransformMethod')) !== 'DocMDP') continue;
    const params = await reader.resolve(ref.get('TransformParams'));
    return (isDict(params) ? numOf(params.get('P')) : undefined) ?? 2;
  }
  return 2; // a certification without its transform: the standard's default
}

/** Object numbers of the signature fields and their widgets. */
async function signatureObjects(reader: PdfReader): Promise<Set<number>> {
  const out = new Set<number>();
  const root = await reader.resolve(reader.trailer.get('Root'));
  const form = isDict(root) ? await reader.resolve(root.get('AcroForm')) : undefined;
  const fields = isDict(form) ? await reader.resolve(form.get('Fields')) : undefined;
  for (const r of Array.isArray(fields) ? fields : []) {
    if (!(r instanceof PdfRef)) continue;
    const f = await reader.resolve(r);
    if (!isDict(f) || nameOf(f.get('FT')) !== 'Sig') continue;
    out.add(r.num);
    const kids = await reader.resolve(f.get('Kids'));
    for (const k of Array.isArray(kids) ? kids : []) if (k instanceof PdfRef) out.add(k.num);
  }
  return out;
}

/** The text comparison file over Document B. */
export async function buildTextFile(env: FileEnv, req: TextFileRequest): Promise<Uint8Array> {
  const { A, B } = req;
  const copy = req.route === 'copy';
  const base = copy ? await rewrite(env, B.bytes, B.password) : B.bytes;
  await env.checkpoint();
  const bStorage: StoredFile['storage'] = copy
    ? { attachment: keyOf('B', 0, 1) }
    : { prefix: { length: B.bytes.length, revisions: revisionCount(B.bytes) } };
  const sec = await Section.open(base, B.password, env.inflate);
  const sigs = copy ? await signatureObjects(sec.reader) : new Set<number>();
  const written = await writeMarks(sec, req.marks, {
    when: req.when,
    author: req.words.author,
    drop: sigs,
  });
  const data: ComparisonData = {
    ...baseData('text', req.fields, req.when),
    documents: {
      A: [await stored(A, { attachment: keyOf('A', 0, 1) })],
      B: [await stored(B, bStorage)],
    },
    marks: written.marks,
  };
  const att = [{ key: keyOf('A', 0, 1), input: A, desc: req.words.descA }];
  if (copy) att.push({ key: keyOf('B', 0, 1), input: B, desc: req.words.descB });
  await attachAll(sec, att, data, req.words, req.when, async (d) => {
    if (!copy) return;
    // The visible copy carries no signature: B's own, intact, is the attachment.
    d.delete('Perms');
    const form = await sec.reader.resolve(d.get('AcroForm'));
    if (!isDict(form)) return;
    const f: PdfDict = new Map(form);
    const fields = await sec.reader.resolve(f.get('Fields'));
    f.set(
      'Fields',
      (Array.isArray(fields) ? fields : []).filter(
        (r) => !(r instanceof PdfRef && sigs.has(r.num)),
      ),
    );
    f.delete('SigFlags');
    d.set('AcroForm', f);
  });
  let bytes = sec.finish();
  await env.checkpoint();
  if (copy) {
    // Compact, so the dropped signature objects are not left in the file.
    bytes = await rewrite(env, bytes, B.password);
    if (req.lock !== undefined && !B.locked) bytes = await lockFile(env, bytes, req.lock);
  }
  return bytes;
}
