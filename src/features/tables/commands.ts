// Convert → Tables (Beta) (M4-13 … M4-15, §7.7): Express Extract for the
// active document, and Review & Extract (M4-14) on and off, Table Templates (M4-15). Reading tables needs the copy permission (rule 9); without
// it the command is disabled with the reason.
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { openExpressExtract } from './expressExtract';
import { enterReview, exitReview, reviewStore } from './reviewStore';
import { openTemplates } from './templateStore';

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
    registerCommand('convert.reviewExtract', {
      requiresDocument: true,
      requires: 'copy',
      run: () => {
        const active = selectActive(documentStore.getState());
        if (!active) return;
        if (reviewStore.getState().docId === active.meta.id) exitReview();
        else enterReview(active.meta.id);
      },
      isPressed: () => {
        const active = selectActive(documentStore.getState());
        return !!active && reviewStore.getState().docId === active.meta.id;
      },
    }),
    registerCommand('convert.tableTemplates', {
      requiresDocument: true,
      requires: 'copy',
      run: () => {
        const active = selectActive(documentStore.getState());
        if (active) openTemplates(active.meta.id);
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
