// The comparison file's Work worker jobs (M12-20, D-65): gathering the inputs
// (each file as saved, plus the review comments not saved yet), the overlay
// pages with the overlay notes on them, the permission checks (rule 9), and
// reading a comparison file back. The writing itself is build.ts.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../../engine/errors';
import type { FileKind } from '../../../model/compare/file/format';
import { PdfReader } from '../../../model/pdf/reader';
import { docPtrOf } from '../../render/pdfium';
import { concatBytes } from '../../render/save/bytes';
import type { WorkDocs } from '../docs';
import { requireCapability, securityOf } from '../permissionGate';
import type { JobSlice } from '../scheduler';
import { importComments, pageBox, skeletonPdf } from '../transfer';
import { buildVectorOverlay, type VectorOverlayRequest, type VectorSource } from '../vectorOverlay';
import {
  buildOverlayFile,
  buildTextFile,
  certificationLevel,
  type DataFields,
  type FileEnv,
  type FileWords,
  type InputFile,
  type TextRoute,
} from './build';
import type { MarkSpec } from './marks';
import { detect, readComparison, type Detected } from './read';
import type { Inflate } from './section';

/** A buffer of exactly these bytes (a Node Buffer's `slice` shares its pool). */
export function ownBuffer(b: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(b.length);
  out.set(b);
  return out.buffer;
}

/** An input of the comparison as the main thread names it. */
export interface FileInputRef {
  docId: string;
  name: string;
  range: string;
  /**
   * The review comments not saved yet (an incremental tail prepared by the
   * save flow, M1-21), appended to the file as saved; `baseLength` is the
   * length it appends to.
   */
  tail?: ArrayBuffer;
  baseLength?: number;
}

export interface CompareFileRequest {
  kind: FileKind;
  A: FileInputRef[];
  B: FileInputRef[];
  fields: DataFields;
  words: FileWords;
  /** ISO time of the save. */
  when: string;
  /** The comparison file's open password (a protected input, ADR-032 decision 1). */
  lock?: string;
  /** Overlay: the vector overlay's request (M12-16) and the comparison's notes. */
  vector?: VectorOverlayRequest;
  notesDocId?: string;
  /** Text: the change marks on B's pages. */
  marks?: MarkSpec[];
}

export interface CompareFileResult {
  bytes: ArrayBuffer;
  route: TextRoute | null;
  /** Overlay notes (comments) written onto the pages. */
  notes: number;
}

export interface FileJobEnv {
  mod: WrappedPdfiumModule;
  native: PdfiumNative;
  docs: WorkDocs;
  inflate: Inflate;
  /** The document's current state read by our object layer (its notes, its layers). */
  liveReader(docId: string): Promise<PdfReader>;
  slice: JobSlice;
  progress(p: { done: number; total: number }): void;
}

/** An input's bytes as they go into the file: as saved, plus its unsaved review comments. */
async function inputOf(env: FileJobEnv, ref: FileInputRef): Promise<InputFile> {
  const { doc } = await env.docs.get(ref.docId);
  const saved = env.docs.bytes(ref.docId);
  if (ref.tail && ref.baseLength !== undefined && ref.baseLength !== saved.length)
    throw new RpcError('compare-file-stale', 'The document changed while it was being saved');
  const bytes = ref.tail ? concatBytes([saved, new Uint8Array(ref.tail)]) : saved;
  const password = env.docs.passwordOf(ref.docId);
  return {
    name: ref.name,
    bytes,
    pages: doc.pageCount,
    range: ref.range,
    ...(password === undefined ? {} : { password }),
    locked: env.docs.hasOpenPassword(ref.docId),
  };
}

/** Rule 9: the content-copying permission of every input; for text, commenting in B. */
async function checkPermissions(env: FileJobEnv, req: CompareFileRequest): Promise<void> {
  for (const ref of [...req.A, ...req.B]) {
    const { doc } = await env.docs.get(ref.docId);
    const sec = securityOf(env.mod, docPtrOf(env.native, doc.id));
    requireCapability(sec, 'copy');
    if (req.kind === 'text' && ref === req.B[0]) requireCapability(sec, 'annotate');
  }
}

/** The overlay pages: the vector overlay, then the notes copied onto them as comments. */
async function overlayPages(
  env: FileJobEnv,
  req: CompareFileRequest,
): Promise<{ bytes: Uint8Array; notes: number }> {
  if (!req.vector) throw new RpcError('compare-file-request', 'No overlay pages asked for');
  const total = req.vector.sheets.length + 1;
  const { bytes } = await buildVectorOverlay(
    {
      mod: env.mod,
      native: env.native,
      source: async (docId): Promise<VectorSource> => {
        const { doc } = await env.docs.get(docId);
        return { engineId: doc.id, reader: () => env.liveReader(docId) };
      },
      slice: env.slice,
      progress: (p) => {
        env.progress({ done: p.done, total });
      },
    },
    req.vector,
  );
  if (!req.notesDocId || !env.docs.has(req.notesDocId)) return { bytes, notes: 0 };
  const src = await env.liveReader(req.notesDocId);
  const tgt = await PdfReader.open(bytes, env.inflate);
  const pages = (await tgt.pages()).length;
  const r = await importComments(src, tgt, bytes, {
    withReplies: true,
    pageMap: (sp) => (sp < pages ? sp : null),
    checkpoint: () => env.slice.checkpoint(),
  });
  return { bytes: concatBytes([bytes, r.tail]), notes: r.report.roots };
}

