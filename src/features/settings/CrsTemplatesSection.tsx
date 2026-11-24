import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { Button } from '../../ui/components';
import { loadCrsTemplates, useCrsTemplates } from '../crs/templates/crsTemplateStore';
import { openTemplateManager } from '../crs/templates/templateUi';

/**
 * File → Settings → CRS templates (M13-08, D-71, plan M13 §6): how many
 * project templates this device keeps, and the template manager.
 */
export function CrsTemplatesSection() {
  const { t } = useTranslation();
  const count = useCrsTemplates((s) => s.templates.length);
  const loaded = useCrsTemplates((s) => s.loaded);
  useEffect(() => {
    if (!loaded) void loadCrsTemplates();
  }, [loaded]);
  return (
    <div className="profile-section" data-testid="crs-templates-section">
      <h3 className="local-data-title">{t('settings.crsTemplates.title')}</h3>
      <p className="local-data-note">
        {count === 0
          ? t('settings.crsTemplates.none')
          : t('settings.crsTemplates.count', { count, n: format.number(count, 0) })}
      </p>
      <div>
        <Button label={t('settings.crsTemplates.manage')} onClick={openTemplateManager} />
      </div>
    </div>
  );
}
