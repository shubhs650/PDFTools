/** Package version + build commit, set by vite.config.ts (M1-26); "dev" in unit tests. */
export const APP_VERSION: string =
  (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? 'dev';

/** The build's commit date (ISO 8601), set by vite.config.ts (M10-01); undefined in unit tests. */
export const BUILD_DATE: string | undefined = import.meta.env['VITE_BUILD_DATE'] as
  string | undefined;

/** `0.10.0-beta+ab2edeb` → version `0.10.0-beta`, commit `ab2edeb` (M10-01, File → About). */
export function versionParts(full: string): { version: string; commit: string | undefined } {
  const plus = full.indexOf('+');
  return plus < 0
    ? { version: full, commit: undefined }
    : { version: full.slice(0, plus), commit: full.slice(plus + 1) || undefined };
}
