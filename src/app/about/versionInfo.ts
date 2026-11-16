// File → About → Copy version info (M10-01, ADR-027 D-48): the text a user
// pastes into a bug report. Version, commit, build date, browser, OS and the
// offline state only: never a file name, page text or anything else from a
// document (rule 10). It takes no document state at all, so it cannot leak any.
import type { TFunction } from 'i18next';
import { browserOf, osOf, type UaSource } from '../../features/report/payload';
import { versionParts } from '../version';

export interface VersionInfo {
  /** APP_VERSION: package version + build commit. */
  full: string;
  /** The build date, already formatted for the user's locale; undefined when unknown. */
  built: string | undefined;
  /** The offline state, already translated. */
  offline: string;
  nav: UaSource;
}

export function versionInfoText(t: TFunction, info: VersionInfo): string {
  const { version, commit } = versionParts(info.full);
  const unknown = t('about.unknown');
  return t('about.copy.text', {
    version,
    commit: commit ?? unknown,
    built: info.built ?? unknown,
    browser: browserOf(info.nav),
    os: osOf(info.nav),
    offline: info.offline,
  });
}
