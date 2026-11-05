// The text menu (M7-05, ADR-023 D-43 e; bug B10): while a text box,
// typewriter or callout is being edited, a right click in it, Shift+F10 or
// the Menu key opens this menu instead of the browser's. The edit commands
// come from the command table (label, icon, keys, disabled reason, as every
// menu, M6-02); Text Style is ours: font, size, bold, italic, the standard
// colours (M6-16) and alignment, for the whole comment. Keyboard as any menu
// (Radix); Esc closes it and the editor gets the focus back.
import { Checkmark20Regular } from '@fluentui/react-icons/svg/checkmark';
import { ChevronRight16Regular } from '@fluentui/react-icons/svg/chevron-right';
import { TextAlignCenter20Regular } from '@fluentui/react-icons/svg/text-align-center';
import { TextAlignLeft20Regular } from '@fluentui/react-icons/svg/text-align-left';
import { TextAlignRight20Regular } from '@fluentui/react-icons/svg/text-align-right';
import { TextBold20Regular } from '@fluentui/react-icons/svg/text-bold';
import { TextColor20Regular } from '@fluentui/react-icons/svg/text-color';
import { TextFont20Regular } from '@fluentui/react-icons/svg/text-font';
import { TextFontSize20Regular } from '@fluentui/react-icons/svg/text-font-size';
import { TextItalic20Regular } from '@fluentui/react-icons/svg/text-italic';
import * as CM from '@radix-ui/react-context-menu';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { commandLabelKey } from '../../app/commandLabels';
import { useCommandState } from '../../app/commands/useCommandState';
import { msg, type MessageKey } from '../../i18n';
import { ContextMenuItems } from '../../ui/components';
import { gridMove, PALETTE_COLUMNS, STANDARD_COLORS } from '../../ui/components/colorPalette';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { FONT_FAMILIES, type FontFamily } from './properties/model';
import { inTextEditor, textEditSession } from './textEdit';

const STYLE = 'text.style';
import {
  editedTextStyle,
  keyboardOpened,
  setTextStyle,
  textMenuClosed,
  textMenuOpeners,
  textMenuOpening,
} from './textMenu';
import {
  FONT_SIZES,
  TEXT_EDIT_ENTRIES,
  TEXT_PROPERTIES_ENTRIES,
  type TextStyle,
} from './textMenuModel';

/** Where a keyboard-opened menu appears: at the caret (or the editor's corner). */
function caretPoint(el: HTMLElement): { x: number; y: number } {
  const sel = window.getSelection();
  const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
  if (r && (r.width > 0 || r.height > 0)) return { x: r.left, y: r.bottom };
  const box = el.getBoundingClientRect();
  return { x: box.left + 4, y: box.top + 4 };
}

const FONT_KEYS: Record<FontFamily, MessageKey> = {
  helvetica: msg('annotProps.font.helvetica'),
  times: msg('annotProps.font.times'),
  courier: msg('annotProps.font.courier'),
};

const ALIGNS: readonly { value: number; key: MessageKey; icon: ReactNode }[] = [
  { value: 0, key: msg('textMenu.alignLeft'), icon: <TextAlignLeft20Regular aria-hidden /> },
  { value: 1, key: msg('textMenu.alignCenter'), icon: <TextAlignCenter20Regular aria-hidden /> },
  { value: 2, key: msg('textMenu.alignRight'), icon: <TextAlignRight20Regular aria-hidden /> },
];

export function TextEditMenu({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const open = (x: number, y: number): void => {
      if (!textMenuOpening()) return;
      trigger.current?.dispatchEvent(
        new window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 2,
        }),
      );
    };
    textMenuOpeners.set(documentId, open);
    // Shift+F10 and the Menu key in the editor (the document's own menu key is not
    // bound inside text, M6-02).
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
      if (!inTextEditor(e.target) || textEditSession()?.docId !== documentId) return;
      e.preventDefault();
      e.stopPropagation();
      const el = textEditSession()?.el;
      if (!el) return;
      const p = caretPoint(el);
      keyboardOpened();
      open(p.x, p.y);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      if (textMenuOpeners.get(documentId) === open) textMenuOpeners.delete(documentId);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [documentId]);

  return (
    <CM.Root modal>
      <CM.Trigger asChild>
        <span ref={trigger} className="text-menu-anchor" aria-hidden="true" />
      </CM.Trigger>
      <CM.Portal>
        <CM.Content
          className="ui-menu ui-context-menu"
          aria-label={t('textMenu.label')}
          collisionPadding={8}
          loop
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            textMenuClosed(documentId);
          }}
        >
          <ContextMenuItems entries={TEXT_EDIT_ENTRIES} />
          <CM.Separator className="ui-menu-separator" />
          <TextStyleMenu />
          <CM.Separator className="ui-menu-separator" />
          <ContextMenuItems entries={TEXT_PROPERTIES_ENTRIES} />
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

/** A submenu's trigger, drawn as the command menus' items. */
function SubTrigger({
  icon,
  label,
  disabled = false,
  command,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  command?: string;
}) {
  return (
    <CM.SubTrigger
      className="ui-menu-item"
      disabled={disabled}
      {...(command ? { 'data-command': command } : {})}
    >
      <span className="ui-menu-icon">{icon}</span>
      <span className="ui-menu-label">{label}</span>
      <ChevronRight16Regular aria-hidden className="ui-menu-chevron" />
    </CM.SubTrigger>
  );
}

function SubContent({ children, label }: { children: ReactNode; label: string }) {
  return (
    <CM.Portal>
      <CM.SubContent
        className="ui-menu ui-context-menu"
        aria-label={label}
        collisionPadding={8}
        loop
      >
        {children}
      </CM.SubContent>
    </CM.Portal>
  );
}

