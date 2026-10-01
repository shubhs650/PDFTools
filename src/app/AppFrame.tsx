import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BOUNDARY } from './diagnostics';
import { ErrorBoundary } from './ErrorBoundary';
import { LeftRail } from './LeftRail';
import { PropertiesPane } from './PropertiesPane';
import { ReviewPanel } from '../features/tables/ReviewPanel';
import { StatusBar, type StatusBarProps } from './StatusBar';
import { TabStrip } from './TabStrip';

export interface AppFrameProps {
  /** Quick access toolbar and ribbon (M1-10). */
  ribbon?: ReactNode;
  /** The active document view or the start screen (M1-13, M1-14, M1-18). */
  children?: ReactNode;
  status?: StatusBarProps;
}

/**
 * PDF-XChange-style layout (D-01, §8; layout only, no artwork): banner with the
 * ribbon, document tabs, left rail + panes, document area, Properties pane,
 * status bar. Minimum width 1280 px (§8).
 */
export function AppFrame({ ribbon, children, status }: AppFrameProps) {
  const { t } = useTranslation();
  return (
    <div className="app-frame" data-testid="app-shell">
      <header aria-label={t('frame.banner')} className="app-banner">
        {/* Screen-reader page heading (the title bar shows the name visually later). */}
        <h1 className="ui-visually-hidden">{t('app.name')}</h1>
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
      </div>
      <StatusBar {...status} />
    </div>
  );
}
