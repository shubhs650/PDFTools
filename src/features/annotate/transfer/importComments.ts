// Comment → Import Comments (M4-20, §7.1, ADR-018): comments from another PDF
// (never opened as a tab; a password if encrypted; its copy permission, rule
// 9) or from our JSON v1 export, into the active document as one undo step.
// A PDF source goes through the Work worker's object copy and the Render
// worker's reopen (ADR-018 decisions 2–4: every appearance, reply, state and
// measurement travels as is); a JSON source is re-created through the
// annotation plugin (PDFium draws the appearances, rule 6). The main thread
// only sends options and receives counts (rule 1); both are cancellable.
import type { PdfAnnotationObject, PdfAnnotationState } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore } from '../../../app/store/documentStore';
import { RpcError } from '../../../engine/errors';
import { msg, t, type MessageKey } from '../../../i18n';
import { pickCommentSource } from '../../../storage/fileAccess';
import type { SourceSummary, TransferSpec } from '../../../workers/work/transferJobs';
import {
  runBusy,
  runTransfer,
  showPagesError,
  syncLive,
  transferBlocked,
} from '../../pages/pageOps';
import { workClient } from '../../view/host';
import { objectsOf } from '../comments/commentsStore';
import { makeState } from '../comments/thread';
import { STATUS_KEYS } from '../comments/statusLabels';
import { joinStep } from '../historyJoin';
import { annotationCapability, annotationState } from '../selection';
import {
  latestState,
  parseAnnotationJson,
  planJsonImport,
  reviveModel,
  type JsonError,
  type JsonRecord,
} from './jsonImport';
import { announceTransfer } from './transferAnnounce';

export interface SummaryComment {
  page: number;
  author: string;
  /** Lower-case subtype ("square"). */
  type: string;
  state: string | null;
  replies: number;
}

export interface ImportSource {
  kind: 'pdf' | 'json';
  name: string;
  /** PDF: the file (kept here, never opened as a tab). */
  bytes?: ArrayBuffer;
  password?: string;
  needsPassword: boolean;
  wrongPassword: boolean;
  /** The PDF doesn't allow copying with the password given (rule 9). */
  restricted: boolean;
  /** Source page count (JSON: the export's, else its highest page). */
  pages: number;
  comments: SummaryComment[];
  records?: JsonRecord[];
  /** The file could not be used. */
  error?: MessageKey;
}

export interface ImportOptions {
  /** 0-based source pages; null: all. */
  pages: number[] | null;
  /** null: everyone. */
  authors: string[] | null;
  /** Lower-case types; null: all. */
  types: string[] | null;
  withReplies: boolean;
  offset: number;
}

export interface ImportCounts {
  selected: number;
  roots: number;
  skipped: { duplicate: number; missingPage: number; unsupported: number };
}

interface State {
  docId: string | null;
  source: ImportSource | null;
  loading: boolean;
  preview: ImportCounts | null;
}

export const importStore = createStore<State>()(() => ({
  docId: null,
  source: null,
  loading: false,
  preview: null,
}));

export function useImport<T>(selector: (s: State) => T): T {
  return useStore(importStore, selector);
}

export function openImportComments(docId: string): void {
  if (!documentStore.getState().docs[docId]) return;
  importStore.setState({ docId, source: null, loading: false, preview: null });
}

export function closeImportComments(): void {
  importStore.setState({ docId: null, source: null, loading: false, preview: null });
}

const JSON_ERRORS: Record<JsonError, MessageKey> = {
  syntax: msg('transfer.json.syntax'),
  format: msg('transfer.json.format'),
  version: msg('transfer.json.version'),
  shape: msg('transfer.json.shape'),
  tooLarge: msg('transfer.json.tooLarge'),
};

const isJson = (f: File) => /\.json$/iu.test(f.name) || f.type === 'application/json';

