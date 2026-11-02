// Form commands. Home → Reset Form (M2-14, §7.10): asks first (ResetFormDialog),
// needs fill permission (rule 9). Form tab (M6-14, ADR-021 D-36 / D-39):
// Select Fields, the five field tools and Highlight Fields; designing fields
// needs modify + annotate (ADR-022 d4), the Render worker refuses independently.
import { notify, registerCommand, type CommandHandler } from '../../app/commands/dispatch';
import { appStore } from '../../app/store/appStore';
import { documentStore, selectActive } from '../../app/store/documentStore';
import type { Capability } from '../../model/permissions';
import { msg } from '../../i18n';
import { FIELD_COMMANDS } from './fieldModel';
import { askReset, formStore } from './formStore';

/** `FPDF_GetFormType`: 0 no form; 2 full XFA (not filled). */
const NO_FORM = 0;
const XFA_FULL = 2;

/** Form design (ADR-022 d4, ISO 32000-1 table 22 bits 4 and 6). */
export const DESIGN_NEEDS: readonly Capability[] = ['modify', 'annotate'];

/** A full XFA form has no AcroForm fields to design. */
const xfaReason: Pick<CommandHandler, 'disabledReason'> = {
  disabledReason: () =>
    selectActive(documentStore.getState())?.meta.formType === XFA_FULL
      ? msg('forms.xfa.full')
      : null,
};

/** On until Esc or the command again (like the Comment tab's tools). */
function toolCommand(tool: 'selectFields' | (typeof FIELD_COMMANDS)[string]): CommandHandler {
  return {
    requires: DESIGN_NEEDS,
    ...xfaReason,
    isPressed: () => appStore.getState().tool === tool,
    run: () => {
      const app = appStore.getState();
      if (app.tool === tool) {
        app.setTool('select');
        return;
      }
      app.setTool(tool);
      // Field Properties shows what is drawn or selected next.
      app.setProperties(true);
    },
  };
}

export function registerFormCommands(): () => void {
  const offs = [
    registerCommand('home.resetForm', {
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
    }),
    registerCommand('form.selectFields', toolCommand('selectFields')),
    ...Object.entries(FIELD_COMMANDS).map(([command, tool]) =>
      registerCommand(command, toolCommand(tool)),
    ),
    registerCommand('form.highlightFields', {
      isPressed: () => formStore.getState().highlight,
      run: () => {
        formStore.setState((s) => ({ highlight: !s.highlight }));
        notify();
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
