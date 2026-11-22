// Spike S27 (M12-02): several documents on screen together. The app's real
// view layer (DocumentHost, DocumentView with every layer, its context menus,
// the comment tools, undo and shortcuts) mounted once per window over the
// one plugin registry and the shared Render and Work workers (route 1:
// EmbedPDF's own per-document viewports). Driven by s27.spec.ts through
// window.__s27 and the real mouse and keyboard.
import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore, useStore } from 'zustand';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { ZoomCapability } from '@embedpdf/plugin-zoom';
import '../../src/app/app.css';
import { initTheme } from '../../src/app/theme';
import { installTestHook } from '../../src/testing/hook';
import { UiProvider } from '../../src/ui/components';
import { DocumentHost } from '../../src/features/view/DocumentHost';
import { DocumentView } from '../../src/features/view/DocumentView';
import { capability, hostStore, tileCache, whenRegistry } from '../../src/features/view/host';
import { documentStore } from '../../src/app/store/documentStore';
import { appStore } from '../../src/app/store/appStore';
import { openFiles } from '../../src/features/open/openDocument';
import { useShortcuts } from '../../src/app/keys/useShortcuts';
import { registerBuiltinCommands } from '../../src/app/commands/builtins';
import { registerAnnotateCommands } from '../../src/features/annotate/commands';
import { registerSelectionCommands } from '../../src/features/select/commands';
import { registerViewCommands } from '../../src/features/view/commands';
import { installProbes, probe } from '../shared/probe';
import { Linker, centreOn, pageSize, sameScale, viewCentre } from './follow.ts';
import { installKeyedTiles } from './keyedTiles.ts';
import { invert, similarity, toPageCoords, IDENTITY, type Affine, type Pt } from './link.ts';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import './s27.css';

type Kind = 'single' | 'two' | 'three';
interface LayoutState {
  kind: Kind;
  /** single: [doc]; two: [A, B]; three: [overlay, A, B]. */
  ids: string[];
}
const layoutStore = createStore<LayoutState>()(() => ({ kind: 'single', ids: [] }));

const linker = new Linker();

/** The window the user works in is the app's active document: commands, menus and undo act on it. */
function focusDoc(id: string): void {
  if (documentStore.getState().activeId !== id) documentStore.getState().activate(id);
  const registry = hostStore.getState().registry;
  if (registry) {
    const dm = capability<DocumentManagerCapability>(registry, 'document-manager');
    if (dm.isDocumentOpen(id) && dm.getActiveDocumentId() !== id) dm.setActiveDocument(id);
  }
  tileCache.setActive(id);
  linker.lead(id);
}

function Window({ id, role }: { id: string; role: string }) {
  return (
    <section
      className="s27-window"
      data-s27-doc={id}
      data-s27-role={role}
      aria-label={role}
      onPointerDownCapture={() => {
        focusDoc(id);
      }}
      onWheelCapture={() => {
        focusDoc(id);
      }}
      onFocusCapture={() => {
        focusDoc(id);
      }}
    >
      <DocumentView documentId={id} />
    </section>
  );
}

const ROLES: Record<Kind, string[]> = {
  single: ['tab'],
  two: ['docA', 'docB'],
  three: ['overlay', 'docA', 'docB'],
};

function Area() {
  const { kind, ids } = useStore(layoutStore);
  const registry = useStore(hostStore, (s) => s.registry);
  if (!registry || ids.length === 0) return <p className="s27-empty">S27</p>;
  return (
    <div className={`s27-area s27-${kind}`}>
      {ids.map((id, i) => (
        <Window key={`${kind}-${String(i)}-${id}`} id={id} role={ROLES[kind][i] ?? 'x'} />
      ))}
    </div>
  );
}

function Harness({ children }: { children: ReactNode }) {
  useEffect(() => registerBuiltinCommands(), []);
  useEffect(() => registerViewCommands(), []);
  useEffect(() => registerSelectionCommands(), []);
  useEffect(() => registerAnnotateCommands(), []);
  useShortcuts();
  return children;
}

// ------------------------------------------------------------- test API

