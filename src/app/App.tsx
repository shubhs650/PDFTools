import { t } from '../i18n';
import './app.css';

// Empty shell. The real AppFrame (ribbon, tabs, panes, status bar) arrives in M1.
export function App() {
  return <main className="app-shell" aria-label={t('app.shell.label')} data-testid="app-shell" />;
}
