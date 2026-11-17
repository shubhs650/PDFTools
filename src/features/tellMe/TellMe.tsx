// Tell me (M10-08·O2, ADR-027): Alt+Q (or the top bar's lightbulb) opens a small
// search box under the header that finds any command by name and runs it, showing
// where it lives on the ribbon and its shortcut. The search runs on Enter or the
// Search button, never while typing (rule 3); Enter again runs the chosen result.
import * as RadixDialog from '@radix-ui/react-dialog';
import { Search20Regular } from '@fluentui/react-icons/svg/search';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { commandLabelKey } from '../../app/commandLabels';
import { commandState, registerCommand, runCommand } from '../../app/commands/dispatch';
import { shortcutText } from '../../app/keys/labels';
import { IconButton } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { commandIndex, searchCommands, type SearchItem } from './commandSearch';

const TEST_ID = 'tell-me';

interface Result extends SearchItem {
  keys: string;
  /** Why it can't run now (null: it can). */
  reason: string | null;
  pressed: boolean;
}

export function TellMe() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** The query the results are for (null: no search yet). */
  const [searched, setSearched] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const returnTo = useRef<HTMLElement | null>(null);
  /** The command to run once the box has closed and focus is back where it was. */
  const pending = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const statusId = `${id}-status`;
  const optionId = (i: number): string => `${id}-option-${String(i)}`;

  useEffect(
    () =>
      registerCommand('app.tellMe', {
        run: () => {
          // Each opening starts afresh.
          setQuery('');
          setSearched(null);
          setResults([]);
          setActive(0);
          setOpen(true);
        },
      }),
    [],
  );

  const index = useMemo(() => commandIndex(), []);

  const search = (): void => {
    const items: SearchItem[] = index.map((e) => {
      const parts = e.where.map((k) => t(k));
      const where =
        parts.length === 2 ? t('tellMe.path', { tab: parts[0], group: parts[1] }) : parts.join('');
      return { id: e.id, label: t(commandLabelKey(e.id)), where };
    });
    // Each result's state is read once, at search time: nothing changes while the box is open.
    const found = searchCommands(items, query).map((item): Result => {
      const state = commandState(item.id);
      return {
        ...item,
        keys: shortcutText(item.id, t),
        reason: state.enabled ? null : t(state.reason),
        pressed: state.pressed,
      };
    });
    setResults(found);
    setSearched(query);
    setActive(0);
  };

  const run = (r: Result | undefined): void => {
    if (!r || r.reason) return;
    pending.current = r.id;
    setOpen(false);
  };

  const move = (step: number): void => {
    if (!results.length) return;
    setActive((i) => (i + step + results.length) % results.length);
  };

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${String(active)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter searches a new query; on the results of this one it runs the chosen command.
      if (searched === query && results.length) run(results[active]);
      else search();
    }
  };

  const stale = searched !== null && searched !== query;
  const status =
    searched === null || stale
      ? query.trim()
        ? t('tellMe.pending')
        : t('tellMe.hint')
      : results.length
        ? t('tellMe.count', { count: results.length })
        : searched.trim()
          ? t('tellMe.none', { query: searched.trim() })
          : t('tellMe.hint');

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Content
          className="tell-me"
          aria-describedby={statusId}
          data-testid={TEST_ID}
          onOpenAutoFocus={() => {
            const el = document.activeElement;
            returnTo.current = el instanceof HTMLElement ? el : null;
          }}
          onCloseAutoFocus={(e) => {
            // Focus goes back first, so a dialog the command opens returns there too.
            const el = returnTo.current;
            if (el?.isConnected) {
              e.preventDefault();
              el.focus();
            }
            const cmd = pending.current;
            pending.current = null;
            if (cmd) void runCommand(cmd);
          }}
        >
          <RadixDialog.Title className="ui-visually-hidden">{t('tellMe.title')}</RadixDialog.Title>
          <form
            role="search"
            className="tell-me-form"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <input
              className="ui-field-input tell-me-input"
              type="text"
              role="combobox"
              aria-label={t('tellMe.title')}
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={results.length ? optionId(active) : undefined}
              placeholder={t('tellMe.placeholder')}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              onKeyDown={onKey}
            />
            <IconButton
              type="submit"
              label={t('tellMe.search')}
              icon={<Search20Regular />}
              tooltip={false}
            />
          </form>
          <p id={statusId} className="tell-me-status" role="status" aria-live="polite">
            {status}
          </p>
          {results.length ? (
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={t('tellMe.results')}
              className="tell-me-results"
            >
              {results.map((r, i) => (
                // Keyboard: the arrow keys in the box move the choice (aria-activedescendant).
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  key={r.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={r.reason ? true : undefined}
                  className="tell-me-option"
                  data-index={i}
                  data-command={r.id}
                  // Focusable for the listbox pattern, but focus stays in the box.
                  tabIndex={-1}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onPointerMove={() => {
                    if (i !== active) setActive(i);
                  }}
                  onClick={() => {
                    run(r);
                  }}
                >
                  <CommandIcon id={r.id} pressed={r.pressed} className="tell-me-icon" />
                  <span className="tell-me-text">
                    <span className="tell-me-label">{r.label}</span>
                    <span className="tell-me-where">
                      {r.reason ? `${r.where} · ${r.reason}` : r.where}
                    </span>
                  </span>
                  {r.keys ? <kbd className="tell-me-keys">{r.keys}</kbd> : null}
                </div>
              ))}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
