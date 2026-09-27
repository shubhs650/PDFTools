// View commands (§5, §8.1, M1-15): zoom, page navigation, Hand and Select.
import { registerCommand } from '../../app/commands/dispatch';
import { clearSelection } from '../select/commands';
import { appStore } from '../../app/store/appStore';
import { documentStore, selectActive, type ZoomSetting } from '../../app/store/documentStore';
import type { ViewMode } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import { move, rotate, setViewMode, setZoom, zoomStep, type ZoomTarget } from './controller';
import { canGoBack, canGoForward, nextView, previousView } from './viewHistory';

const modeIs = (m: ViewMode): boolean => selectActive(documentStore.getState())?.view.mode === m;

/** View-mode commands (§5, M1-16), for the ribbon and the status-bar switch. */
export const VIEW_MODE_COMMANDS: readonly [string, ViewMode][] = [
  ['view.singlePage', 'single'],
  ['view.continuous', 'continuous'],
  ['view.facing', 'facing'],
  ['view.continuousFacing', 'continuousFacing'],
];

const zoomIs = (z: ZoomSetting): boolean => selectActive(documentStore.getState())?.view.zoom === z;

export function registerViewCommands(): () => void {
  const zoomCommand = (id: string, target: ZoomTarget, pressed: () => boolean) =>
    registerCommand(id, {
      requiresDocument: true,
      run: () => setZoom(target),
      isPressed: pressed,
    });
  const nav = (id: string, m: Parameters<typeof move>[0]) =>
    registerCommand(id, {
      requiresDocument: true,
      run: () => {
        move(m);
      },
    });
  const offs = [
    registerCommand('view.zoomIn', {
      requiresDocument: true,
      run: () => {
        zoomStep(1);
      },
    }),
    registerCommand('view.zoomOut', {
      requiresDocument: true,
      run: () => {
        zoomStep(-1);
      },
    }),
    zoomCommand('view.fitPage', 'fitPage', () => zoomIs('fitPage')),
    zoomCommand('view.fitWidth', 'fitWidth', () => zoomIs('fitWidth')),
    zoomCommand('view.fitVisible', 'fitVisible', () => zoomIs('fitVisible')),
    zoomCommand('view.actualSize', 'actualSize', () => zoomIs(1)),
    nav('view.firstPage', 'first'),
    nav('view.prevPage', 'prev'),
    nav('view.nextPage', 'next'),
    nav('view.lastPage', 'last'),
    // Previous / Next View (M2-10): back and forward through jumps.
    registerCommand('view.prevView', {
      requiresDocument: true,
      run: previousView,
      disabledReason: () => (canGoBack() ? null : msg('view.history.noPrevious')),
    }),
    registerCommand('view.nextView', {
      requiresDocument: true,
      run: nextView,
      disabledReason: () => (canGoForward() ? null : msg('view.history.noNext')),
    }),
    ...VIEW_MODE_COMMANDS.map(([id, mode]) =>
      registerCommand(id, {
        requiresDocument: true,
        run: () => {
          setViewMode(mode);
        },
        isPressed: () => modeIs(mode),
      }),
    ),
    registerCommand('view.rotateCw', {
      requiresDocument: true,
      run: () => {
        rotate(1);
      },
    }),
    registerCommand('view.rotateCcw', {
      requiresDocument: true,
      run: () => {
        rotate(-1);
      },
    }),
    registerCommand('home.hand', {
      run: () => {
        appStore.getState().setTool('hand');
      },
      isPressed: () => appStore.getState().tool === 'hand',
    }),
    registerCommand('home.select', {
      run: () => {
        clearSelection();
        appStore.getState().setTool('select');
      },
      isPressed: () => appStore.getState().tool === 'select',
    }),
    // Select Text (M2): drag selects text, the same selection and copy as Select.
    registerCommand('home.selectText', {
      run: () => {
        appStore.getState().setTool('selectText');
      },
      isPressed: () => appStore.getState().tool === 'selectText',
    }),
    // Esc (§8.1): back to Select. Only claims Esc when a document is open.
    registerCommand('tool.cancel', {
      requiresDocument: true,
      run: () => {
        clearSelection();
        appStore.getState().setTool('select');
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
