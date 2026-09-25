import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../ui/components';
import { appStore, useApp } from './store/appStore';

/** Right Properties pane (D-01). Content (selected annotation properties) arrives in M3. */
export function PropertiesPane() {
  const { t } = useTranslation();
  const open = useApp((s) => s.propertiesOpen);
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
    </aside>
  );
}
