// "What's new" (M10-08·O6, ADR-027): the release notes of recent versions,
// newest first, always in File › About, and shown once after an update in a
// dismissable banner. The text is in src/i18n/whatsnew.en.json (rule 11), a
// short form of docs/release-notes/<id>.md written with each release.
//
// "After an update": the release this device last announced is kept in
// localStorage (listed on the Privacy page, reset by Clear all local data).
// A first visit records the newest release without a banner; a device that
// already ran the app (the page came from the service worker an earlier visit
// installed) but has no record yet is a returning user, so it gets the banner.
import { createStore, useStore } from 'zustand';
import whatsNewEn from '../../i18n/whatsnew.en.json';
import { PSEUDO_LOCALE, pseudoLocalize } from '../../i18n/pseudo';

export interface Release {
  /** A short name for the release; its notes are docs/release-notes/<id>.md when they exist. */
  id: string;
  /** ISO date (YYYY-MM-DD) the release was published. */
  date: string;
  title: string;
  items: string[];
}

const EN: readonly Release[] = whatsNewEn.releases;

/** The releases in the UI language (the pseudo-locale in dev and e2e builds), newest first. */
export function releases(language: string): readonly Release[] {
  if (language !== PSEUDO_LOCALE) return EN;
  return EN.map((r) => ({
    ...r,
    title: pseudoLocalize(r.title),
    items: r.items.map(pseudoLocalize),
  }));
}

/** The newest release's id (the first in the list). */
export const LATEST_RELEASE_ID: string = EN[0]?.id ?? '';

/** An ISO date as a local calendar date (no time-zone shift). */
export function releaseDate(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** localStorage key (storage names keep "pdftools", D-41): the last release announced here. */
export const WHATS_NEW_STORAGE_KEY = 'pdftools.whatsNewSeen';

/** What to do at start: show the banner, record the release quietly, or nothing. */
export type Announce = 'banner' | 'record' | 'none';

/**
 * `seen` is the stored release id (null when none); `returning` is true when
 * this device ran the app before (its page came from the service worker).
 */
export function announceAction(seen: string | null, latest: string, returning: boolean): Announce {
  if (!latest || seen === latest) return 'none';
  if (seen === null && !returning) return 'record';
  return 'banner';
}

interface WhatsNewState {
  /** The release the banner shows; null when it is not shown. */
  banner: string | null;
  /** About scrolls to and focuses its What's new heading once (the banner's button). */
  focusInAbout: boolean;
}

export const whatsNewStore = createStore<WhatsNewState>()(() => ({
  banner: null,
  focusInAbout: false,
}));

export function useWhatsNew<T>(selector: (s: WhatsNewState) => T): T {
  return useStore(whatsNewStore, selector);
}

function readSeen(): string | null {
  try {
    return localStorage.getItem(WHATS_NEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSeen(id: string): void {
  try {
    localStorage.setItem(WHATS_NEW_STORAGE_KEY, id);
  } catch {
    // Storage blocked: the banner may show again next time; About always lists the notes.
  }
}

const servedByServiceWorker = (): boolean =>
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  navigator.serviceWorker.controller !== null;

/**
 * App start: decides whether the banner shows. It is shown once: the release
 * is recorded as soon as it is announced, so a reload does not show it again.
 */
export function startWhatsNew(returning: boolean = servedByServiceWorker()): void {
  const action = announceAction(readSeen(), LATEST_RELEASE_ID, returning);
  if (action === 'none') return;
  writeSeen(LATEST_RELEASE_ID);
  if (action === 'banner') whatsNewStore.setState({ banner: LATEST_RELEASE_ID });
}

export function dismissWhatsNew(): void {
  whatsNewStore.setState({ banner: null });
}

/** The banner's "See what's new": closes it and asks About to bring its list into view. */
export function requestWhatsNewInAbout(): void {
  whatsNewStore.setState({ banner: null, focusInAbout: true });
}

/** About took the request. */
export function clearWhatsNewFocus(): void {
  whatsNewStore.setState({ focusInAbout: false });
}

/** Clear all local data: forget the record (the in-memory banner state stays as it is). */
export function resetWhatsNew(): void {
  try {
    localStorage.removeItem(WHATS_NEW_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was stored.
  }
}
