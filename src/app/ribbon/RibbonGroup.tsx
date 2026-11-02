import { ChevronDown12Regular } from '@fluentui/react-icons/svg/chevron-down';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CommandDropdown, type ContextMenuEntry } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { PALETTE_COMMANDS } from '../../features/annotate/tools/stylePalette';
import { groupLabelKey } from '../commandLabels';
import type { CommandTab } from '../commands';
import { RibbonButton, RibbonSplitButton } from './RibbonButton';
import {
  commandsAtStep,
  groupCells,
  groupKey,
  type GroupStep,
  type RibbonGroupLayout,
} from './layout';

/** One stop of the toolbar's roving focus: its ref and tab index. */
export interface Stop {
  bind: (el: HTMLButtonElement | null) => void;
  tabIndex: number;
}

export interface RibbonGroupProps {
  /** The tab the group is shown on (ids of its label). */
  tab: CommandTab;
  group: RibbonGroupLayout;
  step: GroupStep;
  /** The next toolbar stop, in order. */
  stop: () => Stop;
  /** Drawn only to be measured (useAdaptiveSteps): no ids, no names, out of the tab order. */
  measure?: boolean;
}

/**
 * A ribbon group at one of its adaptive steps (D-36): its buttons (large,
 * small, icons only) in cells, or one button that opens the group as a menu.
 * The group's name labels it either way.
 */
export function RibbonGroup({ tab, group, step, stop, measure = false }: RibbonGroupProps) {
  const { t } = useTranslation();
  const label = t(groupLabelKey(group));
  const labelId = measure ? undefined : `grp-${tab}-${group.tab}-${group.group}`;
  const shown = commandsAtStep(group.commands, step);
  return (
    <div
      role={measure ? undefined : 'group'}
      aria-labelledby={labelId}
      className={`ribbon-group${shown ? '' : ' ribbon-group--menu'}`}
      data-group={groupKey(group)}
      data-step={step}
    >
      <div className="ribbon-group-body">
        {shown ? (
          groupCells(shown).map((cell) => {
            const buttons = cell.map((c) => {
              const main = stop();
              const tool = PALETTE_COMMANDS[c.id];
              if (tool) {
                const arrow = stop();
                return (
                  <RibbonSplitButton
                    key={c.id}
                    command={c}
                    tool={tool}
                    large={c.size === 'large'}
                    mainRef={main.bind}
                    arrowRef={arrow.bind}
                    mainTabIndex={main.tabIndex}
                    arrowTabIndex={arrow.tabIndex}
                  />
                );
              }
              return (
                <RibbonButton
                  key={c.id}
                  ref={main.bind}
                  command={c}
                  large={c.size === 'large'}
                  tabIndex={main.tabIndex}
                />
              );
            });
            const first = cell[0];
            if (!first || first.size === 'large') return buttons;
            return (
              <div
                key={first.id}
                className={`ribbon-cell${cell.every((c) => c.compact) ? ' ribbon-cell--compact' : ''}`}
              >
                {buttons}
              </div>
            );
          })
        ) : (
          <GroupMenu group={group} label={label} {...stop()} />
        )}
      </div>
      <div id={labelId} className="ribbon-group-label">
        {label}
      </div>
    </div>
  );
}

/** A group folded into one button: the group's commands as a menu (D-36). */
function GroupMenu({
  group,
  label,
  bind,
  tabIndex,
}: {
  group: RibbonGroupLayout;
  label: string;
} & Stop) {
  const entries: ContextMenuEntry[] = group.commands.map((c) => ({ kind: 'command', id: c.id }));
  const first = group.commands[0];
  return (
    <CommandDropdown
      label={label}
      entries={entries}
      trigger={<GroupMenuButton ref={bind} label={label} icon={first?.id} tabIndex={tabIndex} />}
    />
  );
}

const GroupMenuButton = forwardRef<
  HTMLButtonElement,
  { label: string; icon: string | undefined; tabIndex: number }
>(function GroupMenuButton({ label, icon, tabIndex, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="ribbon-button ribbon-group-menu ui-focusable"
      tabIndex={tabIndex}
      // Radix's trigger props (aria-haspopup, aria-expanded, handlers) come through `rest`.
      {...rest}
    >
      {icon ? <CommandIcon id={icon} className="ribbon-icon" /> : null}
      <span className="ribbon-label">{label}</span>
      <ChevronDown12Regular aria-hidden className="ribbon-group-menu-chevron" />
    </button>
  );
});
