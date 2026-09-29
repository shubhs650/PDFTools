import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store/appStore';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
import { allows } from '../../model/permissions';
import { ratioLabel } from '../../model/scale';
import { coversPage } from '../../model/scaleViewport';
import { Button } from '../../ui/components';
import { entriesOf, loadScales, mediaBoxOf, readEntries, useScales } from './scaleStore';
import { addViewport, defaultBox, deleteViewport, editViewport } from './viewports';

/**
 * The current page's scale viewports in the Properties pane while the Measure
 * tab is shown (M3-17): the keyboard path to add, edit and delete them.
 */
export function ViewportList() {
  const { t } = useTranslation();
  const onMeasure = useApp((s) => s.ribbonTab === 'measure');
  const docId = useDocuments((s) => s.activeId);
  const page = useDocuments((s) => (s.activeId ? (s.docs[s.activeId]?.view.page ?? 0) : 0));
  const canEdit = useDocuments((s) => {
    const meta = s.activeId ? s.docs[s.activeId]?.meta : undefined;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const entry = useScales((s) => (docId ? s.docs[docId] : undefined));
  useEffect(() => {
    if (docId && onMeasure) void loadScales(docId);
  }, [docId, onMeasure]);
  const items = useMemo(() => {
    if (!docId || !entry || typeof entry === 'string') return [];
    const st = { docs: { [docId]: entry } };
    const media = mediaBoxOf(st, docId, page);
    return readEntries(entriesOf(st, docId, page))
      .map((v, index) => ({ v, index }))
      .filter(({ v }) => v && !coversPage(v.bbox, media))
      .map(({ v, index }) => ({
        index,
        name: v?.name ?? '',
        text: v?.scale
          ? t('viewport.item', { name: v.name, ratio: ratioLabel(v.scale, format) })
          : t('viewport.unscaled', { name: v?.name ?? '' }),
      }));
  }, [docId, entry, page, t]);
  if (!onMeasure || !docId) return null;
  return (
    <section className="viewport-list" aria-labelledby="viewport-list-title">
      <h3 id="viewport-list-title" className="prop-subtitle">
        {t('viewport.list')}
      </h3>
      {items.length === 0 ? <p className="prop-empty">{t('viewport.none')}</p> : null}
      <ul className="viewport-items">
        {items.map((it) => (
          <li key={it.index} className="viewport-item">
            <span className="viewport-item-text">{it.text}</span>
            <Button
              label={t('viewport.edit', { name: it.name })}
              disabled={!canEdit}
              onClick={() => {
                editViewport(docId, page, it.index);
              }}
            />
            <Button
              label={t('viewport.delete', { name: it.name })}
              disabled={!canEdit}
              onClick={() => {
                deleteViewport(docId, page, it.index);
              }}
            />
          </li>
        ))}
      </ul>
      <Button
        label={t('viewport.add')}
        disabled={!canEdit}
        onClick={() => {
          void addViewport(docId, page, defaultBox(docId, page));
        }}
      />
    </section>
  );
}
