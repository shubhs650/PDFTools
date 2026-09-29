import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { AnnotationProperties } from '../features/annotate/properties/AnnotationProperties';
import { MeasureInfo } from '../features/measure/MeasureInfo';
import { ViewportList } from '../features/measure/ViewportList';
import { useDocuments } from './store/documentStore';
import { IconButton } from '../ui/components';
import { appStore, useApp } from './store/appStore';

/** Right Properties pane (D-01): the selected annotations' properties (M3-10). */
export function PropertiesPane() {
  const { t } = useTranslation();
  const open = useApp((s) => s.propertiesOpen);
  const docId = useDocuments((s) => s.activeId);
  if (!open) return null;
  return (
    <aside
      aria-labelledby="properties-title"
      className="properties-pane"
      data-testid="properties-pane"
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
          }}
        />
      </div>
      <AnnotationProperties />
      {/* A measurement's scale and the page's viewports (M3-17). */}
      {docId ? <MeasureInfo docId={docId} /> : null}
      <ViewportList />
    </aside>
  );
}
