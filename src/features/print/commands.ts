// File → Print, the Quick Access Print button and Ctrl+P (M2-15, D-25):
// open the print dialog; File → Export Print-Ready PDF opens its dialog (M2-16).
// Disabled when the document forbids printing (rule 9).
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { openExport } from './exportPrintReady';
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
  const offs = [
    registerCommand('file.print', open),
    registerCommand('qat.print', open),
    // Export Print-Ready PDF (M2-16): a way of printing, so it needs the print permission.
    registerCommand('file.exportPrintReady', {
      requiresDocument: true,
      requires: 'print',
      run: () => {
        const active = selectActive(documentStore.getState());
        if (active) openExport(active.meta.id);
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
