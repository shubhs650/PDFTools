import { TabAdd20Regular } from '@fluentui/react-icons/svg/tab-add';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/components';
import { newComparisonFrom } from './compareFlow';

/** The button's test id (e2e). */
const TEST_ID = 'compare-new';

/**
 * New comparison in a result's header (M12-24, ADR-033, replacing "Change
 * inputs"): a new comparison tab with the same files, type and settings; this
 * result stays open in its own tab.
 */
export function NewComparisonButton({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <Button
      label={t('compare.result.newComparison')}
      title={t('compare.result.newComparisonHint')}
      size="small"
      icon={<TabAdd20Regular />}
      data-testid={TEST_ID}
      onClick={() => {
        newComparisonFrom(id);
      }}
    />
  );
}
