// Convert → Recognize Text (OCR) (M5-04, ADR-020): opens the OCR dialog for
// the active document. Adding a text layer needs the modify permission
// (rule 9); without it the command is disabled with the reason.
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { ocrBlocked, openOcr } from './ocrJob';

export function registerOcrCommands(): () => void {
  return registerCommand('convert.ocr', {
    requiresDocument: true,
    requires: 'modify',
    disabledReason: () => {
      const active = selectActive(documentStore.getState());
      return active ? ocrBlocked(active.meta.id) : null;
    },
    run: () => {
      const active = selectActive(documentStore.getState());
      if (active) openOcr(active.meta.id);
    },
  });
}
