// Protect → Redact (M4-16, §7.9 step 1): Mark for Redaction (text), Mark Area
// for Redaction and Pending Redactions. Marks are annotations, so they need
// the annotate permission (M4-Q2, rule 9). Apply comes with M4-17/18.
import { registerCommand } from '../../app/commands/dispatch';
import { appStore } from '../../app/store/appStore';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { requestProfile } from '../settings/profile/profileStore';
import { cancelKeyRect, keyRectStore, markSelection, startKeyRect } from './markTools';
import { redactPanelStore, setRedactPanel } from './redactStore';

const activeId = (): string | null => selectActive(documentStore.getState())?.meta.id ?? null;

/** Was the command run from the keyboard (no pointer press just before)? */
let pointerAt = 0;
if (typeof window !== 'undefined')
  window.addEventListener(
    'pointerdown',
    () => {
      pointerAt = performance.now();
    },
    true,
  );
const fromKeyboard = (): boolean => performance.now() - pointerAt > 500;

export function registerRedactCommands(): () => void {
  const offs = [
    registerCommand('protect.markRedaction', {
      requiresDocument: true,
      requires: 'annotate',
      isPressed: () => appStore.getState().tool === 'redactText',
      run: async () => {
        const id = activeId();
        if (!id) return;
        await requestProfile();
        // Text already selected (a drag, or Ctrl+A from the keyboard) is marked at once.
        if (markSelection(id)) {
          setRedactPanel(true);
          return;
        }
        const tool = appStore.getState().tool;
        appStore.getState().setTool(tool === 'redactText' ? 'select' : 'redactText');
        if (tool !== 'redactText') setRedactPanel(true);
      },
    }),
    registerCommand('protect.markRedactionArea', {
      requiresDocument: true,
      requires: 'annotate',
      isPressed: () => appStore.getState().tool === 'redactArea',
      run: async () => {
        const id = activeId();
        if (!id) return;
        if (appStore.getState().tool === 'redactArea') {
          cancelKeyRect();
          appStore.getState().setTool('select');
          return;
        }
        await requestProfile();
        appStore.getState().setTool('redactArea');
        setRedactPanel(true);
        // From the keyboard: a rectangle at the current page's centre (M4-Q10).
        if (fromKeyboard()) startKeyRect(id, documentStore.getState().docs[id]?.view.page ?? 0);
      },
    }),
    registerCommand('protect.redactionList', {
      requiresDocument: true,
      isPressed: () => redactPanelStore.getState().open,
      run: () => {
        setRedactPanel(!redactPanelStore.getState().open);
      },
    }),
  ];
  // Leaving the area tool drops the keyboard rectangle.
  const offTool = appStore.subscribe((s) => {
    if (s.tool !== 'redactArea' && keyRectStore.getState().rect) cancelKeyRect();
  });
  return () => {
    for (const off of offs) off();
    offTool();
  };
}
