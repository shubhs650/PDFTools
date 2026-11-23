import { ChevronLeft12Regular } from '@fluentui/react-icons/svg/chevron-left';
import { ChevronRight12Regular } from '@fluentui/react-icons/svg/chevron-right';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { PaneSplitter } from '../../../app/PaneSplitter';
import type { PaneSide } from '../../../app/paneSize';
import { Tooltip } from '../../../ui/components';
import {
  paneWidth,
  setFolded,
  setPaneWidth,
  updateLayout,
  useLayout,
  type PaneKey,
} from './layoutStore';

/**
 * A comparison pane that folds and resizes (M12-25, ADR-033, D-62), like the app's side
 * panes (D-56): an edge strip on its inner edge holds the splitter while the pane is shown and
 * an arrow that folds it away or opens it again. Folded, only the strip stays. Each comparison
 * remembers its panes' widths and which are folded.
 */
export function ComparePane({
  id,
  pane,
  side,
  name,
  children,
}: {
  /** The comparison. */
  id: string;
  pane: PaneKey;
  /** The side of the windows the pane is on (its strip is on the other edge). */
  side: PaneSide;
  /** The pane's name, as the arrow and the splitter say it ("Differences"). */
  name: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const layout = useLayout(id);
  const bodyId = useId();
  const folded = Boolean(layout.folded[pane]);
  const width = paneWidth(layout, pane);
  const label = folded
    ? t('compare.pane.show', { pane: name })
    : t('compare.pane.hide', { pane: name });
  // The chevron points where the pane goes: towards its side to fold it, away to open it.
  const pointsLeft = (side === 'left') !== folded;
  const edge = (
    <div
      className={`pane-edge cmp-pane-edge cmp-pane-edge--${side}${folded ? '' : ' pane-edge--open'}`}
      data-testid={`cmp-edge-${pane}`}
    >
      {folded ? null : (
        <PaneSplitter
          side={side}
          label={t('compare.pane.resize', { pane: name })}
          width={width}
          onWidth={(px) => {
            updateLayout(id, (l) => setPaneWidth(l, pane, px));
          }}
          testId={`cmp-resizer-${pane}`}
        />
      )}
      <Tooltip content={label} side={side === 'left' ? 'right' : 'left'}>
        <button
          type="button"
          className="pane-edge-button ui-focusable"
          aria-label={label}
          aria-expanded={!folded}
          aria-controls={folded ? undefined : bodyId}
          onClick={() => {
            updateLayout(id, (l) => setFolded(l, pane, !folded));
          }}
        >
          <span aria-hidden="true">
            {pointsLeft ? <ChevronLeft12Regular /> : <ChevronRight12Regular />}
          </span>
        </button>
      </Tooltip>
    </div>
  );
  return (
    <div
      className={`cmp-pane cmp-pane--${side}`}
      data-testid={`cmp-pane-${pane}`}
      data-folded={folded ? 'true' : 'false'}
    >
      {side === 'right' ? edge : null}
      {folded ? null : (
        <div id={bodyId} className="cmp-pane-body" style={{ width }}>
          {children}
        </div>
      )}
      {side === 'left' ? edge : null}
    </div>
  );
}
