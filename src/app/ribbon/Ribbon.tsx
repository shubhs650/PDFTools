import { ChevronDown20Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronUp20Regular } from '@fluentui/react-icons/svg/chevron-up';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../ui/components';
import { groupLabelKey, tabLabelKey } from '../commandLabels';
import { appStore, useApp } from '../store/appStore';
import { RibbonButton } from './RibbonButton';
import { ribbonLayout, type RibbonTabLayout } from './layout';
import { useRovingToolbar } from './useRovingToolbar';

const PANEL_ID = 'ribbon-panel';

export interface RibbonProps {
  onOpenBackstage: () => void;
  /** Where Esc sends focus (the document area). */
  focusDocument: () => void;
}

/**
 * The ribbon (§8): File opens the backstage; the other tabs form a tablist
 * whose panel is a toolbar with roving focus. Esc returns focus to the
 * document; Ctrl+F1 (keymap) collapses the ribbon.
 */
export function Ribbon({ onOpenBackstage, focusDocument }: RibbonProps) {
  const { t } = useTranslation();
  const layout = useMemo(() => ribbonLayout(), []);
  const [tabIndex, setTabIndex] = useState(0);
  const collapsed = useApp((s) => s.ribbonCollapsed);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = layout.tabs[tabIndex];

  const onTabKey = (e: KeyboardEvent, i: number): void => {
    const n = layout.tabs.length;
    const to: Record<string, number> = {
      ArrowRight: (i + 1) % n,
      ArrowLeft: (i - 1 + n) % n,
      Home: 0,
      End: n - 1,
    };
    const next = to[e.key];
    if (next !== undefined) {
      e.preventDefault();
      setTabIndex(next);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'Escape') {
      focusDocument();
    }
  };

  return (
    <div
      className={`ribbon${collapsed ? ' ribbon--collapsed' : ''}`}
      aria-label={t('ribbon.label')}
      role="region"
    >
      <div className="ribbon-tabs">
        <button
          type="button"
          className="ribbon-file ui-focusable"
          onClick={onOpenBackstage}
          data-testid="file-tab"
        >
          {t('ribbon.tab.file')}
        </button>
        <div role="tablist" aria-label={t('ribbon.tabs')} className="ribbon-tablist">
          {layout.tabs.map((tab, i) => (
            <button
              key={tab.tab}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`ribbon-tab-${tab.tab}`}
              aria-selected={i === tabIndex}
              aria-controls={PANEL_ID}
              tabIndex={i === tabIndex ? 0 : -1}
              className="ribbon-tab ui-focusable"
              onClick={() => {
                setTabIndex(i);
                if (collapsed) appStore.getState().toggleRibbon();
              }}
              onKeyDown={(e) => {
                onTabKey(e, i);
              }}
            >
              {t(tabLabelKey(tab.tab))}
            </button>
          ))}
        </div>
        <span className="ribbon-tabs-end">
          <IconButton
            label={collapsed ? t('ribbon.expand') : t('command.view.collapseRibbon')}
            icon={collapsed ? <ChevronDown20Regular /> : <ChevronUp20Regular />}
            size="small"
            aria-expanded={!collapsed}
            aria-controls={PANEL_ID}
            onClick={() => {
              appStore.getState().toggleRibbon();
            }}
          />
        </span>
      </div>
      {active && !collapsed ? (
        <RibbonPanel key={active.tab} tab={active} onEscape={focusDocument} />
      ) : null}
    </div>
  );
}

function RibbonPanel({ tab, onEscape }: { tab: RibbonTabLayout; onEscape: () => void }) {
  const { t } = useTranslation();
  const flat = tab.groups.flatMap((g) => g.commands);
  const roving = useRovingToolbar(flat.length);
  let n = 0;
  return (
    <div
      id={PANEL_ID}
      role="tabpanel"
      aria-labelledby={`ribbon-tab-${tab.tab}`}
      className="ribbon-panel"
    >
      <div
        role="toolbar"
        aria-label={t('ribbon.commands', { tab: t(tabLabelKey(tab.tab)) })}
        className="ribbon-toolbar"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onEscape();
            return;
          }
          roving.onKeyDown(e);
        }}
      >
        {tab.groups.map((g) => (
          <div
            key={`${g.tab}.${g.group}`}
            role="group"
            aria-labelledby={`grp-${tab.tab}-${g.tab}-${g.group}`}
            className="ribbon-group"
          >
            <div
              className={`ribbon-group-body ribbon-group-body--${g.commands.some((c) => c.size === 'large') ? 'large' : 'small'}`}
            >
              {g.commands.map((c) => {
                const i = n++;
                return (
                  <RibbonButton
                    key={c.id}
                    ref={roving.register(i)}
                    command={c}
                    large={c.size === 'large'}
                    tabIndex={i === roving.index ? 0 : -1}
                  />
                );
              })}
            </div>
            <div id={`grp-${tab.tab}-${g.tab}-${g.group}`} className="ribbon-group-label">
              {t(groupLabelKey(g))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
