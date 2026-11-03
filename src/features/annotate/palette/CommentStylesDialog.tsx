// Comment → Comment Styles Palette (M6-07; rebuilt as a PDF-XChange-style
// window in M6-17, D-37): the comment tools in groups on the left; the
// selected tool's Current Style (its defaults, M6-03 store) and its Custom
// Styles (the presets and the user's own, one ordered list) as tiles in the
// middle; the selected tile's properties on the right, in the Properties
// pane's rows (M6-06). Clone, Rename, Reset, Delete, Set Current and
// Export/Import on the toolbar; Reset All on the left. Every change is
// saved on this device at once (rule 7 does not apply: nothing here is in a PDF).
import { ArrowExport20Regular } from '@fluentui/react-icons/svg/arrow-export';
import { ArrowImport20Regular } from '@fluentui/react-icons/svg/arrow-import';
import { ArrowReset20Regular } from '@fluentui/react-icons/svg/arrow-reset';
import { CheckmarkCircle20Regular } from '@fluentui/react-icons/svg/checkmark-circle';
import { Copy20Regular } from '@fluentui/react-icons/svg/copy';
import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { PanelRight20Regular } from '@fluentui/react-icons/svg/panel-right';
import { Rename20Regular } from '@fluentui/react-icons/svg/rename';
import { uuidV4 } from '@embedpdf/models';
import * as CM from '@radix-ui/react-context-menu';
import { forwardRef, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRovingToolbar } from '../../../app/ribbon/useRovingToolbar';
import { msg, type MessageKey } from '../../../i18n';
import { downloadBytes } from '../../../storage/fileAccess';
import { CommandIcon } from '../../../ui/icons/CommandIcon';
import { Button, Dialog } from '../../../ui/components';
import { StyleAndText } from '../properties/AnnotationProperties';
import { canBeCloudy, type Plain, type Prop } from '../properties/model';
import { TOOL_NAME_KEYS } from '../properties/toolProperties';
import {
  addStyle,
  closeStylesDialog,
  deleteStyle,
  exportStylesFile,
  importStylesFile,
  renameStyle,
  reorderStyle,
  resetAllStyles,
  resetStyle,
  setDialogTool,
  stylesOf,
  updateStyle,
  useCommentStyles,
} from '../tools/commentStylesStore';
import {
  cloneName,
  gridMove,
  isPristine,
  MAX_NAME,
  MAX_STYLES,
  presetOf,
  STYLE_FILE_SUFFIX,
  TOOL_COMMANDS,
  TOOL_GROUPS,
  type StyleFileError,
  type UserStyle,
} from '../tools/stylePalette';
import type { StyleProps, StyleTool } from '../tools/toolDefaults';
import {
  defaultsFor,
  resetToolDefaults,
  setToolDefaults,
  useToolDefaults,
} from '../tools/toolDefaultsStore';
import { styleName } from './presetName';
import { editedStyle, styleRows, styleSample } from './styleSample';
import { StyleSwatch } from './StyleSwatch';

const ERRORS: Record<StyleFileError, MessageKey> = {
  tooLarge: msg('stylePalette.error.tooLarge'),
  json: msg('stylePalette.error.json'),
  format: msg('stylePalette.error.format'),
  version: msg('stylePalette.error.version'),
  tool: msg('stylePalette.error.tool'),
  style: msg('stylePalette.error.style'),
  empty: msg('stylePalette.error.empty'),
  tooMany: msg('stylePalette.error.tooMany'),
};

const GROUP_KEYS: Record<string, MessageKey> = {
  drawings: msg('stylePalette.group.drawings'),
  textBoxes: msg('stylePalette.group.textBoxes'),
  textMarkups: msg('stylePalette.group.textMarkups'),
  notes: msg('stylePalette.group.notes'),
};

const EXPORT_NAME = 'comment-styles';
const JSON_TYPE = 'application/json';
/** The Current Style tile's id among the tiles. */
const CURRENT = 'current';
/** A tile's preview size in px. */
const TILE_ART = 56;

