// View commands (§5, §8.1, M1-15): zoom, page navigation, Hand and Select.
import { registerCommand } from '../../app/commands/dispatch';
import { appStore } from '../../app/store/appStore';
import { documentStore, selectActive, type ZoomSetting } from '../../app/store/documentStore';
import { move, setZoom, zoomStep, type ZoomTarget } from './controller';

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
    registerCommand('home.hand', {
      run: () => {
        appStore.getState().setTool('hand');
      },
      isPressed: () => appStore.getState().tool === 'hand',
    }),
    registerCommand('home.select', {
      run: () => {
        appStore.getState().setTool('select');
      },
      isPressed: () => appStore.getState().tool === 'select',
    }),
    // Esc (§8.1): back to Select. Only claims Esc when a document is open.
    registerCommand('tool.cancel', {
      requiresDocument: true,
      run: () => {
        appStore.getState().setTool('select');
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
