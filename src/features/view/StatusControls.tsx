import { ChevronDown16Regular } from '@fluentui/react-icons/svg/chevron-down';
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { commandLabelKey } from '../../app/commandLabels';
import { runCommand } from '../../app/commands/dispatch';
import { useCommandState } from '../../app/commands/useCommandState';
import { selectActive, useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
import { DropdownMenu, IconButton, type MenuEntry } from '../../ui/components';
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
  if (!doc) return null;
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

/** Status bar view-mode switch (§5): single, continuous, facing, continuous facing. */
export function ViewModeSwitch() {
  const { t } = useTranslation();
  const doc = useDocuments(selectActive);
  if (!doc) return null;
  return (
    <div role="group" aria-label={t('status.viewMode')} className="status-group">
      {VIEW_MODE_COMMANDS.map(([id]) => (
        <ModeButton key={id} id={id} />
      ))}
    </div>
  );
}
