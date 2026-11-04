// The product name (ADR-023 D-41, rule 11): the one `app.name` key in en.json.
// UI strings name the product as {{app}} (a default variable, src/i18n/index.ts);
// code outside React and the i18n instance — the workers' Office exports, the
// manifest — reads it from here. Vite's JSON named export keeps only the `app`
// entry in a worker bundle, not the whole message file.
import { app } from './en.json';

export const APP_NAME: string = app.name;
