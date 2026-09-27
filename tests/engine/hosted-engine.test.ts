import { PdfErrorCode } from '@embedpdf/models';
import { afterEach, describe, expect, it } from 'vitest';
import { createRenderEngine } from '../../src/engine/createEngine';
import { RpcError } from '../../src/engine/errors';
import {
  RoutedPdfEngine,
  createHostedExecutor,
  slimArgs,
  type TextSource,
} from '../../src/engine/hostedEngine';
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
    snapshotTail: () => ({ tail: new ArrayBuffer(0), baseLength: 0 }),
    saveState: () => ({ dirty: [], untracked: false, baseLength: 0, staged: 0 }),
    stageObjects: () => ({ staged: 0 }),
    annotationTile: () => null,
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
    docInfo: () => ({
      pageCount: 0,
      permissions: 0,
      securityRevision: -1,
      ownerUnlocked: false,
      formType: 0,
      signatureCount: 0,
    }),
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

describe('RoutedPdfEngine: text geometry off the Render queue (ADR-012 decision 1)', () => {
  const doc = { id: 'd', pageCount: 1, pages: [] } as unknown as Parameters<
    RoutedPdfEngine['getPageGeometry']
  >[0];
  const page = { index: 0 } as unknown as Parameters<RoutedPdfEngine['getPageGeometry']>[1];
  const converter = () => Promise.resolve(new Blob());

  it('answers getPageGeometry and getTextSlices from the text source; the executor is never called', async () => {
    const called: string[] = [];
    let cancelled = 0;
    const text: TextSource = {
      pageGeometry: () => ({ promise: Promise.resolve({ runs: [] }), cancel: () => cancelled++ }),
      textSlices: (_d, slices) => ({
        promise: Promise.resolve(slices.map(() => 'abc')),
        cancel: () => cancelled++,
      }),
    };
    const engine = new RoutedPdfEngine(
      executorWith((m) => {
        called.push(m);
        return null;
      }),
      { imageConverter: converter },
      text,
    );
    expect(await engine.getPageGeometry(doc, page).toPromise()).toEqual({ runs: [] });
    expect(
      await engine.getTextSlices(doc, [{ pageIndex: 0, charIndex: 0, charCount: 3 }]).toPromise(),
    ).toEqual(['abc']);
    expect(called).toEqual([]);
    expect(cancelled).toBe(0);
  });

  it('falls back to the Render worker when the source has no copy; aborting cancels the job', async () => {
    const called: string[] = [];
    let cancelled = 0;
    let serve = true;
    const text: TextSource = {
      pageGeometry: () =>
        serve ? { promise: new Promise(() => undefined), cancel: () => cancelled++ } : null,
      textSlices: () => null,
    };
    const engine = new RoutedPdfEngine(
      executorWith((m) => {
        called.push(m);
        return { runs: [{ fromRender: true }] };
      }),
      { imageConverter: converter },
      text,
    );
    const pending = engine.getPageGeometry(doc, page);
    pending.abort({ code: PdfErrorCode.Cancelled, message: 'x' });
    expect(cancelled).toBe(1);
    serve = false;
    expect(await engine.getPageGeometry(doc, page).toPromise()).toEqual({
      runs: [{ fromRender: true }],
    });
    expect(called).toEqual(['getPageGeometry']);
  });

  it('a refused job rejects with its PDFium code (copy denied, rule 9)', async () => {
    const text: TextSource = {
      pageGeometry: () => null,
      textSlices: () => ({
        promise: Promise.reject(new RpcError(`pdfium:${String(PdfErrorCode.Security)}`, 'no')),
        cancel: () => undefined,
      }),
    };
    const engine = new RoutedPdfEngine(
      executorWith(() => null),
      { imageConverter: converter },
      text,
    );
    const err = await engine
      .getTextSlices(doc, [])
      .toPromise()
      .catch((e: unknown) => e);
    expect((err as { reason?: { code?: number } }).reason?.code).toBe(PdfErrorCode.Security);
  });
});