export function CommentStylesDialog() {
  const open = useCommentStyles((s) => s.dialogOpen);
  if (!open) return null;
  return <StylesWindow />;
}

function StylesWindow() {
  const { t } = useTranslation();
  const tool = useCommentStyles((s) => s.dialogTool);
  const loaded = useCommentStyles((s) => s.loaded);
  const list = useCommentStyles((s) => stylesOf(s, tool));
  // Re-read whenever the tool's current style changes.
  useToolDefaults((s) => s.overrides[tool]);
  const current = defaultsFor(tool);
  const [selected, setSelected] = useState<string>(CURRENT);
  const [renaming, setRenaming] = useState(false);
  const [showProps, setShowProps] = useState(true);
  const [message, setMessage] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const tilesRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const toolName = t(TOOL_NAME_KEYS[tool]);
  const index = list.findIndex((s) => s.id === selected);
  const style = index >= 0 ? list[index] : undefined;
  const name = (s: UserStyle): string => styleName(tool, s, t);
  const selectedName = style ? name(style) : t('stylePalette.current');
  const full = list.length >= MAX_STYLES;

  /** Focus a tile once React has drawn it. */
  const focusTile = (id: string): void => {
    requestAnimationFrame(() => {
      tilesRef.current?.querySelector<HTMLElement>(`[data-tile="${CSS.escape(id)}"]`)?.focus();
    });
  };
  const select = (id: string): void => {
    setSelected(id);
    setRenaming(false);
  };

  const chooseTool = (next: StyleTool): void => {
    setDialogTool(next);
    select(CURRENT);
  };

  // ------------------------------------------------------------ actions
  const clone = async (): Promise<void> => {
    if (full) {
      setMessage(t('stylePalette.full', { max: MAX_STYLES }));
      return;
    }
    const base = style ? name(style) : t('stylePalette.current');
    const newName = cloneName(list.map(name), base, (b, n) =>
      n === 1
        ? t('stylePalette.copyName', { name: b })
        : t('stylePalette.copyNameN', { name: b, n }),
    );
    const id = uuidV4();
    const props: StyleProps = style ? { ...style.props } : { ...current };
    if (await addStyle(tool, newName, props, id, style?.id ?? null)) {
      setSelected(id);
      setRenaming(true);
      setMessage(t('stylePalette.added', { name: newName, tool: toolName }));
    }
  };
  const reset = async (): Promise<void> => {
    if (!style) {
      await resetToolDefaults(tool);
      setMessage(t('stylePalette.currentReset', { tool: toolName }));
    } else if (presetOf(tool, style)) {
      await resetStyle(tool, style.id);
      setMessage(t('stylePalette.resetDone', { name: name({ ...style, name: '' }) }));
    }
  };
  const remove = async (): Promise<void> => {
    if (!style) return;
    const next = list[index + 1] ?? list[index - 1];
    await deleteStyle(tool, style.id);
    setMessage(t('stylePalette.deleted', { name: name(style) }));
    select(next?.id ?? CURRENT);
    focusTile(next?.id ?? CURRENT);
  };
  const setCurrent = async (): Promise<void> => {
    if (!style) return;
    await setToolDefaults(tool, style.props);
    setMessage(t('stylePalette.currentSet', { tool: toolName, name: name(style) }));
  };
  const move = async (delta: -1 | 1): Promise<void> => {
    if (!style) return;
    await reorderStyle(tool, style.id, delta);
    focusTile(style.id);
  };
  const commitRename = async (value: string): Promise<boolean> => {
    if (!style) return true;
    if (value.trim() === name(style)) return true;
    if (await renameStyle(tool, style.id, value)) {
      setMessage(t('stylePalette.renamed', { name: value.trim() }));
      return true;
    }
    setMessage(t('stylePalette.badName', { max: MAX_NAME }));
    return false;
  };
  const edit = (p: Prop) => (v: Plain) => {
    const next = editedStyle(tool, style ? style.props : {}, p, v);
    if (!next) return;
    if (style) void updateStyle(tool, style.id, next);
    else void setToolDefaults(tool, next);
  };
  const exportAll = (): void => {
    const blob = new Blob([exportStylesFile((tl, s) => styleName(tl, s, t))], { type: JSON_TYPE });
    downloadBytes(blob, `${EXPORT_NAME}${STYLE_FILE_SUFFIX}`);
    setMessage(t('stylePalette.exported'));
  };
  const importFile = (file: File): void => {
    void file
      .text()
      .then((text) => importStylesFile(text, uuidV4))
      .then((r) => {
        setMessage(
          r.ok
            ? t('stylePalette.imported', { count: r.count })
            : t('stylePalette.importRefused', {
                reasons: r.errors.map((er) => t(ERRORS[er])).join(' '),
              }),
        );
      });
  };

  const canReset = style ? !!presetOf(tool, style) && !isPristine(tool, style) : true;
  const actions: ToolbarAction[] = [
    {
      id: 'clone',
      label: t('stylePalette.clone'),
      icon: <Copy20Regular />,
      disabled: full,
      run: clone,
    },
    {
      id: 'rename',
      label: t('stylePalette.rename'),
      icon: <Rename20Regular />,
      disabled: !style,
      run: () => {
        setRenaming(true);
      },
    },
    {
      id: 'reset',
      label: t('stylePalette.reset'),
      icon: <ArrowReset20Regular />,
      disabled: !canReset,
      run: reset,
    },
    {
      id: 'delete',
      label: t('stylePalette.delete'),
      icon: <Delete20Regular />,
      disabled: !style,
      run: remove,
    },
    {
      id: 'properties',
      label: t('stylePalette.properties'),
      icon: <PanelRight20Regular />,
      pressed: showProps,
      run: () => {
        setShowProps((v) => !v);
      },
    },
    {
      id: 'setCurrent',
      label: t('stylePalette.setCurrent'),
      icon: <CheckmarkCircle20Regular />,
      disabled: !style,
      run: setCurrent,
    },
    {
      id: 'export',
      label: t('stylePalette.export'),
      icon: <ArrowExport20Regular />,
      run: exportAll,
    },
    {
      id: 'import',
      label: t('stylePalette.import'),
      icon: <ArrowImport20Regular />,
      run: () => {
        importRef.current?.click();
      },
    },
  ];

  const tileKeys = (e: KeyboardEvent<HTMLElement>): void => {
    if (renaming) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      void move(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const keyActions: Record<string, () => unknown> = {
      Enter: setCurrent,
      F2: () => {
        if (style) setRenaming(true);
      },
      Delete: remove,
    };
    const act = keyActions[e.key];
    if (act) {
      e.preventDefault();
      void act();
      return;
    }
    // Arrow keys move in two dimensions over the tiles as laid out (rows by position).
    const tiles = [...(tilesRef.current?.querySelectorAll<HTMLElement>('[data-tile]') ?? [])];
    const rows: number[][] = [];
    let top = Number.NaN;
    tiles.forEach((el, i) => {
      if (el.offsetTop !== top || rows.length === 0) {
        rows.push([]);
        top = el.offsetTop;
      }
      rows[rows.length - 1]?.push(i);
    });
    const at = tiles.findIndex((el) => el.dataset['tile'] === selected);
    const next = gridMove(rows, Math.max(0, at), e.key);
    if (next === undefined) return;
    e.preventDefault();
    const id = tiles[next]?.dataset['tile'];
    if (id) {
      select(id);
      tiles[next]?.focus();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeStylesDialog();
      }}
      title={t('stylePalette.title')}
      description={t('stylePalette.description')}
      closeIcon={<Dismiss20Regular />}
      className="styles-window"
      onEscapeKeyDown={(e) => {
        // Esc in the name field cancels the rename, not the window.
        if (renaming) {
          e.preventDefault();
          setRenaming(false);
          focusTile(selected);
        }
      }}
      footer={
        <>
          <p className="styles-window-message" role="status" data-testid="comment-styles-message">
            {message}
          </p>
          <Button label={t('stylePalette.close')} onClick={closeStylesDialog} />
        </>
      }
    >
      <div className="styles-window-body" data-testid="comment-styles-dialog">
        <ToolList
          tool={tool}
          onChoose={chooseTool}
          onResetAll={() => {
            setConfirmReset(true);
          }}
        />
        <div className="styles-window-main">
          <Toolbar actions={actions} label={t('stylePalette.toolbar')} />
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="ui-visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="comment-styles-import"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) importFile(file);
            }}
          />
          <div
            className={
              showProps ? 'styles-window-split' : 'styles-window-split styles-window-split--wide'
            }
          >
            {loaded ? (
              <div
                ref={tilesRef}
                className="styles-tiles"
                role="listbox"
                aria-label={t('stylePalette.listOf', { tool: toolName })}
                aria-describedby="styles-window-keys"
                tabIndex={-1}
              >
                <div
                  role="group"
                  aria-label={t('stylePalette.current')}
                  className="styles-tiles-row"
                >
                  <Tile
                    id={CURRENT}
                    tool={tool}
                    props={current}
                    name={t('stylePalette.current')}
                    selected={selected === CURRENT}
                    current
                    onSelect={select}
                    onKeyDown={tileKeys}
                  />
                </div>
                <div className="styles-tiles-heading" aria-hidden="true">
                  {t('stylePalette.custom')}
                </div>
                <div
                  role="group"
                  aria-label={t('stylePalette.custom')}
                  className="styles-tiles-row"
                >
                  {list.map((s, i) => (
                    <TileMenu
                      key={s.id}
                      label={t('stylePalette.styleMenu', { name: name(s) })}
                      items={[
                        { label: t('stylePalette.setCurrent'), run: setCurrent },
                        { label: t('stylePalette.clone'), run: clone, disabled: full },
                        {
                          label: t('stylePalette.rename'),
                          run: () => {
                            setRenaming(true);
                          },
                        },
                        {
                          label: t('stylePalette.reset'),
                          run: reset,
                          disabled: !presetOf(tool, s) || isPristine(tool, s),
                        },
                        { label: t('stylePalette.delete'), run: remove },
                        {
                          label: t('stylePalette.moveEarlier'),
                          run: () => move(-1),
                          disabled: i === 0,
                        },
                        {
                          label: t('stylePalette.moveLater'),
                          run: () => move(1),
                          disabled: i === list.length - 1,
                        },
                      ]}
                      onOpen={() => {
                        select(s.id);
                      }}
                    >
                      <Tile
                        id={s.id}
                        tool={tool}
                        props={{ ...current, ...s.props }}
                        name={name(s)}
                        selected={selected === s.id}
                        onSelect={select}
                        onKeyDown={tileKeys}
                        onActivate={() => void setCurrent()}
                        renaming={renaming && selected === s.id}
                        onRename={async (value) => {
                          if (value === null) {
                            setRenaming(false);
                            focusTile(s.id);
                            return;
                          }
                          if (await commitRename(value)) {
                            setRenaming(false);
                            focusTile(s.id);
                          }
                        }}
                      />
                    </TileMenu>
                  ))}
                  {list.length === 0 ? (
                    <p className="styles-tiles-empty">
                      {t('stylePalette.noCustom', { tool: toolName })}
                    </p>
                  ) : null}
                </div>
                <p id="styles-window-keys" className="styles-window-keys">
                  {t('stylePalette.keys')}
                </p>
              </div>
            ) : (
              <p className="styles-tiles">{t('stylePalette.loading')}</p>
            )}
            {showProps ? (
              <StyleProperties
                tool={tool}
                props={style ? style.props : {}}
                title={t('stylePalette.propertiesOf', { name: selectedName })}
                onEdit={edit}
              />
            ) : null}
          </div>
        </div>
      </div>
      {confirmReset ? (
        <ResetAllDialog
          onClose={() => {
            setConfirmReset(false);
          }}
          onConfirm={async () => {
            setConfirmReset(false);
            await resetAllStyles();
            select(CURRENT);
            setMessage(t('stylePalette.resetAllDone'));
          }}
        />
      ) : null}
    </Dialog>
  );
}

