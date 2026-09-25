// Typed keys for t() and useTranslation() (rule 11): an unknown key is a type error.
import type en from './en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
    returnNull: false;
  }
}

export {};
