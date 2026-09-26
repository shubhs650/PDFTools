// Main-thread side of the hosted Render worker (ADR-004 decision 2): a Proxy
// implementing EmbedPDF's IPdfiumExecutor that forwards every call to
// render.worker.ts over our RPC, wrapped in EmbedPDF's PdfEngine orchestrator
// (priority queue, encoding). The headless plugins see an ordinary PdfEngine.
import { PdfEngine, type browserImageDataToBlobConverter } from '@embedpdf/engines/pdfium';
import { PdfErrorCode, Task, TaskStage, type IPdfiumExecutor } from '@embedpdf/models';
import { RpcError, isAbortError } from './errors';
import { isMutation } from './mutations';
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

/** Called after a document-changing call succeeded (the tab's dirty mark, M1-22). */
export type MutationListener = (method: string, docId: string) => void;

export function createHostedExecutor(
  rpc: RpcClient<RenderApi>,
  onMutation?: MutationListener,
): IPdfiumExecutor {
  return new Proxy({} as IPdfiumExecutor, {
    get(_target, method) {
      if (typeof method !== 'string' || method === 'then') return undefined;
      return (...args: unknown[]) => {
        const task = new Task<unknown, { code: PdfErrorCode; message: string }>();
        const job = rpc.call(
          'exec',
          { method, args: slimArgs(args) },
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

export function createPdfEngine(
  rpc: RpcClient<RenderApi>,
  imageConverter: ImageConverter,
  onMutation?: MutationListener,
): PdfEngine {
  return new PdfEngine(createHostedExecutor(rpc, onMutation), { imageConverter });
}

export type { ImageConverter };
