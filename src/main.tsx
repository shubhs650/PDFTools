import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// Test-only hook (M1-Q3): statically false outside `vite build --mode e2e`, so
// the import and the module are dropped from production builds.
if (import.meta.env.MODE === 'e2e') {
  void import('./testing/hook').then((m) => m.installTestHook());
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
