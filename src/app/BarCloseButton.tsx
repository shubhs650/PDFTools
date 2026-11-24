import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../ui/components';
import { closeBar } from './infoBars';

/** Class of every bar's ×, so a list of notes can find the next one. */
export const BAR_CLOSE_CLASS = 'info-bar-close';

/**
 * The × of an information bar: "Close this message", keyboard reachable. `afterClose`
 * puts the focus somewhere useful, since the button goes with its bar.
 */
export function BarCloseButton({ barKey, afterClose }: { barKey: string; afterClose: () => void }) {
  const { t } = useTranslation();
  return (
    <IconButton
      label={t('frame.closeMessage')}
      icon={<Dismiss20Regular />}
      size="small"
      className={BAR_CLOSE_CLASS}
      onClick={() => {
        closeBar(barKey);
        requestAnimationFrame(afterClose);
      }}
    />
  );
}
