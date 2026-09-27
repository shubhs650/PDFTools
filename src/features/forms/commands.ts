// Home → Reset Form (M2-14, §7.10): asks first (ResetFormDialog), needs fill permission (rule 9).
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import { askReset } from './formStore';

/** `FPDF_GetFormType`: 0 no form; 2 full XFA (not filled). */
const NO_FORM = 0;
const XFA_FULL = 2;

export function registerFormCommands(): () => void {
  return registerCommand('home.resetForm', {
    requiresDocument: true,
    requires: 'fillForms',
    disabledReason: () => {
      const type = selectActive(documentStore.getState())?.meta.formType ?? NO_FORM;
      return type === NO_FORM || type === XFA_FULL ? msg('forms.reset.noFields') : null;
    },
    run: () => {
      const active = selectActive(documentStore.getState());
      if (active) askReset(active.meta.id);
    },
  });
}
