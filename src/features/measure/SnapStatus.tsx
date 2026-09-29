import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { setSnapping, useSnapping } from './snapping';

/**
 * Status bar (§5): "Enable Snapping", and "Preparing snapping…" while the
 * current page's index is built (ADR-008 decision 4: snapping waits for it).
 */
export function SnapStatus() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const page = useDocuments((s) => (s.activeId ? (s.docs[s.activeId]?.view.page ?? 0) : 0));
  const on = useSnapping((s) => s.enabled);
  const state = useSnapping((s) => (docId ? s.pages[`${docId}/${String(page)}`] : undefined));
  if (!docId) return null;
  return (
    <span className="snap-status">
      <button
        type="button"
        className="snap-toggle ui-focusable"
        aria-pressed={on}
        data-testid="snap-toggle"
        onClick={() => {
          void setSnapping(!on);
        }}
      >
        {t('snap.enable')}
      </button>
      <span role="status" className="snap-preparing" data-testid="snap-preparing">
        {on && state === 'preparing' ? t('snap.preparing') : ''}
      </span>
    </span>
  );
}
