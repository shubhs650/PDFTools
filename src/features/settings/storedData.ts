// What PDFTools keeps on this device (M1-26, §1.1, §10.3, D-22): one list,
// used by the Privacy page and checked by a unit test against the IndexedDB
// migrations and the OPFS layout, so a new store cannot appear unlisted.
// Documents themselves are never stored here: they stay in the user's files;
// only crash-recovery snapshots of unsaved changes go to OPFS (§4.3).
import { ACCENT_STORAGE_KEY, DENSITY_STORAGE_KEY, THEME_STORAGE_KEY } from '../../app/theme';
import { msg, type MessageKey } from '../../i18n';
import { WHATS_NEW_STORAGE_KEY } from '../whatsNew/releases';
import { RECENT_FONTS_STORAGE_KEY } from '../annotate/fonts/recentFonts';
import { DB_NAME } from '../../storage/idb';
import { RECOVERY_DIR } from '../../storage/recoveryTypes';

export type LocalDataKind = 'indexedDB' | 'opfs' | 'localStorage' | 'cache';

export interface LocalDataItem {
  kind: LocalDataKind;
  /** The technical location: IndexedDB database/store, OPFS directory, localStorage key, cache name. */
  location: string;
  /** Store or directory name as the code sees it (for the unit test). */
  store: string;
  what: MessageKey;
  /** Deleted by Settings → "Clear all local data". */
  cleared: boolean;
}

/** Cache Storage names that hold the offline app files (the service worker's, src/sw/sw.ts). */
export const APP_FILES_CACHE = /^pdftools-[0-9a-f]+$/;

export const LOCAL_DATA: readonly LocalDataItem[] = [
  {
    kind: 'indexedDB',
    location: `${DB_NAME} › settings`,
    store: 'settings',
    what: msg('privacy.data.settings'),
    cleared: true,
  },
  {
    kind: 'indexedDB',
    location: `${DB_NAME} › recent`,
    store: 'recent',
    what: msg('privacy.data.recent'),
    cleared: true,
  },
  {
    kind: 'indexedDB',
    location: `${DB_NAME} › profile`,
    store: 'profile',
    what: msg('privacy.data.profile'),
    cleared: true,
  },
  {
    kind: 'indexedDB',
    location: `${DB_NAME} › schemes`,
    store: 'schemes',
    what: msg('privacy.data.schemes'),
    cleared: true,
  },
  {
    kind: 'indexedDB',
    location: `${DB_NAME} › tableTemplates`,
    store: 'tableTemplates',
    what: msg('privacy.data.tableTemplates'),
    cleared: true,
  },
  {
    kind: 'indexedDB',
    location: `${DB_NAME} › toolDefaults`,
    store: 'toolDefaults',
    what: msg('privacy.data.toolDefaults'),
    cleared: true,
  },
  {
    kind: 'indexedDB',
    location: `${DB_NAME} › commentStyles`,
    store: 'commentStyles',
    what: msg('privacy.data.commentStyles'),
    cleared: true,
  },
  {
    kind: 'indexedDB',
    location: `${DB_NAME} › visualSignatures`,
    store: 'visualSignatures',
    what: msg('privacy.data.visualSignatures'),
    cleared: true,
  },
  {
    // Named sets of ignore zones for comparisons (M12-14, D-61): names and rectangles only.
    kind: 'indexedDB',
    location: `${DB_NAME} › ignoreZoneSets`,
    store: 'ignoreZoneSets',
    what: msg('privacy.data.ignoreZoneSets'),
    cleared: true,
  },
  {
    // Each file's last view (M11-08·O3, D-53), by fingerprint: never a name or content.
    kind: 'indexedDB',
    location: `${DB_NAME} › lastViews`,
    store: 'lastViews',
    what: msg('privacy.data.lastViews'),
    cleared: true,
  },
  {
    // The files open last time (M11-08·O2, D-53), only while Start-up reopens them.
    kind: 'indexedDB',
    location: `${DB_NAME} › session`,
    store: 'session',
    what: msg('privacy.data.session'),
    cleared: true,
  },
  {
    kind: 'opfs',
    location: `${RECOVERY_DIR}/`,
    store: RECOVERY_DIR,
    what: msg('privacy.data.recovery'),
    cleared: true,
  },
  {
    // Read before the first paint, so it cannot wait for IndexedDB (M7-11, D-42).
    kind: 'localStorage',
    location: THEME_STORAGE_KEY,
    store: THEME_STORAGE_KEY,
    what: msg('privacy.data.theme'),
    cleared: true,
  },
  {
    // The accent colour (M10 O7, D-47): read before the first paint, as the theme.
    kind: 'localStorage',
    location: ACCENT_STORAGE_KEY,
    store: ACCENT_STORAGE_KEY,
    what: msg('privacy.data.accent'),
    cleared: true,
  },
  {
    // The density (M10-08·O9, D-47): read before the first paint, as the theme.
    kind: 'localStorage',
    location: DENSITY_STORAGE_KEY,
    store: DENSITY_STORAGE_KEY,
    what: msg('privacy.data.density'),
    cleared: true,
  },
  {
    // The last release "What's new" announced (M10-08·O6), so its banner shows once.
    kind: 'localStorage',
    location: WHATS_NEW_STORAGE_KEY,
    store: WHATS_NEW_STORAGE_KEY,
    what: msg('privacy.data.whatsNew'),
    cleared: true,
  },
  {
    // The comment fonts chosen last (M11-07, D-52): "Recently used" on top of the font list.
    kind: 'localStorage',
    location: RECENT_FONTS_STORAGE_KEY,
    store: RECENT_FONTS_STORAGE_KEY,
    what: msg('privacy.data.recentFonts'),
    cleared: true,
  },
  {
    kind: 'cache',
    location: 'pdftools-…',
    store: 'pdftools-',
    what: msg('privacy.data.appFiles'),
    cleared: false,
  },
];
