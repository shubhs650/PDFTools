import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import type { LayerList } from '../../../model/ocg';
import { workClient } from '../../view/host';
import type { Comparison } from '../model';
import { differingDefaults, updateView, useOverlayView, type Sheet } from './overlayState';

const lists = new Map<string, Promise<LayerList>>();

/** A document's layers (read by the Work worker), cached per edit count. */
function useLayers(docId: string | null): LayerList | null {
  const version = useDocuments((s) => (docId ? (s.docs[docId]?.edits ?? 0) : 0));
  const [list, setList] = useState<{ key: string; list: LayerList } | null>(null);
  const key = docId ? `${docId}\n${String(version)}` : null;
  useEffect(() => {
    if (!docId || key === null) return;
    let live = true;
    let job = lists.get(key);
    if (!job) {
      job = workClient().run('listLayers', { docId }).promise;
      lists.set(key, job);
      job.catch(() => lists.delete(key));
    }
    job.then(
      (l) => {
        if (live) setList({ key, list: l });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [docId, key]);
  return list?.key === key ? list.list : null;
}

/**
 * The left pane's switches below the sheet list (D-59): comments of each
 * document on top of the overlay and Hide check highlights (Q10, Q11), and
 * each file's layers with their default visibility (Q24). Each file is drawn
 * with its own default layers; a notice names the layers whose default differs
 * between the two files. The engine cannot switch layers (ADR-012), so the
 * list shows them as the files set them.
 */
export function OverlayLayers({ comparison: c, sheet }: { comparison: Comparison; sheet: Sheet }) {
  const { t } = useTranslation();
  const commentsId = useId();
  const layersId = useId();
  const view = useOverlayView(c.id);
  const set = (key: 'a' | 'b' | 'hideChecks', on: boolean): void => {
    updateView(c.id, (v) => ({ ...v, comments: { ...v.comments, [key]: on } }));
  };
  const docA = sheet.a?.docId ?? null;
  const docB = sheet.b?.docId ?? null;
  const la = useLayers(docA);
  const lb = useLayers(docB);
  const nameA = useDocuments((s) => (docA ? (s.docs[docA]?.meta.name ?? '') : ''));
  const nameB = useDocuments((s) => (docB ? (s.docs[docB]?.meta.name ?? '') : ''));
  const differ = differingDefaults(la, lb);
  const hint = t('compare.overlay.hideChecksHint');
  return (
    <>
      <section className="overlay-switches" aria-labelledby={commentsId}>
        <h3 id={commentsId} className="overlay-side-title">
          {t('compare.overlay.comments')}
        </h3>
        <label className="overlay-check">
          <input
            type="checkbox"
            className="ui-focusable"
            checked={view.comments.a}
            disabled={!sheet.a}
            onChange={(e) => {
              set('a', e.currentTarget.checked);
            }}
          />
          <span>{t('compare.overlay.commentsA')}</span>
        </label>
        <label className="overlay-check">
          <input
            type="checkbox"
            className="ui-focusable"
            checked={view.comments.b}
            disabled={!sheet.b}
            onChange={(e) => {
              set('b', e.currentTarget.checked);
            }}
          />
          <span>{t('compare.overlay.commentsB')}</span>
        </label>
        <label className="overlay-check" title={hint}>
          <input
            type="checkbox"
            className="ui-focusable"
            checked={view.comments.hideChecks}
            onChange={(e) => {
              set('hideChecks', e.currentTarget.checked);
            }}
          />
          <span>{t('compare.overlay.hideChecks')}</span>
        </label>
      </section>
      {(la?.layers.length ?? 0) + (lb?.layers.length ?? 0) > 0 || la?.encrypted || lb?.encrypted ? (
        <section className="overlay-layers" aria-labelledby={layersId} data-testid="overlay-layers">
          <h3 id={layersId} className="overlay-side-title">
            {t('compare.overlay.layers')}
          </h3>
          {differ.length > 0 ? (
            <p className="overlay-layer-notice" role="note">
              {t('compare.overlay.layerNotice', { names: format.list(differ) })}
            </p>
          ) : null}
          <LayerGroup name={nameA} list={la} />
          <LayerGroup name={nameB} list={lb} />
        </section>
      ) : null}
    </>
  );
}

function LayerGroup({ name, list }: { name: string; list: LayerList | null }) {
  const { t } = useTranslation();
  if (!list) return null;
  if (list.encrypted)
    return <p className="overlay-layer-empty">{t('compare.overlay.layersEncrypted', { name })}</p>;
  if (list.layers.length === 0)
    return <p className="overlay-layer-empty">{t('compare.overlay.noLayers', { name })}</p>;
  return (
    <ul className="overlay-layer-list" aria-label={t('compare.overlay.layersOf', { name })}>
      {list.layers.map((l, i) => (
        <li key={i} className="overlay-layer" data-on={l.on ? 'true' : 'false'}>
          {l.on
            ? t('compare.overlay.layerOn', { name: l.name })
            : t('compare.overlay.layerOff', { name: l.name })}
        </li>
      ))}
    </ul>
  );
}
