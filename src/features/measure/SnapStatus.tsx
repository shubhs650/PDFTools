import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { Tooltip } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { setSnapping, useSnapping } from './snapping';

/**
 * Status bar (§5): the snapping toggle as a magnet icon button (M6-01, ADR-021
 * D-35; the Measure tab's magnet, Filled while pressed), named and tooltipped
 * "Enable Snapping", and "Preparing snapping…" while the current page's index
 * is built (ADR-008 decision 4: snapping waits for it).
 */
export function SnapStatus() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const page = useDocuments((s) => (s.activeId ? (s.docs[s.activeId]?.view.page ?? 0) : 0));
  const on = useSnapping((s) => s.enabled);
  const state = useSnapping((s) => (docId ? s.pages[`${docId}/${String(page)}`] : undefined));
  if (!docId) return null;
  const label = t('snap.enable');
  return (
    <span className="snap-status">
      <Tooltip content={label}>
        <button
          type="button"
          className="snap-toggle ui-focusable"
          aria-label={label}
          aria-pressed={on}
          data-testid="snap-toggle"
          onClick={() => {
            void setSnapping(!on);
          }}
        >
          <CommandIcon id="measure.snapping" pressed={on} className="snap-toggle-icon" />
        </button>
      </Tooltip>
      <span role="status" className="snap-preparing" data-testid="snap-preparing">
        {on && state === 'preparing' ? t('snap.preparing') : ''}
      </span>
    </span>
  );
}
