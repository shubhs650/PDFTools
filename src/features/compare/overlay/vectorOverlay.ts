// The vector overlay on the main thread (M12-16, D-59; ADR-032 route 2): what
// the Work worker's builder is asked for, Export Overlay… (a new PDF file,
// one page per sheet, without attachments: plan risk "shared by mistake"),
// and the "Vector overlay (beta)" display mode, which draws the sheet from
// the builder's page instead of the two tinted revisions. The bytes only
// pass through here (transferred, rule 1).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { RpcError } from '../../../engine/errors';
import { t } from '../../../i18n';
import { IDENTITY } from '../../../model/compare/material';
import {
  accessStrategy,
  downloadBytes,
  pickSaveTarget,
  writeToHandle,
} from '../../../storage/fileAccess';
import { layerKey } from '../../../workers/shared/layerCopy';
import type { VectorOverlayRequest, VectorSheet } from '../../../workers/work/vectorOverlay';
import { DENIED } from '../../../workers/work/permissionGate';
import { renderEngine, workClient } from '../../view/host';
import { baseName, documentsOf, type Comparison } from '../model';
import { pairingSession, pairingStore } from '../pairingFlow';
import { blockFor, type Block } from '../permissions';
import {
  alignmentOf,
  overlayStore,
  overlayView,
  placeOf,
  sheetsOf,
  type OverlayView,
  type Sheet,
} from './overlayState';

/** A sheet as the builder takes it: its pages and A's placement in B's frame. */
export function vectorSheet(view: OverlayView, s: Sheet, hide?: VectorSheet['hide']): VectorSheet {
  return {
    a: s.a ? { docId: s.a.docId, pageIndex: s.a.page } : null,
    b: s.b ? { docId: s.b.docId, pageIndex: s.b.page } : null,
    place: s.a && s.b ? placeOf(view, s) : IDENTITY,
    ...(hide ? { hide } : {}),
  };
}

/** The builder's request for these sheets, as the view draws them (colours, alignment, layers). */
export function vectorRequest(
  c: Comparison,
  view: OverlayView,
  sheets: readonly VectorSheet[],
  nameOf: (docId: string) => string,
): VectorOverlayRequest {
  const label = (side: 'a' | 'b') =>
    Object.fromEntries(
      c[side].map((f) => [
        f.docId,
        side === 'a'
          ? t('compare.export.layersOld', { name: nameOf(f.docId) })
          : t('compare.export.layersNew', { name: nameOf(f.docId) }),
      ]),
    );
  const layers = Object.fromEntries(
    Object.entries(view.layers).filter(([, states]) => layerKey(states) !== ''),
  );
  return {
    sheets: [...sheets],
    colA: view.style.colA,
    colB: view.style.colB,
    layers,
    labels: { a: label('a'), b: label('b') },
  };
}

const nameOf = (docId: string): string => documentStore.getState().docs[docId]?.meta.name ?? '';

/** The comparison's sheets, once paired. */
export function comparisonSheets(id: string): Sheet[] | null {
  const p = pairingStore.getState().byId[id];
  return p?.status === 'done' ? sheetsOf(p.rows, p.pages) : null;
}

/** Which file blocks Export Overlay… (rule 9: every file's content-copying permission). */
export function exportBlock(c: Comparison): Block | null {
  const docs = documentStore.getState().docs;
  return blockFor(
    'exportOverlay',
    documentsOf(c).flatMap((docId) => {
      const d = docs[docId];
      return d ? [{ docId, name: d.meta.name, security: securityOf(d.meta) }] : [];
    }),
  );
}

/** "RevA vs RevB (overlay).pdf" (localized); a set names its first files. */
export function exportName(c: Comparison): string {
  const first = (side: 'a' | 'b'): string => baseName(nameOf(c[side][0]?.docId ?? ''));
  return t('compare.export.fileName', { a: first('a'), b: first('b') });
}

// ---- Export Overlay… ----

export type ExportScope = 'all' | 'sheet';

interface ExportState {
  /** The comparison the dialog is open for. */
  id: string | null;
  scope: ExportScope;
  running: { stage: 'aligning' | 'drawing'; done: number; total: number } | null;
  error: 'failed' | 'denied' | null;
}

