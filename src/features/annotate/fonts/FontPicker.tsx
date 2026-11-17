// The comment font list (M11-07, D-52): a button showing the font, which
// opens a list of every font — Recently used, Standard, then the library's
// groups — each name drawn in its own face (the faces load only when the list
// opens). Used by the Properties pane, the tool defaults and the Comment
// Styles window (all through the property grid). Keyboard: Enter, Space or
// Down opens it; Up/Down, Home/End, Page Up/Down move; typing a name jumps to
// it; Enter or Space chooses; Esc closes (back to the button).
//
// Fonts on this computer (M11-08·O5, D-54): in Chromium the last section is
// "Show fonts on this computer…" until the browser lists them; a family is
// checked (embedding flags, outlines) as it scrolls into view and before it is
// used, and one that cannot be used stays listed, disabled, with the reason.
import { ChevronDown12Regular } from '@fluentui/react-icons/svg/chevron-down';
import * as Popover from '@radix-ui/react-popover';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cssFontStack, registerCommentFonts } from './commentFonts';
import { fontOption, fontSections, typeahead, type FontOption } from './fontList';
import { noteFontUsed, useRecentFonts } from './recentFonts';
import {
  checkSystemFamily,
  showSystemFonts,
  systemFontsSupported,
  useSystemFonts,
} from './systemFonts';

export interface FontPickerProps {
  /** The field's label element id: the button is named "‹label› ‹font›" (rule 12). */
  labelId: string;
  /** Accessible name of the list. */
  label: string;
  /** A comment font id, or null when the selection's fonts differ (Mixed). */
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
}

const PAGE = 8;
const TYPEAHEAD_MS = 700;
const ACTIVE_OPTION = '[data-active]';

