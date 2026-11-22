import { ArrowAutofitWidth20Regular } from '@fluentui/react-icons/svg/arrow-autofit-width';
import { Blur20Regular } from '@fluentui/react-icons/svg/blur';
import { Color20Regular } from '@fluentui/react-icons/svg/color';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { Eye20Filled, Eye20Regular } from '@fluentui/react-icons/svg/eye';
import { Flash20Filled, Flash20Regular } from '@fluentui/react-icons/svg/flash';
import {
  LineThickness20Filled,
  LineThickness20Regular,
} from '@fluentui/react-icons/svg/line-thickness';
import { PageFit20Regular } from '@fluentui/react-icons/svg/page-fit';
import { ZoomIn20Regular } from '@fluentui/react-icons/svg/zoom-in';
import { ZoomOut20Regular } from '@fluentui/react-icons/svg/zoom-out';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../../i18n';
import {
  PRESET_ORDER,
  hexOf,
  presetOf,
  rgbOf,
  type ColourPreset,
} from '../../../model/compare/overlay';
import {
  Button,
  ColorPicker,
  Dialog,
  DropdownMenu,
  IconButton,
  ToggleButton,
  type MenuEntry,
} from '../../../ui/components';
import {
  overlapWarning,
  setBalance,
  setColour,
  setFade,
  setPreset,
  toggleSide,
  updateView,
  useOverlayView,
  type OverlayView,
  type Sheet,
} from './overlayState';

const PRESET_LABEL: Record<ColourPreset, MessageKey> = {
  redGreen: msg('compare.overlay.preset_redGreen'),
  redBlue: msg('compare.overlay.preset_redBlue'),
  magentaGreen: msg('compare.overlay.preset_magentaGreen'),
};

const CUSTOM = 'custom';

/** The swatch of a side's colour, beside its switch. */
function Swatch({ colour }: { colour: string }) {
  return <span className="overlay-swatch" style={{ background: colour }} aria-hidden="true" />;
}

/**
 * The floating bar over the overlay (D-59, Q18): show or hide each revision,
 * the balance between them, Fade unchanged, Thicken thin lines, Blink (hold),
 * the colours, and the zoom.
 */
