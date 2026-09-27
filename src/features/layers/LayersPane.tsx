import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import type { LayerList } from '../../model/ocg';
import { workClient } from '../view/host';

interface State {
  docId: string;
  list: LayerList | null;
  failed: boolean;
}

/**
 * Layers pane (§5, M2-11, ADR-012 decision 5 option 1): the document's
 * optional content groups with their default visibility. List only — this
 * PDFium can't switch layers, so the pane says that the view follows the
 * document's own settings.
 */
export function LayersPane() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (!docId) return;
    const job = workClient().run('listLayers', { docId });
    job.promise.then(
      (list) => {
        setState({ docId, list, failed: false });
      },
      () => {
        setState({ docId, list: null, failed: true });
      },
    );
    return () => {
      job.cancel();
    };
  }, [docId]);

  if (!docId) return <p className="pane-empty">{t('layers.noDocument')}</p>;
  const current = state?.docId === docId ? state : null;
  if (!current) return <p className="pane-empty">{t('layers.loading')}</p>;
  if (current.failed || !current.list) return <p className="pane-empty">{t('layers.failed')}</p>;
  if (current.list.encrypted) return <p className="pane-empty">{t('layers.encrypted')}</p>;
  if (current.list.layers.length === 0) return <p className="pane-empty">{t('layers.empty')}</p>;
  return (
    <div className="layers-pane">
      <p className="layers-note">{t('layers.note')}</p>
      <ul className="layer-list" aria-label={t('layers.list')}>
        {current.list.layers.map((l, i) => (
          <li key={i} className="layer" tabIndex={-1} data-pane-focus={i === 0 || undefined}>
            <span className="layer-name">{l.name || t('layers.unnamed')}</span>
            <span className="layer-state">{l.on ? t('layers.shown') : t('layers.hidden')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
