// Key probe (M1-11), e2e build only: `/?keyprobe`. Lists every keydown that
// reaches the page, so the owner can check in real Chrome and in the installed
// PWA which browser-reserved shortcuts (Ctrl+W, Ctrl+F4, Ctrl+PageUp/Down,
// Ctrl+Tab) the page receives. Automated tests cannot observe this: they
// inject keys into the page and bypass the browser's own shortcut handling.
/* eslint-disable i18next/no-literal-string -- test-only page, not product copy */
import { useEffect, useState } from 'react';

export function KeyProbe() {
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mods = [
        e.ctrlKey && 'Ctrl',
        e.metaKey && 'Meta',
        e.altKey && 'Alt',
        e.shiftKey && 'Shift',
      ]
        .filter(Boolean)
        .join('+');
      setSeen((s) => [`${mods ? `${mods}+` : ''}${e.key}`, ...s].slice(0, 50));
    };
    window.addEventListener('keydown', onKey);
    // Tests wait for this before pressing keys (the page loads lazily).
    document.body.dataset['keyprobe'] = 'ready';
    return () => {
      window.removeEventListener('keydown', onKey);
      delete document.body.dataset['keyprobe'];
    };
  }, []);
  return (
    <main aria-label="Key probe" style={{ padding: 'var(--space-6)' }}>
      <h1>Key probe</h1>
      <p>
        Press Ctrl+W, Ctrl+F4, Ctrl+PageUp, Ctrl+PageDown, Ctrl+Tab and the alternates. Keys that
        appear below reached the page.
      </p>
      <ol data-testid="keys">
        {seen.map((k, i) => (
          <li key={i}>{k}</li>
        ))}
      </ol>
    </main>
  );
}
