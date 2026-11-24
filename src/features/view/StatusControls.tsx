import { ArrowLeft20Regular } from '@fluentui/react-icons/svg/arrow-left';
import { ArrowRight20Regular } from '@fluentui/react-icons/svg/arrow-right';
import { ChevronDown16Regular } from '@fluentui/react-icons/svg/chevron-down';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { commandLabelKey } from '../../app/commandLabels';
import { runCommand } from '../../app/commands/dispatch';
import { useCommandState } from '../../app/commands/useCommandState';
import { selectActive, useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
import { shortcutText } from '../../app/keys/labels';
import { DropdownMenu, IconButton, Tooltip, type MenuEntry } from '../../ui/components';
import { buttonClass } from '../../ui/components/buttonClass';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { VIEW_MODE_COMMANDS } from './commands';
import { goToPage, setZoom, zoomTo } from './controller';
import { recordJump } from './viewHistory';
import { parsePageInput } from './navigation';
import { ZOOM_PRESETS, parseZoomInput } from './zoom';

function CommandButton({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <IconButton
      label={t(commandLabelKey(id))}
      icon={<CommandIcon id={id} />}
      size="small"
      onClick={() => {
        void runCommand(id);
      }}
    />
  );
}

/**
 * A text box that shows `display` until edited; Enter commits through
 * `commit` (false = invalid, stays open and marked), Esc or blur reverts.
 */
function StatusInput({
  label,
  display,
  commit,
  className,
}: {
  label: string;
  display: string;
  commit: (text: string) => boolean;
  className: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (draft === null) return;
      if (commit(draft)) {
        setDraft(null);
        setInvalid(false);
      } else {
        setInvalid(true);
      }
    } else if (e.key === 'Escape') {
      setDraft(null);
      setInvalid(false);
    }
  };
  return (
    <input
      type="text"
      className={`status-input ui-focusable ${className}`}
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={draft ?? display}
      onFocus={(e) => {
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        setDraft(null);
        setInvalid(false);
      }}
    />
  );
}

/** Status bar page navigation (§5): first, previous, page box, of N, next, last. */
export function PageNav() {
  const { t } = useTranslation();
  const doc = useDocuments(selectActive);
  // A comparison's windows show one sheet each: the sheet list moves between pages (M12-12).
  const comparison = useDocuments((s) => !!s.activeTab && !!s.comparisons[s.activeTab]);
  if (!doc || comparison) return null;
  const count = doc.meta.pageCount;
  return (
    <div role="group" aria-label={t('status.pageNav')} className="status-group">
      <CommandButton id="view.firstPage" />
      <CommandButton id="view.prevPage" />
      <StatusInput
        key={doc.meta.id}
        className="status-input--page"
        label={t('status.pageNumber')}
        display={format.number(doc.view.page + 1, 0)}
        commit={(text) => {
          const index = parsePageInput(text, count, format.locale);
          if (index === null) return false;
          recordJump();
          goToPage(index);
          return true;
        }}
      />
      <span className="status-text">{t('status.pageOf', { total: format.number(count, 0) })}</span>
      <CommandButton id="view.nextPage" />
      <CommandButton id="view.lastPage" />
    </div>
  );
}

/** Previous / Next View's keys as `aria-keyshortcuts` spells them (the keymap's chords). */
const BACK_KEYS = 'Alt+ArrowLeft';
const FORWARD_KEYS = 'Alt+ArrowRight';
const MODE_MENU_TEST_ID = 'view-mode-menu';

/** A thin upright line between status bar groups (M13-04), shown with a document. */
export function StatusDivider() {
  const doc = useDocuments(selectActive);
  return doc ? <span className="status-divider" aria-hidden="true" /> : null;
}

/**
 * Previous View and Next View (M13-04, D-70): two arrows right of the page buttons, after
 * a divider; greyed when there is nowhere to go (still focusable, the tooltip says why).
 * One history for the window, so they show on a comparison tab too.
 */
export function ViewHistoryNav() {
  const { t } = useTranslation();
  const tab = useDocuments((s) => s.activeTab);
  const pages = useDocuments((s) => !!s.activeTab && !!s.docs[s.activeTab]);
  if (!tab) return null;
  return (
    <>
      {pages ? <span className="status-divider" aria-hidden="true" /> : null}
      <div role="group" aria-label={t('status.viewHistory')} className="status-group">
        <HistoryButton id="view.prevView" aria={BACK_KEYS} icon={<ArrowLeft20Regular />} />
        <HistoryButton id="view.nextView" aria={FORWARD_KEYS} icon={<ArrowRight20Regular />} />
      </div>
    </>
  );
}

