import { PdfErrorCode } from '@embedpdf/models';
import { afterEach, describe, expect, it } from 'vitest';
import { createRenderEngine } from '../../src/engine/createEngine';
import { RpcError } from '../../src/engine/errors';
import { createHostedExecutor } from '../../src/engine/hostedEngine';
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

function executorWith(exec: (method: string) => unknown) {
  const ch = new MessageChannel();
  channels.push(ch);
  serve<RenderApi>(ch.port1, {
    init: () => ({ ms: 0, wasmBytes: 0 }),
    contentBox: () => null,
    pageCost: () => ({ objects: 0, segments: 0 }),
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
  return createHostedExecutor(new RpcClient<RenderApi>(ch.port2, 'render'));
}

describe('hosted executor proxy (ADR-004)', () => {
  it('forwards a call and resolves the EmbedPDF task', async () => {
    const ex = executorWith((m) => ({ echoed: m }));
    const task = (
      ex as unknown as Record<string, () => { toPromise(): Promise<unknown> }>
    ).getMetadata?.();
    expect(await task?.toPromise()).toEqual({ echoed: 'getMetadata' });
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

describe('createRenderEngine (ADR-003 decision 2)', () => {
  it('rejects an undefined fontFallback at compile time and at runtime', () => {
    // @ts-expect-error fontFallback is required
    expect(() => createRenderEngine({})).toThrow(TypeError);
    expect(() => createRenderEngine({ fontFallback: undefined as unknown as null })).toThrow(
      /fontFallback must be null or a local config/,
    );
  });
});
