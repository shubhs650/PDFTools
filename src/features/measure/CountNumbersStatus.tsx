import { useTranslation } from 'react-i18next';
import { runCommand } from '../../app/commands/dispatch';
import { commandLabelKey } from '../../app/commandLabels';
import { useDocuments } from '../../app/store/documentStore';
import { StatusToggle } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { useCountNumbers } from './countNumbers';

const COMMAND = 'view.countNumbers';
const TEST_ID = 'count-numbers-toggle';

/**
 * Status bar (§5): Same-Size Count Numbers as a labelled toggle (M14-07, D-75),
 * beside Thin Lines: the same command as View › Page Display. Shown with a
 * document, like the other view controls.
 */
export function CountNumbersStatus() {
  const { t } = useTranslation();
  const hasDoc = useDocuments((s) => s.activeId !== null);
  const on = useCountNumbers();
  if (!hasDoc) return null;
  const label = t(commandLabelKey(COMMAND));
  return (
    <StatusToggle
      label={label}
      pressed={on}
      onPressedChange={() => {
        void runCommand(COMMAND);
      }}
      icon={<CommandIcon id={COMMAND} pressed={on} />}
      tooltip={t('measure.count.sameSizeHint')}
      data-testid={TEST_ID}
    />
  );
}
