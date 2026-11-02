// M6-04 spikes S18 – S22 (ADR-021): a Node stand-in for the Render worker and
// the Work worker, on the same PDFium WASM the app ships. The tracked executor
// below runs every executor call the way src/workers/render.worker.ts `exec`
// does — permission check (rule 9), stable names, /EPDFCustom dropped, the
// author kept, the save tracker told what changed — so EmbedPDF's PdfEngine
// orchestrator and its plugins drive exactly what the app would. Saves go
// through the app's own flow (prepareSave → Work-worker verification →
// keep-all fallback). Self-made fixtures only (rule 13).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PdfEngine, PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  Task,
  type PdfAnnotationObject,
  type PdfBookmarkObject,
  type PdfDocumentObject,
  type PdfPageObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { finishSave, prepareSave, type SaveFlowDeps } from '../../src/engine/saveFlow.ts';
import {
  dropCustom,
  keepAuthor,
  nameTargets,
  writeMarkupIntent,
} from '../../src/workers/render/annotIds.ts';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium.ts';
import { SaveTracker, isMutation } from '../../src/workers/render/save/tracker.ts';
import { WorkDocs } from '../../src/workers/work/docs.ts';
import { verifyCandidate } from '../../src/workers/work/verify.ts';

/**
 * The plugins use window timers and requestAnimationFrame; Node has neither.
 * Only the plugin spikes install these: a global `window` makes PKI.js look for
 * a browser crypto engine (the signed fixture of S18).
 */
export function installBrowserGlobals(): void {
  Object.assign(globalThis, {
    window: globalThis,
    requestAnimationFrame: (f: (t: number) => void) =>
      setTimeout(() => {
        f(performance.now());
      }, 16),
    cancelAnimationFrame: (id: number) => {
      clearTimeout(id);
    },
  });
}

const require = createRequire(import.meta.url);
const wasmBinary = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));

export const mod: WrappedPdfiumModule = await init({ wasmBinary });
export const native = new PdfiumNative(mod, { fontFallback: null });
export const tracker = new SaveTracker(mod, native);
const workMod: WrappedPdfiumModule = await init({ wasmBinary });
export const workNative = new PdfiumNative(workMod, { fontFallback: null });
export const work = new WorkDocs(() => workNative);

export const ms = (t0: number): number => Math.round((performance.now() - t0) * 10) / 10;
export const tick = (n = 1): Promise<void> => new Promise((r) => setTimeout(r, 30 * n));

type ExecFn = (...a: unknown[]) => Task<unknown, unknown>;

/** One executor call the way the Render worker's `exec` makes it. */
export async function exec<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  if (isMutation(method) && typeof docId === 'string') tracker.checkAllowed(method, docId);
  const fn = (native as unknown as Record<string, ExecFn | undefined>)[method];
  if (typeof fn !== 'function') throw new Error(`unknown executor method ${method}`);
  if (typeof docId === 'string') nameTargets(mod, native, method, args);
  const callArgs =
    typeof docId === 'string' ? keepAuthor(mod, native, method, dropCustom(method, args)) : args;
  const value = (await fn.apply(native, callArgs).toPromise()) as T;
  if (typeof docId === 'string') writeMarkupIntent(mod, native, method, callArgs);
  if (method === 'unlockOwnerPermissions' && value === true && typeof docId === 'string') {
    const pw = args[1];
    if (typeof pw === 'string') tracker.ownerUnlocked(docId, pw);
  }
  if (method === 'openDocumentBuffer') {
    const file = args[0] as { id: string; content: ArrayBuffer };
    const password = (args[1] as { password?: unknown } | undefined)?.password;
    tracker.opened(
      file.id,
      new Uint8Array(file.content),
      typeof password === 'string' ? password : undefined,
    );
  } else if (method === 'closeDocument' && typeof docId === 'string') {
    tracker.closed(docId);
  } else if (isMutation(method)) {
    tracker.recordMutation(method, args);
  }
  return value;
}

