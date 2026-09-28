// Page scales (M3-15, §7.4, D-14, ADR-007): read from each page's /VP
// (ours and viewers') through the Work worker, and set by staging a new /VP
// through the object layer (M3-03), saved in the same Ctrl+S revision. A page's
// scale is its whole-page viewport; other viewports on it are kept. The user's
// last units and precision are remembered on this device (settings).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import {
  PAGE_VIEWPORT_NAME,
  pageScale,
  viewportsFromPdf,
  viewportToPdf,
  type Scale,
} from '../../model/scale';
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
  /** Scales set in this session (staged, saved with the next Ctrl+S). */
  set: Record<number, Scale>;
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

/** The page's scale: set in this session, else read from its /VP; null = uncalibrated. */
export function scaleOf(s: Pick<ScaleState, 'docs'>, docId: string, page: number): Scale | null {
  const d = s.docs[docId];
  if (!d || typeof d === 'string') return null;
  const set = d.set[page];
  if (set) return set;
  const p = d.pages[page];
  return p ? pageScale(viewportsFromPdf(p.vp), p.mediaBox) : null;
}

export async function loadScales(docId: string): Promise<void> {
  const cur = scaleStore.getState().docs[docId];
  if (cur && cur !== 'failed') return;
  scaleStore.setState((s) => ({ docs: { ...s.docs, [docId]: 'loading' } }));
  try {
    await workClient().whenAdded(docId, 10_000);
    const pages = await workClient().run('pageViewports', { docId }).promise;
    scaleStore.setState((s) => ({ docs: { ...s.docs, [docId]: { pages, set: {} } } }));
  } catch (err) {
    recordError('measure.viewports', err);
    scaleStore.setState((s) => ({ docs: { ...s.docs, [docId]: 'failed' } }));
  }
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
  const d = scaleStore.getState().docs[docId];
  if (!d || typeof d === 'string') return false;
  const { rpc } = renderEngine();
  try {
    for (const page of pages) {
      const p = d.pages[page];
      if (!p) continue;
      const others = (Array.isArray(p.vp) ? p.vp : []).filter((entry) => {
        const [vp] = viewportsFromPdf([entry]);
        return vp?.name !== PAGE_VIEWPORT_NAME;
      });
      const vp: PdfJson = [
        ...others,
        viewportToPdf({ name: PAGE_VIEWPORT_NAME, bbox: p.mediaBox, scale }),
      ];
      await rpc.call('stageObjects', { docId, target: { page }, set: { VP: vp } }).promise;
    }
  } catch (err) {
    recordError('measure.stage', err);
    return false;
  }
  scaleStore.setState((s) => {
    const cur = s.docs[docId];
    if (!cur || typeof cur === 'string') return s;
    const set = { ...cur.set };
    for (const page of pages) set[page] = scale;
    return { docs: { ...s.docs, [docId]: { ...cur, set } } };
  });
  documentStore.getState().markDirty(docId);
  void rememberDefaults({
    unit: scale.unit,
    precision: scale.precision,
    ...(scale.ftIn ? { ftIn: scale.ftIn } : {}),
  });
  return true;
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