/** A ticked choice: the tick in the icon column, as the command menus' toggles. */
function Tick({ on, icon }: { on: boolean; icon?: ReactNode }) {
  return (
    <span className="ui-menu-icon">{on ? <Checkmark20Regular aria-hidden /> : (icon ?? null)}</span>
  );
}

function TextStyleMenu() {
  const { t } = useTranslation();
  const state = useCommandState(STYLE);
  const label = t(commandLabelKey(STYLE));
  // Read as the menu opens; each choice closes it.
  const style: TextStyle | null = editedTextStyle();
  // Disabled once the edit has ended (Properties ends it while the menu closes).
  if (!state.enabled || !style) {
    return (
      <CM.Sub>
        <SubTrigger icon={<CommandIcon id={STYLE} />} label={label} disabled command={STYLE} />
      </CM.Sub>
    );
  }
  return (
    <CM.Sub>
      <SubTrigger icon={<CommandIcon id={STYLE} />} label={label} command={STYLE} />
      <SubContent label={label}>
        <CM.Sub>
          <SubTrigger icon={<TextFont20Regular aria-hidden />} label={t('textMenu.font')} />
          <SubContent label={t('textMenu.font')}>
            <CM.RadioGroup
              value={style.family}
              onValueChange={(v) => {
                setTextStyle({ prop: 'fontFamily', value: v as FontFamily });
              }}
            >
              {FONT_FAMILIES.map((f) => (
                <CM.RadioItem key={f} value={f} className="ui-menu-item" data-font={f}>
                  <Tick on={style.family === f} />
                  <span className="ui-menu-label">{t(FONT_KEYS[f])}</span>
                </CM.RadioItem>
              ))}
            </CM.RadioGroup>
          </SubContent>
        </CM.Sub>
        <CM.Sub>
          <SubTrigger icon={<TextFontSize20Regular aria-hidden />} label={t('textMenu.size')} />
          <SubContent label={t('textMenu.size')}>
            <CM.RadioGroup
              value={String(style.size)}
              onValueChange={(v) => {
                setTextStyle({ prop: 'fontSize', value: Number(v) });
              }}
            >
              {FONT_SIZES.map((size) => (
                <CM.RadioItem
                  key={size}
                  value={String(size)}
                  className="ui-menu-item"
                  data-size={size}
                >
                  <Tick on={style.size === size} />
                  <span className="ui-menu-label">{t('textMenu.points', { size })}</span>
                </CM.RadioItem>
              ))}
            </CM.RadioGroup>
          </SubContent>
        </CM.Sub>
        <CM.CheckboxItem
          className="ui-menu-item"
          checked={style.bold}
          onCheckedChange={(on) => {
            setTextStyle({ prop: 'bold', value: on });
          }}
        >
          <Tick on={style.bold} icon={<TextBold20Regular aria-hidden />} />
          <span className="ui-menu-label">{t('textMenu.bold')}</span>
        </CM.CheckboxItem>
        <CM.CheckboxItem
          className="ui-menu-item"
          checked={style.italic}
          onCheckedChange={(on) => {
            setTextStyle({ prop: 'italic', value: on });
          }}
        >
          <Tick on={style.italic} icon={<TextItalic20Regular aria-hidden />} />
          <span className="ui-menu-label">{t('textMenu.italic')}</span>
        </CM.CheckboxItem>
        <CM.Sub>
          <SubTrigger icon={<TextColor20Regular aria-hidden />} label={t('textMenu.color')} />
          <SubContent label={t('textMenu.color')}>
            <ColorGrid value={style.color} />
          </SubContent>
        </CM.Sub>
        <CM.Separator className="ui-menu-separator" />
        <CM.RadioGroup
          value={String(style.align)}
          onValueChange={(v) => {
            setTextStyle({ prop: 'textAlign', value: Number(v) });
          }}
        >
          {ALIGNS.map((a) => (
            <CM.RadioItem
              key={a.value}
              value={String(a.value)}
              className="ui-menu-item"
              data-align={a.value}
            >
              <Tick on={style.align === a.value} icon={a.icon} />
              <span className="ui-menu-label">{t(a.key)}</span>
            </CM.RadioItem>
          ))}
        </CM.RadioGroup>
      </SubContent>
    </CM.Sub>
  );
}

/**
 * The standard colours (M6-16) as menu items in the picker's grid: arrows
 * move in two dimensions (the grid pattern), Enter picks, Esc or Left at a
 * row's start goes back.
 */
function ColorGrid({ value }: { value: string }) {
  const { t } = useTranslation();
  const cells = useRef<(HTMLDivElement | null)[]>([]);
  const onKey = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const next = gridMove(i, e.key, e.ctrlKey, STANDARD_COLORS.length, PALETTE_COLUMNS);
    // Left at a row's start leaves the submenu, as in any menu.
    if (next === null || next === i) return;
    e.preventDefault();
    e.stopPropagation();
    cells.current[next]?.focus();
  };
  return (
    <>
      <CM.Label className="ui-color-heading">{t('colorPicker.standard')}</CM.Label>
      <CM.RadioGroup
        className="ui-color-grid text-menu-colors"
        value={value}
        onValueChange={(v) => {
          setTextStyle({ prop: 'fontColor', value: v });
        }}
      >
        {STANDARD_COLORS.map((p, i) => (
          <CM.RadioItem
            key={p.hex}
            ref={(el) => {
              cells.current[i] = el;
            }}
            value={p.hex}
            className="ui-color-cell"
            style={{ background: p.hex }}
            aria-label={t(p.name)}
            title={t(p.name)}
            data-hex={p.hex}
            onKeyDown={onKey(i)}
          />
        ))}
      </CM.RadioGroup>
    </>
  );
}
