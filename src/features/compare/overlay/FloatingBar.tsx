import { ArrowAutofitWidth20Regular } from '@fluentui/react-icons/svg/arrow-autofit-width';
import { dialogHelp } from '../../help/openHelp';
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
import { Shapes20Filled, Shapes20Regular } from '@fluentui/react-icons/svg/shapes';
import { Target20Filled, Target20Regular } from '@fluentui/react-icons/svg/target';
import { ZoomIn20Regular } from '@fluentui/react-icons/svg/zoom-in';
import { ZoomOut20Regular } from '@fluentui/react-icons/svg/zoom-out';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../../i18n';
import {
  PRESET_ORDER,
  hexOf,
  keyColours,
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
import { toggleLineUp } from '../align/manualAlign';
import {
  needsCheck,
  overlapWarning,
  setBalance,
  setColour,
  setFade,
  setPreset,
  setVector,
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

type ColourName = 'red' | 'green' | 'blue' | 'magenta';
/** The colours of each preset by name, for the key (custom colours have none). */
const PRESET_NAMES: Record<ColourPreset, { a: ColourName; b: ColourName }> = {
  redGreen: { a: 'red', b: 'green' },
  redBlue: { a: 'red', b: 'blue' },
  magentaGreen: { a: 'magenta', b: 'green' },
};
const COLOUR_NAME: Record<ColourName | 'black' | 'grey', MessageKey> = {
  red: msg('compare.key.colour_red'),
  green: msg('compare.key.colour_green'),
  blue: msg('compare.key.colour_blue'),
  magenta: msg('compare.key.colour_magenta'),
  black: msg('compare.key.colour_black'),
  grey: msg('compare.key.colour_grey'),
};

/** The swatch of a side's colour, beside its switch. */
function Swatch({ colour }: { colour: string }) {
  return <span className="overlay-swatch" style={{ background: colour }} aria-hidden="true" />;
}

/**
 * The floating bar over the overlay (D-59, Q18): **Line up** (M12-26,
 * ADR-033: the sheet lined up by hand, always in sight), show or hide each
 * revision, the balance between them, Fade unchanged, Thicken thin lines,
 * Blink (hold), the colours, the "Vector overlay (beta)" display mode
 * (M12-16) and the zoom.
 */
export function FloatingBar({
  id,
  sheet,
  zoomText,
  onZoom,
  onFit,
  onBlink,
}: {
  id: string;
  sheet: Sheet;
  zoomText: string;
  onZoom: (dir: 1 | -1) => void;
  /** Fits the sheet to the window (once; any zoom after it is the user's). */
  onFit: (mode: 'page' | 'width') => void;
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
  // The vector page is one drawing (M12-16): the screen drawing's own controls are off.
  const screenOnly = view.vector;
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
  const lining = sheet.pair !== null && view.manual?.pair === sheet.pair;
  return (
    <div className="overlay-bar" role="toolbar" aria-label={t('compare.overlay.bar')}>
      <div
        className="overlay-bar-group overlay-line-up"
        data-testid="line-up-button"
        data-attention={needsCheck(view, sheet) ? 'true' : undefined}
      >
        <ToggleButton
          label={t('compare.lineUp.button')}
          tooltip={t('compare.lineUp.buttonTip')}
          compact
          icon={<Target20Regular />}
          pressedIcon={<Target20Filled />}
          pressed={lining}
          disabled={sheet.pair === null}
          onPressedChange={(on) => {
            toggleLineUp(id, sheet, on);
          }}
        />
      </div>
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
          disabled={!both || screenOnly}
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
          disabled={!both || screenOnly}
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
          disabled={screenOnly}
          onPressedChange={(on) => {
            set((v) => ({ ...v, thicken: on }));
          }}
        />
        <BlinkButton
          disabled={!both || screenOnly}
          active={view.blink !== null}
          onBlink={onBlink}
        />
        <DropdownMenu
          trigger={<IconButton label={t('compare.overlay.colours')} icon={<Color20Regular />} />}
          entries={colourEntries}
        />
        <ToggleButton
          label={t('compare.overlay.vector')}
          iconOnly
          icon={<Shapes20Regular />}
          pressedIcon={<Shapes20Filled />}
          pressed={view.vector}
          onPressedChange={(on) => {
            set((v) => setVector(v, on));
          }}
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
        <IconButton
          label={t('compare.overlay.fitPage')}
          icon={<PageFit20Regular />}
          onClick={() => {
            onFit('page');
          }}
        />
        <IconButton
          label={t('compare.overlay.fitWidth')}
          icon={<ArrowAutofitWidth20Regular />}
          onClick={() => {
            onFit('width');
          }}
        />
      </Group>
      <ColourKey style={s} preset={preset} />
      <CustomColours id={id} open={custom} onOpenChange={setCustom} />
    </div>
  );
}

/**
 * The colour key (M12-25, ADR-033): "Red: only in old · Green: only in new · Black: same",
 * following the colours chosen (custom colours show their swatch with no name).
 */
function ColourKey({
  style,
  preset,
}: {
  style: OverlayView['style'];
  preset: ColourPreset | null;
}) {
  const { t } = useTranslation();
  const colours = keyColours(style);
  const names = preset ? PRESET_NAMES[preset] : null;
  const fade = style.fade > 0;
  const items = [
    {
      key: 'a',
      colour: colours.a,
      name: names?.a,
      what: msg('compare.key.a'),
      alone: msg('compare.key.alone_a'),
    },
    {
      key: 'b',
      colour: colours.b,
      name: names?.b,
      what: msg('compare.key.b'),
      alone: msg('compare.key.alone_b'),
    },
    {
      key: 'both',
      colour: colours.both,
      name: names ? (fade ? 'grey' : 'black') : undefined,
      what: msg('compare.key.both'),
      alone: msg('compare.key.alone_both'),
    },
  ] as const;
  return (
    <ul className="overlay-key" aria-label={t('compare.key.title')} data-testid="overlay-key">
      {items.map((i) => (
        <li key={i.key} className="overlay-key-item" data-key={i.key}>
          <Swatch colour={hexOf(i.colour)} />
          <span>
            {i.name
              ? t('compare.key.named', { colour: t(COLOUR_NAME[i.name]), what: t(i.what) })
              : t(i.alone)}
          </span>
        </li>
      ))}
    </ul>
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
      help={dialogHelp('compare-overlay')}
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
