// M1-01 spike: EmbedPDF headless plugins (viewport, scroll, render, tiling,
// zoom, spread, rotate, document manager) on top of the *hosted* Render worker
// from ADR-004. Answers the questions in docs/plan/M1.md §M1-01 and records
// numbers for ADR-011. Throwaway — never imported by /src.

import { createElement as h, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPluginRegistration, type PluginRegistry } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import {
  DocumentManagerPluginPackage,
  type DocumentManagerCapability,
} from '@embedpdf/plugin-document-manager/react';
import { ViewportPluginPackage, Viewport } from '@embedpdf/plugin-viewport/react';
import { ScrollPluginPackage, Scroller, type PageLayout } from '@embedpdf/plugin-scroll/react';
import { RenderPluginPackage, RenderLayer } from '@embedpdf/plugin-render/react';
import { TilingPluginPackage, TilingLayer } from '@embedpdf/plugin-tiling/react';
import { ZoomPluginPackage, ZoomMode, type ZoomCapability } from '@embedpdf/plugin-zoom/react';
import {
  SpreadPluginPackage,
  SpreadMode,
  type SpreadCapability,
} from '@embedpdf/plugin-spread/react';
import { RotatePluginPackage, type RotateCapability } from '@embedpdf/plugin-rotate/react';
import type { PdfEngine, Task } from '@embedpdf/models';
import { browserImageDataToBlobConverter } from '@embedpdf/engines/pdfium';
import { createHostedRender } from '../s3-two-engines/hosted-engine.ts';
import { installProbes, probe } from '../shared/probe.ts';

installProbes();

/** Longest side of the low-resolution base ("preview") image, in CSS px. */
const PREVIEW_MAX_PX = 1024;

// ---------------------------------------------------------------- instrumentation

interface RenderStat {
  requested: number;
  done: number;
  aborted: number;
  failed: number;
  latencies: number[];
}
const newStat = (): RenderStat => ({
  requested: 0,
  done: 0,
  aborted: 0,
  failed: 0,
  latencies: [],
});
let tiles = newStat();
let previews = newStat();
let previewPixels: number[] = [];
let blankPageFrames = 0;
let frames = 0;
let frameGaps: number[] = [];

function wrap(engine: PdfEngine, method: 'renderPageRect' | 'renderPage', stat: () => RenderStat) {
  const orig = (engine as unknown as Record<string, (...a: unknown[]) => Task<unknown, unknown>>)[
    method
  ];
  if (!orig) throw new Error(`no ${method}`);
  (engine as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
    const s = stat();
    s.requested++;
    const t0 = performance.now();
    if (method === 'renderPage') {
      const o = args[2] as { scaleFactor?: number; dpr?: number } | undefined;
      const page = args[1] as { size: { width: number; height: number } };
      const k = (o?.scaleFactor ?? 1) * (o?.dpr ?? 1);
      previewPixels.push(Math.round(page.size.width * k * page.size.height * k));
    }
    const task = orig.apply(engine, args);
    task.wait(
      () => {
        s.done++;
        s.latencies.push(performance.now() - t0);
      },
      (e: unknown) => {
        if ((e as { type?: string }).type === 'abort') s.aborted++;
        else s.failed++;
      },
    );
    return task;
  };
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round((s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0) * 10) / 10;
}
const summarize = (s: RenderStat) => ({
  requested: s.requested,
  done: s.done,
  aborted: s.aborted,
  failed: s.failed,
  p50: pct(s.latencies, 50),
  p95: pct(s.latencies, 95),
  max: pct(s.latencies, 100),
});

// ---------------------------------------------------------------- engine + registry

// Absolute URL: the same self-hosted file the other spikes use (ADR-003 finding 3).
const wasmUrl = new URL('/pdfium/pdfium.wasm', location.origin).href;
// ?enc=worker encodes tiles in encoder.worker.ts instead of a main-thread
// canvas; ?type=webp switches the tile/preview image type (default png).
const params = new URLSearchParams(location.search);
const ENC = params.get('enc') === 'worker' ? 'worker' : 'main';
const IMAGE_TYPE = params.get('type') === 'webp' ? 'image/webp' : 'image/png';