/** The user picks the source; a PDF is summarized in the Work worker, a JSON file here. */
export async function chooseSource(): Promise<void> {
  const file = await pickCommentSource();
  if (!file) return;
  importStore.setState({ loading: true, preview: null });
  try {
    const source = isJson(file)
      ? await readJson(file)
      : await readPdf(file.name, await file.arrayBuffer());
    importStore.setState({ source, loading: false });
  } catch (err) {
    recordError('transfer.source', err);
    importStore.setState({
      loading: false,
      source: {
        kind: 'pdf',
        name: file.name,
        needsPassword: false,
        wrongPassword: false,
        restricted: false,
        pages: 0,
        comments: [],
        error: msg('transfer.unreadable'),
      },
    });
  }
}

async function readJson(file: File): Promise<ImportSource> {
  const base = {
    kind: 'json' as const,
    name: file.name,
    needsPassword: false,
    wrongPassword: false,
    restricted: false,
  };
  const r = parseAnnotationJson(await file.text());
  if (!r.ok) return { ...base, pages: 0, comments: [], error: JSON_ERRORS[r.error] };
  const records = r.doc.records;
  const maxPage = records.reduce((m, x) => Math.max(m, x.page + 1), 0);
  return {
    ...base,
    pages: Math.max(r.doc.pages ?? 0, maxPage),
    records,
    comments: records.map((x) => ({
      page: x.page,
      author: x.author ?? '',
      type: x.type,
      state: latestState(x),
      replies: x.replies.length,
    })),
  };
}

async function readPdf(name: string, bytes: ArrayBuffer, password?: string): Promise<ImportSource> {
  const base = { kind: 'pdf' as const, name, bytes, needsPassword: false, wrongPassword: false };
  let s: SourceSummary;
  try {
    s = await workClient().run('commentSource', {
      bytes: bytes.slice(0),
      ...(password === undefined ? {} : { password }),
    }).promise;
  } catch (err) {
    if (err instanceof RpcError && err.code === 'pdfium:4')
      return {
        ...base,
        needsPassword: true,
        wrongPassword: password !== undefined,
        restricted: false,
        pages: 0,
        comments: [],
      };
    throw err;
  }
  return {
    ...base,
    ...(password === undefined ? {} : { password }),
    restricted: !s.copyAllowed,
    pages: s.pages,
    comments: s.comments.map((c) => ({
      page: c.page,
      author: c.author,
      type: c.type,
      state: c.state,
      replies: c.replies,
    })),
  };
}

/** A password for the chosen PDF (to open it, or its owner password for copying). */
export async function unlockSource(password: string): Promise<void> {
  const src = importStore.getState().source;
  if (!src?.bytes) return;
  importStore.setState({ loading: true });
  try {
    importStore.setState({ source: await readPdf(src.name, src.bytes, password), loading: false });
  } catch (err) {
    recordError('transfer.source', err);
    importStore.setState({ loading: false, source: { ...src, error: msg('transfer.unreadable') } });
  }
}

const specOf = (o: ImportOptions, dryRun: boolean): TransferSpec => ({
  ...(o.pages ? { pages: o.pages } : {}),
  ...(o.authors ? { authors: o.authors } : {}),
  ...(o.types ? { types: o.types } : {}),
  withReplies: o.withReplies,
  offset: o.offset,
  ...(dryRun ? { dryRun: true } : {}),
});

const existingIds = (docId: string): Set<string> => {
  const st = annotationState(docId);
  return new Set(st ? objectsOf(st.byUid).map((a) => a.id) : []);
};

function jsonPlan(docId: string, src: ImportSource, o: ImportOptions) {
  return planJsonImport(src.records ?? [], {
    ...(o.pages ? { pages: new Set(o.pages) } : {}),
    ...(o.authors ? { authors: new Set(o.authors) } : {}),
    ...(o.types ? { types: new Set(o.types) } : {}),
    offset: o.offset,
    withReplies: o.withReplies,
    targetPages: documentStore.getState().docs[docId]?.meta.pageCount ?? 0,
    existing: existingIds(docId),
  });
}

let previewSeq = 0;

