import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import { Edit20Regular } from '@fluentui/react-icons/svg/edit';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { securityOf, useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { allows } from '../../../model/permissions';
import { ratioLabel } from '../../../model/scale';
import { coversPage, layoutOf, normBox, type Box } from '../../../model/scaleViewport';
import { Button, IconButton } from '../../../ui/components';
import { entriesOf, mediaBoxOf, openScaleDialog, readEntries, useScales } from '../scaleStore';
import { addViewport, defaultBox, deleteViewport, editViewport } from '../viewports';
import { showViewport, useMeasurePane, type PaneScope } from './measureEntries';

interface ViewportItem {
  index: number;
  name: string;
  text: string;
  bbox: Box;
}

interface PageScales {
  page: number;
  scale: string | null;
  viewports: ViewportItem[];
}

/**
 * The Measurements pane's Scales section (M14-08, D-76, D-77, Q22): every
 * page's scale and its scale viewports with name and ratio (pages with
 * neither are left out, except the current page); a click on a viewport shows
 * and selects it on its page. Replaces the Properties pane's viewport list
 * (M3-17) as the keyboard path to set a page's scale and to add, edit and
 * delete viewports. This page shows the current page only.
 */
export function ScalesSection({
  docId,
  page,
  scope,
}: {
  docId: string;
  page: number;
  scope: PaneScope;
}) {
  const { t } = useTranslation();
  const entry = useScales((s) => s.docs[docId]);
  const picked = useMeasurePane((s) => s.viewport);
  const canEdit = useDocuments((s) => {
    const meta = s.docs[docId]?.meta;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const pages = useMemo((): PageScales[] => {
    if (!entry || typeof entry === 'string') return [];
    const st = { docs: { [docId]: entry } };
    const out: PageScales[] = [];
    const list = scope === 'page' ? [page] : entry.pages.map((_, i) => i);
    for (const p of list) {
      const media = mediaBoxOf(st, docId, p);
      const read = readEntries(entriesOf(st, docId, p));
      const pageScale = layoutOf(read, media).pageDefault;
      const viewports = read.flatMap((v, index): ViewportItem[] =>
        v && !coversPage(v.bbox, media)
          ? [
              {
                index,
                name: v.name,
                bbox: normBox(v.bbox),
                text: v.scale
                  ? t('viewport.item', { name: v.name, ratio: ratioLabel(v.scale, format) })
                  : t('viewport.unscaled', { name: v.name }),
              },
            ]
          : [],
      );
      if (p !== page && !pageScale && viewports.length === 0) continue;
      out.push({
        page: p,
        scale: pageScale ? ratioLabel(pageScale, format) : null,
        viewports,
      });
    }
    return out;
  }, [entry, docId, page, scope, t]);

  return (
    <section
      className="mpane-scales"
      aria-labelledby="mpane-scales-title"
      data-testid="measure-scales"
    >
      <h3 id="mpane-scales-title" className="mpane-scales-title">
        {t('measurements.scales')}
      </h3>
      {!entry || entry === 'loading' ? (
        <p className="pane-empty">{t('measurements.loading')}</p>
      ) : entry === 'failed' ? (
        <p className="pane-empty">{t('measurements.scalesFailed')}</p>
      ) : (
        <ul className="mpane-scale-pages">
          {pages.map((p) => {
            const n = format.number(p.page + 1, 0);
            return (
              <li key={p.page} className="mpane-scale-page" data-testid="measure-scale-page">
                <div className="mpane-scale-head">
                  <span className="mpane-scale-name">
                    {t('measurements.page', { page: n })}
                    {p.page === page ? (
                      <span className="mpane-scale-current"> {t('measurements.currentPage')}</span>
                    ) : null}
                  </span>
                  <span className="mpane-scale-ratio">{p.scale ?? t('measurements.noScale')}</span>
                  <IconButton
                    label={t('measurements.setScaleOf', { page: n })}
                    icon={<Edit20Regular />}
                    size="small"
                    disabled={!canEdit}
                    onClick={() => {
                      openScaleDialog('setScale', p.page);
                    }}
                  />
                </div>
                {p.viewports.length ? (
                  <ul
                    className="mpane-viewports"
                    aria-label={t('measurements.viewportsOf', { page: n })}
                  >
                    {p.viewports.map((v) => {
                      const isPicked =
                        picked?.docId === docId &&
                        picked.page === p.page &&
                        picked.index === v.index;
                      return (
                        <li key={v.index} className="mpane-viewport">
                          <button
                            type="button"
                            className={`mpane-viewport-show${isPicked ? ' is-selected' : ''}`}
                            aria-pressed={isPicked}
                            data-testid="measure-viewport"
                            onClick={() => {
                              showViewport(docId, p.page, v.index, v.bbox);
                            }}
                          >
                            {v.text}
                          </button>
                          <IconButton
                            label={t('viewport.edit', { name: v.name })}
                            icon={<Edit20Regular />}
                            size="small"
                            disabled={!canEdit}
                            onClick={() => {
                              editViewport(docId, p.page, v.index);
                            }}
                          />
                          <IconButton
                            label={t('viewport.delete', { name: v.name })}
                            icon={<Delete20Regular />}
                            size="small"
                            disabled={!canEdit}
                            onClick={() => {
                              deleteViewport(docId, p.page, v.index);
                            }}
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Button
        label={t('viewport.add')}
        size="small"
        disabled={!canEdit || !entry || typeof entry === 'string'}
        onClick={() => {
          void addViewport(docId, page, defaultBox(docId, page));
        }}
      />
    </section>
  );
}
