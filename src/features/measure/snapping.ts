// Snapping for the drawing and measurement tools (M3-18, §7.4, D-14, ADR-008).
// When snapping is on, the current page's geometry is extracted whole in the
// Work worker (geometry priority, cached per page), indexed there and handed
// to the pure-JS Snap worker by transfer. Pointer positions are snapped from
// the Snap worker's latest answer; queries are coalesced to ≤ 1 in flight per
// animation frame, so snapping never waits for PDFium and the main thread only
// converts coordinates (rule 1). Alt held: no snapping for that move.
// Picking a measuring tool turns snapping on and its end turns it back off
// unless the person switched it meanwhile (M13-02, D-68, ADR-034).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { appStore } from '../../app/store/appStore';
import { documentStore } from '../../app/store/documentStore';
import type { SnapApi } from '../../engine/snapApi';
import { RpcClient } from '../../engine/rpc';
import { SNAP_KINDS, type Snap, type SnapKind } from '../../model/snapIndex';
import type { Pt } from '../../model/scale';
import { appDb } from '../../storage/appDb';
import { t } from '../../i18n';
import { onSnapToggled, onToolChange, type AutoSnapSession } from '../../model/autoSnap';
import { showStatusToast } from '../snapshot/snapshot';
import { loupeSettingsStore } from './loupeSettings';
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

/** Pages changed (M4-09): each page's index is keyed by page index; extract again. */
export async function dropSnapPages(docId: string): Promise<void> {
  const prefix = `${docId}/`;
  snapStore.setState((s) => ({
    pages: Object.fromEntries(Object.entries(s.pages).filter(([k]) => !k.startsWith(prefix))),
  }));
  if (client) await client.call('drop', { prefix }).promise.catch(() => undefined);
}

/**
 * Extracts and loads a page's index once (per document, per page). `force`:
 * also with snapping switched off (picking alignment points, M12-13).
 */
export async function ensurePage(docId: string, page: number, force = false): Promise<void> {
  const key = keyOf(docId, page);
  const st = snapStore.getState();
  if ((!st.enabled && !force) || st.pages[key] === 'ready' || st.pages[key] === 'preparing') return;
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
  /** The window's zoom when the caller knows it (a comparison window, M12-13). */
  zoom?: number;
  /** Shift (M14-02): the direction is locked from this point (EmbedPDF page points). */
  from?: Pt;
}

let pending: Query | null = null;
let inFlight = false;
let frame = 0;
/** The latest answer: for which pointer position, and the snapped point. */
let last: { q: Query; at: Pt | null; r: number } | null = null;
/** Round trips (ms), for the perf scenario (probe). */
export const rtts: number[] = [];

/** Bumped when the marker is taken off, so an answer already on its way is not shown. */
let cleared = 0;

