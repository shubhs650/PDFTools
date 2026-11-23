// Shows or hides the differences pane in an overlay result's head (M12-14, D-61).
import { PanelRight20Filled, PanelRight20Regular } from '@fluentui/react-icons/svg/panel-right';
import { useTranslation } from 'react-i18next';
import { ToggleButton } from '../../../ui/components';
import { updateDiff, useDiffPart } from './diffState';

export function DiffToggle({ id }: { id: string }) {
  const { t } = useTranslation();
  const open = useDiffPart(id, (v) => v.pane);
  return (
    <ToggleButton
      label={t('compare.diff.toggle')}
      iconOnly
      icon={<PanelRight20Regular />}
      pressedIcon={<PanelRight20Filled />}
      pressed={open}
      onPressedChange={(on) => {
        updateDiff(id, (v) => ({ ...v, pane: on }));
      }}
    />
  );
}
