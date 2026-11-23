// The app's side of "Clear all local data" (clearAll.ts, M1-26).
import { resetAccent, resetDensity, resetTheme } from '../../app/theme';
import { storageClient } from '../../engine/storageClient';
import { deleteAppDb } from '../../storage/appDb';
import { recentStore } from '../recent/recent';
import { recoveryStore } from '../recovery/recovery';
import { resetProfile } from './profile/profileStore';
import { resetSchemes } from '../stamps/schemes/schemeStore';
import { resetTemplates } from '../tables/templateStore';
import { resetAllToolDefaults } from '../annotate/tools/toolDefaultsStore';
import { resetAllCommentStyles } from '../annotate/tools/commentStylesStore';
import { resetSignatures } from '../sign/signStore';
import { resetWhatsNew } from '../whatsNew/releases';
import { resetRecentFonts } from '../annotate/fonts/recentFonts';
import { resetSession } from '../session/session';
import { resetZoneSets } from '../compare/diff/zoneSetsStore';
import { resetPresets } from '../compare/presets/presetStore';
import type { ClearDeps } from './clearAll';

const hasCaches = (): boolean => typeof caches !== 'undefined';

export const appClearDeps: ClearDeps = {
  clearRecovery: async () => {
    await storageClient().call('clearAll', null).promise;
  },
  deleteDatabase: deleteAppDb,
  cacheNames: () => (hasCaches() ? caches.keys() : Promise.resolve([])),
  deleteCache: (name) => caches.delete(name),
  reset: () => {
    recoveryStore.setState({ offers: [] });
    // The database is recreated, empty, the next time something needs it.
    recentStore.setState({ entries: [], problem: null });
    resetProfile();
    resetSchemes();
    resetTemplates();
    resetAllToolDefaults();
    resetAllCommentStyles();
    resetSignatures();
    // The theme, accent and density choices (localStorage, M7-11, O7, O9): back to
    // light, blue and comfortable.
    resetTheme();
    resetAccent();
    resetDensity();
    // Which release "What's new" last announced (M10-08·O6).
    resetWhatsNew();
    // The comment fonts chosen last (M11-07).
    resetRecentFonts();
    // Start-up back to the start screen, no files kept (M11-08·O2).
    resetSession();
    // The comparison's ignore zone sets (M12-14).
    resetZoneSets();
    // The comparison presets (M12-21).
    resetPresets();
  },
};
