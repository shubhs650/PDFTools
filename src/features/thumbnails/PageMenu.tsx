import * as Menu from '@radix-ui/react-dropdown-menu';
import { useTranslation } from 'react-i18next';
import { runCommand } from '../../app/commands/dispatch';
import { openPageDialog } from '../pages/dialogStore';
import { pageOpBlocked } from '../pages/pageOps';

/**
 * The Thumbnails pane's context menu (M4-09): the Organize commands for the
 * selected pages, opened at the pointer (right click) or at the focused
 * thumbnail (Shift+F10, the Menu key). Keyboard as any menu (Radix): arrows,
 * Enter, Esc returns focus to the thumbnail.
 */
export function PageMenu({
  docId,
  x,
  y,
  page,
  onClose,
}: {
  docId: string;
  x: number;
  y: number;
  page: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const disabled = pageOpBlocked(docId) !== null;
  const items: { id: string; label: string; run: () => void }[] = [
    {
      id: 'rotateCw',
      label: t('pages.menu.rotateCw'),
      run: () => void runCommand('organize.rotateCw'),
    },
    {
      id: 'rotateCcw',
      label: t('pages.menu.rotateCcw'),
      run: () => void runCommand('organize.rotateCcw'),
    },
    {
      id: 'move',
      label: t('pages.menu.move'),
      run: () => {
        openPageDialog('move', docId);
      },
    },
    {
      id: 'insertBefore',
      label: t('pages.menu.insertBefore'),
      run: () => {
        openPageDialog('insertBlank', docId, 'before');
      },
    },
    {
      id: 'insertAfter',
      label: t('pages.menu.insertAfter'),
      run: () => {
        openPageDialog('insertBlank', docId, 'after');
      },
    },
    {
      id: 'delete',
      label: t('pages.menu.delete'),
      run: () => {
        openPageDialog('delete', docId);
      },
    },
  ];
  return (
    <Menu.Root
      open
      modal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Menu.Trigger asChild>
        <span
          aria-hidden="true"
          data-page-menu-anchor={page}
          style={{ position: 'fixed', left: x, top: y, width: 1, height: 1 }}
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="ui-menu" align="start" aria-label={t('pages.menu.label')}>
          {items.map((it) => (
            <Menu.Item
              key={it.id}
              className="ui-menu-item"
              disabled={disabled}
              onSelect={() => {
                onClose();
                it.run();
              }}
            >
              {it.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
