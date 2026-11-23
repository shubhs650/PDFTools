import { ArrowMaximize20Regular } from '@fluentui/react-icons/svg/arrow-maximize';
import { ArrowMinimize20Regular } from '@fluentui/react-icons/svg/arrow-minimize';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { appStore } from '../../../app/store/appStore';
import { ToggleButton } from '../../../ui/components';
import { areaStore } from '../area/areaPick';
import { diffView } from '../diff/diffState';
import { overlayView } from '../overlay/overlayState';
import { useMaximised } from './maximised';

/** Something open that Esc closes first: a dialog, a menu or a popup. */
const OVERLAYS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"][data-state="open"]';

/** Whether Esc on `target` belongs to a field (a search box clears, a list closes). */
const inField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Whether Esc has another job first: closing a dialog, menu or popup, a field's own Esc,
 * stopping point picking or drawing (an area, an ignore zone), or leaving a comment tool.
 */
function escTaken(id: string, target: EventTarget | null): boolean {
  if (document.querySelector(OVERLAYS) || inField(target)) return true;
  if (overlayView(id).manual?.picking) return true;
  if (areaStore.getState().byId[id]?.drawing) return true;
  if (diffView(id).drawing) return true;
  return appStore.getState().tool !== 'select';
}

/**
 * Maximise (M12-25, ADR-033 C3): hides the ribbon, the document tabs, the app's panes, the
 * comparison's panes and the status bar, leaving the header, the windows and the floating
 * bar. The same button or Esc brings everything back. Esc that something else uses first
 * (see escTaken) does not; it is looked at as the key goes down, before any handler.
 */
export function MaximiseButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const on = useMaximised(id);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.repeat) return;
      // Looked at before anything handles the key: a dialog closing on it is gone afterwards.
      if (escTaken(id, e.target)) return;
      appStore.getState().setMaximised(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [on, id]);
  return (
    <ToggleButton
      label={t('compare.maximise')}
      tooltip={t('compare.maximiseTip')}
      iconOnly
      icon={<ArrowMaximize20Regular />}
      pressedIcon={<ArrowMinimize20Regular />}
      pressed={on}
      onPressedChange={(p) => {
        appStore.getState().setMaximised(p ? id : null);
      }}
    />
  );
}