/**
 * PdfiumNative with every call routed through `exec`: what the main thread's
 * hosted engine reaches over the RPC (src/engine/hostedEngine.ts).
 */
export const trackedExecutor = new Proxy(native, {
  get(target, prop, receiver) {
    const v = Reflect.get(target, prop, receiver) as unknown;
    if (typeof prop !== 'string' || typeof v !== 'function') return v;
    if (!isMutation(prop) && prop !== 'openDocumentBuffer' && prop !== 'closeDocument')
      return (v as (...a: unknown[]) => unknown).bind(target);
    return (...args: unknown[]) => {
      return wrapPromise(exec(prop, ...args));
    };
  },
});

/** The orchestrator over the tracked executor (what the plugins talk to). */
export const engine = new PdfEngine(trackedExecutor, {
  imageConverter: () => Promise.resolve(new Blob()),
});

function wrapPromise(p: Promise<unknown>): Task<unknown, unknown> {
  const t = new Task<unknown, unknown>();
  p.then(
    (v) => {
      t.resolve(v);
    },
    (e: unknown) => {
      t.reject({ code: 0, message: e instanceof Error ? e.message : String(e) });
    },
  );
  return t;
}

let seq = 0;

/** Opens bytes in the "Render worker" (tracked) and the "Work worker" (verification copy). */
export async function openDoc(
  bytes: Uint8Array,
  password?: string,
  prefix = 'd',
): Promise<PdfDocumentObject> {
  const id = `${prefix}${String(++seq)}`;
  const doc = await exec<PdfDocumentObject>(
    'openDocumentBuffer',
    { id, content: bytes.slice().buffer },
    password === undefined ? {} : { password },
  );
  await tracker.securityReady(id);
  await work.open(id, bytes.slice().buffer, undefined, password);
  return doc;
}

export async function closeDoc(doc: PdfDocumentObject): Promise<void> {
  await exec('closeDocument', doc);
  await work.close(doc.id);
}

/** Plain open for read-back checks (not tracked). */
export async function openPlain(
  bytes: Uint8Array,
  password?: string,
): Promise<{ doc: PdfDocumentObject } | { error: number }> {
  try {
    const doc = await native
      .openDocumentBuffer(
        { id: `p${String(++seq)}`, content: bytes.slice().buffer },
        password === undefined ? {} : { password },
      )
      .toPromise();
    return { doc };
  } catch (e) {
    const code = (e as { reason?: { code?: number } }).reason?.code;
    return { error: typeof code === 'number' ? code : -1 };
  }
}

export const deps = (): SaveFlowDeps => ({
  saveIncremental: async (d, keepAll) => {
    const r = await tracker.save(d, keepAll ? { keepAll } : {});
    return { ...r, tail: r.tail.slice().buffer };
  },
  verify: (d, piece, expected) => verifyCandidate(workMod, workNative, work, d, piece, expected),
  commit: (d, n) => Promise.resolve({ baseLength: tracker.commit(d, n) }),
  refreshWork: (d, piece) => {
    work.append(d, piece);
    return Promise.resolve();
  },
  logFallback: (e) => {
    fallbacks.push(e.code);
  },
});
export const fallbacks: string[] = [];

/** Ctrl+S through the app's save flow; returns the new file (base + tail) and the facts. */
export async function ctrlS(
  doc: PdfDocumentObject,
  base: Uint8Array,
): Promise<{
  bytes: Uint8Array;
  mode: string;
  fellBack: boolean;
  tailBytes: number;
  ms: number;
}> {
  const before = fallbacks.length;
  const t0 = performance.now();
  const r = await prepareSave(doc.id, deps());
  if (!r) return { bytes: base, mode: 'nothing', fellBack: false, tailBytes: 0, ms: ms(t0) };
  await finishSave(r, deps());
  const bytes = new Uint8Array(base.length + r.tail.byteLength);
  bytes.set(base, 0);
  bytes.set(new Uint8Array(r.tail), base.length);
  return {
    bytes,
    mode: r.mode,
    fellBack: r.fellBack || fallbacks.length > before,
    tailBytes: r.tail.byteLength,
    ms: ms(t0),
  };
}

