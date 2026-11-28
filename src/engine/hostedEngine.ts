// Main-thread side of the hosted Render worker (ADR-004 decision 2): a Proxy
// implementing EmbedPDF's IPdfiumExecutor that forwards every call to
// render.worker.ts over our RPC, wrapped in EmbedPDF's PdfEngine orchestrator
// (priority queue, encoding). The headless plugins see an ordinary PdfEngine.
import { PdfEngine, type browserImageDataToBlobConverter } from '@embedpdf/engines/pdfium';
import {
  PdfErrorCode,
  Task,
  TaskStage,
  type IPdfiumExecutor,
  type AnnotationAppearanceMap,
  type PageTextSlice,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfPageGeometry,
  type PdfPageObject,
  type PdfTask,
} from '@embedpdf/models';
import { RpcError, isAbortError } from './errors';
import { THIN_METHODS, isMutation } from './mutations';
import { PDFIUM_ERROR_PREFIX, type RenderApi } from './renderApi';
import type { RpcClient } from './rpc';

/** EmbedPDF's Blob image-converter signature (we plug in the encoder worker). */
type ImageConverter = typeof browserImageDataToBlobConverter;

/** EmbedPDF task error from our RpcError (codes survive; messages are fixed). */
function toPdfError(err: unknown): { code: PdfErrorCode; message: string } {
  if (err instanceof RpcError && err.code.startsWith(PDFIUM_ERROR_PREFIX)) {
    const code = Number(err.code.slice(PDFIUM_ERROR_PREFIX.length));
    return { code, message: err.message };
  }
  return { code: PdfErrorCode.Unknown, message: err instanceof Error ? err.message : 'error' };
}

/**
 * Buffers to transfer instead of copy. A structured-clone copy of a 500 MB
 * file would be a main-thread long task (rule 1); after the transfer the
 * caller's buffer is detached.
 */
export function transferablesFor(method: string, args: unknown[]): Transferable[] {
  if (method !== 'openDocumentBuffer') return [];
  const content = (args[0] as { content?: unknown } | undefined)?.content;
  return content instanceof ArrayBuffer ? [content] : [];
}

/**
 * Arguments as sent to the Render worker: an EmbedPDF document object loses
 * its `pages` array. PdfEngine passes the whole document with every call, and
 * cloning 2,000 page entries per render request made zoom thrash a main-thread
 * long task (rule 1); the worker's PDFium engine reads only `id`, `pageCount`
 * and `normalizedRotation` from it.
 */
export function slimArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (!a || typeof a !== 'object' || !('pages' in a) || !Array.isArray(a.pages)) return a;
    if (typeof (a as { id?: unknown }).id !== 'string') return a;
    const rest: Record<string, unknown> = { ...a };
    delete rest['pages'];
    return rest;
  });
}

/**
 * How many calls of each executor method went to the Render worker since the
 * app started (a counter per method name, nothing else). The perf gate in
 * e2e/perf/annotation-load.spec.ts checks that loading every annotation never
 * reaches the Render queue (ADR-014 decision 2), which tile timing alone
 * cannot show reliably on a busy CI machine (issue #59).
 */
export const renderCallCounts = new Map<string, number>();

/** Called after a document-changing call succeeded (the tab's dirty mark, M1-22). */
export type MutationListener = (method: string, docId: string) => void;

/**
 * The render option a view render carries while Thin Lines is on (M13-05, D-69;
 * set where the request is made and cached, renderStats.ts). EmbedPDF passes
 * render options through to the executor unchanged.
 */
export const THIN_OPTION = 'thinLines';

/**
 * A view render that asks for Thin Lines: the call and its arguments as sent
 * (the option taken out), or null when it does not ask.
 */
export function thinCall(method: string, args: unknown[]): unknown[] | null {
  if (!THIN_METHODS.has(method)) return null;
  const at = method === 'renderPageRect' ? 3 : 2;
  const options = args[at];
  if (!options || typeof options !== 'object' || !(THIN_OPTION in options)) return null;
  const { [THIN_OPTION]: thin, ...rest } = options as Record<string, unknown>;
  if (thin !== true) return null;
  const out = [...args];
  out[at] = rest;
  return out;
}

export function createHostedExecutor(
  rpc: RpcClient<RenderApi>,
  onMutation?: MutationListener,
): IPdfiumExecutor {
  return new Proxy({} as IPdfiumExecutor, {
    get(_target, method) {
      if (typeof method !== 'string' || method === 'then') return undefined;
      return (...args: unknown[]) => {
        renderCallCounts.set(method, (renderCallCounts.get(method) ?? 0) + 1);
        const task = new Task<unknown, { code: PdfErrorCode; message: string }>();
        const thinArgs = thinCall(method, args);
        const job = rpc.call(
          'exec',
          thinArgs
            ? { method, args: slimArgs(thinArgs), thin: true }
            : { method, args: slimArgs(args) },
          {
            transfer: transferablesFor(method, args),
            onProgress: (p) => {
              task.progress(p);
            },
          },
        );
        const abort = task.abort.bind(task);
        task.abort = (reason) => {
          job.cancel(); // drops the queued/in-flight call (ADR-004 decision 3)
          abort(reason);
        };
        job.promise.then(
          (value) => {
            if (onMutation && isMutation(method)) {
              const docId = (args[0] as { id?: unknown } | undefined)?.id;
              if (typeof docId === 'string') onMutation(method, docId);
            }
            if (task.state.stage === TaskStage.Pending) task.resolve(value);
          },
          (err: unknown) => {
            if (task.state.stage !== TaskStage.Pending) return;
            if (isAbortError(err))
              task.abort({ code: PdfErrorCode.Cancelled, message: 'cancelled' });
            else task.reject(toPdfError(err));
          },
        );
        return task;
      };
    },
  });
}

