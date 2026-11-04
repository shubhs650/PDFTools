// i18n setup (D-30, CLAUDE.md rule 11). Strings are bundled (offline-first) and
// initialised synchronously, so `t()` works on the first render. English is the
// only UI language at launch; formatting follows the user's locale (format.ts).
//
// Dev and e2e builds accept `?locale=pseudo` to render the pseudo-locale
// (+40 % length) for layout testing (§8.2).

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import type {} from './i18next-types';
import { createFormatters, type Formatters } from './format';
import { PSEUDO_LOCALE, pseudoResources } from './pseudo';
import { APP_NAME } from './appName';

export type { MessageKey } from './keys';
export { msg } from './keys';

function wantsPseudo(): boolean {
  if (!import.meta.env.DEV && import.meta.env.MODE !== 'e2e') return false;
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('locale') === 'pseudo';
}

const pseudo = wantsPseudo();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ...(pseudo ? { [PSEUDO_LOCALE]: { translation: pseudoResources(en) } } : {}),
  },
  lng: pseudo ? PSEUDO_LOCALE : 'en',
  fallbackLng: 'en',
  initAsync: false,
  // React escapes. {{app}} is the product name in every string (ADR-023 D-41).
  interpolation: { escapeValue: false, defaultVariables: { app: APP_NAME } },
  returnNull: false,
});

/** Translate outside React components. Inside components prefer `useTranslation()`. */
export const t = i18n.t.bind(i18n);

/** Formatters for the user's locale (not the UI language). */
export const format: Formatters = createFormatters(
  typeof navigator !== 'undefined' ? navigator.language : 'en-US',
);

export { i18n };
