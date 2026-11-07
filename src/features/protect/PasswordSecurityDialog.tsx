import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import {
  ALL_ALLOWED,
  effectiveAllowed,
  IMPLIED_BY,
  isValid,
  MAX_PASSWORD_BYTES,
  NEEDS,
  validate,
  type PasswordError,
  type PasswordSecurityForm,
} from '../../model/passwordSecurity';
import { CAPABILITIES, type Capability } from '../../model/permissions';
import { Button, Dialog, ProgressBar, TextField } from '../../ui/components';
import {
  cancelSecurity,
  closeSecurityDialog,
  isEncrypted,
  openSecured,
  runSecurity,
  securedName,
  useSecurity,
  type SecurityMode,
} from './passwordSecurity';
import { dialogHelp } from '../help/openHelp';

// Protect → Password Security… / Remove Security (M6-12, D-40 a, §7.12): the
// form, then progress with Cancel, then the verified result or what failed.
// Native inputs only, so it is complete from the keyboard (rule 12). Password
// fields are `autocomplete="new-password"`: the browser never fills them from
// a saved login, and the values live in this component's state only.

const CAPABILITY_LABEL: Record<Capability, MessageKey> = {
  print: msg('security.capability.print'),
  printHighQuality: msg('security.capability.printHighQuality'),
  copy: msg('security.capability.copy'),
  accessibility: msg('security.capability.accessibility'),
  annotate: msg('security.capability.annotate'),
  fillForms: msg('security.capability.fillForms'),
  modify: msg('security.capability.modify'),
  assemble: msg('security.capability.assemble'),
};

const PASSWORD_ERROR: Record<PasswordError, MessageKey> = {
  empty: msg('passwordSecurity.error.empty'),
  tooLong: msg('passwordSecurity.error.tooLong'),
  mismatch: msg('passwordSecurity.error.mismatch'),
  same: msg('passwordSecurity.error.same'),
};

/** The two modes' own texts (one dialog, two commands). */
const TEXT: Record<
  SecurityMode,
  {
    title: MessageKey;
    description: MessageKey;
    encryption: MessageKey;
    newFile: MessageKey;
    apply: MessageKey;
    openNew: MessageKey;
  }
> = {
  apply: {
    title: msg('passwordSecurity.title'),
    description: msg('passwordSecurity.description'),
    encryption: msg('passwordSecurity.aes256'),
    newFile: msg('passwordSecurity.newFile'),
    apply: msg('passwordSecurity.apply'),
    openNew: msg('passwordSecurity.openNew'),
  },
  remove: {
    title: msg('command.protect.removeSecurity'),
    description: msg('removeSecurity.description'),
    encryption: msg('removeSecurity.none'),
    newFile: msg('removeSecurity.newFile'),
    apply: msg('removeSecurity.apply'),
    openNew: msg('removeSecurity.openNew'),
  },
};

export function PasswordSecurityDialog() {
  const docId = useSecurity((s) => s.docId);
  const mode = useSecurity((s) => s.mode);
  if (!docId) return null;
  return <Body key={`${docId}:${mode}`} docId={docId} mode={mode} />;
}

