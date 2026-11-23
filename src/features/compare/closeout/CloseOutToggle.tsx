// Shows or hides the close-out list in a comparison result's head (M12-15, D-62).
import {
  TaskListSquareLtr20Filled,
  TaskListSquareLtr20Regular,
} from '@fluentui/react-icons/svg/task-list-square-ltr';
import { useTranslation } from 'react-i18next';
import { ToggleButton } from '../../../ui/components';
import { updateCloseOut, useCloseOutView } from './closeOutStore';

export function CloseOutToggle({ id }: { id: string }) {
  const { t } = useTranslation();
  const open = useCloseOutView(id).open;
  return (
    <ToggleButton
      label={t('compare.closeout.toggle')}
      tooltip={t('compare.closeout.toggleTip')}
      compact
      icon={<TaskListSquareLtr20Regular />}
      pressedIcon={<TaskListSquareLtr20Filled />}
      pressed={open}
      onPressedChange={(on) => {
        updateCloseOut(id, (v) => ({ ...v, open: on }));
      }}
    />
  );
}