function workerConverter(): typeof browserImageDataToBlobConverter {
  const enc = new Worker(new URL('./encoder.worker.ts', import.meta.url), {
    type: 'module',
    name: 'encoder',
  });
  let seq = 0;
  const pending = new Map<number, { resolve: (b: Blob) => void; reject: (e: unknown) => void }>();
  enc.addEventListener(
    'message',
    (ev: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.blob) p.resolve(ev.data.blob);
      else p.reject(new Error(ev.data.error ?? 'encode failed'));
    },
  );
  return (getImageData, imageType = 'image/png', quality) => {
    const img = getImageData();
    // The pixels arrived by transfer from the Render worker, so we own the
    // buffer and can pass it on without a copy.
    const own =
      img.data.byteOffset === 0 && img.data.byteLength === img.data.buffer.byteLength
        ? img.data
        : new Uint8ClampedArray(img.data);
    return new Promise<Blob>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      enc.postMessage(
        { id, data: own, width: img.width, height: img.height, type: imageType, quality },
        [own.buffer],
      );
    });
  };
}

const hosted = createHostedRender(
  wasmUrl,
  ENC === 'worker' ? workerConverter() : browserImageDataToBlobConverter,
);
wrap(hosted.engine, 'renderPageRect', () => tiles);
wrap(hosted.engine, 'renderPage', () => previews);

let registry: PluginRegistry | undefined;
let setActive: (id: string | null) => void = () => undefined;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed lookup helper
const cap = <T>(id: string): T => {
  const p = registry?.getPlugin(id);
  if (!p?.provides) throw new Error(`plugin ${id} not ready`);
  return p.provides() as T;
};

const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage, { maxDocuments: 10 }),
  createPluginRegistration(ViewportPluginPackage, { viewportGap: 10 }),
  createPluginRegistration(ScrollPluginPackage, {}),
  createPluginRegistration(RenderPluginPackage, { defaultImageType: IMAGE_TYPE }),
  createPluginRegistration(TilingPluginPackage, {
    tileSize: 256,
    overlapPx: 2.5,
    extraRings: 0,
    defaultImageType: IMAGE_TYPE,
  }),
  createPluginRegistration(ZoomPluginPackage, {
    defaultZoomLevel: ZoomMode.FitWidth,
    minZoom: 0.01,
    maxZoom: 64,
  }),
  createPluginRegistration(SpreadPluginPackage, {}),
  createPluginRegistration(RotatePluginPackage, {}),
];

function Page({
  documentId,
  layout,
  scale,
}: {
  documentId: string;
  layout: PageLayout;
  scale: number;
}) {
  const maxDim = Math.max(layout.width, layout.height) / scale; // page size in pt
  const previewScale = Math.min(scale, PREVIEW_MAX_PX / maxDim);
  return h(
    'div',
    {
      'data-page': layout.pageIndex,
      style: {
        width: layout.width,
        height: layout.height,
        position: 'relative',
        background: '#fff',
      },
    },
    h(RenderLayer, {
      documentId,
      pageIndex: layout.pageIndex,
      scale: previewScale,
      dpr: 1,
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
    }),
    h(TilingLayer, {
      documentId,
      pageIndex: layout.pageIndex,
      style: { position: 'absolute', inset: 0 },
    }),
  );
}

function DocView({ documentId }: { documentId: string }): ReactNode {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const z = cap<ZoomCapability>('zoom');
    return z.onZoomChange((e) => {
      if (e.documentId === documentId) setScale(e.newZoom);
    });
  }, [documentId]);
  return h(Viewport, {
    documentId,
    id: 'vp',
    style: { width: 1400, height: 900, overflow: 'auto', background: '#ddd' },
    children: h(Scroller, {
      documentId,
      renderPage: (layout: PageLayout) => h(Page, { documentId, layout, scale }),
    }),
  });
}

function App(): ReactNode {
  const [active, setA] = useState<string | null>(null);
  setActive = setA;
  return h(EmbedPDF, {
    engine: hosted.engine,
    plugins,
    onInitialized: async (r: PluginRegistry) => {
      registry = r;
      cap<DocumentManagerCapability>('document-manager').onActiveDocumentChanged((e) => {
        setActive(e.currentDocumentId);
      });
      await Promise.resolve();
    },
    children: () =>
      active ? h(DocView, { key: active, documentId: active }) : h('p', null, 'no document'),
  });
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('no #root');
createRoot(rootEl).render(h(App));

// ---------------------------------------------------------------- scenarios

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const vp = () => {
  const el = document.getElementById('vp');
  if (!el) throw new Error('no viewport');
  return el;
};
const until = async (cond: () => boolean, timeoutMs = 20_000) => {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > timeoutMs) throw new Error('timeout');
    await sleep(10);
  }
  return performance.now() - t0;
};