export function permissionsOf(doc: PdfDocumentObject): number {
  return rawCall(mod, 'FPDF_GetDocPermissions', docPtrOf(native, doc.id)) >>> 0;
}
export function securityRevision(doc: PdfDocumentObject): number {
  return rawCall(mod, 'FPDF_GetSecurityHandlerRevision', docPtrOf(native, doc.id));
}

// ---- qpdf -----------------------------------------------------------------------

function tmpFile(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'm6s-'));
  const f = join(dir, 'f.pdf');
  writeFileSync(f, bytes);
  return f;
}

export function qpdf(args: string[], bytes: Uint8Array): { status: number; out: string } {
  const r = spawnSync('qpdf', [...args, tmpFile(bytes)], { maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? -1, out: (r.stdout.toString() + r.stderr.toString()).trim() };
}

/** `qpdf --check`: "ok" or the last lines of the complaint. */
export function qpdfCheck(bytes: Uint8Array, password?: string): string {
  const r = qpdf(['--check', ...(password ? [`--password=${password}`] : [])], bytes);
  // Exit 3 = warnings only.
  if (r.status === 0) return 'ok';
  return `exit ${String(r.status)}: ${r.out.split('\n').slice(-3).join(' | ')}`;
}

/** qpdf's JSON v2 of the (decrypted) file: objects by "obj:N 0 R". */
export function qpdfJson(
  bytes: Uint8Array,
  password?: string,
): { qpdf: [unknown, Record<string, { value?: unknown; stream?: { dict: unknown } }>] } {
  const r = spawnSync(
    'qpdf',
    [
      '--json=2',
      '--json-key=qpdf',
      '--decode-level=none',
      ...(password ? [`--password=${password}`] : []),
      tmpFile(bytes),
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  const text = r.stdout.toString();
  if (!text) throw new Error(`qpdf --json failed: ${r.stderr.toString().trim().slice(0, 300)}`);
  return JSON.parse(text) as never;
}

/** The trailer dict keys qpdf reports, and /Root. */
export function qpdfTrailer(bytes: Uint8Array, password?: string): Record<string, unknown> {
  const j = qpdfJson(bytes, password);
  const t = j.qpdf[1].trailer as { value?: Record<string, unknown> } | undefined;
  return t?.value ?? {};
}

export function obj(
  j: ReturnType<typeof qpdfJson>,
  ref: string,
): Record<string, unknown> | undefined {
  const o = j.qpdf[1][`obj:${ref}`];
  if (!o) return undefined;
  return (o.value ?? o.stream?.dict) as Record<string, unknown> | undefined;
}

/** Count of annotations on each page (PDFium). */
export function annotCounts(doc: PdfDocumentObject): number[] {
  return doc.pages.map((p) => {
    const page = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, doc.id), p.index);
    const n = rawCall(mod, 'FPDFPage_GetAnnotCount', page);
    rawCall(mod, 'FPDF_ClosePage', page);
    return n;
  });
}

export { rawCall, docPtrOf };

/** `v`, or a throw when it is missing (spike code: a fixture assumption broke). */
export function must<T>(v: T | undefined | null, what = 'value'): T {
  if (v === undefined || v === null) throw new Error(`missing ${what}`);
  return v;
}

export const pageOf = (doc: PdfDocumentObject, i = 0): PdfPageObject => must(doc.pages[i], 'page');

export async function annotsOf(doc: PdfDocumentObject, i = 0): Promise<PdfAnnotationObject[]> {
  return (await native
    .getPageAnnotations(doc, pageOf(doc, i))
    .toPromise()) as PdfAnnotationObject[];
}

export async function bookmarksOf(doc: PdfDocumentObject): Promise<PdfBookmarkObject[]> {
  const r = (await native.getBookmarks(doc).toPromise()) as { bookmarks: PdfBookmarkObject[] };
  return r.bookmarks;
}
