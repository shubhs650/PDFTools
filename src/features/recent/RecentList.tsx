import { Dismiss16Regular } from '@fluentui/react-icons/svg/dismiss';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../i18n';
import { Button, IconButton } from '../../ui/components';
import {
  clearRecent,
  dismissProblem,
  loadRecent,
  openRecent,
  recentSupported,
  removeRecent,
  useRecent,
  type RecentProblem,
} from './recent';

const PROBLEM: Record<RecentProblem, MessageKey> = {
  denied: msg('recent.denied'),
  missing: msg('recent.missing'),
};

const TEST_ID = 'recent-list';

/**
 * Recent files (§8, M1-18): name and when it was last opened; Enter or click
 * reopens (after the browser's permission prompt). Each entry can be removed;
 * "Clear recent" empties the list. Not shown where files have no handles.
 */
export function RecentList({
  onOpened,
  labelledBy,
}: {
  onOpened?: () => void;
  /** Id of an existing heading (the backstage section's); otherwise the list shows its own. */
  labelledBy?: string;
}) {
  const { t } = useTranslation();
  const entries = useRecent((s) => s.entries);
  const problem = useRecent((s) => s.problem);
  const supported = recentSupported();
  // "Last opened" times are relative to now; refresh them every minute.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (supported) void loadRecent();
  }, [supported]);

  if (!supported) return null;
  return (
    <section
      className="recent"
      aria-labelledby={labelledBy ?? 'recent-title'}
      data-testid={TEST_ID}
    >
      <div className="recent-header">
        {labelledBy ? <span /> : <h3 id="recent-title">{t('recent.title')}</h3>}
        {entries.length > 0 ? (
          <Button
            label={t('recent.clear')}
            size="small"
            variant="subtle"
            onClick={() => {
              void clearRecent();
            }}
          />
        ) : null}
      </div>
      {problem ? (
        <div className="recent-problem" role="alert">
          <span>{t(PROBLEM[problem.kind], { name: problem.name })}</span>
          <Button
            label={t('recent.removeEntry')}
            size="small"
            onClick={() => {
              void removeRecent(problem.id);
            }}
          />
          <Button
            label={t('recent.dismiss')}
            size="small"
            variant="subtle"
            onClick={dismissProblem}
          />
        </div>
      ) : null}
      {entries.length === 0 ? (
        <p className="recent-empty">{t('recent.empty')}</p>
      ) : (
        <ul className="recent-items">
          {entries.map((e) => (
            <li key={e.id} className="recent-item">
              <button
                type="button"
                className="recent-open ui-focusable"
                onClick={() => {
                  void openRecent(e).then((ok) => {
                    if (ok) onOpened?.();
                  });
                }}
              >
                <span className="recent-name">{e.name}</span>
                <span className="recent-when">
                  {format.relative(Math.min(e.lastOpened, now), now)}
                </span>
              </button>
              <IconButton
                label={t('recent.remove', { name: e.name })}
                icon={<Dismiss16Regular />}
                size="small"
                onClick={() => {
                  void removeRecent(e.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
