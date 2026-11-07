import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { Print20Regular } from '@fluentui/react-icons/svg/print';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../ui/components';
import { appStore, useApp } from '../store/appStore';
import { ShortcutTable } from './ShortcutTable';
import { dialogHelp } from '../../features/help/openHelp';

/** Printable list of every binding, generated from the keymap (§8.1). */
export function ShortcutSheet() {
  const { t } = useTranslation();
  const open = useApp((s) => s.shortcutsOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        appStore.getState().setShortcutsOpen(o);
      }}
      title={t('shortcuts.title')}
      description={t('shortcuts.description')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('keyboard-shortcuts')}
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
      <ShortcutTable />
    </Dialog>
  );
}
