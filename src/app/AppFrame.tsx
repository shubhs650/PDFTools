import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BOUNDARY } from './diagnostics';
import { ErrorBoundary } from './ErrorBoundary';
import { LeftRail } from './LeftRail';
import { PropertiesPane } from './PropertiesPane';
import { ReviewPanel } from '../features/tables/ReviewPanel';
import { PendingRedactionsPanel } from '../features/redact/PendingRedactionsPanel';
import { StatusBar, type StatusBarProps } from './StatusBar';
import { TabStrip } from './TabStrip';
import { useApp } from './store/appStore';
import { useDocuments } from './store/documentStore';

export interface AppFrameProps {
  /** The ribbon, whose first row is the header: mark and name, Quick Access, tabs (M10-08·O3). */
  ribbon?: ReactNode;
  /** The active document view or the start screen (M1-13, M1-14, M1-18). */
  children?: ReactNode;
  status?: StatusBarProps;
}

/**
 * desktop-editor-style layout (D-01, §8; layout only, no artwork): the banner holds
 * the ribbon, whose one header row has the product mark and name, quick access,
 * File, the tabs and the top bar buttons (D-35, M10-08·O3), then the document
 * tabs; below, the left rail + panes, document area, Properties pane, status bar.
 * Minimum width 1280 px (§8).
 */
export function AppFrame({ ribbon, children, status }: AppFrameProps) {
  const { t } = useTranslation();
  // Maximise (M12-25, ADR-033): only while the maximised tab is the one in use.
  const maximised = useApp((s) => s.maximised);
  const active = useDocuments((s) => s.activeTab);
  const max = maximised !== null && maximised === active;
  return (
    <div
      className={`app-frame${max ? ' app-frame--maximised' : ''}`}
      data-testid="app-shell"
      data-maximised={max ? 'true' : undefined}
    >
      <header aria-label={t('frame.banner')} className="app-banner">
        {ribbon}
        <TabStrip />
      </header>
      <div className="app-body">
        <LeftRail />
        <main
          id="document-panel"
          aria-label={t('frame.main')}
          className="document-area"
          tabIndex={-1}
        >
          <ErrorBoundary where={BOUNDARY.document}>{children}</ErrorBoundary>
        </main>
        <PropertiesPane />
        {/* Review & Extract (M4-14) while it is on. */}
        <ReviewPanel />
        {/* Pending Redactions (M4-16) while it is open. */}
        <PendingRedactionsPanel />
      </div>
      <StatusBar {...status} />
    </div>
  );
}