/** Save comparison… and Save review in a reopened comparison file: the whole file. */
export async function compareFileSave(
  env: FileJobEnv,
  req: CompareFileRequest,
): Promise<CompareFileResult> {
  await checkPermissions(env, req);
  const fileEnv: FileEnv = {
    mod: env.mod,
    native: env.native,
    inflate: env.inflate,
    checkpoint: () => env.slice.checkpoint(),
  };
  const when = new Date(req.when);
  const A = await Promise.all(req.A.map((r) => inputOf(env, r)));
  const B = await Promise.all(req.B.map((r) => inputOf(env, r)));
  if (req.kind === 'overlay') {
    const pages = await overlayPages(env, req);
    const bytes = await buildOverlayFile(fileEnv, {
      pages: pages.bytes,
      A,
      B,
      fields: req.fields,
      words: req.words,
      when,
      ...(req.lock === undefined ? {} : { lock: req.lock }),
    });
    const total = (req.vector?.sheets.length ?? 0) + 1;
    env.progress({ done: total, total });
    return { bytes: ownBuffer(bytes), route: null, notes: pages.notes };
  }
  const a = A[0];
  const b = B[0];
  if (!a || !b || A.length !== 1 || B.length !== 1)
    throw new RpcError('compare-file-request', 'A text comparison has one file per side');
  env.progress({ done: 0, total: 2 });
  const reader = await PdfReader.open(
    b.bytes,
    env.inflate,
    b.password === undefined ? {} : { password: b.password },
  );
  const level = await certificationLevel(reader);
  // ADR-032 decision 4: a certification that forbids comments; decision 1: a
  // protected A over an open B locks the file, which B's own bytes cannot be.
  const route: TextRoute =
    level === 1 || level === 2 || (req.lock !== undefined && !b.locked) ? 'copy' : 'prefix';
  const bytes = await buildTextFile(fileEnv, {
    A: a,
    B: b,
    marks: req.marks ?? [],
    route,
    fields: req.fields,
    words: req.words,
    when,
    ...(req.lock === undefined ? {} : { lock: req.lock }),
  });
  env.progress({ done: 2, total: 2 });
  return { bytes: ownBuffer(bytes), route, notes: 0 };
}

/** The document as saved, read by our object layer (its own password). */
async function savedReader(env: FileJobEnv, docId: string): Promise<PdfReader> {
  await env.docs.get(docId);
  const password = env.docs.passwordOf(docId);
  const reader = await PdfReader.open(
    env.docs.bytes(docId),
    env.inflate,
    password === undefined ? {} : { password },
  );
  if (!reader.readable) throw new RpcError('pdfium:4', 'The file could not be decrypted');
  return reader;
}

/** Whether an open document is a comparison file (its catalog only). */
export async function compareFileProbe(env: FileJobEnv, docId: string): Promise<Detected | null> {
  return detect(await savedReader(env, docId));
}

export interface ComparisonContents {
  detected: Detected;
  /** The data attachment as JSON text (parsed and checked on the main thread too). */
  data: string;
  A: { bytes: ArrayBuffer; exact: boolean }[];
  B: { bytes: ArrayBuffer; exact: boolean }[];
  foreignRevisions: number;
  /**
   * Overlay: a small PDF of the overlay pages' boxes holding their comments
   * (the overlay notes), unencrypted; null when there are none.
   */
  notes: ArrayBuffer | null;
}

/** Takes a comparison file apart: the data, every input byte for byte, the overlay notes. */
export async function compareFileRead(env: FileJobEnv, docId: string): Promise<ComparisonContents> {
  const reader = await savedReader(env, docId);
  const bytes = env.docs.bytes(docId);
  const opened = await readComparison(reader, bytes);
  await env.slice.checkpoint();
  let notes: ArrayBuffer | null = null;
  if (opened.data.kind === 'overlay') {
    // The sheets' pages only (an optional summary page comes first, M12-21).
    const lead = opened.data.leadingPages ?? 0;
    const pages = (await reader.pages()).slice(lead);
    const boxes = [];
    for (const p of pages) boxes.push(await pageBox(reader, p.dict));
    const skel = skeletonPdf(boxes);
    const tgt = await PdfReader.open(skel, env.inflate);
    const r = await importComments(reader, tgt, skel, {
      withReplies: true,
      noTransform: true,
      offset: -lead,
    });
    if (r.report.roots > 0) notes = ownBuffer(concatBytes([skel, r.tail]));
  }
  const out = (list: typeof opened.A) =>
    list.map((r) => ({ bytes: ownBuffer(r.bytes), exact: r.exact }));
  return {
    detected: opened.detected,
    data: JSON.stringify(opened.data),
    A: out(opened.A),
    B: out(opened.B),
    foreignRevisions: opened.foreignRevisions,
    notes,
  };
}

/**
 * A reopened comparison's notes (M12-12): the blank pages made for its sheets
 * with the comments of the comparison file's overlay pages copied onto them.
 */
export async function compareNotesSeed(
  env: FileJobEnv,
  blank: ArrayBuffer,
  notes: ArrayBuffer,
): Promise<ArrayBuffer> {
  const tgtBytes = new Uint8Array(blank);
  const src = await PdfReader.open(new Uint8Array(notes), env.inflate);
  const tgt = await PdfReader.open(tgtBytes, env.inflate);
  const pages = (await tgt.pages()).length;
  const r = await importComments(src, tgt, tgtBytes, {
    withReplies: true,
    pageMap: (sp) => (sp < pages ? sp : null),
    checkpoint: () => env.slice.checkpoint(),
  });
  return ownBuffer(concatBytes([tgtBytes, r.tail]));
}
