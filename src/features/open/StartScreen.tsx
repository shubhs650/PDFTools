import { useTranslation } from 'react-i18next';
import { runCommand } from '../../app/commands/dispatch';
import { Button } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';

const OPEN = 'file.open';

/** Shown when no document is open. M1-18 adds the recent-files list. */
export function StartScreen() {
  const { t } = useTranslation();
  return (
    <section className="start-screen" aria-labelledby="start-title" data-testid="start-screen">
      <h2 id="start-title">{t('open.start.title')}</h2>
      <p>{t('open.start.hint')}</p>
      <Button
        label={t('open.start.open')}
        variant="primary"
        icon={<CommandIcon id={OPEN} />}
        onClick={() => {
          void runCommand(OPEN);
        }}
      />
    </section>
  );
}