function fire(): void {
  frame = 0;
  const q = pending;
  if (!q || inFlight) return;
  pending = null;
  const st = snapStore.getState();
  const kinds = SNAP_KINDS.filter((k) => st.kinds[k]);
  const f = frameOf(q.docId, q.page);
  const r = RADIUS_PX / (q.zoom ?? zoomOf(q.docId));
  inFlight = true;
  const clearedAtStart = cleared;
  const t0 = performance.now();
  const key = keyOf(q.docId, q.page);
  const x = f.originX + q.pos.x;
  const y = f.originY + f.height - q.pos.y;
  const from = q.from;
  const len = from ? Math.hypot(q.pos.x - from.x, q.pos.y - from.y) : 0;
  const call =
    from && len > 0
      ? snapClient().call('snapLine', {
          key,
          ox: f.originX + from.x,
          oy: f.originY + f.height - from.y,
          // y down on the page is y up in user space.
          dx: (q.pos.x - from.x) / len,
          dy: -(q.pos.y - from.y) / len,
          x,
          y,
          r,
        })
      : snapClient().call('snap', { key, x, y, r, kinds });
  call.promise
    .then(
      (s: Snap | null) => {
        rtts.push(performance.now() - t0);
        if (cleared !== clearedAtStart) return; // the marker was taken off meanwhile
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
  const docId = documentStore.getState().activeId;
  return docId ? snapPointIn(docId, page, pos, evt) : pos;
}

/**
 * snapPoint on a given document's page. `force`: snaps even with snapping
 * switched off (picking alignment points snaps to the drawing, M12-13, D-60);
 * `zoom`: the zoom of the window the pointer is in (CSS px per point).
 */
export function snapPointIn(
  docId: string,
  page: number,
  pos: Pt,
  evt: unknown,
  { force = false, zoom, from }: { force?: boolean; zoom?: number; from?: Pt } = {},
): Pt {
  const st = snapStore.getState();
  const alt = (evt as { altKey?: boolean } | null)?.altKey === true;
  if ((!st.enabled && !force) || alt) {
    if (st.marker) snapStore.setState({ marker: null });
    return pos;
  }
  const key = keyOf(docId, page);
  if (st.pages[key] !== 'ready') {
    void ensurePage(docId, page, force);
    return pos;
  }
  request({ docId, page, pos, ...(zoom ? { zoom } : {}), ...(from ? { from } : {}) });
  const l = last;
  if (
    l?.at &&
    l.q.docId === docId &&
    l.q.page === page &&
    sameLock(l.q.from, from) &&
    Math.hypot(l.q.pos.x - pos.x, l.q.pos.y - pos.y) <= l.r / 2
  )
    return l.at;
  return pos;
}

const sameLock = (a: Pt | undefined, b: Pt | undefined): boolean =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);

/**
 * Shift with snapping on (M14-02, D-78, Q25): `pos` is already locked to 0°,
 * 45° or 90° from `from`; the answer is where that direction crosses a drawn
 * line near the pointer (the latest answer, as snapPoint), else `pos`. Alt:
 * no snapping for that click.
 */
export function snapLocked(page: number, from: Pt, pos: Pt, evt: unknown): Pt {
  const docId = documentStore.getState().activeId;
  return docId ? snapPointIn(docId, page, pos, evt, { from }) : pos;
}

/**
 * Takes the snap marker off the page: another tool or another tab (pre-release audit
 * bug 6). The next pointer move with a snapping tool asks again.
 */
export function clearSnapMarker(): void {
  cleared++;
  last = null;
  if (snapStore.getState().marker) snapStore.setState({ marker: null });
}

// ---- switches ---------------------------------------------------------------------

/**
 * Automatic snapping while measuring (M13-02, D-68, P3): the session that
 * turned snapping on, so the tool's end can turn it back off.
 */
let autoSession: AutoSnapSession | null = null;

function applySnapping(on: boolean): void {
  snapStore.setState({ enabled: on, ...(on ? {} : { marker: null }) });
  last = null;
  if (on) {
    const d = documentStore.getState();
    const id = d.activeId;
    if (id) void ensurePage(id, d.docs[id]?.view.page ?? 0);
  }
}

/** Kept on the device: the person's own choice, never a measuring session's automatic one. */
async function persist(): Promise<void> {
  const s = snapStore.getState();
  const a = autoSession;
  const on = a?.turnedOn && !a.touched ? a.before : s.enabled;
  try {
    await (await appDb()).setSetting(SETTINGS_KEY, { on, kinds: s.kinds });
  } catch (err) {
    recordError('snap.settings', err);
  }
}

/** The person switches snapping (status bar, ribbon): their choice, kept on the device. */
export async function setSnapping(on: boolean): Promise<void> {
  autoSession = onSnapToggled(autoSession);
  applySnapping(on);
  await persist();
}

export function toggleKind(kind: SnapKind): void {
  snapStore.setState((s) => ({ kinds: { ...s.kinds, [kind]: !s.kinds[kind] } }));
  last = null;
  void persist();
}

/** A tool change: picking a measuring tool turns snapping on, its end turns it back (D-68). */
function followTool(from: string, to: string): void {
  const step = onToolChange(autoSession, {
    from,
    to,
    enabled: snapStore.getState().enabled,
    autoSnap: loupeSettingsStore.getState().autoSnap,
  });
  autoSession = step.session;
  if (step.set !== null) applySnapping(step.set);
  const docId = documentStore.getState().activeId;
  if (step.note && docId) showStatusToast(docId, t('snap.autoOn'), true);
}

/** Tests: no measuring session. */
export function resetAutoSnap(): void {
  autoSession = null;
}

/** Called once at start: the remembered switches; snapping follows the current page. */
export function installSnapping(): () => void {
  setSnapper(snapPoint, snapLocked);
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
  const offTool = appStore.subscribe((s, prev) => {
    if (s.tool === prev.tool) return;
    clearSnapMarker();
    followTool(prev.tool, s.tool);
  });
  const off = documentStore.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) clearSnapMarker();
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
    offTool();
    setSnapper(null);
  };
}
