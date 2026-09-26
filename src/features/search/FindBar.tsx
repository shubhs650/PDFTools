import { ChevronDown20Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronUp20Regular } from '@fluentui/react-icons/svg/chevron-up';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { Stop20Regular } from '@fluentui/react-icons/svg/stop';
import {
  TextCaseTitle20Filled,
  TextCaseTitle20Regular,
} from '@fluentui/react-icons/svg/text-case-title';
import {
  TextWholeWord20Filled,
  TextWholeWord20Regular,
} from '@fluentui/react-icons/svg/text-whole-word';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../i18n';
import { IconButton, ToggleButton } from '../../ui/components';
import {
  cancelFind,
  closeFind,
  findNext,
  currentOrdinal,
  setOption,
  setQuery,
  useFind,
} from './findStore';

const ERROR_MESSAGE: Record<string, MessageKey> = {
  'search-empty-query': msg('find.error.empty'),
  'search-invalid-query': msg('find.error.invalid'),
  'search-matches-empty': msg('find.error.matchesEmpty'),
  'search-failed': msg('find.error.failed'),
};

/**
 * Quick Find bar (Ctrl+F, §6): searches only on Enter or the buttons (rule 3);
 * Enter again / F3 go to the next hit, Shift+Enter / Shift+F3 to the previous;
 * Esc closes it and returns to the document.
 */
export function FindBar() {
  const { t } = useTranslation();
  const open = useFind((s) => s.open);
  const query = useFind((s) => s.query);
  const matchCase = useFind((s) => !!s.options.matchCase);
  const wholeWord = useFind((s) => !!s.options.wholeWord);
  const status = useFind((s) => s.status);
  const error = useFind((s) => s.error);
  const n = useFind(currentOrdinal);
  const total = useFind((s) => s.results.total);
  const progress = useFind((s) => (s.pageCount ? s.pagesDone / s.pageCount : 0));
  const input = useRef<HTMLInputElement>(null);
  const focusRequest = useFind((s) => s.focusRequest);

  useEffect(() => {
    if (open) input.current?.select();
  }, [open, focusRequest]);

  if (!open) return null;

  const statusText =
    status === 'error'
      ? t(ERROR_MESSAGE[error ?? ''] ?? msg('find.error.failed'))
      : total > 0
        ? t('find.status.count', { n: format.number(n, 0), total: format.number(total, 0) })
        : status === 'searching'
          ? t('find.status.searching', { percent: format.percent(progress, 0) })
          : status === 'done'
            ? t('find.status.none')
            : '';

  const close = (): void => {
    closeFind();
    document.getElementById('document-panel')?.focus();
    document.querySelector<HTMLElement>('[data-testid="document-view"]')?.focus();
  };

  return (
    <section className="find-bar" aria-label={t('find.barName')}>
      <input
        ref={input}
        className="find-input"
        type="search"
        aria-label={t('find.label')}
        placeholder={t('find.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          // F3 too: shortcuts are off while typing (M1-11), but not for Find's own keys.
          if (e.key === 'Enter' || e.key === 'F3') {
            e.preventDefault();
            void findNext(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <ToggleButton
        label={t('find.matchCase')}
        iconOnly
        size="small"
        icon={<TextCaseTitle20Regular />}
        pressedIcon={<TextCaseTitle20Filled />}
        pressed={matchCase}
        onPressedChange={(on) => {
          setOption('matchCase', on);
        }}
      />
      <ToggleButton
        label={t('find.wholeWord')}
        iconOnly
        size="small"
        icon={<TextWholeWord20Regular />}
        pressedIcon={<TextWholeWord20Filled />}
        pressed={wholeWord}
        onPressedChange={(on) => {
          setOption('wholeWord', on);
        }}
      />
      <IconButton
        label={t('find.prev')}
        size="small"
        icon={<ChevronUp20Regular />}
        onClick={() => {
          void findNext(-1);
        }}
      />
      <IconButton
        label={t('find.next')}
        size="small"
        icon={<ChevronDown20Regular />}
        onClick={() => {
          void findNext(1);
        }}
      />
      <span className="find-status" role="status" aria-live="polite">
        {statusText}
      </span>
      {status === 'searching' ? (
        <IconButton
          label={t('find.stop')}
          size="small"
          icon={<Stop20Regular />}
          onClick={cancelFind}
        />
      ) : null}
      <IconButton
        label={t('find.close')}
        size="small"
        icon={<Dismiss20Regular />}
        onClick={close}
      />
    </section>
  );
}
