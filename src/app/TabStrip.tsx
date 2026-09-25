import { Dismiss16Regular } from '@fluentui/react-icons/svg/dismiss';
import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../ui/components';
import { documentStore, useDocuments } from './store/documentStore';

/**
 * Document tabs (D-01): a tablist with roving focus (arrows, Home, End). Each
 * tab has its own close button next to it (not nested inside the tab, so both
 * stay valid controls). Opening files and the unsaved-changes prompt come in
 * M1-13; keyboard shortcuts in M1-11.
 */
export function TabStrip() {
  const { t } = useTranslation();
  const order = useDocuments((s) => s.order);
  const activeId = useDocuments((s) => s.activeId);
  const docs = useDocuments((s) => s.docs);
  const refs = useRef(new Map<string, HTMLButtonElement>());

  if (order.length === 0) return <div className="tab-strip tab-strip--empty" />;

  const focusTab = (i: number): void => {
    const id = order[(i + order.length) % order.length];
    if (!id) return;
    documentStore.getState().activate(id);
    refs.current.get(id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, i: number): void => {
    const moves: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowLeft: i - 1,
      Home: 0,
      End: order.length - 1,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    focusTab(to);
  };

  return (
    <div className="tab-strip">
      <div role="tablist" aria-label={t('frame.tabs')} className="tab-list">
        {order.map((id, i) => {
          const d = docs[id];
          if (!d) return null;
          const active = id === activeId;
          return (
            <span key={id} className={`tab${active ? ' tab--active' : ''}`}>
              <button
                ref={(el) => {
                  if (el) refs.current.set(id, el);
                  else refs.current.delete(id);
                }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={active}
                aria-controls="document-panel"
                aria-label={d.dirty ? t('frame.dirtyTab', { name: d.meta.name }) : d.meta.name}
                tabIndex={active ? 0 : -1}
                className="tab-button ui-focusable"
                onClick={() => {
                  documentStore.getState().activate(id);
                }}
                onKeyDown={(e) => {
                  onKeyDown(e, i);
                }}
              >
                {d.dirty ? <span className="tab-dirty" aria-hidden="true" /> : null}
                <span className="tab-name">{d.meta.name}</span>
              </button>
              <IconButton
                label={t('frame.closeTab', { name: d.meta.name })}
                icon={<Dismiss16Regular />}
                size="small"
                tooltip={false}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  documentStore.getState().close(id);
                }}
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}
