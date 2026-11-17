import { History20Regular } from '@fluentui/react-icons/svg/history';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { Button } from '../../ui/components';
import { dismissWaiting, reopenWaiting, useSession } from './session';

/** Names listed before "and N more". */
const LISTED = 4;

/**
 * Pick up where you left off (M11-08·O2, D-53): last session's files that the browser lets
 * us reopen only after a click (it asks to allow access again). On the start screen a card
 * above the drop card; with documents open (some files reopened at once) a bar above the
 * document. "Reopen files" asks for each; "Not now" forgets them.
 */
export function SessionPrompt({ variant }: { variant: 'card' | 'bar' }) {
  const { t } = useTranslation();
  const waiting = useSession((s) => s.waiting);
  const busy = useSession((s) => s.busy);
  if (waiting.length === 0) return null;
  const names = waiting.map((e) => e.name);
  const shown = names.slice(0, LISTED);
  const more = names.length - shown.length;
  const list =
    more > 0
      ? t('session.prompt.more', { list: format.list(shown), count: more })
      : format.list(shown);
  const actions = (
    <div className="session-prompt-actions">
      <Button
        label={t('session.prompt.reopen', { count: waiting.length })}
        variant="primary"
        size="small"
        disabled={busy}
        onClick={() => {
          void reopenWaiting();
        }}
      />
      <Button
        label={t('session.prompt.notNow')}
        variant="subtle"
        size="small"
        disabled={busy}
        onClick={dismissWaiting}
      />
    </div>
  );
  if (variant === 'bar')
    return (
      <section
        className="permission-banner session-bar"
        aria-label={t('session.prompt.title')}
        data-testid="session-prompt"
      >
        <p className="permission-banner-text">
          {t('session.prompt.bar', { count: waiting.length, list })}
        </p>
        {actions}
      </section>
    );
  return (
    <section
      className="session-card"
      aria-labelledby="session-card-title"
      aria-describedby="session-card-text"
      data-testid="session-prompt"
    >
      <span className="start-badge" aria-hidden="true">
        <History20Regular />
      </span>
      <div className="session-card-body">
        <h3 id="session-card-title" className="session-card-title">
          {t('session.prompt.title')}
        </h3>
        <p id="session-card-text" className="session-card-text">
          {t('session.prompt.text', { count: waiting.length, list })}
        </p>
        {actions}
      </div>
    </section>
  );
}
