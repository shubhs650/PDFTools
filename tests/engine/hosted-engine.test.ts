import { PdfErrorCode } from '@embedpdf/models';
import { afterEach, describe, expect, it } from 'vitest';
import { createRenderEngine } from '../../src/engine/createEngine';
import { RpcError } from '../../src/engine/errors';
import { createHostedExecutor, slimArgs } from '../../src/engine/hostedEngine';
import type { RenderApi } from '../../src/engine/renderApi';
import { RpcClient } from '../../src/engine/rpc';
import { serve } from '../../src/workers/rpc-host';

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const c of channels.splice(0)) {
    c.port1.close();
    c.port2.close();
  }
});

function executorWith(
  exec: (method: string) => unknown,
  onMutation?: (method: string, docId: string) => void,
) {
  const ch = new MessageChannel();
  channels.push(ch);
  serve<RenderApi>(ch.port1, {
    init: () => ({ ms: 0, wasmBytes: 0 }),
    contentBox: () => null,
    pageCost: () => ({ objects: 0, segments: 0 }),
    saveIncremental: () => {
      throw new Error('not used');
    },
    commitSave: () => ({ baseLength: 0 }),
    saveRewrite: () => {
      throw new Error('not used');
    },
    saveState: () => ({ dirty: [], untracked: false, baseLength: 0 }),
    renderProgressive: () => {
      throw new Error('not used');
    },
    exec: async ({ method }, ctx) => {
      if (method === 'slow') {
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener('abort', () => {
            resolve();
          });
        });
        return null;
      }
      return exec(method);
    },
    docInfo: () => ({ pageCount: 0, permissions: 0, signatureCount: 0 }),
    memory: () => ({ wasmBytes: 0 }),
  });
  return createHostedExecutor(new RpcClient<RenderApi>(ch.port2, 'render'), onMutation);
}

describe('hosted executor proxy (ADR-004)', () => {
  it('forwards a call and resolves the EmbedPDF task', async () => {
    const ex = executorWith((m) => ({ echoed: m }));
    const task = (
      ex as unknown as Record<string, () => { toPromise(): Promise<unknown> }>
    ).getMetadata?.();
    expect(await task?.toPromise()).toEqual({ echoed: 'getMetadata' });
  });

  it('reports successful document changes (the dirty mark, M1-22), not reads or failures', async () => {
    const seen: string[] = [];
    const ex = executorWith(
      (m) => {
        if (m === 'removePageAnnotation') throw new RpcError('pdfium:5', 'refused');
        return true;
      },
      (method, docId) => seen.push(`${method}:${docId}`),
    ) as unknown as Record<string, (...a: unknown[]) => { toPromise(): Promise<unknown> }>;
    const doc = { id: 'd1' };
    await ex.createPageAnnotation?.(doc, { index: 0 }, {}).toPromise();
    await ex.getPageAnnotations?.(doc, { index: 0 }).toPromise();
    await ex
      .removePageAnnotation?.(doc, { index: 0 }, {})
      .toPromise()
      .catch(() => undefined);
    expect(seen).toEqual(['createPageAnnotation:d1']);
  });

  it('turns a pdfium:<code> RpcError back into the PdfErrorCode (e.g. password)', async () => {
    const ex = executorWith(() => {
      throw new RpcError(`pdfium:${String(PdfErrorCode.Password)}`, 'PDFium error 4');
    });
    const task = ex.openDocumentBuffer({ id: 'x', content: new ArrayBuffer(0) });
    const err = await task.toPromise().catch((e: unknown) => e);
    expect((err as { reason?: { code?: number } }).reason?.code).toBe(PdfErrorCode.Password);
  });

  it('aborting the EmbedPDF task cancels the worker call', async () => {
    const ex = executorWith(() => null);
    const task = (
      ex as unknown as Record<
        string,
        () => { abort(r: unknown): void; toPromise(): Promise<unknown> }
      >
    ).slow?.();
    task?.abort({ code: PdfErrorCode.Cancelled, message: 'x' });
    const err = await task?.toPromise().catch((e: unknown) => e);
    expect((err as { reason?: { code?: number } }).reason?.code).toBe(PdfErrorCode.Cancelled);
  });
});

describe('slimArgs (rule 1)', () => {
  it('drops the pages array of a document argument and leaves everything else', () => {
    const pages = Array.from({ length: 2000 }, (_, index) => ({ index }));
    const doc = { id: 'd1', pageCount: 2000, normalizedRotation: false, pages };
    const page = pages[3];
    const file = { id: 'f', content: new ArrayBuffer(8) };
    const [slim, p, opts, f] = slimArgs([doc, page, { scaleFactor: 2 }, file]);
    expect(slim).toEqual({ id: 'd1', pageCount: 2000, normalizedRotation: false });
    expect(p).toBe(page);
    expect(opts).toEqual({ scaleFactor: 2 });
    expect(f).toBe(file);
    expect(doc.pages).toBe(pages); // the caller's object is untouched
  });
});

describe('createRenderEngine (ADR-003 decision 2)', () => {
  it('rejects an undefined fontFallback at compile time and at runtime', () => {
    // @ts-expect-error fontFallback is required
    expect(() => createRenderEngine({})).toThrow(TypeError);
    expect(() => createRenderEngine({ fontFallback: undefined as unknown as null })).toThrow(
      /fontFallback must be null or a local config/,
    );
  });
});
