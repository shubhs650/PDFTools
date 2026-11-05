// Handlers that exist in M1-10 (window and ribbon toggles). Feature tasks add
// theirs (save M1-22, view M1-15/16, help M1-11/25/26; QAT Open and Check for
// Updates M1-28).
import { checkForUpdates } from '../../features/offline/offline';
import { openFiles, requestClose } from '../../features/open/openDocument';
import { pickPdfFiles } from '../../storage/fileAccess';
import { canFullScreen, isFullScreen, subscribeFullScreen, toggleFullScreen } from '../fullScreen';
import { msg, t } from '../../i18n';
import { currentIssueUrl, OPENENGTOOLS_URL } from '../links';
import { appStore } from '../store/appStore';
import { getTheme, subscribeTheme, toggleTheme } from '../theme';
import { documentStore } from '../store/documentStore';
import { notify, registerCommand } from './dispatch';

/** A link of the top bar from a command (keyboard, menus): a new tab, no opener (M6-01). */
const openTab = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

export function registerBuiltinCommands(): () => void {
  const offs = [
    registerCommand('view.leftPanes', {
      run: () => {
        appStore.getState().toggleLeftPane();
      },
      isPressed: () => appStore.getState().leftPaneOpen,
    }),
    // Left panes (M2-08): choosing the pane shown closes the pane area.
    ...[
      'rail.bookmarks',
      'rail.thumbnails',
      'rail.comments',
      'rail.search',
      'rail.attachments',
      'rail.layers',
      'rail.signatures',
    ].map((id) =>
      registerCommand(id, {
        run: () => {
          appStore.getState().choosePane(id);
        },
        isPressed: () => {
          const s = appStore.getState();
          return s.leftPaneOpen && s.leftPane === id;
        },
      }),
    ),
    registerCommand('view.propertiesPane', {
      run: () => {
        appStore.getState().toggleProperties();
      },
      isPressed: () => appStore.getState().propertiesOpen,
    }),
    // A context menu's Properties (M6-02): opens the pane (never closes it).
    registerCommand('edit.properties', {
      run: () => {
        appStore.getState().setProperties(true);
      },
    }),
    registerCommand('view.collapseRibbon', {
      run: () => {
        appStore.getState().toggleRibbon();
      },
      isPressed: () => appStore.getState().ribbonCollapsed,
    }),
    // Top bar (M6-01, ADR-021 D-35).
    registerCommand('app.home', {
      run: () => {
        openTab(OPENENGTOOLS_URL);
      },
    }),
    registerCommand('app.reportIssue', {
      run: () => {
        openTab(currentIssueUrl(t));
      },
    }),
    ...(['view.fullScreen', 'view.exitFullScreen'] as const).map((id) =>
      registerCommand(id, {
        run: () => toggleFullScreen(),
        isPressed: isFullScreen,
        disabledReason: () => (canFullScreen() ? null : msg('topBar.fullScreenUnavailable')),
      }),
    ),
    subscribeFullScreen(notify),
    // Light / dark theme (M7-11, D-42): the top bar, View → Window, Ctrl+Shift+D.
    registerCommand('view.darkTheme', {
      run: toggleTheme,
      isPressed: () => getTheme() === 'dark',
    }),
    subscribeTheme(notify),
    registerCommand('help.shortcuts', {
      run: () => {
        appStore.getState().setShortcutsOpen(true);
      },
    }),
    registerCommand('file.open', {
      run: async () => {
        await openFiles(await pickPdfFiles());
      },
    }),
    // Quick access toolbar (§8): the same command as File → Open.
    registerCommand('qat.open', {
      run: async () => {
        await openFiles(await pickPdfFiles());
      },
    }),
    registerCommand('help.updates', {
      run: async () => {
        await checkForUpdates();
      },
    }),
    registerCommand('tab.close', {
      requiresDocument: true,
      run: () => {
        const { activeId } = documentStore.getState();
        if (activeId) requestClose(activeId);
      },
    }),
    registerCommand('tab.next', {
      requiresDocument: true,
      run: () => {
        cycleTab(1);
      },
    }),
    registerCommand('tab.prev', {
      requiresDocument: true,
      run: () => {
        cycleTab(-1);
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** Activates the next/previous tab, wrapping around (Ctrl+PageDown/PageUp). */
function cycleTab(step: number): void {
  const s = documentStore.getState();
  if (s.order.length === 0) return;
  const i = s.activeId ? s.order.indexOf(s.activeId) : -1;
  const next = s.order[(i + step + s.order.length) % s.order.length];
  if (next) s.activate(next);
}
