// The only way to create the render engine (ADR-003 decision 2, ADR-004).
// Spawns the Render worker and the encoder worker, initializes PDFium from the
// single self-hosted pdfium.wasm (ADR-004 decision 6) and returns EmbedPDF's
// PdfEngine for the headless plugins.
import type { PdfEngine } from '@embedpdf/engines/pdfium';
import type { FontFallbackConfig } from '@embedpdf/engines/pdfium';
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { createEncoder } from './encoder';
import { createPdfEngine } from './hostedEngine';
import type { RenderApi } from './renderApi';
import { RpcClient } from './rpc';

export interface RenderEngineOptions {
  /**
   * Required, with no default: `null` (no fallback fonts) or a local config
   * with absolute same-origin URLs (see fonts.ts). `undefined` is rejected,
   * because EmbedPDF treats it as "fetch fonts from jsDelivr" (ADR-003).
   */
  fontFallback: FontFallbackConfig | null;
  /** Absolute URL of pdfium.wasm; defaults to the bundled asset on this origin. */
  wasmUrl?: string;
}

export interface RenderEngine {
  engine: PdfEngine;
  rpc: RpcClient<RenderApi>;
  /** Resolves once PDFium is initialized in the worker. */
  ready: Promise<{ ms: number; wasmBytes: number }>;
  terminate(): void;
}

export const PDFIUM_WASM_URL: string = pdfiumWasmUrl;

export function createRenderEngine(options: RenderEngineOptions): RenderEngine {
  if ((options as { fontFallback?: unknown }).fontFallback === undefined) {
    throw new TypeError(
      'createRenderEngine: fontFallback must be null or a local config (ADR-003)',
    );
  }
  const worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), {
    type: 'module',
    name: 'render',
  });
  const rpc = new RpcClient<RenderApi>(worker, 'render');
  const encoder = createEncoder();
  const wasmUrl = options.wasmUrl ?? new URL(pdfiumWasmUrl, location.origin).href;
  const ready = rpc.call('init', { wasmUrl, fontFallback: options.fontFallback }).promise;
  const engine = createPdfEngine(rpc, encoder.converter);
  return {
    engine,
    rpc,
    ready,
    terminate: () => {
      rpc.dispose();
      worker.terminate();
      encoder.client.dispose();
      encoder.worker.terminate();
    },
  };
}
