// The Comments pane's toolbar (M6-05, B1): one row — the Options menu (sort,
// group, filters, expand / collapse, numbers on the page, import, export),
// Reply, Set status, Previous / Next comment and Delete. Replaces M3-11's five
// stacked fields. A toolbar with one tab stop (arrows move, rule 12).
import { ArrowCollapseAll20Regular } from '@fluentui/react-icons/svg/arrow-collapse-all';
import { ArrowExpandAll20Regular } from '@fluentui/react-icons/svg/arrow-expand-all';
import { ArrowExport20Regular } from '@fluentui/react-icons/svg/arrow-export';
import { ArrowImport20Regular } from '@fluentui/react-icons/svg/arrow-import';
import { ArrowReply20Regular } from '@fluentui/react-icons/svg/arrow-reply';
import { ArrowSort20Regular } from '@fluentui/react-icons/svg/arrow-sort';
import { CheckmarkCircle20Regular } from '@fluentui/react-icons/svg/checkmark-circle';
import { ChevronDown20Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronUp20Regular } from '@fluentui/react-icons/svg/chevron-up';
import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import { Filter20Regular } from '@fluentui/react-icons/svg/filter';
import { GroupList20Regular } from '@fluentui/react-icons/svg/group-list';
import { Settings20Regular } from '@fluentui/react-icons/svg/settings';
import { PdfAnnotationState, type PdfAnnotationSubtype } from '@embedpdf/models';
import { forwardRef, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { commandLabelKey } from '../../../app/commandLabels';
import { runCommand } from '../../../app/commands/dispatch';
import { useCommandState, useCommandStates } from '../../../app/commands/useCommandState';
import { useRovingToolbar } from '../../../app/ribbon/useRovingToolbar';
import { msg, type MessageKey } from '../../../i18n';
import { DropdownMenu, Tooltip, type MenuEntry } from '../../../ui/components';
import { annotationTypeKey } from '../annotationTypes';
import type { CommentGroup, CommentSort } from './commentsModel';
import { setView, useComments, type CommentsView } from './commentsStore';
import { STATUS_FILTERS, STATUS_KEYS } from './statusLabels';
import { selectedRoots, setStatus } from './threadActions';

const SORTS: readonly { value: CommentSort; key: MessageKey }[] = [
  { value: 'page', key: msg('comments.sort.page') },
  { value: 'date', key: msg('comments.sort.date') },
  { value: 'author', key: msg('comments.sort.author') },
  { value: 'type', key: msg('comments.sort.type') },
];

const GROUPS: readonly { value: CommentGroup; key: MessageKey }[] = [
  { value: 'page', key: msg('comments.group.page') },
  { value: 'author', key: msg('comments.group.author') },
  { value: 'type', key: msg('comments.group.type') },
  { value: 'status', key: msg('comments.group.status') },
  { value: 'none', key: msg('comments.group.none') },
];

const REPLY = 'comment.reply';
const DELETE = 'comment.delete';

/** The statuses Set status offers (as the page's menu, M6-02). */
const SETTABLE = [
  PdfAnnotationState.None,
  PdfAnnotationState.Accepted,
  PdfAnnotationState.Rejected,
  PdfAnnotationState.Cancelled,
  PdfAnnotationState.Completed,
] as const;

export interface CommentsToolbarProps {
  docId: string;
  view: CommentsView;
  authors: readonly string[];
  types: readonly PdfAnnotationSubtype[];
  groupKeys: readonly string[];
  /** Previous / Next comment, or null at the ends of the list. */
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  /** The current page (Current page only). */
  page: number;
}

const toggled = <T,>(list: readonly T[] | undefined, v: T, on: boolean): T[] => {
  const rest = (list ?? []).filter((x) => x !== v);
  return on ? [...rest, v] : rest;
};

export function CommentsToolbar({
  docId,
  view,
  authors,
  types,
  groupKeys,
  onPrev,
  onNext,
  page,
}: CommentsToolbarProps) {
  const { t } = useTranslation();
  const roving = useRovingToolbar(6);
  const f = view.filter;
  const cmds = useCommandStates([
    'comment.importComments',
    'comment.exportAnnotations',
    'comment.autoNumber',
  ]);
  const setFilter = (filter: CommentsView['filter']): void => {
    setView(docId, { filter });
  };
  const options: MenuEntry[] = [
    {
      kind: 'submenu',
      id: 'sort',
      label: t('comments.sortLabel'),
      icon: <ArrowSort20Regular />,
      entries: [
        {
          kind: 'radio',
          id: 'sort-by',
          label: t('comments.sortLabel'),
          value: view.sort,
          options: SORTS.map((s) => ({ value: s.value, label: t(s.key) })),
          onValueChange: (v) => {
            setView(docId, { sort: v as CommentSort });
          },
        },
      ],
    },
    {
      kind: 'submenu',
      id: 'group',
      label: t('comments.groupLabel'),
      icon: <GroupList20Regular />,
      entries: [
        {
          kind: 'radio',
          id: 'group-by',
          label: t('comments.groupLabel'),
          value: view.group,
          options: GROUPS.map((g) => ({ value: g.value, label: t(g.key) })),
          onValueChange: (v) => {
            setView(docId, { group: v as CommentGroup, collapsed: [] });
          },
        },
      ],
    },
    {
      kind: 'submenu',
      id: 'show',
      label: t('comments.show'),
      icon: <Filter20Regular />,
      entries: [
        {
          kind: 'submenu',
          id: 'show-author',
          label: t('comments.author'),
          entries: authors.map((a) => ({
            kind: 'checkbox',
            id: `author-${a}`,
            label: a || t('annotate.noAuthor'),
            checked: f.authors?.includes(a) ?? false,
            onCheckedChange: (on: boolean) => {
              setFilter({ ...f, authors: toggled(f.authors, a, on) });
            },
          })),
        },
        {
          kind: 'submenu',
          id: 'show-type',
          label: t('comments.type'),
          entries: types.map((ty) => ({
            kind: 'checkbox',
            id: `type-${String(ty)}`,
            label: t(annotationTypeKey({ type: ty } as never)),
            checked: f.types?.includes(ty) ?? false,
            onCheckedChange: (on: boolean) => {
              setFilter({ ...f, types: toggled(f.types, ty, on) });
            },
          })),
        },
        {
          kind: 'submenu',
          id: 'show-status',
          label: t('comments.statusLabel'),
          entries: STATUS_FILTERS.map((s) => ({
            kind: 'checkbox',
            id: `status-${s}`,
            label: t(STATUS_KEYS[s]),
            checked: f.statuses?.includes(s) ?? false,
            onCheckedChange: (on: boolean) => {
              setFilter({ ...f, statuses: toggled(f.statuses, s, on) });
            },
          })),
        },
        { kind: 'separator', id: 'show-sep' },
        {
          kind: 'checkbox',
          id: 'this-page',
          label: t('comments.thisPage'),
          checked: view.currentPageOnly,
          onCheckedChange: (on) => {
            const rest = { ...f };
            delete rest.pages;
            setView(docId, {
              currentPageOnly: on,
              filter: on ? { ...rest, pages: [page, page] } : rest,
            });
          },
        },
      ],
    },
    { kind: 'separator', id: 'sep-groups' },
    {
      id: 'expand',
      label: t('comments.expandAll'),
      icon: <ArrowExpandAll20Regular />,
      disabled: view.group === 'none' || view.collapsed.length === 0,
      onSelect: () => {
        setView(docId, { collapsed: [] });
      },
    },
    {
      id: 'collapse',
      label: t('comments.collapseAll'),
      icon: <ArrowCollapseAll20Regular />,
      disabled: view.group === 'none' || groupKeys.length === 0,
      onSelect: () => {
        setView(docId, { collapsed: [...groupKeys] });
      },
    },
    { kind: 'separator', id: 'sep-numbers' },
    {
      kind: 'checkbox',
      id: 'numbers',
      label: t(commandLabelKey('comment.autoNumber')),
      checked: cmds['comment.autoNumber']?.pressed ?? false,
      onCheckedChange: () => {
        void runCommand('comment.autoNumber');
      },
    },
    { kind: 'separator', id: 'sep-transfer' },
    {
      id: 'import',
      label: t(commandLabelKey('comment.importComments')),
      icon: <ArrowImport20Regular />,
      disabled: !(cmds['comment.importComments']?.enabled ?? false),
      onSelect: () => {
        void runCommand('comment.importComments');
      },
    },
    {
      id: 'export',
      label: t(commandLabelKey('comment.exportAnnotations')),
      icon: <ArrowExport20Regular />,
      disabled: !(cmds['comment.exportAnnotations']?.enabled ?? false),
      onSelect: () => {
        void runCommand('comment.exportAnnotations');
      },
    },
  ];

  return (
    <div
      className="comments-toolbar"
      role="toolbar"
      aria-label={t('comments.toolbar')}
      onKeyDown={roving.onKeyDown}
    >
      <DropdownMenu
        trigger={
          <ToolButton
            ref={roving.register(0)}
            tabIndex={roving.index === 0 ? 0 : -1}
            label={t('comments.options')}
            icon={<Settings20Regular />}
            onFocus={() => {
              roving.setCurrent(0);
            }}
          />
        }
        entries={options}
      />
      <CommandToolButton
        ref={roving.register(1)}
        tabIndex={roving.index === 1 ? 0 : -1}
        command={REPLY}
        icon={<ArrowReply20Regular />}
        onFocus={() => {
          roving.setCurrent(1);
        }}
      />
      <StatusButton
        ref={roving.register(2)}
        docId={docId}
        tabIndex={roving.index === 2 ? 0 : -1}
        onFocus={() => {
          roving.setCurrent(2);
        }}
      />
      <ToolButton
        ref={roving.register(3)}
        tabIndex={roving.index === 3 ? 0 : -1}
        label={t('comments.prev')}
        icon={<ChevronUp20Regular />}
        reason={onPrev ? null : t('comments.noPrev')}
        onClick={onPrev ?? undefined}
        onFocus={() => {
          roving.setCurrent(3);
        }}
      />
      <ToolButton
        ref={roving.register(4)}
        tabIndex={roving.index === 4 ? 0 : -1}
        label={t('comments.next')}
        icon={<ChevronDown20Regular />}
        reason={onNext ? null : t('comments.noNext')}
        onClick={onNext ?? undefined}
        onFocus={() => {
          roving.setCurrent(4);
        }}
      />
      <CommandToolButton
        ref={roving.register(5)}
        tabIndex={roving.index === 5 ? 0 : -1}
        command={DELETE}
        icon={<Delete20Regular />}
        onFocus={() => {
          roving.setCurrent(5);
        }}
      />
    </div>
  );
}

interface ToolButtonProps {
  label: string;
  icon: ReactNode;
  tabIndex: number;
  /** Why it is disabled (shown and announced; the button stays focusable, rule 12). */
  reason?: string | null;
  onClick?: (() => void) | undefined;
  onFocus?: () => void;
  pressed?: boolean;
}

/** An icon button that stays focusable when disabled and says why (as the ribbon's). */
const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { label, icon, tabIndex, reason = null, onClick, onFocus, ...rest },
  ref,
) {
  const reasonId = useId();
  return (
    <Tooltip content={reason ? `${label} — ${reason}` : label}>
      <button
        ref={ref}
        type="button"
        className="ui-button ui-button--subtle ui-button--icon comments-tool"
        tabIndex={tabIndex}
        aria-label={label}
        aria-disabled={reason ? true : undefined}
        aria-describedby={reason ? reasonId : undefined}
        onFocus={onFocus}
        {...rest}
        onClick={(e) => {
          // Radix menu triggers pass their own handler through `rest`.
          (rest as { onClick?: (e: unknown) => void }).onClick?.(e);
          if (!reason) onClick?.();
        }}
      >
        <span aria-hidden="true">{icon}</span>
        {reason ? (
          <span id={reasonId} className="ui-visually-hidden">
            {reason}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
});

const CommandToolButton = forwardRef<
  HTMLButtonElement,
  { command: string; icon: ReactNode; tabIndex: number; onFocus: () => void }
>(function CommandToolButton({ command, icon, tabIndex, onFocus }, ref) {
  const { t } = useTranslation();
  const state = useCommandState(command);
  return (
    <ToolButton
      ref={ref}
      tabIndex={tabIndex}
      label={t(commandLabelKey(command))}
      icon={icon}
      reason={state.enabled ? null : t(state.reason)}
      onClick={() => {
        void runCommand(command);
      }}
      onFocus={onFocus}
    />
  );
});

/** Set status (M3-12): a menu of review states for the selected comments. */
const StatusButton = forwardRef<
  HTMLButtonElement,
  { docId: string; tabIndex: number; onFocus: () => void }
>(function StatusButton({ docId, tabIndex, onFocus }, ref) {
  const { t } = useTranslation();
  const state = useCommandState('comment.setStatus');
  const [open, setOpen] = useState(false);
  const focusStatus = useComments((s) => s.focusStatus);
  const [seen, setSeen] = useState(focusStatus);
  // comment.setStatus from the ribbon or a key opens this menu.
  if (focusStatus !== seen) {
    setSeen(focusStatus);
    if (state.enabled) setOpen(true);
  }
  const entries: MenuEntry[] = SETTABLE.map((s) => ({
    id: s,
    label: t(STATUS_KEYS[s]),
    onSelect: () => {
      for (const root of selectedRoots(docId)) void setStatus(docId, root, s);
    },
  }));
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o && state.enabled);
      }}
      trigger={
        <ToolButton
          ref={ref}
          tabIndex={tabIndex}
          label={t(commandLabelKey('comment.setStatus'))}
          icon={<CheckmarkCircle20Regular />}
          reason={state.enabled ? null : t(state.reason)}
          onFocus={onFocus}
        />
      }
      entries={entries}
    />
  );
});
