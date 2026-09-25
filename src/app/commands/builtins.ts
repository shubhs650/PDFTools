// Handlers that exist in M1-10 (window and ribbon toggles). Feature tasks add
// theirs (open M1-13, save M1-22, view M1-15/16, help M1-11/25/26).
import { appStore } from '../store/appStore';
import { registerCommand } from './dispatch';

export function registerBuiltinCommands(): () => void {
  const offs = [
    registerCommand('view.leftPanes', {
      run: () => {
        appStore.getState().toggleLeftPane();
      },
      isPressed: () => appStore.getState().leftPaneOpen,
    }),
    registerCommand('view.propertiesPane', {
      run: () => {
        appStore.getState().toggleProperties();
      },
      isPressed: () => appStore.getState().propertiesOpen,
    }),
    registerCommand('view.collapseRibbon', {
      run: () => {
        appStore.getState().toggleRibbon();
      },
      isPressed: () => appStore.getState().ribbonCollapsed,
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
