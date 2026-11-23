// A "?" button outside a dialog (M12-22): on a pane or window of the app that
// has its own Help topic, such as a comparison's input window and its panes.
// Dialogs get theirs from Dialog's `help` (dialogHelp, M9-04).
import { QuestionCircle20Regular } from '@fluentui/react-icons/svg/question-circle';
import { useTranslation } from 'react-i18next';
import type { TopicId } from '../../help/topics';
import { IconButton } from '../../ui/components';
import { openHelp } from './openHelp';

export function HelpButton({ topic, label }: { topic: TopicId; label?: string }) {
  const { t } = useTranslation();
  return (
    <IconButton
      className="help-button"
      size="small"
      label={label ?? t('ui.pane.help')}
      icon={<QuestionCircle20Regular />}
      data-help-topic={topic}
      onClick={() => {
        openHelp(topic);
      }}
    />
  );
}