export function FontPicker({ labelId, label, value, onChange, disabled, id }: FontPickerProps) {
  const { t } = useTranslation();
  const own = useId();
  const buttonId = id ?? own;
  const listId = `${buttonId}-list`;
  const valueId = `${buttonId}-value`;
  const recent = useRecentFonts();
  const [open, setOpen] = useState(false);
  const sysState = useSystemFonts((s) => s.state);
  const sysIds = useSystemFonts((s) => s.ids);
  const sysChecks = useSystemFonts((s) => s.checks);
  const sections = useMemo(
    () =>
      fontSections(recent, {
        supported: systemFontsSupported(),
        state: sysState,
        ids: sysIds,
        checks: sysChecks,
      }),
    [recent, sysState, sysIds, sysChecks],
  );
  const flat = useMemo(
    () => sections.flatMap((s) => s.options.map((o) => ({ section: s.id, option: o }))),
    [sections],
  );
  const nameOf = (o: FontOption): string => ('text' in o.name ? o.name.text : t(o.name.key));
  const names = flat.map((e) => nameOf(e.option));
  // The current font in its group (not in Recently used), else the first entry.
  const currentIndex = Math.max(
    flat.findIndex((e) => e.section !== 'recent' && e.option.id === value),
    0,
  );
  const [active, setActive] = useState(currentIndex);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  /** A font on this computer being checked before it is used (D-54); dropped if the list closes. */
  const pending = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector(`[data-index="${String(active)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  // Fonts on this computer are checked as they come into view (D-54), one at a time.
  useEffect(() => {
    const root = list.current;
    if (!open || sysState !== 'on' || !root || typeof IntersectionObserver === 'undefined') return;
    const seen = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const font = en.isIntersecting ? (en.target as HTMLElement).dataset['font'] : undefined;
          if (font) {
            seen.unobserve(en.target);
            void checkSystemFamily(font);
          }
        }
      },
      { root },
    );
    for (const el of root.querySelectorAll('[data-system]')) seen.observe(el);
    return () => {
      seen.disconnect();
    };
  }, [open, sysState, sysIds]);

  const pickFont = (id: string): void => {
    setOpen(false);
    noteFontUsed(id);
    if (id !== value) onChange(id);
  };

  const choose = (i: number): void => {
    const e = flat[i];
    if (!e) {
      setOpen(false);
      return;
    }
    const o = e.option;
    if (o.action === 'showSystem') {
      // On this click (or key) only, behind the browser's permission prompt (D-54). The
      // fonts then take the entry's place, so the first of them becomes the active one.
      void showSystemFonts();
      return;
    }
    if (o.disabled) return;
    if (!o.system) {
      pickFont(o.id);
      return;
    }
    pending.current = o.id;
    void (async () => {
      if (sysState !== 'on') await showSystemFonts();
      const check = await checkSystemFamily(o.id);
      if (pending.current !== o.id) return;
      pending.current = null;
      if (check === 'ok') pickFont(o.id);
    })();
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const last = flat.length - 1;
    const move = (to: number): void => {
      e.preventDefault();
      setActive(Math.min(last, Math.max(0, to)));
    };
    switch (e.key) {
      case 'ArrowDown':
        move(active + 1);
        return;
      case 'ArrowUp':
        move(active - 1);
        return;
      case 'Home':
        move(0);
        return;
      case 'End':
        move(last);
        return;
      case 'PageDown':
        move(active + PAGE);
        return;
      case 'PageUp':
        move(active - PAGE);
        return;
      case 'Enter':
        e.preventDefault();
        choose(active);
        return;
      case ' ':
        if (!typed.current.text) {
          e.preventDefault();
          choose(active);
          return;
        }
        break;
      case 'Tab':
        e.preventDefault();
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = e.timeStamp;
      const t0 = typed.current;
      const text = now - t0.at > TYPEAHEAD_MS ? e.key : t0.text + e.key;
      typed.current = { text, at: now };
      const i = typeahead(names, text, active);
      e.preventDefault();
      if (i >= 0) setActive(i);
    }
  };

  const current = value === null ? null : fontOption(value);
  const shown = current ? nameOf(current) : t('annotProps.mixed');
  const optionId = (i: number): string => `${listId}-${String(i)}`;
  let index = -1;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) pending.current = null;
        if (o) {
          registerCommentFonts();
          setActive(currentIndex);
          typed.current = { text: '', at: 0 };
        }
        setOpen(o);
      }}
    >
      <Popover.Trigger asChild>
        <button
          id={buttonId}
          type="button"
          className="ui-font-button ui-field-input ui-focusable"
          aria-haspopup="listbox"
          aria-labelledby={`${labelId} ${valueId}`}
          disabled={disabled}
          data-value={value ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              registerCommentFonts();
              setActive(currentIndex);
              setOpen(true);
            }
          }}
        >
          <span
            id={valueId}
            className="ui-font-button-name"
            style={current && value ? { fontFamily: cssFontStack(value) } : undefined}
          >
            {shown}
          </span>
          <ChevronDown12Regular aria-hidden className="ui-color-chevron" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ui-font-popup"
          aria-label={label}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            list.current?.focus();
            // The current font in the middle of the list, once the list is placed.
            requestAnimationFrame(() => {
              list.current?.querySelector(ACTIVE_OPTION)?.scrollIntoView({ block: 'center' });
            });
          }}
        >
          <div
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={0}
            aria-label={label}
            aria-activedescendant={optionId(active)}
            className="ui-font-list"
            onKeyDown={onListKey}
          >
            {sections.map((s) => (
              <div
                key={s.id}
                role="group"
                aria-labelledby={`${listId}-${s.id}`}
                className="ui-font-group"
                data-group={s.id}
              >
                <div id={`${listId}-${s.id}`} role="presentation" className="ui-font-heading">
                  {t(s.title)}
                </div>
                {s.options.map((o) => {
                  index++;
                  const i = index;
                  const selected = o.id === value;
                  // Why a font on this computer cannot be used (D-54), after its name.
                  const reason = o.disabled && o.system ? t(o.disabled) : undefined;
                  return (
                    // Keyboard: the list moves the choice (aria-activedescendant).
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                    <div
                      key={o.id}
                      tabIndex={-1}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={o.disabled ? true : undefined}
                      aria-describedby={reason ? `${optionId(i)}-why` : undefined}
                      data-index={i}
                      data-font={o.action ? undefined : o.id}
                      data-system={o.system && !o.disabled && s.id === 'system' ? '' : undefined}
                      data-action={o.action}
                      data-active={i === active || undefined}
                      className={
                        o.action
                          ? 'ui-font-option ui-font-option--action'
                          : o.disabled
                            ? 'ui-font-option ui-font-option--disabled'
                            : 'ui-font-option'
                      }
                      onPointerMove={() => {
                        if (i !== active) setActive(i);
                      }}
                      onClick={() => {
                        choose(i);
                      }}
                    >
                      <span
                        className="ui-font-name"
                        style={o.action ? undefined : { fontFamily: cssFontStack(o.id) }}
                      >
                        {nameOf(o)}
                      </span>
                      {reason ? (
                        <span id={`${optionId(i)}-why`} className="ui-font-why">
                          {reason}
                        </span>
                      ) : null}
                      {o.sample ? (
                        <span
                          className="ui-font-sample"
                          lang={s.id === 'chinese' || o.id === 'notosanssc' ? 'zh-Hans' : 'hi'}
                          style={{ fontFamily: cssFontStack(o.id) }}
                          aria-hidden="true"
                        >
                          {o.sample}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
