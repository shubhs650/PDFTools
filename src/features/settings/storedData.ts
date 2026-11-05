// What PDFTools keeps on this device (M1-26, §1.1, §10.3, D-22): one list,
// used by the Privacy page and checked by a unit test against the IndexedDB
// migrations and the OPFS layout, so a new store cannot appear unlisted.
// Documents themselves are never stored here: they stay in the user's files;
// only crash-recovery snapshots of unsaved changes go to OPFS (§4.3).
import { THEME_STORAGE_KEY } from '../../app/theme';
import { msg, type MessageKey } from '../../i18n';
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
    kind: 'cache',
    location: 'pdftools-…',
    store: 'pdftools-',
    what: msg('privacy.data.appFiles'),
    cleared: false,
  },
];
