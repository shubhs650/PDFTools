// Typed message keys derived from en.json (CLAUDE.md rule 11). Keys are the
// dotted paths to string leaves, e.g. "app.shell.label".
import type en from './en.json';

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;

/**
 * Marks a key stored in data (a command table, a menu model) rather than passed
 * straight to `t()`. It returns the key unchanged; the completeness test finds
 * keys through `t('…')`, `msg('…')` and `i18nKey="…"`.
 */
export const msg = <K extends MessageKey>(key: K): K => key;
