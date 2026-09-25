import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RibbonButton } from './RibbonButton';
import { ribbonLayout } from './layout';
import { useRovingToolbar } from './useRovingToolbar';

/** Quick access toolbar in the title bar (§8): icon-only small buttons. */
export function QuickAccess() {
  const { t } = useTranslation();
  const commands = useMemo(() => ribbonLayout().quickAccess, []);
  const roving = useRovingToolbar(commands.length);
  if (commands.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t('ribbon.quickAccess')}
      className="quick-access"
      onKeyDown={roving.onKeyDown}
    >
      {commands.map((c, i) => (
        <RibbonButton
          key={c.id}
          ref={roving.register(i)}
          command={c}
          large={false}
          iconOnly
          tabIndex={i === roving.index ? 0 : -1}
        />
      ))}
    </div>
  );
}
