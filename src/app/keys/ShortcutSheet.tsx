import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { Print20Regular } from '@fluentui/react-icons/svg/print';
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { commandLabelKey } from '../commandLabels';
import type { InternalAction } from '../commands/dispatch';
import { appStore, useApp } from '../store/appStore';
import { formatChord, isMac, type KeyLabels } from './chord';
import { KEYMAP } from './keymap';

const ACTION_LABELS: Record<InternalAction, MessageKey> = {
  'tab.close': msg('shortcuts.action.tabClose'),
  'tab.next': msg('shortcuts.action.tabNext'),
  'tab.prev': msg('shortcuts.action.tabPrev'),
  'tool.cancel': msg('shortcuts.action.toolCancel'),
  'edit.copy': msg('shortcuts.action.editCopy'),
  'edit.selectAll': msg('shortcuts.action.editSelectAll'),
};

/** Printable list of every binding, generated from the keymap (§8.1). */
export function ShortcutSheet() {
  const { t } = useTranslation();
  const open = useApp((s) => s.shortcutsOpen);
  const mac = isMac();
  const NAMED: Record<string, MessageKey> = {
    PageUp: msg('shortcuts.key.pageUp'),
    PageDown: msg('shortcuts.key.pageDown'),
    Escape: msg('shortcuts.key.escape'),
  };
  const labels: KeyLabels = {
    ctrl: mac ? t('shortcuts.key.cmd') : t('shortcuts.key.ctrl'),
    shift: t('shortcuts.key.shift'),
    alt: mac ? t('shortcuts.key.option') : t('shortcuts.key.alt'),
    named: (k) => {
      const key = NAMED[k];
      return key ? t(key) : k;
    },
  };
  const label = (target: string): string =>
    t((ACTION_LABELS as Record<string, MessageKey | undefined>)[target] ?? commandLabelKey(target));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        appStore.getState().setShortcutsOpen(o);
      }}
      title={t('shortcuts.title')}
      description={t('shortcuts.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <Button
          label={t('shortcuts.print')}
          icon={<Print20Regular />}
          onClick={() => {
            window.print();
          }}
        />
      }
    >
      <table className="shortcut-sheet" data-testid="shortcut-sheet">
        <thead>
          <tr>
            <th scope="col">{t('shortcuts.command')}</th>
            <th scope="col">{t('shortcuts.keys')}</th>
          </tr>
        </thead>
        <tbody>
          {KEYMAP.map((bnd) => (
            <tr key={bnd.target}>
              <th scope="row">{label(bnd.target)}</th>
              <td>
                {bnd.chords.map((c, i) => (
                  <span key={i}>
                    {i > 0 ? t('shortcuts.or') : null}
                    <kbd>{formatChord(c, labels)}</kbd>
                  </span>
                ))}
                {bnd.reservedFirst ? (
                  <span className="shortcut-note">{t('shortcuts.reservedNote')}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
