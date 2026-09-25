// E2E-only probe for the render engine (M1-07). Registered on the test hook;
// never part of a production build. Opens bytes, reads the document record and
// renders page 1 so tests can check fonts, permissions and errors.
import { cdnFontConfig } from '@embedpdf/engines/pdfium';
import { createRenderEngine, PDFIUM_WASM_URL, type RenderEngine } from '../engine/createEngine';
import { RpcError } from '../engine/errors';
import { localFontConfig } from '../engine/fonts';
import { closeDocument, openDocument } from '../engine/renderClient';
import type { TestHook } from './hook';

export type FontMode = 'local' | 'none' | 'cdn-negative-control';

export interface ProbeResult {
  pageCount: number;
  permissions: number;
  signatureCount: number;
  /** Dark pixels on page 1 at 100 % (glyph presence check). */
  ink: number;
  pngBytes: number;
  pngType: string;
}

const engines = new Map<FontMode, RenderEngine>();

function engineFor(mode: FontMode): RenderEngine {
  let r = engines.get(mode);
  if (!r) {
    r = createRenderEngine({
      fontFallback:
        mode === 'local'
          ? localFontConfig(location.origin)
          : mode === 'none'
            ? null
            : cdnFontConfig,
    });
    engines.set(mode, r);
  }
  return r;
}

let seq = 0;

async function openAndRender(
  base64: string,
  mode: FontMode,
  password?: string,
): Promise<ProbeResult | { error: string }> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
  const r = engineFor(mode);
  try {
    const { doc, info } = await openDocument(r, {
      docId: `probe-${String(++seq)}`,
      bytes,
      ...(password === undefined ? {} : { password }),
    });
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const raw = await r.engine.renderPageRaw(doc, page, { scaleFactor: 1 }).toPromise();
    let ink = 0;
    for (let i = 0; i < raw.data.length; i += 4) if ((raw.data[i] ?? 255) < 128) ink++;
    const png = await r.engine.renderPage(doc, page, { scaleFactor: 0.25 }).toPromise();
    await closeDocument(r, doc);
    return { ...info, ink, pngBytes: png.size, pngType: png.type };
  } catch (err) {
    return { error: err instanceof RpcError ? err.code : String(err) };
  }
}

export function registerEngineProbe(hook: TestHook): void {
  hook.capabilities['engine'] = {
    openAndRender,
    wasmUrl: PDFIUM_WASM_URL,
    createWithUndefinedFonts: () => {
      try {
        createRenderEngine({ fontFallback: undefined as unknown as null });
        return 'created';
      } catch (e) {
        return e instanceof TypeError ? 'rejected' : String(e);
      }
    },
  };
}
