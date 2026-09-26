import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { ProgressBar } from '../../ui/components';
import type { Integrity } from '../../workers/work/signatures';
import { checkDocument, useSignatures } from './signatures';

const INTEGRITY: Record<Integrity, MessageKey> = {
  unchanged: msg('signatures.integrity.unchanged'),
  modified: msg('signatures.integrity.modified'),
  damaged: msg('signatures.integrity.damaged'),
};

/**
 * Signatures pane (D-24, §7.11, M2-13): each signature's signer, time,
 * reason, location and the revision it covers, with an offline integrity
 * check. Trust is never checked: every signature says "Not verified
 * (offline)" and nothing is fetched (rule 4).
 */
export function SignaturesPane() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const key = useDocuments((s) =>
    s.activeId ? `${s.activeId}|${String(s.docs[s.activeId]?.appendedBytes ?? 0)}` : '',
  );
  const check = useSignatures((s) => s.checks[key]);

  useEffect(() => {
    if (docId) checkDocument(docId);
  }, [docId, key]);

  if (!docId) return <p className="pane-empty">{t('signatures.noDocument')}</p>;
  if (!check || check.state === 'checking')
    return (
      <div className="pane-empty">
        <ProgressBar
          label={t('signatures.checking')}
          value={check?.total ? check.done / check.total : null}
        />
      </div>
    );
  if (check.state === 'failed') return <p className="pane-empty">{t('signatures.failed')}</p>;
  if (check.items.length === 0) return <p className="pane-empty">{t('signatures.none')}</p>;
  return (
    <div className="signatures-pane">
      <ul className="signature-list" aria-label={t('signatures.list')}>
        {check.items.map((s, i) => (
          <li
            key={i}
            className={`signature signature--${s.integrity}`}
            tabIndex={-1}
            data-pane-focus={i === 0 || undefined}
          >
            <div className="signature-signer">{s.signer || t('signatures.unknownSigner')}</div>
            <dl className="facts facts--compact">
              <div className="fact">
                <dt>{t('signatures.integrityLabel')}</dt>
                <dd className="signature-integrity">{t(INTEGRITY[s.integrity])}</dd>
              </div>
              <div className="fact">
                <dt>{t('signatures.trustLabel')}</dt>
                <dd>{t('signatures.trust')}</dd>
              </div>
              <div className="fact">
                <dt>{t('signatures.signedAt')}</dt>
                <dd>{s.signedAt ? format.dateTime(new Date(s.signedAt)) : t('properties.none')}</dd>
              </div>
              {s.reason ? (
                <div className="fact">
                  <dt>{t('signatures.reason')}</dt>
                  <dd>{s.reason}</dd>
                </div>
              ) : null}
              {s.location ? (
                <div className="fact">
                  <dt>{t('signatures.location')}</dt>
                  <dd>{s.location}</dd>
                </div>
              ) : null}
              <div className="fact">
                <dt>{t('signatures.covers')}</dt>
                <dd>
                  {t('signatures.revision', {
                    n: format.number(s.revision, 0),
                    m: format.number(s.revisions, 0),
                  })}
                </dd>
              </div>
              <div className="fact">
                <dt>{t('signatures.after')}</dt>
                <dd>
                  {s.changedAfter ? t('signatures.changedAfter') : t('signatures.notChangedAfter')}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