/** The dialog's preview: what these options import and skip (latest request wins). */
export async function previewImport(o: ImportOptions): Promise<void> {
  const { docId, source } = importStore.getState();
  if (!docId || !source || source.error || source.needsPassword || source.restricted) return;
  const seq = ++previewSeq;
  try {
    let counts: ImportCounts;
    if (source.kind === 'json') {
      const c = jsonPlan(docId, source, o).counts;
      counts = { selected: c.selected, roots: c.roots, skipped: c.skipped };
    } else {
      if (!source.bytes) return;
      await syncLive(docId);
      const r = await workClient().run('transferComments', {
        docId,
        source: {
          bytes: source.bytes.slice(0),
          ...(source.password === undefined ? {} : { password: source.password }),
        },
        spec: specOf(o, true),
      }).promise;
      counts = {
        selected: r.counts.selected,
        roots: r.counts.roots,
        skipped: {
          duplicate: r.counts.skipped.duplicate,
          missingPage: r.counts.skipped.missingPage,
          unsupported: 0,
        },
      };
    }
    if (seq === previewSeq) importStore.setState({ preview: counts });
  } catch (err) {
    recordError('transfer.preview', err);
    if (seq === previewSeq) importStore.setState({ preview: null });
  }
}

/** Import with the dialog's options; the dialog closes first (progress shows its own). */
export async function runImport(o: ImportOptions): Promise<void> {
  const { docId, source } = importStore.getState();
  if (!docId || !source) return;
  closeImportComments();
  const blocked = transferBlocked(docId);
  if (blocked) {
    showPagesError(blocked);
    return;
  }
  try {
    const roots =
      source.kind === 'json'
        ? await importJson(docId, source, o)
        : await importPdf(docId, source, o);
    if (roots !== null) announceTransfer(docId, t('transfer.imported', { count: roots }));
  } catch (err) {
    recordError('transfer.import', err);
    showPagesError(msg('transfer.failed'));
  }
}

async function importPdf(
  docId: string,
  src: ImportSource,
  o: ImportOptions,
): Promise<number | null> {
  const bytes = src.bytes;
  if (!bytes) return null;
  let roots = 0;
  const ok = await runTransfer(docId, msg('transfer.importing'), async (progress, onCancel) => {
    const job = workClient().run(
      'transferComments',
      {
        docId,
        source: {
          bytes: bytes.slice(0),
          ...(src.password === undefined ? {} : { password: src.password }),
        },
        spec: specOf(o, false),
      },
      { onProgress: progress },
    );
    onCancel(() => {
      job.cancel();
    });
    const r = await job.promise;
    roots = r.counts.roots;
    return { objects: r.objects, firstNew: r.firstNew };
  });
  return ok ? roots : null;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Re-creates the planned comments through the annotation plugin, 25 per task
 * (rule 1); the first call makes the undo step and the rest join it. Cancel
 * stops after the current batch (what was made stays, as one step).
 */
async function importJson(
  docId: string,
  src: ImportSource,
  o: ImportOptions,
): Promise<number | null> {
  const scope = annotationCapability()?.forDocument(docId);
  if (!scope) return null;
  const { items } = jsonPlan(docId, src, o);
  if (items.length === 0) return 0;
  let made = 0;
  await runBusy(docId, msg('transfer.importing'), async (progress, onCancel) => {
    const stop = { cancelled: false };
    onCancel(() => {
      stop.cancelled = true;
    });
    let first: PdfAnnotationObject | null = null;
    const create = (a: PdfAnnotationObject) => {
      if (a === first) scope.createAnnotation(a.pageIndex, a);
      else
        joinStep(() => {
          scope.createAnnotation(a.pageIndex, a);
        });
    };
    for (const [i, item] of items.entries()) {
      if (stop.cancelled) break;
      const parent = reviveModel(item.record.annotation, item.target);
      first ??= parent;
      create(parent);
      for (const r of item.replies) create(reviveModel(r.annotation, item.target));
      for (const s of item.record.states) {
        const state = s.state as PdfAnnotationState;
        const author = s.author ?? '';
        const key = (STATUS_KEYS as Partial<Record<string, MessageKey>>)[s.state];
        const label = key ? t(key) : s.state;
        create(
          makeState(
            parent,
            state,
            author,
            t('comments.stateSetBy', { state: label, author }),
            s.date ? new Date(s.date) : new Date(),
            s.id,
          ),
        );
      }
      made++;
      if ((i + 1) % 25 === 0) {
        progress({ done: i + 1, total: items.length });
        await tick();
      }
    }
  });
  if (made > 0) documentStore.getState().markDirty(docId);
  return made;
}
