import { useTranslation } from 'react-i18next';
import { useApp } from '../../../app/store/appStore';
import { useDocuments } from '../../../app/store/documentStore';
import { msg, type MessageKey } from '../../../i18n';

/** How to use a tool whose gesture is not obvious, in the status bar while it is on. */
const HINTS: Partial<Record<string, MessageKey>> = {
  // M7-03 (ADR-023 D-43 f, B11): one drag, or the three clicks.
  freeTextCallout: msg('annotate.toolHint.callout'),
};

/** Status bar (§5): the active tool's hint. */
export function ToolHint() {
  const { t } = useTranslation();
  const tool = useApp((s) => s.tool);
  const hasDoc = useDocuments((s) => s.activeId !== null);
  const key = hasDoc ? HINTS[tool] : undefined;
  if (!key) return null;
  return (
    <span className="status-text tool-hint" data-testid="tool-hint">
      {t(key)}
    </span>
  );
}