async function open(names: string[]): Promise<string[]> {
  await whenRegistry();
  const files = await Promise.all(
    names.map(async (n) => {
      const res = await fetch(`/corpus/${n}`);
      return new File([await res.blob()], n, { type: 'application/pdf' });
    }),
  );
  const ids = await openFiles(files.map((file) => ({ file })));
  return ids.map((id) => {
    if (!id) throw new Error('open failed');
    return id;
  });
}

function layout(kind: Kind, ids: string[]): void {
  linker.detach();
  layoutStore.setState({ kind, ids });
  if (ids[0]) focusDoc(ids[0]);
}

interface Frame {
  k: number;
  deg: number;
  tx: number;
  ty: number;
  /** The document is the reference moved by this similarity: use its inverse. */
  inverse?: boolean;
}

/**
 * Each document's frame → the reference's (the last entry), as user-space
 * similarities per document; null = the same frame.
 */
function link(frames: Record<string, Frame | null>) {
  const out: Record<string, Affine> = {};
  const ref = Object.keys(frames).at(-1);
  const hRef = ref ? pageSize(ref)?.height : undefined;
  if (!hRef) throw new Error('no reference page');
  for (const [id, f] of Object.entries(frames)) {
    const h = pageSize(id)?.height;
    if (!h) throw new Error(`no page for ${id}`);
    if (!f) {
      out[id] = IDENTITY;
      continue;
    }
    const user = similarity(f.k, f.deg, f.tx, f.ty);
    out[id] = toPageCoords(f.inverse ? invert(user) : user, h, hRef);
  }
  linker.attach(out);
}

function zoom(id: string, level: number): void {
  const r = hostStore.getState().registry;
  if (!r) return;
  focusDoc(id);
  capability<ZoomCapability>(r, 'zoom').forDocument(id).requestZoom(level);
}

/** Visible pages of a window whose tiles have all loaded, and its tile count. */
function tiles(id: string): { imgs: number; complete: number; previews: number } {
  const w = document.querySelector(`[data-s27-doc="${id}"]`);
  const imgs = [...(w?.querySelectorAll<HTMLImageElement>('.page-tiles img') ?? [])];
  return {
    imgs: imgs.length,
    complete: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    previews: w?.querySelectorAll('img.page-preview').length ?? 0,
  };
}

/** Whether a window is held at a scroll limit (it cannot centre a spot near the page edge). */
function clamped(id: string): boolean {
  const vp = document.querySelector<HTMLElement>(`[data-s27-doc="${id}"] .viewport`);
  if (!vp) return false;
  const maxX = vp.scrollWidth - vp.clientWidth;
  const maxY = vp.scrollHeight - vp.clientHeight;
  return (
    vp.scrollLeft <= 0.5 ||
    vp.scrollTop <= 0.5 ||
    vp.scrollLeft >= maxX - 0.5 ||
    vp.scrollTop >= maxY - 0.5
  );
}

/**
 * Linked alignment error: follower centre vs the leader's centre mapped
 * (follower screen px), for followers not held at a scroll limit; `clamped`
 * lists the others.
 */
function linkError(leader: string): Record<string, number> & { clamped?: number } {
  const here = viewCentre(leader);
  const out: Record<string, number> & { clamped?: number } = {};
  if (!here) return out;
  for (const id of layoutStore.getState().ids) {
    if (id === leader) continue;
    if (clamped(id)) {
      out.clamped = (out.clamped ?? 0) + 1;
      continue;
    }
    const m = linker.map(leader, id);
    const want = {
      x: m.a * here.centre.x + m.c * here.centre.y + m.e,
      y: m.b * here.centre.x + m.d * here.centre.y + m.f,
    };
    const now = viewCentre(id);
    if (!now) continue;
    out[id] = Math.hypot(want.x - now.centre.x, want.y - now.centre.y) * now.scale;
  }
  return out;
}

interface PanResult {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  over25: number;
  over50: number;
  maxLinkErrorPx: number;
  /** Frames where a follower was held at a scroll limit (not counted in the error). */
  clampedFrames: number;
  meanDriveMs: number;
  maxDriveMs: number;
  longTasks: { start: number; duration: number }[];
  /** Long animation frames (> 50 ms, the LoAF API) during the pan, and their blocking time. */
  loafCount: number;
  loafMaxMs: number;
  loafBlockingMs: number;
}

