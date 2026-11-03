// The colour picker (M6-16, beta follow-up): a swatch button that opens a
// "Standard colors" grid, like PDF-XChange's, with "More colors…" for the
// system's own custom picker. Used wherever the user picks a colour.
// Keyboard: Enter/Space/ArrowDown open it; arrows move in the grid,
// Home/End to a row's ends, Enter picks, Esc closes (back to the button).
import { ChevronDown12Regular } from '@fluentui/react-icons/svg/chevron-down';
import { Color16Regular } from '@fluentui/react-icons/svg/color';
import * as Popover from '@radix-ui/react-popover';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  gridMove,
  hexToRgb,
  NATIVE_START,
  normalizeHex,
  PALETTE_COLUMNS,
  paletteColor,
  STANDARD_COLORS,
} from './colorPalette';

/** "No colour" (a transparent fill). */
export const NO_COLOR = 'transparent';

export interface ColorPickerProps {
  /** Accessible name of the button and the popup (rule 12); translated. */
  label: string;
  /** `#rrggbb`, NO_COLOR, or null when a selection's values differ (Mixed). */
  value: string | null;
  /** Gets a lower-case `#rrggbb`, or NO_COLOR. Fires once per choice. */
  onChange: (value: string) => void;
  /** Offers a "no colour" entry, named `noneLabel` (e.g. "No fill"). */
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  /** The button's id, for an outside `<label htmlFor>`. */
  id?: string;
}

export function ColorPicker({
  label,
  value,
  onChange,
  allowNone = false,
  noneLabel,
  disabled = false,
  id,
}: ColorPickerProps) {
  const { t } = useTranslation();
  const own = useId();
  const buttonId = id ?? own;
  const [open, setOpen] = useState(false);
  const native = useRef<HTMLInputElement>(null);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const none = value === NO_COLOR;
  const hex = value === null || none ? null : normalizeHex(value);
  const current = hex === null ? undefined : paletteColor(hex);
  const currentIndex = current ? STANDARD_COLORS.indexOf(current) : -1;
  const [focus, setFocus] = useState(Math.max(currentIndex, 0));
  const noneText = noneLabel ?? t('colorPicker.none');

  // The native picker's "change" fires once it closes: one commit.
  const commit = useRef(onChange);
  useEffect(() => {
    commit.current = onChange;
  });
  useEffect(() => {
    const el = native.current;
    if (!el) return;
    const on = (): void => {
      const v = normalizeHex(el.value);
      if (v !== null) commit.current(v);
    };
    el.addEventListener('change', on);
    return () => {
      el.removeEventListener('change', on);
    };
  }, []);
  // The native input follows the value, so "More colors…" starts from it.
  useEffect(() => {
    if (native.current) native.current.value = hex ?? NATIVE_START;
  }, [hex]);

  const pick = (v: string): void => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  const more = (): void => {
    setOpen(false);
    const el = native.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.click();
    }
  };

  const onGridKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const next = gridMove(focus, e.key, e.ctrlKey, STANDARD_COLORS.length, PALETTE_COLUMNS);
    if (next === null) return;
    e.preventDefault();
    setFocus(next);
    cells.current[next]?.focus();
  };

  const description = none
    ? noneText
    : value === null
      ? t('colorPicker.mixed')
      : current
        ? t(current.name)
        : hex === null
          ? ''
          : t('colorPicker.rgb', { r: hexToRgb(hex)[0], g: hexToRgb(hex)[1], b: hexToRgb(hex)[2] });

  return (
    <span className="ui-color-picker">
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          if (o) setFocus(Math.max(currentIndex, 0));
          setOpen(o);
        }}
      >
        <Popover.Trigger asChild>
          <button
            id={buttonId}
            type="button"
            className="ui-color-button ui-focusable"
            aria-label={label}
            aria-describedby={`${buttonId}-value`}
            title={description}
            disabled={disabled}
            data-value={none ? NO_COLOR : (hex ?? '')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && !open) {
                e.preventDefault();
                setFocus(Math.max(currentIndex, 0));
                setOpen(true);
              }
            }}
          >
            <span
              className={`ui-color-chip${none ? ' ui-color-chip--none' : ''}${value === null ? ' ui-color-chip--mixed' : ''}`}
              style={hex === null ? undefined : { background: hex }}
              aria-hidden="true"
            />
            <ChevronDown12Regular aria-hidden className="ui-color-chevron" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="ui-color-popup"
            role="dialog"
            aria-label={label}
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              cells.current[focus]?.focus();
            }}
          >
            {allowNone ? (
              <button
                type="button"
                className="ui-color-action ui-focusable"
                aria-pressed={none}
                onClick={() => {
                  pick(NO_COLOR);
                }}
              >
                <span className="ui-color-chip ui-color-chip--none" aria-hidden="true" />
                {noneText}
              </button>
            ) : null}
            <p className="ui-color-heading" id={`${buttonId}-standard`}>
              {t('colorPicker.standard')}
            </p>
            <div className="ui-color-grid" role="group" aria-labelledby={`${buttonId}-standard`}>
              {STANDARD_COLORS.map((p, i) => (
                <button
                  key={p.hex}
                  ref={(el) => {
                    cells.current[i] = el;
                  }}
                  type="button"
                  className="ui-color-cell"
                  style={{ background: p.hex }}
                  aria-label={t(p.name)}
                  aria-pressed={i === currentIndex}
                  title={t(p.name)}
                  tabIndex={i === focus ? 0 : -1}
                  data-hex={p.hex}
                  onFocus={() => {
                    setFocus(i);
                  }}
                  onKeyDown={onGridKey}
                  onClick={() => {
                    pick(p.hex);
                  }}
                />
              ))}
            </div>
            <button type="button" className="ui-color-action ui-focusable" onClick={more}>
              <Color16Regular aria-hidden className="ui-color-more-icon" />
              {t('colorPicker.more')}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span id={`${buttonId}-value`} className="ui-visually-hidden">
        {description}
      </span>
      {/* The system picker behind "More colors…"; it opens at the button. */}
      <input
        ref={native}
        type="color"
        className="ui-color-native"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        defaultValue={hex ?? NATIVE_START}
      />
    </span>
  );
}
