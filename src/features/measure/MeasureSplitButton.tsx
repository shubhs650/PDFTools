// Home's and Comment's one Measure button (M14-03, Q26): the main part starts
// the last measuring tool used, its arrow lists every measuring tool. Two
// toolbar stops, each with its own accessible name.
import { ChevronDown12Regular } from '@fluentui/react-icons/svg/chevron-down';
import { forwardRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { COMMANDS } from '../../app/commands';
import { RibbonButton } from '../../app/ribbon/RibbonButton';
import { CommandDropdown, type ContextMenuEntry } from '../../ui/components';
import { MEASURE_MENU, measureCommandOf, useLastMeasureTool } from './lastMeasureTool';

export interface MeasureSplitButtonProps {
  large: boolean;
  /** Icon only (the group's narrowest step, D-36). */
  compact: boolean;
  mainRef: Ref<HTMLButtonElement>;
  arrowRef: Ref<HTMLButtonElement>;
  mainTabIndex: number;
  arrowTabIndex: number;
}

const ENTRIES: ContextMenuEntry[] = MEASURE_MENU.map((id) => ({ kind: 'command', id }));

export function MeasureSplitButton({
  large,
  compact,
  mainRef,
  arrowRef,
  mainTabIndex,
  arrowTabIndex,
}: MeasureSplitButtonProps) {
  const { t } = useTranslation();
  const last = useLastMeasureTool();
  const def = COMMANDS.find((c) => c.id === measureCommandOf(last));
  if (!def) return null;
  const command = compact ? { ...def, compact: true as const } : def;
  const label = t('ribbon.measureMenu');
  return (
    <span className="ribbon-split" data-split="measure.lastTool">
      <RibbonButton ref={mainRef} command={command} large={large} tabIndex={mainTabIndex} />
      <CommandDropdown
        label={label}
        entries={ENTRIES}
        trigger={<MeasureArrow ref={arrowRef} label={label} tabIndex={arrowTabIndex} />}
      />
    </span>
  );
}

const MeasureArrow = forwardRef<HTMLButtonElement, { label: string; tabIndex: number }>(
  function MeasureArrow({ label, tabIndex, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="ribbon-split-arrow ui-focusable"
        data-measure-menu=""
        tabIndex={tabIndex}
        aria-label={label}
        title={label}
        // Radix's trigger props (aria-haspopup, aria-expanded, handlers) come through `rest`.
        {...rest}
      >
        <ChevronDown12Regular aria-hidden className="ribbon-split-chevron" />
      </button>
    );
  },
);