function Body({ docId, mode }: { docId: string; mode: SecurityMode }) {
  const { t } = useTranslation();
  const ids = useId();
  const meta = useDocuments((s) => s.docs[docId]?.meta);
  const running = useSecurity((s) => s.running);
  const result = useSecurity((s) => s.result);
  const error = useSecurity((s) => s.error);
  const [form, setForm] = useState<PasswordSecurityForm>({
    openRequired: true,
    openPassword: '',
    openConfirm: '',
    restrict: false,
    permissionsPassword: '',
    permissionsConfirm: '',
    allowed: ALL_ALLOWED,
  });
  const [tried, setTried] = useState(false);
  const errors = validate(form);
  const set = (patch: Partial<PasswordSecurityForm>): void => {
    setForm((f) => ({ ...f, ...patch }));
  };
  const name = meta ? securedName(meta.name, mode) : '';
  const signatures = meta?.signatureCount ?? 0;
  const encrypted = meta ? isEncrypted(meta) : false;
  const apply = mode === 'apply';
  const text = TEXT[mode];

  const submit = (): void => {
    setTried(true);
    if (apply && !isValid(errors)) return;
    void runSecurity(apply ? form : undefined);
  };
  const fieldError = (e: PasswordError | undefined): string | undefined =>
    tried && e ? t(PASSWORD_ERROR[e], { max: format.number(MAX_PASSWORD_BYTES, 0) }) : undefined;

  const footer = running ? (
    <Button key="cancel" label={t('passwordSecurity.cancel')} onClick={cancelSecurity} />
  ) : result ? (
    <>
      <Button
        key="open"
        label={t(text.openNew)}
        variant="primary"
        onClick={() => void openSecured()}
      />
      <Button label={t('passwordSecurity.close')} onClick={closeSecurityDialog} />
    </>
  ) : (
    <>
      <Button
        key="apply"
        label={t(text.apply)}
        variant="primary"
        type="submit"
        form={`${ids}-form`}
        disabled={apply && errors.nothing === true}
      />
      <Button label={t('passwordSecurity.close')} onClick={closeSecurityDialog} />
    </>
  );

  const allowed = effectiveAllowed(form.allowed);
  const done = !!result;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeSecurityDialog();
      }}
      title={t(text.title)}
      description={t(text.description, { name: meta?.name ?? '' })}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('passwords')}
      footer={footer}
    >
      <form
        id={`${ids}-form`}
        className="print-dialog-form security-form"
        data-testid="password-security"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!running && !done) submit();
        }}
      >
        {!running && !done ? (
          <>
            <dl className="facts facts--compact">
              <div className="fact">
                <dt>{t('passwordSecurity.encryption')}</dt>
                <dd>{t(text.encryption)}</dd>
              </div>
            </dl>
            {apply ? (
              <>
                <fieldset>
                  <legend>{t('passwordSecurity.open.legend')}</legend>
                  <label className="scale-radio">
                    <input
                      type="checkbox"
                      checked={form.openRequired}
                      onChange={(e) => {
                        set({ openRequired: e.currentTarget.checked });
                      }}
                    />
                    {t('passwordSecurity.open.require')}
                  </label>
                  {form.openRequired ? (
                    <div className="security-passwords">
                      <TextField
                        label={t('passwordSecurity.open.password')}
                        type="password"
                        autoComplete="new-password"
                        value={form.openPassword}
                        error={fieldError(errors.openPassword)}
                        onChange={(e) => {
                          set({ openPassword: e.currentTarget.value });
                        }}
                      />
                      <TextField
                        label={t('passwordSecurity.open.confirm')}
                        type="password"
                        autoComplete="new-password"
                        value={form.openConfirm}
                        error={fieldError(errors.openConfirm)}
                        onChange={(e) => {
                          set({ openConfirm: e.currentTarget.value });
                        }}
                      />
                    </div>
                  ) : null}
                </fieldset>
                <fieldset>
                  <legend>{t('passwordSecurity.restrict.legend')}</legend>
                  <label className="scale-radio">
                    <input
                      type="checkbox"
                      checked={form.restrict}
                      onChange={(e) => {
                        set({ restrict: e.currentTarget.checked });
                      }}
                    />
                    {t('passwordSecurity.restrict.require')}
                  </label>
                  {form.restrict ? (
                    <>
                      <div className="security-passwords">
                        <TextField
                          label={t('passwordSecurity.restrict.password')}
                          type="password"
                          autoComplete="new-password"
                          value={form.permissionsPassword}
                          error={fieldError(errors.permissionsPassword)}
                          onChange={(e) => {
                            set({ permissionsPassword: e.currentTarget.value });
                          }}
                        />
                        <TextField
                          label={t('passwordSecurity.restrict.confirm')}
                          type="password"
                          autoComplete="new-password"
                          value={form.permissionsConfirm}
                          error={fieldError(errors.permissionsConfirm)}
                          onChange={(e) => {
                            set({ permissionsConfirm: e.currentTarget.value });
                          }}
                        />
                      </div>
                      <fieldset>
                        <legend>{t('passwordSecurity.restrict.allowed')}</legend>
                        <div className="security-permissions">
                          {CAPABILITIES.map((c) => {
                            const by = IMPLIED_BY[c];
                            const need = NEEDS[c];
                            const implied = by !== undefined && form.allowed.has(by);
                            const blocked = need !== undefined && !form.allowed.has(need);
                            return (
                              <label key={c} className="scale-radio">
                                <input
                                  type="checkbox"
                                  checked={allowed.has(c)}
                                  disabled={implied || blocked}
                                  onChange={(e) => {
                                    const next = new Set(form.allowed);
                                    if (e.currentTarget.checked) next.add(c);
                                    else next.delete(c);
                                    set({ allowed: next });
                                  }}
                                />
                                {t(CAPABILITY_LABEL[c])}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    </>
                  ) : null}
                </fieldset>
                {errors.nothing ? (
                  <p className="print-note">{t('passwordSecurity.nothing')}</p>
                ) : null}
                {encrypted ? <p className="print-note">{t('passwordSecurity.replaces')}</p> : null}
              </>
            ) : null}
            <p className="print-note">{t(text.newFile, { name })}</p>
            {apply ? <p className="print-note">{t('passwordSecurity.notStored')}</p> : null}
            {signatures > 0 ? (
              <p className="print-error" role="alert">
                {t('passwordSecurity.signed', {
                  count: signatures,
                  n: format.number(signatures, 0),
                })}
              </p>
            ) : null}
          </>
        ) : null}
        {running ? (
          <>
            <ProgressBar
              label={t('passwordSecurity.progressName')}
              value={running.total > 0 ? running.done / running.total : null}
            />
            <p className="print-note" role="status">
              {running.phase === 'copy'
                ? t('passwordSecurity.making', {
                    done: format.number(running.done, 0),
                    total: format.number(running.total, 0),
                  })
                : running.phase === 'verify'
                  ? running.total > 0
                    ? t('passwordSecurity.verifyingPages', {
                        done: format.number(running.done, 0),
                        total: format.number(running.total, 0),
                      })
                    : t('passwordSecurity.verifying')
                  : t('passwordSecurity.writing')}
            </p>
          </>
        ) : null}
        {result ? (
          <div role="status" data-testid="security-result">
            <p className="redact-ok">{t('passwordSecurity.success', { name: result.name })}</p>
            <ul className="redact-list">
              {apply ? (
                <>
                  <li>
                    {t(
                      result.openPassword
                        ? msg('passwordSecurity.check.openPassword')
                        : msg('passwordSecurity.check.noOpenPassword'),
                    )}
                  </li>
                  {result.restricted ? <li>{t('passwordSecurity.check.restricted')}</li> : null}
                  <li>{t('passwordSecurity.check.aes')}</li>
                </>
              ) : (
                <li>{t('removeSecurity.check.open')}</li>
              )}
              <li>{t('passwordSecurity.check.same')}</li>
            </ul>
            <p className="print-note">{t('passwordSecurity.openDocUnchanged')}</p>
          </div>
        ) : null}
        {error ? (
          <p className="print-error" role="alert">
            {t(
              error === 'denied'
                ? msg('passwordSecurity.error.denied')
                : error === 'verify'
                  ? msg('passwordSecurity.error.verify')
                  : msg('passwordSecurity.error.failed'),
            )}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