export const exportOverlayStore = createStore<ExportState>()(() => ({
  id: null,
  scope: 'all',
  running: null,
  error: null,
}));

export function useExportOverlay<T>(selector: (s: ExportState) => T): T {
  return useStore(exportOverlayStore, selector);
}

let job: AbortController | null = null;

export function openExportOverlay(id: string): void {
  exportOverlayStore.setState({ id, scope: 'all', running: null, error: null });
}

export function closeExportOverlay(): void {
  job?.abort();
  job = null;
  exportOverlayStore.setState({ id: null, running: null, error: null });
}

export function cancelExportOverlay(): void {
  job?.abort();
}

export function setExportScope(scope: ExportScope): void {
  exportOverlayStore.setState({ scope });
}

const aborted = (): DOMException => new DOMException('Cancelled', 'AbortError');

/**
 * Resolves once every pair of `sheets` has its alignment (set by hand or
 * found), or the comparison's work is over (a sheet it could not align is
 * then laid over as is, as the overlay window shows it).
 */
export function whenAligned(
  id: string,
  sheets: readonly Sheet[],
  signal: AbortSignal,
): Promise<void> {
  const missing = (): boolean => {
    const v = overlayView(id);
    return sheets.some((s) => s.pair !== null && !alignmentOf(v, s) && v.manual?.pair !== s.pair);
  };
  if (!missing()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (): void => {
      off();
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      off();
      reject(aborted());
    };
    const off = overlayStore.subscribe(() => {
      if (!missing()) done();
    });
    signal.addEventListener('abort', onAbort, { once: true });
    const session = pairingSession(id);
    if (session) void session.whenDone().then(done, done);
    else done();
  });
}

/**
 * Asks where to save (first: the picker needs the click's gesture), waits for
 * the alignment, builds the overlay in the Work worker and writes it.
 */
export async function startExportOverlay(): Promise<void> {
  const { id, scope, running } = exportOverlayStore.getState();
  const c = id ? documentStore.getState().comparisons[id] : undefined;
  const all = id ? comparisonSheets(id) : null;
  if (!id || !c || !all?.length || running) return;
  if (exportBlock(c)) {
    exportOverlayStore.setState({ error: 'denied' });
    return;
  }
  const view = overlayView(id);
  const current = all[Math.min(view.sheet, all.length - 1)];
  const sheets = scope === 'sheet' && current ? [current] : all;
  const fileName = exportName(c);
  const controller = new AbortController();
  job = controller;
  exportOverlayStore.setState({
    running: { stage: 'aligning', done: 0, total: sheets.length },
    error: null,
  });
  try {
    let handle: FileSystemFileHandle | undefined;
    if (accessStrategy() === 'fsa') {
      handle = await pickSaveTarget(fileName);
      if (!handle) {
        exportOverlayStore.setState({ running: null });
        return;
      }
    }
    await whenAligned(id, sheets, controller.signal);
    const v = overlayView(id);
    const req = vectorRequest(
      c,
      v,
      sheets.map((s) => vectorSheet(v, s)),
      nameOf,
    );
    exportOverlayStore.setState({ running: { stage: 'drawing', done: 0, total: sheets.length } });
    const { bytes } = await workClient().run(
      'compareVectorOverlay',
      { ...req, exported: true },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (!controller.signal.aborted)
            exportOverlayStore.setState({ running: { stage: 'drawing', ...p } });
        },
      },
    ).promise;
    controller.signal.throwIfAborted();
    const data = new Uint8Array(bytes);
    if (handle) await writeToHandle(handle, data, controller.signal);
    else downloadBytes(data, fileName);
    exportOverlayStore.setState({ id: null, running: null, error: null });
  } catch (err) {
    const cancelled = controller.signal.aborted;
    const denied = err instanceof RpcError && err.code.startsWith(DENIED);
    if (!cancelled && !denied) recordError('compare.exportOverlay', err);
    exportOverlayStore.setState({
      running: null,
      error: cancelled ? null : denied ? 'denied' : 'failed',
    });
  } finally {
    if (job === controller) job = null;
  }
}

// ---- The "Vector overlay (beta)" display mode ----

/** Overlay pages open in the Render worker at once (each a small PDF of one sheet). */
const MAX_PAGES = 4;
/** A replaced page stays open this long, so tiles asked for just before still draw. */
const CLOSE_DELAY_MS = 2000;

