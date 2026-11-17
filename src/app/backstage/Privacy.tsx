import { useTranslation } from 'react-i18next';
import { LOCAL_DATA, type LocalDataKind } from '../../features/settings/storedData';
import { msg, type MessageKey } from '../../i18n';

const KIND: Record<LocalDataKind, MessageKey> = {
  indexedDB: msg('privacy.kind.indexedDB'),
  opfs: msg('privacy.kind.opfs'),
  localStorage: msg('privacy.kind.localStorage'),
  cache: msg('privacy.kind.cache'),
};

const PROMISES: MessageKey[] = [
  msg('privacy.promise.documents'),
  msg('privacy.promise.account'),
  msg('privacy.promise.telemetry'),
  msg('privacy.promise.network'),
  msg('privacy.promise.reports'),
  msg('privacy.promise.links'),
  // Fonts on this computer (M11-08·O5, D-54).
  msg('privacy.promise.fonts'),
];

/**
 * File → Privacy (M1-26, §1.1, §10.3, D-22): the privacy promise and every
 * piece of data kept on this device (LOCAL_DATA, checked against the code by
 * a unit test).
 */
export function Privacy() {
  const { t } = useTranslation();
  return (
    <div className="privacy" data-testid="privacy">
      <ul className="privacy-promises">
        {PROMISES.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <table className="privacy-data">
        <caption>{t('privacy.data.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('privacy.data.what')}</th>
            <th scope="col">{t('privacy.data.where')}</th>
            <th scope="col">{t('privacy.data.cleared')}</th>
          </tr>
        </thead>
        <tbody>
          {LOCAL_DATA.map((item) => (
            <tr key={item.location}>
              <td>{t(item.what)}</td>
              <td>
                {t(KIND[item.kind])} <code>{item.location}</code>
              </td>
              <td>{item.cleared ? t('privacy.data.yes') : t('privacy.data.no')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="privacy-note">{t('privacy.clearHint')}</p>
    </div>
  );
}
