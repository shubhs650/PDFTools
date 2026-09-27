import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocProperties } from '../../features/properties/useDocProperties';
import { hostStore } from '../../features/view/host';
import { format } from '../../i18n';
import { selectActive, useDocuments } from '../store/documentStore';

const MM_PER_PT = 25.4 / 72;

/**
 * File → Properties (M1-Q6, M2-12): read-only facts about the active
 * document. Values are the document's own; nothing here is reported
 * anywhere (rule 10).
 */
export function Properties() {
  const { t } = useTranslation();
  const active = useDocuments(selectActive);
  const state = useDocProperties(active?.meta.id ?? null);
  if (!active) return <p className="backstage-note">{t('properties.noDocument')}</p>;
  if (state.state === 'loading') return <p className="backstage-note">{t('properties.loading')}</p>;
  if (state.state === 'failed') return <p className="backstage-note">{t('properties.failed')}</p>;
  const p = state.props;
  const size = hostStore.getState().registry?.getStore().getState().core.documents[active.meta.id]
    ?.document?.pages[active.view.page]?.size;
  const none = t('properties.none');
  const text = (v: string) => v || none;
  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso)) : none);
  const yes = (b: boolean) => (b ? t('properties.yes') : t('properties.no'));
  const rows: [string, ReactNode][] = [
    [t('properties.title'), text(p.title)],
    [t('properties.author'), text(p.author)],
    [t('properties.subject'), text(p.subject)],
    [t('properties.keywords'), text(p.keywords)],
    [t('properties.creator'), text(p.creator)],
    [t('properties.producer'), text(p.producer)],
    [t('properties.created'), date(p.created)],
    [t('properties.modified'), date(p.modified)],
    [t('properties.version'), p.version ?? none],
    [t('properties.pages'), format.number(active.meta.pageCount, 0)],
    [
      t('properties.pageSize', { page: format.number(active.view.page + 1, 0) }),
      size
        ? t('properties.pageSizeValue', {
            w: format.number(size.width * MM_PER_PT, 0),
            h: format.number(size.height * MM_PER_PT, 0),
            wi: format.number(size.width / 72, 2),
            hi: format.number(size.height / 72, 2),
          })
        : none,
    ],
    [t('properties.fileSize'), format.bytes(p.fileBytes)],
    [t('properties.tagged'), yes(p.tagged)],
    [t('properties.linearized'), yes(p.linearized)],
    [t('properties.revisions'), format.number(p.revisions, 0)],
  ];
  return (
    <dl className="facts" data-testid="properties">
      {rows.map(([k, v]) => (
        <div key={k} className="fact">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