interface PageEntry {
  /** The comparison it belongs to. */
  id: string;
  key: string;
  copyId: string;
  job: Promise<string>;
}

const pages = new Map<string, PageEntry>();
const failedKeys = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let seq = 0;

function changed(): void {
  version++;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function closePage(k: string, delay = 0): void {
  const e = pages.get(k);
  if (!e) return;
  pages.delete(k);
  const go = (): void => {
    void e.job
      .then(() => renderEngine().rpc.call('overlayCopyClose', { copyIds: [e.copyId] }).promise)
      .catch(() => undefined);
  };
  if (delay > 0) setTimeout(go, delay);
  else go();
}

/** The Render worker's id of the sheet's vector page for `req` (built and opened on first use). */
function vectorPage(id: string, key: string, req: VectorOverlayRequest): Promise<string> {
  const hit = pages.get(key);
  if (hit) {
    pages.delete(key);
    pages.set(key, hit);
    return hit.job;
  }
  const copyId = `${id}~vector${String(++seq)}`;
  const job = (async () => {
    const { bytes } = await workClient().run('compareVectorOverlay', { ...req, exported: false })
      .promise;
    await renderEngine().rpc.call('overlayCopyOpen', { copyId, bytes }, { transfer: [bytes] })
      .promise;
    return copyId;
  })();
  const entry: PageEntry = { id, key, copyId, job };
  pages.set(key, entry);
  failedKeys.delete(key);
  job.catch((err: unknown) => {
    failedKeys.add(key);
    recordError('compare.vectorOverlay', err);
    changed();
  });
  while (pages.size > MAX_PAGES) {
    const oldest = pages.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    closePage(oldest, CLOSE_DELAY_MS);
  }
  return job;
}

/** Closes the vector pages of a comparison (it closed, or left the display mode). */
export function closeVectorPages(id: string): void {
  let any = false;
  for (const [k, e] of [...pages])
    if (e.id === id) {
      closePage(k);
      any = true;
    }
  if (any) changed();
}

export interface VectorContent {
  /** The Render worker's copy holding the sheet's vector page (its page 0). */
  contentId: string | undefined;
  /** A page for the current state is being built (the previous one stays drawn). */
  pending: boolean;
  /** The page could not be built: the overlay is drawn the usual way. */
  failed: boolean;
}

/**
 * The vector page of the sheet shown, as the view draws it (colours,
 * alignment, layers, shown sides), while `on`. `versions` (the documents'
 * edit counts) build it again after a change.
 */
export function useVectorContent(
  c: Comparison | undefined,
  sheet: Sheet,
  view: OverlayView,
  versions: readonly number[],
  on: boolean,
): VectorContent {
  useSyncExternalStore(subscribe, () => version);
  let key = '';
  let sheetKey = '';
  let req: VectorOverlayRequest | null = null;
  if (on && c) {
    const spec = vectorSheet(view, sheet, {
      ...(view.style.showA ? {} : { a: true }),
      ...(view.style.showB ? {} : { b: true }),
    });
    req = vectorRequest(c, view, [spec], nameOf);
    sheetKey = JSON.stringify([spec.a, spec.b]);
    const docs = [sheet.a?.docId, sheet.b?.docId].filter((d): d is string => d !== undefined);
    key = JSON.stringify([
      spec,
      req.colA,
      req.colB,
      docs.map((d) => layerKey(view.layers[d])),
      versions,
    ]);
  }
  const [got, setGot] = useState<{ key: string; sheetKey: string; contentId?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!req || !key || !c) return;
    let live = true;
    vectorPage(c.id, key, req).then(
      (contentId) => {
        if (live) setGot({ key, sheetKey, contentId });
      },
      () => {
        if (live) setGot({ key, sheetKey });
      },
    );
    return () => {
      live = false;
    };
    // `key` stands for the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, key]);
  if (!on || !c) return { contentId: undefined, pending: false, failed: false };
  const failed = failedKeys.has(key);
  // While a new page is built, the last one of the same sheet stays drawn.
  return {
    contentId: failed || got?.sheetKey !== sheetKey ? undefined : got.contentId,
    pending: !failed && got?.key !== key,
    failed,
  };
}
