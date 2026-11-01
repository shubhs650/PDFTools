// External links of the top bar (M6-01, ADR-021 D-35). Both open in a new tab
// as user-initiated top-level navigations: the app itself makes no request
// (rule 4, D-22; the CSP's connect-src stays 'self').
//
// The GitHub issue link is prefilled with the app version (with its commit),
// the browser family and the OS family only: never a file name, page text or
// anything else from the documents (rule 10). The builder below takes no
// document state at all, so it cannot leak any.
import type { TFunction } from 'i18next';
import { browserOf, osOf, type UaSource } from '../features/report/payload';
import { APP_VERSION } from './version';

/** The OpenEngTools home page. */
export const OPENENGTOOLS_URL = 'https://www.openengtools.com';

/** The repository's new-issue page. */
export const NEW_ISSUE_URL = 'https://github.com/shubhs650/PDFTools/issues/new';

/** Link attributes for both (a new tab, no opener, no referrer). */
export const EXTERNAL_LINK = { target: '_blank', rel: 'noopener noreferrer' } as const;

export interface IssueText {
  /** The issue title. */
  title: string;
  /** The body, with {{app}}, {{browser}} and {{os}} already filled in by i18n. */
  body: (env: { app: string; browser: string; os: string }) => string;
}

export interface IssueEnv {
  /** APP_VERSION: package version + build commit. */
  app: string;
  nav: UaSource;
}

/** The new-issue URL: title and body with the app version, browser and OS only. */
export function issueUrl(env: IssueEnv, text: IssueText): string {
  const body = text.body({ app: env.app, browser: browserOf(env.nav), os: osOf(env.nav) });
  const q = new URLSearchParams({ title: text.title, body });
  return `${NEW_ISSUE_URL}?${q.toString()}`;
}

/** The new-issue URL for this build and browser, in the UI language. */
export function currentIssueUrl(t: TFunction): string {
  return issueUrl(
    { app: APP_VERSION, nav: navigator },
    { title: t('topBar.issue.title'), body: (env) => t('topBar.issue.body', env) },
  );
}
