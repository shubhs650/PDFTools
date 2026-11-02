import { ChevronDown20Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronUp20Regular } from '@fluentui/react-icons/svg/chevron-up';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../ui/components';
import { tabLabelKey } from '../commandLabels';
import { TopBarActions } from '../TopBar';
import { appStore, useApp } from '../store/appStore';
import { PALETTE_COMMANDS } from '../../features/annotate/tools/stylePalette';
import { RibbonGroup, type Stop } from './RibbonGroup';
import { ribbonLayout, STEP_MENU, type RibbonTabLayout } from './layout';
import { useAdaptiveSteps } from './useAdaptiveSteps';
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
  // Pages show tab-specific layers (scale viewports on Measure, M3-17).
  useEffect(() => {
    if (active) appStore.getState().setRibbonTab(active.tab);
  }, [active]);

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
          <TopBarActions />
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
  // Adaptive steps (D-36): each group's size for the panel's width.
  const { panelRef, steps, measuring } = useAdaptiveSteps(tab);
  // A split button (a comment tool and its style palette, M6-07) is two stops;
  // a group folded into its menu button is one.
  const stops = tab.groups.reduce((sum, g, i) => {
    if (steps[i] === STEP_MENU) return sum + 1;
    return sum + g.commands.length + g.commands.filter((c) => PALETTE_COMMANDS[c.id]).length;
  }, 0);
  const roving = useRovingToolbar(stops);
  let n = 0;
  const stop = (): Stop => {
    const i = n++;
    return { bind: roving.register(i), tabIndex: i === roving.index ? 0 : -1 };
  };
  return (
    <div
      ref={panelRef}
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
        {tab.groups.map((g, i) => (
          <RibbonGroup
            key={`${g.tab}.${g.group}`}
            tab={tab.tab}
            group={g}
            step={steps[i] ?? 0}
            stop={stop}
          />
        ))}
      </div>
      {measuring}
    </div>
  );
}
