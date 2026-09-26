// Save commands (M1-22): Ctrl+S, Ctrl+Shift+S, the QAT button and the File
// backstage (§4.2); Save Optimized opens its dialog (M1-23).
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore } from '../../app/store/documentStore';
import { openOptimizeDialog, save, saveAs } from './save';

function onActive(fn: (docId: string) => Promise<unknown>): () => Promise<void> {
  return async () => {
    const id = documentStore.getState().activeId;
    if (id) await fn(id);
  };
}

export function registerSaveCommands(): () => void {
  const offs = [
    registerCommand('file.save', { requiresDocument: true, run: onActive(save) }),
    registerCommand('qat.save', { requiresDocument: true, run: onActive(save) }),
    registerCommand('file.saveAs', { requiresDocument: true, run: onActive(saveAs) }),
    registerCommand('file.saveOptimized', {
      requiresDocument: true,
      run: onActive((id) => {
        openOptimizeDialog(id);
        return Promise.resolve();
      }),
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
