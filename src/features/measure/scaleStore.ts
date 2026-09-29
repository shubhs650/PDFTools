// Page scales and scale viewports (M3-15, M3-17, §7.4, D-14, ADR-007): read
// from each page's /VP (ours and viewers') through the Work worker, and changed
// by staging the page's new /VP through the object layer (M3-03), saved in the
// same Ctrl+S revision. A page's scale is its whole-page viewport; its detail
// viewports ("Detail A 1:5") are the others. Entries we don't touch are kept
// as read. The user's last units and precision are remembered on this device.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import {
  PAGE_VIEWPORT_NAME,
  viewportsFromPdf,
  viewportToPdf,
  type PageViewport,
  type Scale,
} from '../../model/scale';
import { coversPage, layoutOf, type Box, type PageLayout } from '../../model/scaleViewport';
import type { PdfJson } from '../../model/pdf/wire';
import { appDb } from '../../storage/appDb';
import type { PageVp } from '../../workers/work/viewports';
import { renderEngine, workClient } from '../view/host';

const DEFAULTS_KEY = 'measureDefaults';

export interface MeasureDefaults {
  unit: Scale['unit'];
  precision: number;
  ftIn?: number;
}

interface DocScales {
  pages: PageVp[];
  /** Pages' /VP lists changed in this session (staged, saved with the next Ctrl+S). */
  vp: Record<number, PdfJson[]>;
}

interface ScaleState {
  docs: Record<string, DocScales | 'loading' | 'failed'>;
  defaults: MeasureDefaults;
  dialog: 'setScale' | 'calibrate' | null;
  /** Calibration points picked on the page (page points), for the dialog. */
  picked: { page: number; a: { x: number; y: number }; b: { x: number; y: number } } | null;
}

export const scaleStore = createStore<ScaleState>()(() => ({
  docs: {},
  defaults: { unit: 'mm', precision: 2 },
  dialog: null,
  picked: null,
}));

export function useScales<T>(selector: (s: ScaleState) => T): T {
  return useStore(scaleStore, selector);
}

/** The page's /VP entries now (this session's, else the file's). */
export function entriesOf(s: Pick<ScaleState, 'docs'>, docId: string, page: number): PdfJson[] {
  const d = s.docs[docId];
  if (!d || typeof d === 'string') return [];
  const mine = d.vp[page];
  if (mine) return mine;
  const vp = d.pages[page]?.vp;
  return Array.isArray(vp) ? vp : [];
}

/** Each /VP entry read (null where it can't be), in order. */
export const readEntries = (list: readonly PdfJson[]): (PageViewport | null)[] =>
  list.map((e) => viewportsFromPdf([e])[0] ?? null);

export function mediaBoxOf(s: Pick<ScaleState, 'docs'>, docId: string, page: number): Box {
  const d = s.docs[docId];
  const p = d && typeof d !== 'string' ? d.pages[page] : undefined;
  return p?.mediaBox ?? [0, 0, 612, 792];
}

/** The page's default scale and detail viewports. */
export function layoutFor(s: Pick<ScaleState, 'docs'>, docId: string, page: number): PageLayout {
  return layoutOf(readEntries(entriesOf(s, docId, page)), mediaBoxOf(s, docId, page));
}

/** The page's scale: its whole-page viewport; null = uncalibrated. */
export function scaleOf(s: Pick<ScaleState, 'docs'>, docId: string, page: number): Scale | null {
  return layoutFor(s, docId, page).pageDefault;
}

export async function loadScales(docId: string): Promise<void> {
  const cur = scaleStore.getState().docs[docId];
  if (cur && cur !== 'failed') return;
  scaleStore.setState((s) => ({ docs: { ...s.docs, [docId]: 'loading' } }));
  try {
    await workClient().whenAdded(docId, 10_000);
    const pages = await workClient().run('pageViewports', { docId }).promise;
    scaleStore.setState((s) => ({ docs: { ...s.docs, [docId]: { pages, vp: {} } } }));
  } catch (err) {
    recordError('measure.viewports', err);
    scaleStore.setState((s) => ({ docs: { ...s.docs, [docId]: 'failed' } }));
  }
}

/** Stages each page's new /VP list and keeps it as the page's list now. */
export async function setEntries(
  docId: string,
  lists: ReadonlyMap<number, PdfJson[]>,
): Promise<boolean> {
  const { rpc } = renderEngine();
  const done = new Map<number, PdfJson[]>();
  try {
    for (const [page, list] of lists) {
      await rpc.call('stageObjects', { docId, target: { page }, set: { VP: list } }).promise;
      done.set(page, list);
    }
  } catch (err) {
    recordError('measure.stage', err);
    return false;
  } finally {
    if (done.size > 0) {
      scaleStore.setState((s) => {
        const cur = s.docs[docId];
        if (!cur || typeof cur === 'string') return s;
        return {
          docs: { ...s.docs, [docId]: { ...cur, vp: { ...cur.vp, ...Object.fromEntries(done) } } },
        };
      });
      documentStore.getState().markDirty(docId);
    }
  }
  return true;
}

/**
 * Sets `scale` on `pages`: each page's /VP keeps its other viewports and gets
 * a whole-page viewport with the scale (replacing an earlier one).
 */
export async function applyScale(
  docId: string,
  pages: readonly number[],
  scale: Scale,
): Promise<boolean> {
  await loadScales(docId);
  const st = scaleStore.getState();
  const d = st.docs[docId];
  if (!d || typeof d === 'string') return false;
  const lists = new Map<number, PdfJson[]>();
  for (const page of pages) {
    const p = d.pages[page];
    if (!p) continue;
    const others = entriesOf(st, docId, page).filter((entry) => {
      const [vp] = viewportsFromPdf([entry]);
      return !vp || !(vp.name === PAGE_VIEWPORT_NAME || coversPage(vp.bbox, p.mediaBox));
    });
    lists.set(page, [
      ...others,
      viewportToPdf({ name: PAGE_VIEWPORT_NAME, bbox: p.mediaBox, scale }),
    ]);
  }
  const ok = await setEntries(docId, lists);
  if (ok)
    void rememberDefaults({
      unit: scale.unit,
      precision: scale.precision,
      ...(scale.ftIn ? { ftIn: scale.ftIn } : {}),
    });
  return ok;
}

let defaultsLoaded = false;

export async function loadDefaults(): Promise<void> {
  if (defaultsLoaded) return;
  defaultsLoaded = true;
  try {
    const v = await (await appDb()).getSetting<MeasureDefaults>(DEFAULTS_KEY);
    if (v && typeof v.unit === 'string' && typeof v.precision === 'number')
      scaleStore.setState({ defaults: v });
  } catch (err) {
    recordError('measure.defaults', err);
  }
}

async function rememberDefaults(d: MeasureDefaults): Promise<void> {
  scaleStore.setState({ defaults: d });
  try {
    await (await appDb()).setSetting(DEFAULTS_KEY, d);
  } catch (err) {
    recordError('measure.defaults', err);
  }
}

export function openScaleDialog(which: 'setScale' | 'calibrate'): void {
  void loadDefaults();
  scaleStore.setState({ dialog: which });
}

export function closeScaleDialog(): void {
  scaleStore.setState({ dialog: null });
}

/** Forget a closed document. */
documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const id of Object.keys(prev.docs))
    if (!(id in s.docs))
      scaleStore.setState((st) => ({
        docs: Object.fromEntries(Object.entries(st.docs).filter(([k]) => k !== id)),
      }));
});
