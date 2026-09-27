import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deriveInitials,
  PROFILE_LIMITS,
  validateProfile,
  type ProfileErrors,
  type ProfileField,
  type ReviewerProfile,
} from '../../../model/reviewerProfile';
import { msg, type MessageKey } from '../../../i18n';
import { Button, Dialog, TextField } from '../../../ui/components';
import { closeProfileDialog, saveProfile, useProfile } from './profileStore';

const LABELS: Record<ProfileField, MessageKey> = {
  name: msg('profile.field.name'),
  initials: msg('profile.field.initials'),
  discipline: msg('profile.field.discipline'),
  company: msg('profile.field.company'),
};

const FIELDS: readonly ProfileField[] = ['name', 'initials', 'discipline', 'company'];

const EMPTY: ReviewerProfile = { name: '', initials: '', discipline: '', company: '' };

/**
 * The reviewer profile dialog (M3-07, D-16): asked before the first markup of
 * a session without a profile ("first", with Skip), and from Settings or
 * Comment → Reviewer Profile ("edit"). Everything stays on this device.
 */
export function ProfileDialog() {
  const mode = useProfile((s) => s.dialog);
  if (!mode) return null;
  return <ProfileForm mode={mode} />;
}

function ProfileForm({ mode }: { mode: 'first' | 'edit' }) {
  const { t, i18n } = useTranslation();
  const stored = useProfile((s) => s.profile);
  const [values, setValues] = useState<ReviewerProfile>(stored ?? EMPTY);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [failed, setFailed] = useState(false);
  const formId = 'profile-form';

  const submit = (): void => {
    const r = validateProfile(values, i18n.language);
    if (!r.profile) {
      setErrors(r.errors);
      return;
    }
    void saveProfile(r.profile).then((ok) => {
      // Kept in memory for this session even when the device refused to store it.
      if (ok) closeProfileDialog(false);
      else setFailed(true);
    });
  };

  const error = (k: ProfileField): string | undefined => {
    const e = errors[k];
    if (!e) return undefined;
    return e === 'required'
      ? t('profile.error.required')
      : t('profile.error.tooLong', { max: PROFILE_LIMITS[k] });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeProfileDialog(true);
      }}
      title={t(mode === 'first' ? msg('profile.titleFirst') : msg('profile.title'))}
      description={t('profile.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button label={t('profile.save')} variant="primary" type="submit" form={formId} />
          <Button
            label={t(mode === 'first' ? msg('profile.skip') : msg('profile.cancel'))}
            onClick={() => {
              closeProfileDialog(true);
            }}
          />
        </>
      }
    >
      <form
        id={formId}
        className="profile-form"
        data-testid="profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        {FIELDS.map((k) => (
          <TextField
            key={k}
            name={k}
            label={t(LABELS[k])}
            value={values[k]}
            required={k === 'name'}
            autoComplete={k === 'name' ? 'name' : k === 'company' ? 'organization' : 'off'}
            // The initials a blank field would get.
            placeholder={k === 'initials' ? deriveInitials(values.name, i18n.language) : undefined}
            error={error(k)}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setValues((p) => ({ ...p, [k]: v }));
              setErrors((p) => ({ ...p, [k]: undefined }));
            }}
          />
        ))}
        {failed ? (
          <p className="profile-failed" role="alert">
            {t('profile.saveFailed')}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
