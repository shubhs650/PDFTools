// Fonts installed on this computer (M11-08·O5, D-54, ADR-028). In Chromium
// the font list offers "Show fonts on this computer…": on that click,
// Local Font Access (`queryLocalFonts()`) lists them behind the browser's
// permission prompt. Nothing is read before; nothing leaves the device; font
// files are never stored (only a chosen family's name, in Recently used).
// Once the user has allowed it, the browser remembers the permission, and the
// list is read again at start-up (no prompt), so comments made in such a font
// keep it when edited later.
//
// The main thread only lists the fonts (names, no bytes) and hands a face's
// file (a Blob, read off the main thread by the browser) to the Render worker
// when it asks; the worker reads the embedding flags and draws (rule 1).
import { createStore, useStore } from 'zustand';
import i18n from 'i18next';
import {
  libraryFamily,
  setSystemFamilies,
  systemFamilies,
  updateSystemFamily,
  type LibraryFamily,
  type SystemFontBlock,
} from '../../../model/fonts/library';
import { checkFace, groupLocalFonts, type LocalFace } from '../../../model/fonts/systemFamilies';
import type {
  SystemFontReply,
  SystemFontRequest,
} from '../../../workers/render/commentFonts/systemFonts';
import { hostStore, renderEngine, startedWorkClient } from '../../view/host';
import type { RenderEngine } from '../../../engine/createEngine';

/** What Local Font Access gives for one face (Chromium's FontData). */
interface FontData extends LocalFace {
  blob(): Promise<Blob>;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<FontData[]>;
  }
}

export type SystemFontsState = 'off' | 'loading' | 'on' | 'denied' | 'error';
/** A family's check: usable, or why not. */
export type FontCheck = 'ok' | SystemFontBlock;

interface Store {
  state: SystemFontsState;
  /** Family ids in list order. */
  ids: string[];
  checks: Record<string, FontCheck | 'checking'>;
}

const store = createStore<Store>()(() => ({ state: 'off', ids: [], checks: {} }));

export const useSystemFonts = <T>(select: (s: Store) => T): T => useStore(store, select);
export const systemFontsState = (): Store => store.getState();

/** Chromium with Local Font Access (other browsers do not show the entry). */
export const systemFontsSupported = (): boolean =>
  typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';

let faces = new Map<string, FontData>();
let channel: MessagePort | null = null;
let loading: Promise<SystemFontsState> | null = null;
let pendingFamilies: LibraryFamily[] | null = null;

/** Hands the families to the Render worker; the first time, the channel for their files too. */
async function sendToWorker(r: RenderEngine, families: LibraryFamily[]): Promise<void> {
  if (channel) {
    await r.rpc.call('systemFonts', { families }).promise;
    return;
  }
  const { port1, port2 } = new MessageChannel();
  channel = port1;
  port1.addEventListener('message', (ev: MessageEvent<SystemFontRequest>) => {
    answer(port1, ev);
  });
  port1.start();
  await r.rpc.call('systemFonts', { families, port: port2 }, { transfer: [port2] }).promise;
}

hostStore.subscribe((s) => {
  const families = pendingFamilies;
  if (!s.render || !families) return;
  pendingFamilies = null;
  void sendToWorker(s.render, families).catch(() => undefined);
});

/** Answers the Render worker's requests for a face's file. */
function answer(port: MessagePort, ev: MessageEvent<SystemFontRequest>): void {
  const { id, file } = ev.data;
  const f = faces.get(file.slice('sys:'.length));
  const reply = (blob: Blob | null): void => {
    port.postMessage({ id, blob } satisfies SystemFontReply);
  };
  if (!f) {
    reply(null);
    return;
  }
  f.blob().then(reply, () => {
    reply(null);
  });
}

/**
 * Lists the fonts on this computer (on the user's click, or at start-up when
 * the permission is already granted) and registers them on both sides.
 */
export function showSystemFonts(): Promise<SystemFontsState> {
  const query = typeof window === 'undefined' ? undefined : window.queryLocalFonts;
  if (!query) return Promise.resolve(store.getState().state);
  if (loading) return loading;
  if (store.getState().state === 'on') return Promise.resolve('on');
  store.setState({ state: 'loading' });
  loading = (async (): Promise<SystemFontsState> => {
    try {
      const list = await query.call(window);
      faces = new Map(list.map((f) => [f.postscriptName, f]));
      const families = groupLocalFonts(
        list.map(({ family, style, postscriptName }) => ({ family, style, postscriptName })),
        i18n.language,
      );
      setSystemFamilies(families);
      // The Render worker learns them now if it runs, else when it starts (never started for this).
      const r = hostStore.getState().render;
      if (r) await sendToWorker(r, families);
      else pendingFamilies = families;
      // The Work worker reads comments back too (a later one learns them when it starts).
      await startedWorkClient()
        ?.setSystemFonts(families)
        .catch(() => null);
      store.setState({ state: 'on', ids: families.map((f) => f.id), checks: {} });
      return 'on';
    } catch (err) {
      const name = (err as { name?: unknown } | null)?.name;
      const state: SystemFontsState =
        name === 'SecurityError' || name === 'NotAllowedError' ? 'denied' : 'error';
      store.setState({ state });
      return state;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** At start-up: lists them again if the user allowed it before (no prompt, no click needed). */
export async function restoreSystemFonts(): Promise<void> {
  if (!systemFontsSupported() || typeof navigator === 'undefined') return;
  try {
    const status = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
    if (status.state === 'granted') await showSystemFonts();
  } catch {
    // No such permission in this browser: the entry stays a click away.
  }
}

let queue: Promise<unknown> = Promise.resolve();
const checking = new Map<string, Promise<FontCheck>>();

const setCheck = (id: string, check: FontCheck | 'checking'): void => {
  store.setState((s) => ({ checks: { ...s.checks, [id]: check } }));
};

/**
 * Whether a family can be used (its regular face's embedding flags and
 * outlines, read in the Render worker), one family at a time. Learns its
 * standard fallback (/DA) too.
 */
export function checkSystemFamily(id: string): Promise<FontCheck> {
  const known = store.getState().checks[id];
  if (known && known !== 'checking') return Promise.resolve(known);
  const running = checking.get(id);
  if (running) return running;
  const family = libraryFamily(id);
  const registered = store.getState().state === 'on' && systemFamilies().some((f) => f.id === id);
  const face = family ? checkFace(family) : undefined;
  if (!registered || !face) {
    setCheck(id, 'missing');
    updateSystemFamily(id, { blocked: 'missing' });
    return Promise.resolve('missing');
  }
  setCheck(id, 'checking');
  const p = queue
    .then(() => renderEngine().rpc.call('inspectSystemFont', { file: face.file }).promise)
    .then(
      ({ use, standard }): FontCheck => {
        updateSystemFamily(id, { standard, blocked: use === 'ok' ? undefined : use });
        return use;
      },
      (): FontCheck => {
        updateSystemFamily(id, { blocked: 'unreadable' });
        return 'unreadable';
      },
    )
    .then((check) => {
      setCheck(id, check);
      checking.delete(id);
      return check;
    });
  queue = p;
  checking.set(id, p);
  return p;
}
