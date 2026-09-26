// Offline and updates, app side (M1-25, §9, D-17, D-18, rule 4). Registers the
// service worker (src/sw/sw.ts), asks for the background precache after the
// first render, turns its messages into the status bar's "Preparing offline…
// n %" / "✓ Ready offline" / "Downloading…", and applies an update only on
// the user's click and never while a document is open. The only network
// traffic this adds is same-origin (precache and update checks).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';

export type OfflinePhase = 'off' | 'preparing' | 'ready' | 'failed';
export type UpdateState = 'none' | 'ready' | 'waiting-for-close';
/** Help → Check for Updates, shown in the status bar for a few seconds (M1-28). */
export type UpdateCheck = 'checking' | 'current' | 'found' | 'failed' | 'unavailable';

interface OfflineStoreState {
  phase: OfflinePhase;
  /** Cached files / all files to cache (0…1). */
  progress: number;
  /** Modules being fetched on demand because they were not cached yet. */
  priority: number;
  update: UpdateState;
  /** The "close your documents first" explanation is shown. */
  explain: boolean;
  check: UpdateCheck | null;
}

export const offlineStore = createStore<OfflineStoreState>()(() => ({
  phase: 'off',
  progress: 0,
  priority: 0,
  update: 'none',
  explain: false,
  check: null,
}));

export function useOffline<T>(selector: (s: OfflineStoreState) => T): T {
  return useStore(offlineStore, selector);
}

/** Checks for a new version (same origin only, rule 4). */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Whether this build registers the service worker. Production always does;
 * the e2e build only when the URL asks (`?sw`), so ordinary e2e tests do not
 * download the whole precache.
 */
export function swEnabled(): boolean {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return false;
  return import.meta.env.MODE !== 'e2e' || new URLSearchParams(location.search).has('sw');
}

interface Counts {
  done: number;
  total: number;
}

const counts: { core: Counts; background: Counts } = {
  core: { done: 0, total: 0 },
  background: { done: 0, total: 0 },
};

function setProgress(): void {
  const done = counts.core.done + counts.background.done;
  const total = counts.core.total + counts.background.total;
  offlineStore.setState({ progress: total > 0 ? done / total : 0 });
}

let registration: ServiceWorkerRegistration | undefined;

/** Service worker → app messages (exported for the unit test). */
export function onMessage(event: Pick<MessageEvent, 'data'>): void {
  const m = event.data as
    | { type: 'precache-progress'; kind: 'core' | 'background'; done: number; total: number }
    | { type: 'precache-done' | 'precache-failed' }
    | { type: 'priority-fetch'; pending: number }
    | { type: 'status'; done: number; total: number }
    | null;
  if (!m) return;
  switch (m.type) {
    case 'precache-progress':
      counts[m.kind] = { done: m.done, total: m.total };
      setProgress();
      break;
    case 'precache-done':
      offlineStore.setState({ phase: 'ready', progress: 1 });
      break;
    case 'precache-failed':
      offlineStore.setState({ phase: 'failed' });
      break;
    case 'priority-fetch':
      offlineStore.setState({ priority: Math.max(0, m.pending) });
      break;
    case 'status':
      if (m.total > 0 && m.done >= m.total) offlineStore.setState({ phase: 'ready', progress: 1 });
      else {
        offlineStore.setState({ phase: 'preparing', progress: m.total > 0 ? m.done / m.total : 0 });
        registration?.active?.postMessage({ type: 'precache-background' });
      }
      break;
  }
}

function watchForUpdates(reg: ServiceWorkerRegistration): void {
  const markReady = (): void => {
    // Only an update: the very first install has no controller to replace.
    if (reg.waiting && navigator.serviceWorker.controller)
      offlineStore.setState({ update: 'ready' });
  };
  markReady();
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'installed') markReady();
    });
  });
  const check = (): void => {
    reg.update().catch(() => undefined); // offline: try again later
  };
  setInterval(check, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/** Registers the service worker (app start). */
export async function startOffline(): Promise<void> {
  if (!swEnabled()) return;
  offlineStore.setState({ phase: 'preparing' });
  navigator.serviceWorker.addEventListener('message', onMessage);
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    watchForUpdates(registration);
  } catch (err) {
    recordError('offline', err);
    offlineStore.setState({ phase: 'failed' });
  }
}

/** After the first render: the rest of the precache, in the background (§9). */
export async function startBackgroundPrecache(): Promise<void> {
  if (!swEnabled()) return;
  const reg = await navigator.serviceWorker.ready;
  registration = reg;
  reg.active?.postMessage({ type: 'status' });
}

function activateWaiting(): void {
  const waiting = registration?.waiting;
  if (!waiting) return;
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {
      location.reload();
    },
    { once: true },
  );
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

let unsubscribe: (() => void) | undefined;

/** "Update ready" clicked: now if no document is open, else once the last one closes. */
export function applyUpdate(): void {
  if (documentStore.getState().order.length === 0) {
    activateWaiting();
    return;
  }
  offlineStore.setState({ update: 'waiting-for-close', explain: true });
  unsubscribe?.();
  unsubscribe = documentStore.subscribe((s) => {
    if (s.order.length > 0) return;
    unsubscribe?.();
    unsubscribe = undefined;
    activateWaiting();
  });
}

/** "Not now": keep the update for the next launch (or a later click). */
export function postponeUpdate(): void {
  unsubscribe?.();
  unsubscribe = undefined;
  offlineStore.setState({ update: 'ready', explain: false });
}

/** "OK": the explanation closes; the update still applies once the last document closes. */
export function dismissUpdateExplanation(): void {
  offlineStore.setState({ explain: false });
}

/** How long the result of a manual check stays in the status bar. */
export const CHECK_MESSAGE_MS = 8000;
const INSTALL_WAIT_MS = 120_000;
let clearCheck: ReturnType<typeof setTimeout> | undefined;

function showCheck(check: UpdateCheck): void {
  clearTimeout(clearCheck);
  offlineStore.setState({ check });
  if (check !== 'checking') {
    clearCheck = setTimeout(() => {
      offlineStore.setState({ check: null });
    }, CHECK_MESSAGE_MS);
  }
}

/** Resolves once a worker that is installing has finished (installed or redundant). */
function installed(sw: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      if (sw.state !== 'installing') {
        sw.removeEventListener('statechange', done);
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(resolve, INSTALL_WAIT_MS);
    sw.addEventListener('statechange', done);
    done();
  });
}

/**
 * Help → Check for Updates (M1-28, §9): the same same-origin check the app
 * runs hourly (rule 4), now, with its outcome in the status bar. A new version
 * installs in the background and shows "Update ready" as usual; it is never
 * applied from here.
 */
export async function checkForUpdates(
  reg: ServiceWorkerRegistration | undefined = swEnabled() ? registration : undefined,
  hasController: () => boolean = () => Boolean(navigator.serviceWorker.controller),
): Promise<UpdateCheck> {
  if (!reg) {
    showCheck('unavailable');
    return 'unavailable';
  }
  showCheck('checking');
  let result: UpdateCheck;
  try {
    await reg.update();
    if (reg.installing) await installed(reg.installing);
    result = reg.waiting && hasController() ? 'found' : 'current';
    if (result === 'found') offlineStore.setState({ update: 'ready' });
  } catch (err) {
    recordError('offline', err);
    result = 'failed';
  }
  showCheck(result);
  return result;
}
