/** Package version + build commit, set by vite.config.ts (M1-26); "dev" in unit tests. */
export const APP_VERSION: string =
  (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? 'dev';
