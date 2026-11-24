import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { StatusToggle } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { setSnapping, useSnapping } from './snapping';

const TOGGLE_TEST_ID = 'snap-toggle';

/**
 * Status bar (§5): Enable Snapping as a labelled toggle (M13-04, D-70: the
 * Measure tab's magnet and the words, Filled while pressed; before, an icon
 * button, M6-01), and "Preparing snapping…" beside it while the current page's
 * index is built (ADR-008 decision 4: snapping waits for it).
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
      <StatusToggle
        label={t('snap.enable')}
        pressed={on}
        onPressedChange={(next) => {
          void setSnapping(next);
        }}
        icon={<CommandIcon id="measure.snapping" pressed={on} />}
        data-testid={TOGGLE_TEST_ID}
      />
      <span role="status" className="snap-preparing" data-testid="snap-preparing">
        {on && state === 'preparing' ? t('snap.preparing') : ''}
      </span>
    </span>
  );
}