export function FloatingBar({
  id,
  sheet,
  zoomText,
  onZoom,
  onBlink,
}: {
  id: string;
  sheet: Sheet;
  zoomText: string;
  onZoom: (dir: 1 | -1) => void;
  onBlink: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const [custom, setCustom] = useState(false);
  const set = (fn: (v: OverlayView) => OverlayView): void => {
    updateView(id, fn);
  };
  const s = view.style;
  const both = sheet.a !== null && sheet.b !== null;
  const preset = presetOf(s.colA, s.colB);
  const balanceText =
    s.balance <= -1
      ? t('compare.overlay.balanceValue_a')
      : s.balance >= 1
        ? t('compare.overlay.balanceValue_b')
        : s.balance === 0
          ? t('compare.overlay.balanceValue_both')
          : t('compare.overlay.balanceValue_mix', {
              a: format.percent(Math.min(1, 1 - s.balance)),
              b: format.percent(Math.min(1, 1 + s.balance)),
            });

  const colourEntries: MenuEntry[] = [
    {
      kind: 'radio',
      id: 'preset',
      label: t('compare.overlay.colours'),
      value: preset ?? CUSTOM,
      options: PRESET_ORDER.map((p) => ({ value: p, label: t(PRESET_LABEL[p]) })),
      onValueChange: (p) => {
        if (p !== CUSTOM) set((v) => setPreset(v, p as ColourPreset));
      },
    },
    { kind: 'separator', id: 'sep' },
    {
      id: 'custom',
      label: t('compare.overlay.custom'),
      onSelect: () => {
        setCustom(true);
      },
    },
  ];
  return (
    <div className="overlay-bar" role="toolbar" aria-label={t('compare.overlay.bar')}>
      <Group>
        <ToggleButton
          label={t('compare.overlay.showA')}
          iconOnly
          icon={<Eye20Regular />}
          pressedIcon={<Eye20Filled />}
          pressed={s.showA}
          disabled={!sheet.a}
          onPressedChange={() => {
            set((v) => toggleSide(v, 'a'));
          }}
        />
        <Swatch colour={hexOf(s.colA)} />
        <BalanceSlider
          value={s.balance}
          valueText={balanceText}
          disabled={!both}
          onChange={(b) => {
            set((v) => setBalance(v, b));
          }}
        />
        <Swatch colour={hexOf(s.colB)} />
        <ToggleButton
          label={t('compare.overlay.showB')}
          iconOnly
          icon={<Eye20Regular />}
          pressedIcon={<Eye20Filled />}
          pressed={s.showB}
          disabled={!sheet.b}
          onPressedChange={() => {
            set((v) => toggleSide(v, 'b'));
          }}
        />
      </Group>
      <Group>
        <ToggleButton
          label={t('compare.overlay.fade')}
          iconOnly
          icon={<Blur20Regular />}
          pressed={s.fade > 0}
          disabled={!both}
          onPressedChange={(on) => {
            set((v) => setFade(v, on));
          }}
        />
        <ToggleButton
          label={t('compare.overlay.thicken')}
          iconOnly
          icon={<LineThickness20Regular />}
          pressedIcon={<LineThickness20Filled />}
          pressed={view.thicken}
          onPressedChange={(on) => {
            set((v) => ({ ...v, thicken: on }));
          }}
        />
        <BlinkButton disabled={!both} active={view.blink !== null} onBlink={onBlink} />
        <DropdownMenu
          trigger={<IconButton label={t('compare.overlay.colours')} icon={<Color20Regular />} />}
          entries={colourEntries}
        />
      </Group>
      <Group>
        <IconButton
          label={t('compare.overlay.zoomOut')}
          icon={<ZoomOut20Regular />}
          onClick={() => {
            onZoom(-1);
          }}
        />
        <span className="overlay-zoom" aria-live="polite">
          {zoomText}
        </span>
        <IconButton
          label={t('compare.overlay.zoomIn')}
          icon={<ZoomIn20Regular />}
          onClick={() => {
            onZoom(1);
          }}
        />
        <ToggleButton
          label={t('compare.overlay.fitPage')}
          iconOnly
          icon={<PageFit20Regular />}
          pressed={view.fit === 'page'}
          onPressedChange={() => {
            set((v) => ({ ...v, fit: 'page' }));
          }}
        />
        <ToggleButton
          label={t('compare.overlay.fitWidth')}
          iconOnly
          icon={<ArrowAutofitWidth20Regular />}
          pressed={view.fit === 'width'}
          onPressedChange={() => {
            set((v) => ({ ...v, fit: 'width' }));
          }}
        />
      </Group>
      <CustomColours id={id} open={custom} onOpenChange={setCustom} />
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="overlay-bar-group">{children}</div>;
}

/** Balance (Q18): old only ↔ both ↔ new only. */
function BalanceSlider({
  value,
  valueText,
  disabled,
  onChange,
}: {
  value: number;
  valueText: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <input
      type="range"
      className="overlay-balance ui-focusable"
      min={-1}
      max={1}
      step={0.1}
      value={value}
      disabled={disabled}
      aria-label={t('compare.overlay.balance')}
      aria-valuetext={valueText}
      title={valueText}
      onChange={(e) => {
        onChange(Number(e.currentTarget.value));
      }}
      onDoubleClick={() => {
        onChange(0);
      }}
    />
  );
}

/** Blink: hold (pointer, Space or Enter) to flip between old and new; X does the same in the window. */
function BlinkButton({
  disabled,
  active,
  onBlink,
}: {
  disabled: boolean;
  active: boolean;
  onBlink: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const label = t('compare.overlay.blink');
  return (
    <IconButton
      label={label}
      icon={active ? <Flash20Filled /> : <Flash20Regular />}
      aria-pressed={active}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onBlink(true);
      }}
      onPointerUp={() => {
        onBlink(false);
      }}
      onPointerCancel={() => {
        onBlink(false);
      }}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          onBlink(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') onBlink(false);
      }}
      onBlur={() => {
        if (active) onBlink(false);
      }}
    />
  );
}

/** Custom colours (Q12): the standard swatch picker for each side, with the dark-overlap warning. */
function CustomColours({
  id,
  open,
  onOpenChange,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const warnId = useId();
  const view = useOverlayView(id);
  const warn = overlapWarning(view);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('compare.overlay.customTitle')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <Button
          label={t('compare.overlay.done')}
          variant="primary"
          onClick={() => {
            onOpenChange(false);
          }}
        />
      }
    >
      <div className="overlay-colours">
        <div className="overlay-colour-row">
          <span>{t('compare.overlay.colourA')}</span>
          <ColorPicker
            label={t('compare.overlay.colourA')}
            value={hexOf(view.style.colA)}
            onChange={(hex) => {
              updateView(id, (v) => setColour(v, 'a', rgbOf(hex)));
            }}
          />
        </div>
        <div className="overlay-colour-row">
          <span>{t('compare.overlay.colourB')}</span>
          <ColorPicker
            label={t('compare.overlay.colourB')}
            value={hexOf(view.style.colB)}
            onChange={(hex) => {
              updateView(id, (v) => setColour(v, 'b', rgbOf(hex)));
            }}
          />
        </div>
        {warn ? (
          <p id={warnId} className="overlay-colour-warning" role="alert">
            {t('compare.overlay.darkWarning')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
