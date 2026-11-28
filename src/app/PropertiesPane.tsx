import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { AnnotationProperties } from '../features/annotate/properties/AnnotationProperties';
import { MeasureInfo } from '../features/measure/MeasureInfo';
import { useDocuments } from './store/documentStore';
import { IconButton } from '../ui/components';
import { PaneEdge } from './PaneEdge';
import { PaneSplitter } from './PaneSplitter';
import { appStore, useApp } from './store/appStore';

/** The pane's element id, for its edge arrow's aria-controls. */
const PANE_ID = 'properties-pane';
const SPLITTER_TEST_ID = 'properties-resizer';

/** The pane goes; focus goes to the arrow that brings it back. */
const focusArrow = (): void => {
  document.querySelector<HTMLElement>('[data-testid="pane-edge-right"] button')?.focus();
};

/**
 * Right Properties pane (D-01): the selected annotations' properties (M3-10). Its edge strip
 * (M11-10, D-56) is always there, on the document side: the splitter while the pane is shown
 * and the arrow that hides or shows it, so the landmark holds just the arrow while hidden.
 */
export function PropertiesPane() {
  const { t } = useTranslation();
  const open = useApp((s) => s.propertiesOpen);
  const width = useApp((s) => s.propertiesWidth);
  const docId = useDocuments((s) => s.activeId);
  return (
    <aside aria-label={t('frame.propertiesDock')} className="properties-dock">
      <PaneEdge side="right" open={open} controls={PANE_ID}>
        {open ? (
          <PaneSplitter
            side="right"
            label={t('frame.resizeProperties')}
            width={width}
            onWidth={(px) => {
              appStore.getState().setPropertiesWidth(px);
            }}
            testId={SPLITTER_TEST_ID}
          />
        ) : null}
      </PaneEdge>
      {open ? (
        <section
          id={PANE_ID}
          aria-labelledby="properties-title"
          className="properties-pane"
          data-testid="properties-pane"
          style={{ width }}
        >
          <div className="pane-header">
            <h2 id="properties-title" className="pane-title">
              {t('frame.properties')}
            </h2>
            <IconButton
              label={t('frame.closeProperties')}
              icon={<Dismiss20Regular />}
              size="small"
              tooltip={false}
              onClick={() => {
                appStore.getState().setProperties(false);
                focusArrow();
              }}
            />
          </div>
          <AnnotationProperties />
          {/* A measurement's scale (M3-17); the page's viewports are in the Measurements pane (M14-08). */}
          {docId ? <MeasureInfo docId={docId} /> : null}
        </section>
      ) : null}
    </aside>
  );
}
