// Placeholder string lookup until i18next is wired up in M1 (D-30).
import en from './en.json';

export type MessageKey = keyof typeof en;

export function t(key: MessageKey): string {
  return en[key];
}
