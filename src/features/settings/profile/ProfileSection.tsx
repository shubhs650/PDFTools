import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../ui/components';
import { loadProfile, openProfileDialog, useProfile } from './profileStore';

/** File → Settings: the reviewer profile (M3-07, D-16), edited in ProfileDialog. */
export function ProfileSection() {
  const { t } = useTranslation();
  const profile = useProfile((s) => s.profile);
  const loaded = useProfile((s) => s.loaded);
  useEffect(() => {
    void loadProfile();
  }, []);
  const rows = profile
    ? ([
        ['profile.field.name', profile.name],
        ['profile.field.initials', profile.initials],
        ['profile.field.discipline', profile.discipline],
        ['profile.field.company', profile.company],
      ] as const)
    : [];
  return (
    <div className="profile-section" data-testid="profile-section">
      <h3 className="local-data-title">{t('profile.title')}</h3>
      {profile ? (
        <dl className="local-data-usage">
          {rows.map(([k, v]) => (
            <div key={k} className="profile-row">
              <dt>{t(k)}</dt>
              <dd>{v || t('profile.notSet')}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="local-data-note">{loaded ? t('profile.none') : '…'}</p>
      )}
      <p className="local-data-note">{t('profile.note')}</p>
      <Button label={t('profile.edit')} onClick={openProfileDialog} />
    </div>
  );
}
