import { ChevronLeft12Regular } from '@fluentui/react-icons/svg/chevron-left';
import { ChevronRight12Regular } from '@fluentui/react-icons/svg/chevron-right';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../ui/components';
import { runCommand } from './commands/dispatch';
import { shortcutText } from './keys/labels';
import type { PaneSide } from './paneSize';

export interface PaneEdgeProps {
  side: PaneSide;
  /** Whether the pane is shown. */
  open: boolean;
  /** The id of the pane the arrow shows and hides (aria-controls while it is shown). */
  controls: string;
  /** The pane's splitter, while the pane is shown. */
  children?: ReactNode;
}

const COMMAND: Record<PaneSide, string> = {
  left: 'view.leftPanes',
  right: 'view.propertiesPane',
};

/**
 * A pane's edge strip (M11-10, ADR-028 D-56; PDF-XChange-style, layout only): a thin bar on
 * the pane's inner edge, always there, holding the pane's splitter while it is shown and a
 * chevron that hides or shows it. The chevron runs the same command as the ribbon and the
 * rail (View › Left Panes, View › Properties Pane), so they always agree; it stays mounted
 * in both states, so focus stays on it.
 */
export function PaneEdge({ side, open, controls, children }: PaneEdgeProps) {
  const { t } = useTranslation();
  const command = COMMAND[side];
  const label =
    side === 'left'
      ? open
        ? t('frame.hideLeftPane')
        : t('frame.showLeftPane')
      : open
        ? t('frame.hidePropertiesPane')
        : t('frame.showPropertiesPane');
  const keys = shortcutText(command, t);
  const tip = keys ? t('ribbon.withShortcut', { label, keys }) : label;
  // The chevron points where the pane goes: towards its side to hide it, away to show it.
  const pointsLeft = (side === 'left') === open;
  return (
    <div
      className={`pane-edge pane-edge--${side}${open ? ' pane-edge--open' : ''}`}
      data-testid={`pane-edge-${side}`}
    >
      {children}
      <Tooltip content={tip} side={side === 'left' ? 'right' : 'left'}>
        <button
          type="button"
          className="pane-edge-button ui-focusable"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? controls : undefined}
          data-command={command}
          onClick={() => {
            void runCommand(command);
          }}
        >
          <span aria-hidden="true">
            {pointsLeft ? <ChevronLeft12Regular /> : <ChevronRight12Regular />}
          </span>
        </button>
      </Tooltip>
    </div>
  );
}
