import { useTranslation } from 'react-i18next';
import { runCommand } from '../../app/commands/dispatch';
import { commandLabelKey } from '../../app/commandLabels';
import { shortcutText } from '../../app/keys/labels';
import { useDocuments } from '../../app/store/documentStore';
import { StatusToggle } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { useThinLines } from './thinLines';

const COMMAND = 'view.thinLines';
/** `aria-keyshortcuts` (the installed app gets Ctrl+5; Ctrl+Alt+5 works everywhere). */
const ARIA_KEYS = 'Control+5 Control+Alt+5';
const TEST_ID = 'thin-lines-toggle';

/**
 * Status bar (§5): Thin Lines as a labelled toggle (M13-05, D-69, D-70), before
 * Enable Snapping: the same command as View › Page Display and Ctrl+5. Shown with
 * a document, like the other view controls.
 */
export function ThinLinesStatus() {
  const { t } = useTranslation();
  const hasDoc = useDocuments((s) => s.activeId !== null);
  const on = useThinLines();
  if (!hasDoc) return null;
  const label = t(commandLabelKey(COMMAND));
  const keys = shortcutText(COMMAND, t);
  return (
    <StatusToggle
      label={label}
      pressed={on}
      onPressedChange={() => {
        void runCommand(COMMAND);
      }}
      icon={<CommandIcon id={COMMAND} pressed={on} />}
      tooltip={keys ? t('ribbon.withShortcut', { label, keys }) : label}
      keys={ARIA_KEYS}
      data-testid={TEST_ID}
    />
  );
}