/** Pages overlapping the viewport that show no loaded image at all. */
function blankVisiblePages(): number {
  const v = vp().getBoundingClientRect();
  let blank = 0;
  for (const el of document.querySelectorAll<HTMLElement>('[data-page]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom < v.top || r.top > v.bottom) continue;
    const img = el.querySelector('img');
    if (!img?.complete) blank++;
  }
  return blank;
}

async function open(url: string, name: string) {
  await until(() => registry !== undefined);
  await hosted.ready;
  const t0 = performance.now();
  const buffer = await (await fetch(url)).arrayBuffer();
  const dm = cap<DocumentManagerCapability>('document-manager');
  const res = await dm.openDocumentBuffer({ buffer, name, documentId: name }).toPromise();
  await res.task.toPromise();
  const opened = performance.now() - t0;
  dm.setActiveDocument(res.documentId);
  await until(() => document.querySelector('[data-page="0"] img') !== null);
  const firstPreview = performance.now() - t0;
  return {
    documentId: res.documentId,
    openMs: Math.round(opened),
    firstPreviewMs: Math.round(firstPreview),
  };
}

function reset() {
  tiles = newStat();
  previews = newStat();
  previewPixels = [];
  blankPageFrames = 0;
  frames = 0;
  frameGaps = [];
  probe.longTasks.length = 0;
}

/** Scroll at a fixed speed for `ms`, counting blank visible pages per frame. */
async function scroll(pxPerSec: number, ms: number) {
  reset();
  const el = vp();
  const t0 = performance.now();
  let last = t0;
  await new Promise<void>((resolve) => {
    const step = (now: number) => {
      frames++;
      frameGaps.push(now - last);
      el.scrollTop += (pxPerSec * (now - last)) / 1000;
      last = now;
      blankPageFrames += blankVisiblePages() > 0 ? 1 : 0;
      if (now - t0 < ms) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  await settle();
  return report();
}

/** Wait until no tile or preview render has been requested for 400 ms. */
async function settle() {
  let lastCount = -1;
  let stableSince = performance.now();
  const t0 = performance.now();
  for (;;) {
    const c = tiles.requested + tiles.done + tiles.aborted + previews.requested + previews.done;
    if (c !== lastCount) {
      lastCount = c;
      stableSince = performance.now();
    }
    if (performance.now() - stableSince > 400) return Math.round(stableSince - t0);
    await sleep(20);
  }
}

async function zoom(level: number | 'fit-page' | 'fit-width') {
  reset();
  const z = cap<ZoomCapability>('zoom');
  z.requestZoom(level as never);
  const sharpMs = await settle();
  return { level, sharpMs, ...(await report()) };
}

async function report() {
  const worker = await hosted.special<Record<string, number>>('stats');
  const variant = { enc: ENC, type: IMAGE_TYPE };
  const mem = await hosted.special<{ wasmBytes: number }>('memory').catch(() => ({ wasmBytes: 0 }));
  return {
    variant,
    tiles: summarize(tiles),
    previews: summarize(previews),
    maxPreviewPixels: Math.max(0, ...previewPixels),
    workerExecuted: {
      renderPageRect: worker.renderPageRect ?? 0,
      renderPage: worker.renderPage ?? 0,
    },
    frames,
    blankPageFrames,
    frameGapP95: pct(frameGaps, 95),
    frameGapMax: pct(frameGaps, 100),
    longTasks: probe.longTasks.map((t) => Math.round(t.duration)),
    csp: probe.cspViolations.length,
    wasmMB: Math.round(mem.wasmBytes / 1e5) / 10,
  };
}

const w = window as unknown as Record<string, unknown>;
w.__s9 = {
  open,
  scroll,
  zoom,
  settle,
  report,
  reset,
  activate: (id: string) => {
    cap<DocumentManagerCapability>('document-manager').setActiveDocument(id);
  },
  close: (id: string) =>
    cap<DocumentManagerCapability>('document-manager').closeDocument(id).toPromise(),
  openIds: () => cap<DocumentManagerCapability>('document-manager').getDocumentOrder(),
  spread: (m: 'none' | 'odd') => {
    cap<SpreadCapability>('spread').setSpreadMode(m === 'odd' ? SpreadMode.Odd : SpreadMode.None);
  },
  rotate: () => {
    cap<RotateCapability>('rotate').rotateForward();
  },
  scrollTo: (top: number) => {
    vp().scrollTop = top;
  },
  zoomNoWait: (level: number) => {
    cap<ZoomCapability>('zoom').requestZoom(level);
  },
  zoomState: () => cap<ZoomCapability>('zoom').getState(),
  blankVisiblePages,
  probe,
};
