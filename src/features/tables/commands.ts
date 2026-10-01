// Convert → Tables (Beta) (M4-13 … M4-15, §7.7): Express Extract for the
// active document. Reading tables needs the copy permission (rule 9); without
// it the command is disabled with the reason.
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { openExpressExtract } from './expressExtract';

export function registerTableCommands(): () => void {
  const offs = [
    registerCommand('convert.expressExtract', {
      requiresDocument: true,
      requires: 'copy',
      run: () => {
        const active = selectActive(documentStore.getState());
        if (active) openExpressExtract(active.meta.id);
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
