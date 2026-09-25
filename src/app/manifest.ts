// Web app manifest (D-21, §4.1, M1-19): installable, opens .pdf files from the
// OS (file_handlers) into new tabs of the existing window (launch_handler
// focus-existing + launchQueue, src/features/open/launchQueue.ts). Icons are
// our own artwork (rule 15; scripts/icons, scripts/gen-app-icons.ts). Names
// come from en.json so product text stays in one place (rule 11).
import en from '../i18n/en.json' with { type: 'json' };
import { msg, type MessageKey } from '../i18n/keys.ts';

/** English text of a message key, at build time (the manifest is static). */
function english(key: MessageKey): string {
  let node: unknown = en;
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part];
  return String(node);
}

export const MANIFEST = {
  id: '/',
  name: english(msg('app.name')),
  short_name: english(msg('app.name')),
  description: english(msg('app.description')),
  lang: 'en',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  // tokens.css --color-bg and --color-accent
  background_color: '#f3f3f3',
  theme_color: '#0f6cbd',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: 'icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
    { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  file_handlers: [{ action: '/', accept: { 'application/pdf': ['.pdf'] } }],
  launch_handler: { client_mode: 'focus-existing' },
} as const;