/** `aria`: the keys as `aria-keyshortcuts` spells them (the tooltip shows them for people). */
function HistoryButton({ id, aria, icon }: { id: string; aria: string; icon: ReactNode }) {
  const { t } = useTranslation();
  const state = useCommandState(id);
  const label = t(commandLabelKey(id));
  const keys = shortcutText(id, t);
  const named = keys ? t('ribbon.withShortcut', { label, keys }) : label;
  const tip = state.enabled
    ? named
    : t('status.withReason', { label: named, reason: t(state.reason) });
  return (
    <Tooltip content={tip} side="top">
      <button
        type="button"
        className={buttonClass('subtle', 'small', 'ui-button--icon')}
        aria-label={label}
        aria-disabled={!state.enabled || undefined}
        aria-keyshortcuts={aria}
        data-command={id}
        onClick={() => {
          if (state.enabled) void runCommand(id);
        }}
      >
        <span aria-hidden="true">{icon}</span>
      </button>
    </Tooltip>
  );
}

/** Status bar zoom (§5): zoom out/in, a box that takes "150" or "150 %", and a level menu. */
export function ZoomBox() {
  const { t } = useTranslation();
  const doc = useDocuments(selectActive);
  if (!doc) return null;
  const fits: [string, Parameters<typeof setZoom>[0]][] = [
    ['view.fitPage', 'fitPage'],
    ['view.fitWidth', 'fitWidth'],
    ['view.fitVisible', 'fitVisible'],
    ['view.actualSize', 'actualSize'],
  ];
  const entries: MenuEntry[] = [
    ...fits.map(([id, target]) => ({
      id,
      label: t(commandLabelKey(id)),
      onSelect: () => {
        void setZoom(target);
      },
    })),
    { kind: 'separator' as const, id: 'sep' },
    ...ZOOM_PRESETS.map((z) => ({
      id: `z${String(z)}`,
      label: format.zoom(z),
      onSelect: () => {
        zoomTo(z);
      },
    })),
  ];
  return (
    <div role="group" aria-label={t('status.zoom')} className="status-group">
      <CommandButton id="view.zoomOut" />
      <StatusInput
        key={doc.meta.id}
        className="status-input--zoom"
        label={t('status.zoom')}
        display={format.zoom(doc.view.scale)}
        commit={(text) => {
          const z = parseZoomInput(text, format.locale);
          if (z === null) return false;
          zoomTo(z);
          return true;
        }}
      />
      <DropdownMenu
        align="end"
        entries={entries}
        trigger={
          <IconButton label={t('status.zoomLevels')} icon={<ChevronDown16Regular />} size="small" />
        }
      />
      <CommandButton id="view.zoomIn" />
    </div>
  );
}

function ModeButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const { pressed } = useCommandState(id);
  return (
    <IconButton
      label={t(commandLabelKey(id))}
      icon={<CommandIcon id={id} pressed={pressed} />}
      size="small"
      aria-pressed={pressed}
      onClick={() => {
        void runCommand(id);
      }}
    />
  );
}

/**
 * Status bar view-mode switch (§5): single, continuous, facing, continuous facing. In a
 * narrow window (the status bar's fold, M13-04, D-70) the four buttons fold into one
 * menu button before any status toggle loses its words.
 */
export function ViewModeSwitch() {
  const { t } = useTranslation();
  const doc = useDocuments(selectActive);
  if (!doc) return null;
  const mode = doc.view.mode;
  const current = VIEW_MODE_COMMANDS.find(([, m]) => m === mode)?.[0] ?? 'view.continuous';
  const menu: MenuEntry[] = [
    {
      kind: 'radio',
      id: 'modes',
      label: t('status.viewMode'),
      value: mode,
      options: VIEW_MODE_COMMANDS.map(([id, m]) => ({ value: m, label: t(commandLabelKey(id)) })),
      onValueChange: (value) => {
        const id = VIEW_MODE_COMMANDS.find(([, m]) => m === value)?.[0];
        if (id) void runCommand(id);
      },
    },
  ];
  return (
    <>
      <div role="group" aria-label={t('status.viewMode')} className="status-group status-modes">
        {VIEW_MODE_COMMANDS.map(([id]) => (
          <ModeButton key={id} id={id} />
        ))}
      </div>
      <div className="status-group status-modes-menu">
        <DropdownMenu
          align="end"
          entries={menu}
          trigger={
            <IconButton
              label={t('status.viewMode')}
              icon={<CommandIcon id={current} />}
              size="small"
              data-testid={MODE_MENU_TEST_ID}
            />
          }
        />
      </div>
    </>
  );
}
