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
import { Brand } from './TopBar';

export interface AppFrameProps {
  /** Quick access toolbar, beside the product mark and name (M6-01). */
  quickAccess?: ReactNode;
  /** Quick access toolbar and ribbon (M1-10). */
  ribbon?: ReactNode;
  /** The active document view or the start screen (M1-13, M1-14, M1-18). */
  children?: ReactNode;
  status?: StatusBarProps;
}

/**
 * PDF-XChange-style layout (D-01, §8; layout only, no artwork): banner with the
 * product name and quick access, the ribbon (its tab row ends with the top bar
 * links and full screen, D-35), document tabs, left rail + panes, document area, Properties pane,
 * status bar. Minimum width 1280 px (§8).
 */
export function AppFrame({ quickAccess, ribbon, children, status }: AppFrameProps) {
  const { t } = useTranslation();
  return (
    <div className="app-frame" data-testid="app-shell">
      <header aria-label={t('frame.banner')} className="app-banner">
        {/* Title row (M6-01, D-35): the product mark and name (the page's h1), then quick access. */}
        <div className="app-title-row">
          <Brand />
          {quickAccess}
        </div>
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
