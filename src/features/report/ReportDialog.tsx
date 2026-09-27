import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../i18n';
import { LIMITS } from '../../model/report';
import { Button, Dialog } from '../../ui/components';
import {
  closeReport,
  copyReport,
  currentJson,
  setDescription,
  submitReport,
  useReport,
  type ReportStatus,
} from './reportStore';

const STATUS: Partial<Record<ReportStatus, MessageKey>> = {
  sending: msg('report.status.sending'),
  sent: msg('report.status.sent'),
  offline: msg('report.status.offline'),
  rateLimited: msg('report.status.rateLimited'),
  failed: msg('report.status.failed'),
};

/**
 * Help → Send Error Report, also offered on caught errors (D-22, §10.2,
 * M2-17): an optional description, then the exact payload, read-only, as it
 * will be sent. Nothing leaves the device until Send (rules 4 and 10).
 */
export function ReportDialog() {
  const { t } = useTranslation();
  const open = useReport((s) => s.open);
  const description = useReport((s) => s.description);
  const status = useReport((s) => s.status);
  const copied = useReport((s) => s.copied);
  // Re-rendered on every change of the state the payload is built from.
  const json = useReport((s) => (s.open ? currentJson(s) : ''));
  const id = useId();
  if (!open) return null;
  const sent = status === 'sent';
  const cantSend = status === 'offline' || status === 'failed' || status === 'rateLimited';
  const statusKey = STATUS[status];
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeReport();
      }}
      title={t('report.title')}
      description={t('report.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        sent ? (
          <Button label={t('report.close')} variant="primary" onClick={closeReport} />
        ) : (
          <>
            <Button
              label={t('report.send')}
              variant="primary"
              disabled={status === 'sending'}
              onClick={() => {
                void submitReport();
              }}
            />
            {cantSend ? (
              <Button
                label={t('report.copy')}
                onClick={() => {
                  void copyReport();
                }}
              />
            ) : null}
            <Button label={t('report.cancel')} onClick={closeReport} />
          </>
        )
      }
    >
      <div className="report-dialog">
        <div className="ui-field">
          <label className="ui-field-label" htmlFor={`${id}-desc`}>
            {t('report.descriptionLabel')}
          </label>
          <textarea
            id={`${id}-desc`}
            className="ui-field-input report-description"
            rows={3}
            maxLength={LIMITS.description}
            value={description}
            disabled={sent || status === 'sending'}
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
          <p id={`${id}-hint`} className="print-note">
            {t('report.descriptionHint', { max: format.number(LIMITS.description, 0) })}
          </p>
        </div>
        <p className="report-payload-heading" id={`${id}-payload`}>
          {t('report.payload')}
        </p>
        <textarea
          className="report-payload"
          data-testid="report-payload"
          readOnly
          rows={12}
          aria-labelledby={`${id}-payload`}
          value={json}
        />
        {statusKey ? (
          <p
            className={cantSend ? 'print-error' : 'print-note'}
            role={cantSend ? 'alert' : 'status'}
          >
            {t(statusKey)}
          </p>
        ) : null}
        {copied ? (
          <p className="print-note" role="status">
            {t('report.copied')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
