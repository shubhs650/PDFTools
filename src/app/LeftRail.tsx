import { useTranslation } from 'react-i18next';
import { ToggleButton } from '../ui/components';
import { CommandIcon } from '../ui/icons/CommandIcon';
import { appStore, useApp } from './store/appStore';

/**
 * Left rail and pane area (§5). The panes themselves (bookmarks, thumbnails,
 * …) arrive in M2; M1 provides the collapsible frame and its toggle.
 */
export function LeftRail() {
  const { t } = useTranslation();
  const open = useApp((s) => s.leftPaneOpen);
  return (
    <aside
      aria-label={t('frame.leftPanes')}
      className={`left-rail${open ? '' : ' left-rail--collapsed'}`}
    >
      <div className="left-rail-icons">
        <ToggleButton
          label={open ? t('frame.hideLeftPanes') : t('frame.showLeftPanes')}
          iconOnly
          icon={<CommandIcon id="view.leftPanes" />}
          pressedIcon={<CommandIcon id="view.leftPanes" pressed />}
          pressed={open}
          onPressedChange={() => {
            appStore.getState().toggleLeftPane();
          }}
        />
      </div>
      {open ? <div className="left-pane" data-testid="left-pane" /> : null}
    </aside>
  );
}
