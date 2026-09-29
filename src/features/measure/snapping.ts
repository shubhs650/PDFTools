// Snapping for the drawing and measurement tools (M3-18, §7.4, D-14, ADR-008).
// When snapping is on, the current page's geometry is extracted whole in the
// Work worker (geometry priority, cached per page), indexed there and handed
// to the pure-JS Snap worker by transfer. Pointer positions are snapped from
// the Snap worker's latest answer; queries are coalesced to ≤ 1 in flight per
// animation frame, so snapping never waits for PDFium and the main thread only
// converts coordinates (rule 1). Alt held: no snapping for that move.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import type { SnapApi } from '../../engine/snapApi';
import { RpcClient } from '../../engine/rpc';
import { SNAP_KINDS, type Snap, type SnapKind } from '../../model/snapIndex';
import type { Pt } from '../../model/scale';
import { appDb } from '../../storage/appDb';
import { setSnapper } from '../annotate/tools/drawTools';
import { workClient } from '../view/host';
import { frameOf } from './viewports';

/** Snap radius on screen (CSS px); in points it shrinks as the zoom grows. */
const RADIUS_PX = 10;
/** Dense pages drop segments shorter than this on screen (ADR-008 d3). */
const MIN_DEVICE_PX = 0.5;
const SETTINGS_KEY = 'snapping';

type PageState = 'preparing' | 'ready' | 'failed';

interface SnapState {
  enabled: boolean;
  kinds: Record<SnapKind, boolean>;
  pages: Record<string, PageState>;
  /** Where the pointer snaps now (EmbedPDF points, top-left origin). */
  marker: { docId: string; page: number; kind: SnapKind; x: number; y: number } | null;
}

export const snapStore = createStore<SnapState>()(() => ({
  enabled: false,
  kinds: { endpoint: true, intersection: true, midpoint: true, nearest: true },
  pages: {},
  marker: null,
}));

export function useSnapping<T>(selector: (s: SnapState) => T): T {
  return useStore(snapStore, selector);
}

const keyOf = (docId: string, page: number): string => `${docId}/${String(page)}`;

let client: RpcClient<SnapApi> | null = null;
function snapClient(): RpcClient<SnapApi> {
  if (!client) {
    const worker = new Worker(new URL('../../workers/snap.worker.ts', import.meta.url), {
      type: 'module',
      name: 'snap',
    });
    client = new RpcClient<SnapApi>(worker, 'snap');
  }
  return client;
}

const zoomOf = (docId: string): number => documentStore.getState().docs[docId]?.view.scale ?? 1;

/** Extracts and loads a page's index once (per document, per page). */
export async function ensurePage(docId: string, page: number): Promise<void> {
  const key = keyOf(docId, page);
  const st = snapStore.getState();
  if (!st.enabled || st.pages[key] === 'ready' || st.pages[key] === 'preparing') return;
  snapStore.setState((s) => ({ pages: { ...s.pages, [key]: 'preparing' } }));
  try {
    const minLen = MIN_DEVICE_PX / zoomOf(docId);
    const r = await workClient().run('snapGeometry', { docId, pageIndex: page, minLen }).promise;
    const { index } = r;
    await snapClient().call(
      'load',
      { key, index },
      {
        transfer: [index.segs.buffer, index.cellStart.buffer, index.items.buffer],
      },
    ).promise;
    snapStore.setState((s) => ({ pages: { ...s.pages, [key]: 'ready' } }));
  } catch (err) {
    recordError('snap.geometry', err);
    snapStore.setState((s) => ({ pages: { ...s.pages, [key]: 'failed' } }));
  }
}

// ---- pointer queries --------------------------------------------------------------

interface Query {
  docId: string;
  page: number;
  pos: Pt;
}

let pending: Query | null = null;
let inFlight = false;
let frame = 0;
/** The latest answer: for which pointer position, and the snapped point. */
let last: { q: Query; at: Pt | null; r: number } | null = null;
/** Round trips (ms), for the perf scenario (probe). */
export const rtts: number[] = [];

