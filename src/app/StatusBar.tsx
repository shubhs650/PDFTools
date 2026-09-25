import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface StatusBarProps {
  /** Page navigation (M1-15). */
  pageNav?: ReactNode;
  /** Zoom box (M1-15) and view-mode switch (M1-16). */
  view?: ReactNode;
  /** "Ready offline" / "Preparing offline… n %" / "Update ready" (M1-25). */
  app?: ReactNode;
}

/** Status bar (§5): slots filled by later tasks. */
export function StatusBar({ pageNav, view, app }: StatusBarProps) {
  const { t } = useTranslation();
  return (
    <footer aria-label={t('frame.statusBar')} className="status-bar">
      <div className="status-bar-slot status-bar-slot--start">{app}</div>
      <div className="status-bar-slot status-bar-slot--center">{pageNav}</div>
      <div className="status-bar-slot status-bar-slot--end">{view}</div>
    </footer>
  );
}
