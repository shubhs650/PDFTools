import { useTranslation } from 'react-i18next';
import { UiProvider } from '../ui/components';
import './app.css';

// Empty shell. The real AppFrame (ribbon, tabs, panes, status bar) arrives in M1-09.
export function App() {
  const { t } = useTranslation();
  return (
    <UiProvider>
      <main className="app-shell" aria-label={t('app.shell.label')} data-testid="app-shell" />
    </UiProvider>
  );
}
