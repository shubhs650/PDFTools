// Entry of the Help window (M9, ADR-026 D-46): help.html. It shares the app's
// strings, tokens and theme, but loads no PDF engine, worker or ribbon.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme, THEME_STORAGE_KEY } from '../app/theme';
import '../i18n';
import '../ui/tokens.css';
import './help.css';
import { HelpApp } from './HelpApp';

// The app's light or dark choice (public/theme-boot.js applied it before the
// first paint); a change in the app's window follows here too.
initTheme();
window.addEventListener('storage', (e) => {
  if (e.key === null || e.key === THEME_STORAGE_KEY) initTheme();
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');
createRoot(rootElement).render(
  <StrictMode>
    <HelpApp />
  </StrictMode>,
);
