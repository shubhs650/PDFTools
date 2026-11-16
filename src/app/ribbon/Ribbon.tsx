import { ChevronDown20Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronUp20Regular } from '@fluentui/react-icons/svg/chevron-up';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../ui/components';
import { tabLabelKey } from '../commandLabels';
import { Brand, TopBarActions } from '../TopBar';
import { appStore, useApp } from '../store/appStore';
import { QuickAccess } from './QuickAccess';
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
 *
 * Its first row is the app's one-row header (M10-08·O3, D-47): the product mark
 * and name, Quick Access, File, the tabs, then the top bar buttons. When the row
 * is too narrow, only the tab list scrolls; the rest never leaves the screen.
 */
export function Ribbon({ onOpenBackstage, focusDocument }: RibbonProps) {
  const { t } = useTranslation();
  const layout = useMemo(() => ribbonLayout(), []);
  const [tabIndex, setTabIndex] = useState(0);
  const collapsed = useApp((s) => s.ribbonCollapsed);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const indicator = useRef<HTMLSpanElement>(null);
  const active = layout.tabs[tabIndex];
  // The active tab's short bar (M10-04, D-47) sits centred under its tab and slides to the
  // next one (a transform, on the compositor; instant with reduced motion). Tab widths
  // change with the font and the language, so it follows their sizes too.
  useLayoutEffect(() => {
    const bar = indicator.current;
    if (!bar) return;
    const place = (): void => {
      const tab = tabRefs.current[tabIndex];
      if (!tab) return;
      const x = tab.offsetLeft + (tab.offsetWidth - bar.offsetWidth) / 2;
      bar.style.transform = `translateX(${String(Math.round(x))}px)`;
    };
    place();
    // Only moves between tabs animate, never the first placement.
    const raf = requestAnimationFrame(() => {
      bar.dataset['ready'] = '';
    });
    const ro = new ResizeObserver(place);
    for (const el of tabRefs.current) if (el) ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [tabIndex]);
  // When the header row is too narrow, the tab list scrolls (M10-08·O3) and fades at an
  // edge that has more tabs behind it.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const wrap = scroller.current;
    if (!wrap) return;
    const edges = (): void => {
      const max = wrap.scrollWidth - wrap.clientWidth;
      wrap.toggleAttribute('data-more-start', wrap.scrollLeft > 1);
      wrap.toggleAttribute('data-more-end', wrap.scrollLeft < max - 1);
    };
    edges();
    wrap.addEventListener('scroll', edges, { passive: true });
    const ro = new ResizeObserver(edges);
    ro.observe(wrap);
    if (wrap.firstElementChild) ro.observe(wrap.firstElementChild);
    return () => {
      wrap.removeEventListener('scroll', edges);
      ro.disconnect();
    };
  }, []);
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
        <Brand />
        <QuickAccess />
        <button
          type="button"
          className="ribbon-file ui-focusable"
          onClick={onOpenBackstage}
          data-testid="file-tab"
        >
          {t('ribbon.tab.file')}
        </button>
        <div ref={scroller} className="ribbon-tablist-wrap">
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
                // A hidden semibold copy reserves the label's width (app.css, M10-04).
                data-label={t(tabLabelKey(tab.tab))}
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
          <span ref={indicator} className="ribbon-tab-indicator" aria-hidden="true" />
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