// ------------------------------------------------------------ tool list

/** The comment tools in groups: a listbox, Up/Down/Home/End and type-ahead move and choose. */
function ToolList({
  tool,
  onChoose,
  onResetAll,
}: {
  tool: StyleTool;
  onChoose: (tool: StyleTool) => void;
  onResetAll: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const all = TOOL_GROUPS.flatMap((g) => g.tools);
  const go = (next: StyleTool | undefined): void => {
    if (!next) return;
    onChoose(next);
    ref.current?.querySelector<HTMLElement>(`[data-tool="${next}"]`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const at = all.indexOf(tool);
    const moves: Record<string, StyleTool | undefined> = {
      ArrowDown: all[Math.min(all.length - 1, at + 1)],
      ArrowUp: all[Math.max(0, at - 1)],
      Home: all[0],
      End: all[all.length - 1],
    };
    if (e.key in moves) {
      e.preventDefault();
      go(moves[e.key]);
      return;
    }
    // Type-ahead: the next tool whose name starts with the letter.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLocaleLowerCase();
      const order = [...all.slice(at + 1), ...all.slice(0, at + 1)];
      const hit = order.find((x) => t(TOOL_NAME_KEYS[x]).toLocaleLowerCase().startsWith(k));
      if (hit) {
        e.preventDefault();
        go(hit);
      }
    }
  };
  return (
    <div className="styles-tools">
      <Button
        size="small"
        variant="subtle"
        className="styles-tools-reset"
        icon={<ArrowReset20Regular />}
        label={t('stylePalette.resetAll')}
        onClick={onResetAll}
      />
      <div
        ref={ref}
        className="styles-tools-list"
        role="listbox"
        aria-label={t('stylePalette.tools')}
        tabIndex={-1}
      >
        {TOOL_GROUPS.map((g) => (
          <div key={g.id} role="group" aria-labelledby={`styles-group-${g.id}`}>
            <div id={`styles-group-${g.id}`} className="styles-tools-heading">
              {t(GROUP_KEYS[g.id] ?? msg('stylePalette.tools'))}
            </div>
            {g.tools.map((x) => (
              <div
                key={x}
                role="option"
                className="styles-tools-item ui-focusable"
                data-tool={x}
                aria-selected={x === tool}
                tabIndex={x === tool ? 0 : -1}
                onKeyDown={onKeyDown}
                onClick={() => {
                  onChoose(x);
                }}
              >
                <CommandIcon id={TOOL_COMMANDS[x]} />
                <span>{t(TOOL_NAME_KEYS[x])}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ toolbar

interface ToolbarAction {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  run: () => unknown;
}

/** One tab stop; Left/Right/Home/End move (rule 12). Disabled buttons stay focusable. */
function Toolbar({ actions, label }: { actions: ToolbarAction[]; label: string }) {
  const roving = useRovingToolbar(actions.length);
  return (
    <div className="styles-toolbar" role="toolbar" aria-label={label} onKeyDown={roving.onKeyDown}>
      {actions.map((a, i) => (
        <button
          key={a.id}
          ref={roving.register(i)}
          type="button"
          className="ui-button ui-button--subtle styles-toolbar-button"
          data-action={a.id}
          tabIndex={roving.index === i ? 0 : -1}
          aria-disabled={a.disabled ? true : undefined}
          {...(a.pressed === undefined ? {} : { 'aria-pressed': a.pressed })}
          onFocus={() => {
            roving.setCurrent(i);
          }}
          onClick={() => {
            if (!a.disabled) void a.run();
          }}
        >
          <span aria-hidden="true" className="styles-toolbar-icon">
            {a.icon}
          </span>
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ tiles

const Tile = forwardRef<
  HTMLDivElement,
  {
    id: string;
    tool: StyleTool;
    props: StyleProps;
    name: string;
    selected: boolean;
    current?: boolean;
    onSelect: (id: string) => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    onActivate?: () => void;
    renaming?: boolean;
    /** The new name, or null when the rename is cancelled. */
    onRename?: (value: string | null) => void | Promise<void>;
  }
>(function Tile(
  {
    id,
    tool,
    props,
    name,
    selected,
    current = false,
    onSelect,
    onKeyDown,
    onActivate,
    renaming,
    onRename,
    ...rest
  },
  ref,
) {
  const { t } = useTranslation();
  return (
    <div
      ref={ref}
      {...rest}
      role="option"
      className={
        current ? 'styles-tile styles-tile--current ui-focusable' : 'styles-tile ui-focusable'
      }
      data-tile={id}
      aria-selected={selected}
      aria-label={name}
      tabIndex={selected ? 0 : -1}
      onClick={() => {
        onSelect(id);
      }}
      onFocus={() => {
        if (!selected) onSelect(id);
      }}
      onKeyDown={onKeyDown}
      onDoubleClick={onActivate}
    >
      <span className="styles-tile-art">
        <StyleSwatch tool={tool} props={props} size={TILE_ART} />
      </span>
      {renaming && onRename ? (
        <RenameField initial={name} label={t('stylePalette.name')} onDone={onRename} />
      ) : (
        <span className="styles-tile-name" aria-hidden="true">
          {name}
        </span>
      )}
    </div>
  );
});

function RenameField({
  initial,
  label,
  onDone,
}: {
  initial: string;
  label: string;
  onDone: (value: string | null) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="ui-field-input styles-tile-input"
      aria-label={label}
      value={value}
      maxLength={MAX_NAME}
      onChange={(e) => {
        setValue(e.currentTarget.value);
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        // The field's keys are its own (not the tiles' arrows, Enter or Delete).
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          done.current = true;
          void onDone(value);
        }
      }}
      onBlur={() => {
        if (!done.current) void onDone(value);
      }}
    />
  );
}

/** A tile's right-click menu (the Menu key and Shift+F10 open it too). */
function TileMenu({
  label,
  items,
  onOpen,
  children,
}: {
  label: string;
  items: { label: string; run: () => unknown; disabled?: boolean }[];
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <CM.Root
      modal
      onOpenChange={(o) => {
        if (o) onOpen();
      }}
    >
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className="ui-menu ui-context-menu" aria-label={label} collisionPadding={8}>
          {items.map((it) => (
            <CM.Item
              key={it.label}
              className="ui-menu-item"
              disabled={it.disabled ?? false}
              onSelect={() => {
                void it.run();
              }}
            >
              <span className="ui-menu-label">{it.label}</span>
            </CM.Item>
          ))}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

// ------------------------------------------------------------ properties

/** The selected tile's properties in the Properties pane's rows (M6-06), changed in place. */
function StyleProperties({
  tool,
  props,
  title,
  onEdit,
}: {
  tool: StyleTool;
  props: StyleProps;
  title: string;
  onEdit: (p: Prop) => (v: Plain) => void;
}) {
  const { t } = useTranslation();
  const rows = styleRows(tool, props);
  return (
    <form
      className="annot-props styles-window-props"
      aria-label={title}
      data-testid="style-properties"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <p className="prop-summary">{title}</p>
      {Object.keys(rows).length === 0 ? (
        <p className="prop-empty-hint">{t('stylePalette.noProperties')}</p>
      ) : (
        <StyleAndText
          props={rows}
          cloudy={canBeCloudy(styleSample(tool, props))}
          disabled={false}
          set={onEdit}
        />
      )}
    </form>
  );
}

// ------------------------------------------------------------ reset all

function ResetAllDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('stylePalette.resetAllTitle')}
      description={t('stylePalette.resetAllBody')}
      closeIcon={<Dismiss20Regular />}
      initialFocus={cancel}
      footer={
        <>
          <Button ref={cancel} label={t('stylePalette.cancel')} onClick={onClose} />
          <Button
            variant="primary"
            label={t('stylePalette.resetAll')}
            onClick={() => {
              void onConfirm();
            }}
          />
        </>
      }
    />
  );
}
