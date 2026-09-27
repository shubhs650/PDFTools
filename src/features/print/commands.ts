// File → Print, the Quick Access Print button and Ctrl+P (M2-15, D-25):
// open the print dialog. Disabled when the document forbids printing (rule 9).
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { openPrint } from './printStore';

export function registerPrintCommands(): () => void {
  const open = {
    requiresDocument: true,
    requires: 'print' as const,
    run: () => {
      const active = selectActive(documentStore.getState());
      if (active) openPrint(active.meta.id);
    },
  };
  const offs = [registerCommand('file.print', open), registerCommand('qat.print', open)];
  return () => {
    for (const off of offs) off();
  };
}
