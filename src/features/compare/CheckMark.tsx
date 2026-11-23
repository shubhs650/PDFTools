import { Warning16Regular } from '@fluentui/react-icons/svg/warning';
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../i18n';
import type { RowCheck } from '../../model/compare/pairing';

const WHY: Record<RowCheck, MessageKey> = {
  low: msg('compare.check.low'),
  added: msg('compare.check.added'),
  removed: msg('compare.check.removed'),
};

/**
 * "Check" on a sheet that needs a look before Compare (M12-24, ADR-033): a
 * weak match, or a page added or removed. Its reason is in its title and is
 * read out with it.
 */
export function CheckMark({ check }: { check: RowCheck }) {
  const { t } = useTranslation();
  const why = t(WHY[check]);
  return (
    <span className="compare-check" title={why} data-testid="compare-check" data-check={check}>
      <Warning16Regular aria-hidden="true" />
      <span>{t('compare.check.label')}</span>
      <span className="ui-visually-hidden">{`: ${why}`}</span>
    </span>
  );
}
