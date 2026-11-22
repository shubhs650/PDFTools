// Spike S29: the overlay worker. PDFium renders each revision's tile through
// a matrix into an 8-bit grey bitmap (no comments); then either
//   "worker":     tint + Multiply (+ Fade, Thicken, neutral overlap) here, one
//                 ImageBitmap per tile to the page;
//   "compositor": the two grey tiles go to the page as two ImageBitmaps and the
//                 browser's compositor tints and multiplies them (CSS blend).
// The grey tiles stay cached here, so a style change re-composes without
// rendering again. The main thread only places bitmaps (rule 1).
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  DEFAULT_STYLE,
  compose,
  crop,
  styleTables,
  thicken,
  type OverlapMode,
  type OverlayStyle,
} from './composite';
import { call, openDoc, pageSize, renderPage, type OpenDoc } from './pdfiumKit';
import { tileMatrix } from './sheet';

let mod: WrappedPdfiumModule | undefined;
let A: OpenDoc | undefined;
let B: OpenDoc | undefined;
let pageA = 0;
let pageB = 0;
let style: OverlayStyle = DEFAULT_STYLE;
let mode: OverlapMode = 'multiply';
let thick = false;
let tables = styleTables(DEFAULT_STYLE, 'multiply');
/** Requests of older generations are dropped before they render (cancel). */
let generation = 0;
const grey = new Map<string, { a: Uint8Array; b: Uint8Array }>();
let greyBytes = 0;

export interface TileReq {
  gen: number;
  key: string;
  z: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  route: 'worker' | 'compositor';
}

function rgbaOfGrey(g: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(g.length * 4);
  for (let i = 0, o = 0; i < g.length; i++, o += 4) {
    const v = g[i] ?? 255;
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  }
  return out;
}

function greyTile(r: TileReq): { a: Uint8Array; b: Uint8Array; renderMs: number } {
  const hit = grey.get(r.key);
  if (hit) return { ...hit, renderMs: 0 };
  if (!mod || !A || !B) throw new Error('not open');
  const m = mod;
  const t0 = performance.now();
  // Thicken needs a one-pixel margin so tiles join without seams.
  const mg = thick ? 1 : 0;
  const draw = (d: OpenDoc, page: number) => {
    const pg = call(m, 'FPDF_LoadPage', d.doc, page);
    try {
      return renderPage(
        m,
        pg,
        tileMatrix(r.z, r.tx - mg, r.ty - mg),
        r.w + 2 * mg,
        r.h + 2 * mg,
        true,
      );
    } finally {
      call(m, 'FPDF_ClosePage', pg);
    }
  };
  let a = draw(A, pageA);
  let b = draw(B, pageB);
  if (thick) {
    a = crop(thicken(a, r.w + 2, r.h + 2), r.w + 2, 1, r.w, r.h);
    b = crop(thicken(b, r.w + 2, r.h + 2), r.w + 2, 1, r.w, r.h);
  }
  const t = { a, b };
  grey.set(r.key, t);
  greyBytes += a.length + b.length;
  return { ...t, renderMs: performance.now() - t0 };
}

const handlers = {
  async init(args: { wasmUrl: string }) {
    const wasmBinary = await (await fetch(args.wasmUrl)).arrayBuffer();
    mod = await init({ wasmBinary });
    call(mod, 'PDFiumExt_Init');
    return true;
  },
  async open(args: { a: string; b: string; pwA?: string; pwB?: string; page?: number }) {
    if (!mod) throw new Error('no PDFium');
    A?.close();
    B?.close();
    grey.clear();
    greyBytes = 0;
    const fetchBytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
    A = openDoc(mod, await fetchBytes(args.a), args.pwA ?? '');
    B = openDoc(mod, await fetchBytes(args.b), args.pwB ?? '');
    pageA = args.page ?? 0;
    pageB = args.page ?? 0;
    return pageSize(mod, B.doc, pageB);
  },
  cancel(args: { gen: number }) {
    generation = args.gen;
    return true;
  },
  setStyle(args: { style: OverlayStyle; mode: OverlapMode; thick: boolean }) {
    const t0 = performance.now();
    if (args.thick !== thick) {
      grey.clear();
      greyBytes = 0;
    }
    style = args.style;
    mode = args.mode;
    thick = args.thick;
    tables = styleTables(style, mode);
    return performance.now() - t0;
  },
  tile(r: TileReq) {
    // Queued, and served one per task after every waiting message has been
    // read: a cancel that arrives behind stale requests still drops them.
    return new Promise((resolve) => {
      queue.push({ r, resolve });
      pump();
    });
  },
  async tileNow(r: TileReq) {
    if (r.gen < generation) return { dropped: true };
    const g = greyTile(r);
    const t1 = performance.now();
    if (r.route === 'compositor') {
      const [ba, bb] = await Promise.all([
        createImageBitmap(new ImageData(rgbaOfGrey(g.a), r.w, r.h)),
        createImageBitmap(new ImageData(rgbaOfGrey(g.b), r.w, r.h)),
      ]);
      return {
        transfer: [ba, bb],
        a: ba,
        b: bb,
        renderMs: g.renderMs,
        composeMs: performance.now() - t1,
      };
    }
    const rgba = compose(g.a, g.b, r.w, r.h, tables) as Uint8ClampedArray<ArrayBuffer>;
    const bmp = await createImageBitmap(new ImageData(rgba, r.w, r.h));
    return { transfer: [bmp], bmp, renderMs: g.renderMs, composeMs: performance.now() - t1 };
  },
  stats() {
    return {
      greyTiles: grey.size,
      greyBytes,
      heap: (mod?.pdfium as unknown as { HEAPU8?: Uint8Array } | undefined)?.HEAPU8?.length ?? 0,
    };
  },
};

const queue: { r: TileReq; resolve: (v: unknown) => void }[] = [];
let pumping = false;
const nextTask = () =>
  new Promise<void>((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      res();
    };
    ch.port2.postMessage(null);
  });
function pump(): void {
  if (pumping) return;
  pumping = true;
  void (async () => {
    for (;;) {
      await nextTask();
      const job = queue.shift();
      if (!job) break;
      job.resolve(await handlers.tileNow(job.r));
    }
    pumping = false;
  })();
}

type Handler = (args: never) => unknown;
self.onmessage = async (
  e: MessageEvent<{ id: number; method: keyof typeof handlers; args: unknown }>,
) => {
  const { id, method, args } = e.data;
  try {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- handlers use no `this`
    const fn = handlers[method] as Handler;
    const value = await fn(args as never);
    const transfer = (value as { transfer?: Transferable[] } | null)?.transfer ?? [];
    if (value && typeof value === 'object' && 'transfer' in value)
      delete (value as { transfer?: unknown }).transfer;
    (self as unknown as Worker).postMessage({ id, value }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
