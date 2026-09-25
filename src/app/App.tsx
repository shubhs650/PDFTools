import { UiProvider } from '../ui/components';
import { AppFrame } from './AppFrame';
import { BOUNDARY } from './diagnostics';
import { ErrorBoundary } from './ErrorBoundary';
import './app.css';

export function App() {
  return (
    <UiProvider>
      <ErrorBoundary where={BOUNDARY.app}>
        <AppFrame />
      </ErrorBoundary>
    </UiProvider>
  );
}