/** A running job: its result, and a way to cancel it. */
export interface TextJob<T> {
  promise: Promise<T>;
  cancel(): void;
}

/**
 * Where text geometry comes from instead of the Render worker (ADR-012
 * decision 1). Returning null falls back to the Render worker (e.g. the Work
 * worker has no copy of the document).
 */
export interface TextSource {
  pageGeometry(doc: PdfDocumentObject, page: PdfPageObject): TextJob<PdfPageGeometry> | null;
  textSlices(doc: PdfDocumentObject, slices: PageTextSlice[]): TextJob<string[]> | null;
  /**
   * Every annotation of the document (ADR-014 decision 2), or null to use the
   * Render worker. `fallback` runs the Render worker's own listing.
   */
  allAnnotations?(
    doc: PdfDocumentObject,
    fallback: () => Promise<Record<number, PdfAnnotationObject[]>>,
  ): TextJob<Record<number, PdfAnnotationObject[]>> | null;
}

/** An EmbedPDF task driven by one of our jobs; aborting the task cancels the job. */
export function taskFromJob<T>(job: TextJob<T>): PdfTask<T> {
  const task = new Task<T, { code: PdfErrorCode; message: string }>();
  const abort = task.abort.bind(task);
  task.abort = (reason) => {
    job.cancel();
    abort(reason);
  };
  job.promise.then(
    (value) => {
      if (task.state.stage === TaskStage.Pending) task.resolve(value);
    },
    (err: unknown) => {
      if (task.state.stage !== TaskStage.Pending) return;
      if (isAbortError(err)) task.abort({ code: PdfErrorCode.Cancelled, message: 'cancelled' });
      else task.reject(toPdfError(err));
    },
  );
  return task;
}

/**
 * EmbedPDF's orchestrator with the text-layer calls answered by `text`
 * (the Work worker). Through the Render worker's one-call-at-a-time queue they
 * tripled visible-tile latency (ADR-012 finding 1).
 */
/**
 * Markups whose screen image is entirely ours (M14-07): a measurement Stamp
 * (Angle, Radius, Diameter, Count) is drawn by our annotation tiles and, while
 * selected, by SelectedMeasure; the plugin's own image of it is hidden
 * (app.css). Asking the Render worker for that image anyway queues one task
 * per Stamp, and EmbedPDF sorts its whole queue before each task: a sheet of
 * 1,000 counts kept the main thread busy for over 100 ms per click.
 */
let drawnByUs: ((docId: string, a: PdfAnnotationObject) => boolean) | null = null;

export function setDrawnByUs(
  fn: ((docId: string, a: PdfAnnotationObject) => boolean) | null,
): void {
  drawnByUs = fn;
}

/** A transparent 1 × 1 PNG: the plugin's image of a markup we draw ourselves. */
const BLANK_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

export class RoutedPdfEngine extends PdfEngine {
  private readonly text: TextSource;

  constructor(
    executor: IPdfiumExecutor,
    options: { imageConverter: ImageConverter },
    text: TextSource,
  ) {
    super(executor, options);
    this.text = text;
  }

  override getPageGeometry(doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfPageGeometry> {
    const job = this.text.pageGeometry(doc, page);
    return job ? taskFromJob(job) : super.getPageGeometry(doc, page);
  }

  override getTextSlices(doc: PdfDocumentObject, slices: PageTextSlice[]): PdfTask<string[]> {
    const job = this.text.textSlices(doc, slices);
    return job ? taskFromJob(job) : super.getTextSlices(doc, slices);
  }

  /**
   * plugin-annotation's load of every annotation (ADR-014 decision 2): from the
   * Work worker, not as 500-page uninterruptible chunks on the Render queue.
   */
  override getAllAnnotations(doc: PdfDocumentObject): ReturnType<PdfEngine['getAllAnnotations']> {
    const job = this.text.allAnnotations?.(doc, () => super.getAllAnnotations(doc).toPromise());
    // The plugin only waits on the result; a plain task stands in for the compound one.
    return job
      ? (taskFromJob(job) as unknown as ReturnType<PdfEngine['getAllAnnotations']>)
      : super.getAllAnnotations(doc);
  }

  override renderPageAnnotation(
    doc: PdfDocumentObject,
    page: PdfPageObject,
    annotation: PdfAnnotationObject,
    options?: Parameters<PdfEngine['renderPageAnnotation']>[3],
  ): PdfTask<Blob> {
    if (drawnByUs?.(doc.id, annotation)) {
      const task = new Task<Blob, { code: PdfErrorCode; message: string }>();
      task.resolve(new Blob([BLANK_PNG], { type: 'image/png' }));
      return task;
    }
    return super.renderPageAnnotation(doc, page, annotation, options);
  }

  /**
   * No appearance bitmaps for the stock annotation layer (ADR-014 decision 3):
   * markups are drawn by our annotation tiles, which stay bounded at any zoom.
   */
  override renderPageAnnotations(): PdfTask<AnnotationAppearanceMap<Blob>> {
    const task = new Task<AnnotationAppearanceMap<Blob>, { code: PdfErrorCode; message: string }>();
    task.resolve({});
    return task;
  }
}

export function createPdfEngine(
  rpc: RpcClient<RenderApi>,
  imageConverter: ImageConverter,
  onMutation?: MutationListener,
  text?: TextSource,
): PdfEngine {
  const executor = createHostedExecutor(rpc, onMutation);
  return text
    ? new RoutedPdfEngine(executor, { imageConverter }, text)
    : new PdfEngine(executor, { imageConverter });
}

export type { ImageConverter };
