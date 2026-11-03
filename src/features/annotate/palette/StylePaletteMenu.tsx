// The arrow part of a comment tool's split button (M6-07, D-37, beta review
// B5): a palette of swatches — the tool's Custom Styles, the presets and the
// user's own in one list since M6-17 — and the Comment Styles Palette… footer. Keyboard (APG grid inside a menu): the
// arrow keys move in two dimensions, Home/End, Enter applies, Esc closes and
// focus returns to the arrow (Radix). With comments of the tool's group
// selected a swatch restyles them; otherwise it sets the tool's style.
import { ChevronDown12Regular } from '@fluentui/react-icons/svg/chevron-down';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { forwardRef, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../../../ui/components';
import { TOOL_NAME_KEYS } from '../properties/toolProperties';
import {
  loadCommentStyles,
  openStylesDialog,
  stylesOf,
  useCommentStyles,
} from '../tools/commentStylesStore';
import { pickStyle, restyleTargets } from '../tools/paletteActions';
import { gridMove, gridRows, isCurrent } from '../tools/stylePalette';
import type { StyleProps, StyleTool } from '../tools/toolDefaults';
import { defaultsFor, useToolDefaults } from '../tools/toolDefaultsStore';
import { documentStore, selectActive } from '../../../app/store/documentStore';
import { styleName } from './presetName';
import { StyleSwatch } from './StyleSwatch';

/** Swatches per row. */
const COLS = 7;

export interface StylePaletteMenuProps {
  tool: StyleTool;
  /** The split button's command (turns the tool on after a style is set). */
  command: string;
  /** The tool button's label (the arrow is "‹label› styles"). */
  label: string;
  tabIndex: number;
  disabled: boolean;
  /** Why it is disabled (translated), shown and announced like the button's. */
  reason: string | null;
}

export const StylePaletteMenu = forwardRef<HTMLButtonElement, StylePaletteMenuProps>(
  function StylePaletteMenu({ tool, command, label, tabIndex, disabled, reason }, ref) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const reasonId = useId();
    const name = t('stylePalette.open', { tool: label });
    const trigger = (
      <button
        ref={ref}
        type="button"
        className="ribbon-split-arrow ui-focusable"
        data-palette={tool}
        tabIndex={tabIndex}
        aria-label={name}
        aria-disabled={disabled || undefined}
        aria-describedby={reason ? reasonId : undefined}
        onPointerDown={(e) => {
          // Radix opens on pointer down: not while disabled.
          if (disabled) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (disabled && ['Enter', ' ', 'ArrowDown'].includes(e.key)) e.preventDefault();
        }}
      >
        <ChevronDown12Regular aria-hidden className="ribbon-split-chevron" />
        {reason ? (
          <span id={reasonId} className="ui-visually-hidden">
            {reason}
          </span>
        ) : null}
      </button>
    );
    return (
      <Menu.Root
        open={open}
        onOpenChange={(o) => {
          if (o && disabled) return;
          if (o) void loadCommentStyles();
          setOpen(o);
        }}
      >
        <Tooltip content={reason ? `${name} — ${reason}` : name}>
          <Menu.Trigger asChild>{trigger}</Menu.Trigger>
        </Tooltip>
        <Menu.Portal>
          {open ? <PaletteContent tool={tool} command={command} label={name} /> : null}
        </Menu.Portal>
      </Menu.Root>
    );
  },
);

function PaletteContent({
  tool,
  command,
  label,
}: {
  tool: StyleTool;
  command: string;
  label: string;
}) {
  const { t } = useTranslation();
  const list = useCommentStyles((s) => stylesOf(s, tool));
  useToolDefaults((s) => s.overrides[tool]);
  const current = defaultsFor(tool);
  // Read once when the palette opens: what a pick will do.
  const [targets] = useState(() => {
    const docId = selectActive(documentStore.getState())?.meta.id;
    return docId ? restyleTargets(docId, tool).length : 0;
  });
  const toolName = t(TOOL_NAME_KEYS[tool]);
  const rows = useMemo(() => gridRows([list.length], COLS, 1), [list.length]);

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>): void => {
    const el = document.activeElement;
    const at = el instanceof HTMLElement ? Number(el.dataset['idx']) : NaN;
    if (Number.isNaN(at)) return;
    const next = gridMove(rows, at, e.key);
    if (next === undefined) return;
    // Before Radix's linear roving (it skips a prevented event).
    e.preventDefault();
    e.currentTarget.querySelector<HTMLElement>(`[data-idx="${String(next)}"]`)?.focus();
  };

  const item = (idx: number, name: string, props: StyleProps, key: string) => (
    <Menu.Item
      key={key}
      className="style-swatch"
      data-idx={idx}
      data-swatch={key}
      data-current={(targets === 0 && isCurrent(props, current)) || undefined}
      aria-label={name}
      title={name}
      onSelect={() => {
        void pickStyle(tool, command, props, name);
      }}
    >
      <StyleSwatch tool={tool} props={{ ...current, ...props }} />
    </Menu.Item>
  );

  return (
    <Menu.Content
      className="ui-menu style-palette"
      aria-label={label}
      align="start"
      sideOffset={4}
      collisionPadding={8}
      loop={false}
      onKeyDownCapture={onKeyDownCapture}
      // The ribbon's toolbar must not see these keys (it roves and Esc leaves it).
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
    >
      <Menu.Label className="style-palette-hint">
        {targets > 0
          ? t('stylePalette.hintSelection', { count: targets })
          : t('stylePalette.hintTool', { tool: toolName })}
      </Menu.Label>
      {list.length > 0 ? (
        <Menu.Group className="style-palette-grid" aria-label={t('stylePalette.custom')}>
          {list.map((s, i) => item(i, styleName(tool, s, t), s.props, s.id))}
        </Menu.Group>
      ) : null}
      <Menu.Separator className="ui-menu-separator" />
      <Menu.Item
        className="ui-menu-item"
        data-idx={list.length}
        onSelect={() => {
          openStylesDialog(tool);
        }}
      >
        <span className="ui-menu-label">{t('stylePalette.manage')}</span>
      </Menu.Item>
    </Menu.Content>
  );
}
