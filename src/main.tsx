import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from './i18n';
import { App } from './app/App';

document.title = t('app.name');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

const root = createRoot(rootElement);
const params = new URLSearchParams(location.search);

// Dev and e2e builds only: `?theme=dark` proves the tokens support a dark theme
// (M1-05; dark theme is Rev 2+).
if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
  if (params.get('theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
}

// Test-only hook and component gallery (M1-Q3): statically false outside
// `vite build --mode e2e`, so these imports are dropped from production builds.
if (import.meta.env.MODE === 'e2e') {
  void import('./testing/hook').then((m) => m.installTestHook());
}
if (import.meta.env.MODE === 'e2e' && params.has('gallery')) {
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