function fire(): void {
  frame = 0;
  const q = pending;
  if (!q || inFlight) return;
  pending = null;
  const st = snapStore.getState();
  const kinds = SNAP_KINDS.filter((k) => st.kinds[k]);
  const f = frameOf(q.docId, q.page);
  const r = RADIUS_PX / zoomOf(q.docId);
  inFlight = true;
  const t0 = performance.now();
  snapClient()
    .call('snap', {
      key: keyOf(q.docId, q.page),
      x: f.originX + q.pos.x,
      y: f.originY + f.height - q.pos.y,
      r,
      kinds,
    })
    .promise.then(
      (s: Snap | null) => {
        rtts.push(performance.now() - t0);
        if (rtts.length > 2000) rtts.splice(0, 1000);
        const at = s ? { x: s.x - f.originX, y: f.originY + f.height - s.y } : null;
        last = { q, at, r };
        snapStore.setState({
          marker: s && at ? { docId: q.docId, page: q.page, kind: s.kind, ...at } : null,
        });
      },
      (err: unknown) => {
        recordError('snap.query', err);
      },
    )
    .finally(() => {
      inFlight = false;
      // The next query goes with the next frame (≤ 1 in flight per frame).
      if (pending && !frame) frame = requestAnimationFrame(fire);
    });
}

function request(q: Query): void {
  pending = q;
  if (!inFlight && !frame) frame = requestAnimationFrame(fire);
}

/**
 * The pointer position snapped: the latest answer when it was asked for a
 * point near this one; a new query goes out for this position either way.
 */
export function snapPoint(page: number, pos: Pt, evt: unknown): Pt {
  const st = snapStore.getState();
  const docId = documentStore.getState().activeId;
  const alt = (evt as { altKey?: boolean } | null)?.altKey === true;
  if (!st.enabled || !docId || alt) {
    if (st.marker) snapStore.setState({ marker: null });
    return pos;
  }
  const key = keyOf(docId, page);
  if (st.pages[key] !== 'ready') {
    void ensurePage(docId, page);
    return pos;
  }
  request({ docId, page, pos });
  const l = last;
  if (
    l?.at &&
    l.q.docId === docId &&
    l.q.page === page &&
    Math.hypot(l.q.pos.x - pos.x, l.q.pos.y - pos.y) <= l.r / 2
  )
    return l.at;
  return pos;
}

// ---- switches ---------------------------------------------------------------------

export async function setSnapping(on: boolean): Promise<void> {
  snapStore.setState({ enabled: on, ...(on ? {} : { marker: null }) });
  last = null;
  if (on) {
    const d = documentStore.getState();
    const id = d.activeId;
    if (id) void ensurePage(id, d.docs[id]?.view.page ?? 0);
  }
  try {
    await (await appDb()).setSetting(SETTINGS_KEY, { on, kinds: snapStore.getState().kinds });
  } catch (err) {
    recordError('snap.settings', err);
  }
}

export function toggleKind(kind: SnapKind): void {
  snapStore.setState((s) => ({ kinds: { ...s.kinds, [kind]: !s.kinds[kind] } }));
  last = null;
  void setSnapping(snapStore.getState().enabled);
}

/** Called once at start: the remembered switches; snapping follows the current page. */
export function installSnapping(): () => void {
  setSnapper(snapPoint);
  void (async () => {
    try {
      const v = await (
        await appDb()
      ).getSetting<{ on: boolean; kinds: SnapState['kinds'] }>(SETTINGS_KEY);
      if (v && typeof v.on === 'boolean') snapStore.setState({ enabled: v.on, kinds: v.kinds });
    } catch (err) {
      recordError('snap.settings', err);
    }
  })();
  const off = documentStore.subscribe((s, prev) => {
    // Follow the current page; forget closed documents (their indexes too).
    const id = s.activeId;
    if (id && snapStore.getState().enabled) {
      const page = s.docs[id]?.view.page ?? 0;
      if (s.activeId !== prev.activeId || page !== (prev.docs[id]?.view.page ?? 0))
        void ensurePage(id, page);
    }
    if (s.docs === prev.docs) return;
    for (const gone of Object.keys(prev.docs).filter((k) => !(k in s.docs))) {
      snapStore.setState((st) => ({
        pages: Object.fromEntries(
          Object.entries(st.pages).filter(([k]) => !k.startsWith(`${gone}/`)),
        ),
      }));
      if (client) void client.call('drop', { prefix: `${gone}/` }).promise.catch(() => undefined);
    }
  });
  return () => {
    off();
    setSnapper(null);
  };
}
