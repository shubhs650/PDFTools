import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from './i18n';
import { App } from './app/App';
import { initTheme } from './app/theme';

document.title = t('app.name');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

const root = createRoot(rootElement);
const params = new URLSearchParams(location.search);

// The stored light/dark choice (M7-11, D-42); public/theme-boot.js already
// applied it before the first paint.
initTheme();

// Test-only hook and component gallery (M1-Q3): statically false outside
// `vite build --mode e2e`, so these imports are dropped from production builds.
if (import.meta.env.MODE === 'e2e') {
  void import('./testing/hook').then((m) => m.installTestHook());
}
if (import.meta.env.MODE === 'e2e' && params.has('keyprobe')) {
  void import('./testing/KeyProbe').then(({ KeyProbe }) => {
    root.render(<KeyProbe />);
  });
} else if (import.meta.env.MODE === 'e2e' && params.has('gallery')) {
  void import('./testing/Gallery').then(({ Gallery }) => {
    root.render(
      <StrictMode>
        <Gallery />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