/**
 * Pans the leader every frame for `ms` (dx, dy CSS px per frame, bouncing
 * at the edges) and records frame intervals and the linked windows' error,
 * read at the start of each frame (after that frame's scroll events).
 */
function pan(leader: string, dx: number, dy: number, ms: number): Promise<PanResult> {
  focusDoc(leader);
  const vp = document.querySelector<HTMLElement>(`[data-s27-doc="${leader}"] .viewport`);
  if (!vp) throw new Error('no viewport');
  linker.stats.driveMs.length = 0;
  const t0 = performance.now();
  const longFrom = probe.longTasks.length;
  const gaps: number[] = [];
  const loafs: { duration: number; blockingDuration: number }[] = [];
  let loafObserver: PerformanceObserver | null = null;
  try {
    loafObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        loafs.push({
          duration: e.duration,
          blockingDuration:
            (e as PerformanceEntry & { blockingDuration?: number }).blockingDuration ?? 0,
        });
    });
    loafObserver.observe({ type: 'long-animation-frame' });
  } catch {
    loafObserver = null;
  }
  let last = t0;
  let maxErr = 0;
  let clampedFrames = 0;
  let sx = dx;
  let sy = dy;
  return new Promise((resolve) => {
    const step = (now: number): void => {
      gaps.push(now - last);
      last = now;
      if (linker.enabled) {
        const { clamped: held, ...errs } = linkError(leader);
        if (held) clampedFrames++;
        for (const e of Object.values(errs)) maxErr = Math.max(maxErr, e);
      }
      if (now - t0 >= ms) {
        const s = [...gaps.slice(1)].sort((a, b) => a - b);
        const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
        const d = linker.stats.driveMs;
        loafObserver?.disconnect();
        resolve({
          loafCount: loafs.length,
          loafMaxMs: loafs.reduce((m, l) => Math.max(m, l.duration), 0),
          loafBlockingMs: loafs.reduce((m, l) => m + l.blockingDuration, 0),
          frames: s.length,
          p50: q(0.5),
          p95: q(0.95),
          max: s.at(-1) ?? 0,
          over25: s.filter((g) => g > 25).length,
          over50: s.filter((g) => g > 50).length,
          maxLinkErrorPx: maxErr,
          clampedFrames,
          meanDriveMs: d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0,
          maxDriveMs: d.length ? Math.max(...d) : 0,
          longTasks: probe.longTasks.slice(longFrom),
        });
        return;
      }
      if (vp.scrollLeft + sx < 0 || vp.scrollLeft + sx > vp.scrollWidth - vp.clientWidth) sx = -sx;
      if (vp.scrollTop + sy < 0 || vp.scrollTop + sy > vp.scrollHeight - vp.clientHeight) sy = -sy;
      vp.scrollLeft += sx;
      vp.scrollTop += sy;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * How much of a window's visible page area is covered by loaded tiles at the
 * current zoom (0–1), sampled on a grid. A window whose tiles were not
 * recalculated after a scroll shows its preview there instead.
 */
function coverage(id: string, n = 12): number {
  const w = document.querySelector<HTMLElement>(`[data-s27-doc="${id}"] .viewport`);
  if (!w) return 0;
  const v = w.getBoundingClientRect();
  const imgs = [...w.querySelectorAll<HTMLImageElement>('.page-tiles img')]
    .filter((i) => i.complete && i.naturalWidth > 0)
    .map((i) => i.getBoundingClientRect());
  const pages = [...w.querySelectorAll<HTMLElement>('.page-content')].map((p) =>
    p.getBoundingClientRect(),
  );
  let onPage = 0;
  let covered = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = v.left + ((i + 0.5) * w.clientWidth) / n;
      const y = v.top + ((j + 0.5) * w.clientHeight) / n;
      const inside = (r: DOMRect): boolean =>
        x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      if (!pages.some(inside)) continue;
      onPage++;
      if (imgs.some(inside)) covered++;
    }
  return onPage ? covered / onPage : 1;
}

/** Text selection rects per page of one document (the selection plugin keeps one per document). */
function selectionRects(id: string): number {
  const r = hostStore.getState().registry;
  if (!r) return 0;
  const st = capability<SelectionCapability>(r, 'selection').getState(id);
  return Object.values(st.rects).reduce((n, v) => n + v.length, 0);
}

interface ViewStash {
  scale: number;
  centre: Pt;
}

/** A window's place (zoom and the page point at its centre), to give a tab its own view back. */
function stashView(id: string): ViewStash | null {
  return viewCentre(id);
}

async function restoreView(id: string, v: ViewStash): Promise<void> {
  const r = hostStore.getState().registry;
  if (!r) return;
  capability<ZoomCapability>(r, 'zoom').forDocument(id).requestZoom(v.scale);
  // The zoom plugin lays out and scrolls over the next frames: land once the
  // scale is in place and the place holds for two frames in a row.
  let held = 0;
  for (let i = 0; i < 60 && held < 2; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const now = viewCentre(id);
    if (!now || !sameScale(now.scale, v.scale)) continue;
    const off = Math.hypot(now.centre.x - v.centre.x, now.centre.y - v.centre.y) * now.scale;
    if (off < 0.5) held++;
    else {
      held = 0;
      centreOn(id, v.centre);
    }
  }
}

/**
 * Jumps the leader to page point `p` (followers follow when linked) and
 * returns how long until every listed window is covered by loaded tiles (ms),
 * or -1 after `timeoutMs`.
 */
function jumpAndFill(leader: string, p: Pt, ids: string[], timeoutMs = 20_000): Promise<number> {
  focusDoc(leader);
  const t0 = performance.now();
  centreOn(leader, p);
  return new Promise((resolve) => {
    const check = (): void => {
      const now = performance.now() - t0;
      if (now > 60 && ids.every((id) => coverage(id) === 1)) resolve(now);
      else if (now > timeoutMs) resolve(-1);
      else setTimeout(check, 25);
    };
    setTimeout(check, 25);
  });
}

let keyedOff: (() => void) | null = null;
async function keyedTiles(on: boolean): Promise<boolean> {
  keyedOff?.();
  keyedOff = null;
  if (on) keyedOff = installKeyedTiles(await whenRegistry());
  return keyedOff !== null;
}

async function memory(): Promise<unknown> {
  const p = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{
      bytes: number;
      breakdown: {
        bytes: number;
        types: string[];
        attribution: { scope: string; url: string }[];
      }[];
    }>;
  };
  if (!crossOriginIsolated || !p.measureUserAgentSpecificMemory) return null;
  const m = await p.measureUserAgentSpecificMemory();
  const byScope: Record<string, number> = {};
  for (const b of m.breakdown) {
    const scope =
      b.attribution.map((a) => `${a.scope}:${a.url.split('/').pop() ?? ''}`).join(',') || 'shared';
    byScope[scope] = (byScope[scope] ?? 0) + b.bytes;
  }
  return { bytes: m.bytes, byScope, tileCacheBytes: tileCache.size };
}

const api = {
  open,
  layout,
  link,
  unlink: () => {
    linker.detach();
  },
  setLinked: (on: boolean) => {
    linker.enabled = on;
  },
  linkStats: () => ({ ...linker.stats, driveMs: linker.stats.driveMs.length }),
  leader: () => linker.leaderId,
  focus: focusDoc,
  active: () => documentStore.getState().activeId,
  zoom,
  tiles,
  coverage,
  jumpAndFill,
  keyedTiles,
  selectionRects,
  stashView,
  restoreView,
  pan,
  linkError,
  viewCentre,
  centreOn: (id: string, p: Pt) => {
    centreOn(id, p);
  },
  memory,
  setTool: (tool: string) => {
    appStore.getState().setTool(tool as never);
  },
  longTasks: () => probe.longTasks,
};
(window as unknown as { __s27: typeof api }).__s27 = api;

initTheme();
installProbes();
installTestHook();
const root = document.getElementById('root');
if (!root) throw new Error('#root');
createRoot(root).render(
  <StrictMode>
    <UiProvider>
      <Harness>
        <div id="document-panel" tabIndex={-1} className="s27-panel">
          <DocumentHost>
            <Area />
          </DocumentHost>
        </div>
      </Harness>
    </UiProvider>
  </StrictMode>,
);
