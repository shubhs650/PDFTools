import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { RibbonGroup, type Stop } from './RibbonGroup';
import {
  choosePlan,
  groupKey,
  groupPriority,
  groupSteps,
  reductionPlans,
  relaxPlan,
  type GroupStep,
  type RibbonTabLayout,
} from './layout';

/**
 * Measured group widths in CSS pixels, by language, group and step. They only
 * change with the language (labels), so a tab measures once per language.
 */
const widths = new Map<string, number>();
const widthKey = (lang: string, group: string, step: GroupStep): string =>
  `${lang}|${group}|${String(step)}`;

const NO_STOP: Stop = { bind: () => undefined, tabIndex: -1 };

export interface AdaptiveSteps {
  /** The panel whose width the groups share. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** One step per group of the tab. */
  steps: readonly GroupStep[];
  /** The hidden measuring layer while widths are unknown (render it in the panel), else null. */
  measuring: ReactNode;
}

/**
 * The adaptive ribbon (D-36): the widest layout of the tab whose groups fit the
 * panel. A hidden copy of every group at every step is measured once per tab
 * and language (before the first paint); a ResizeObserver follows the panel's
 * width. The steps themselves are pure (layout.ts).
 */
export function useAdaptiveSteps(tab: RibbonTabLayout): AdaptiveSteps {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [, setMeasured] = useState(0);

  const groupSets = useMemo(() => tab.groups.map((g) => groupSteps(g.commands)), [tab]);
  const groups = useMemo(
    () => tab.groups.map((g, i) => ({ steps: groupSets[i] ?? [0], priority: groupPriority(g) })),
    [tab, groupSets],
  );
  const plans = useMemo(() => reductionPlans(groups), [groups]);
  const widthOf = (g: number, step: GroupStep): number | undefined => {
    const group = tab.groups[g];
    return group ? widths.get(widthKey(lang, groupKey(group), step)) : undefined;
  };
  const unmeasured = tab.groups.some((g, i) =>
    (groupSets[i] ?? []).some((s) => !widths.has(widthKey(lang, groupKey(g), s))),
  );

  // Measure the hidden copies, then drop them (one extra render, before paint).
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!unmeasured || !layer) return;
    for (const el of layer.querySelectorAll<HTMLElement>('[data-group][data-step]')) {
      const step = Number(el.dataset['step']) as GroupStep;
      // Rounded up, so a layout that fits on paper never overflows by a fraction.
      widths.set(
        widthKey(lang, el.dataset['group'] ?? '', step),
        Math.ceil(el.getBoundingClientRect().width),
      );
    }
    setMeasured((n) => n + 1);
  }, [unmeasured, lang]);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    setAvailable(el.clientWidth);
    const ro = new ResizeObserver(() => {
      setAvailable(el.clientWidth);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const chosen = plans[available === null ? 0 : choosePlan(plans, widthOf, available)] ?? [];
  const plan = available === null ? chosen : relaxPlan(chosen, groups, widthOf, available);
  const measuring = unmeasured ? (
    <div ref={layerRef} className="ribbon-measure" aria-hidden="true" inert>
      {tab.groups.flatMap((g, i) =>
        (groupSets[i] ?? []).map((s) => (
          <RibbonGroup
            key={`${groupKey(g)}.${String(s)}`}
            tab={tab.tab}
            group={g}
            step={s}
            stop={() => NO_STOP}
            measure
          />
        )),
      )}
    </div>
  ) : null;
  return { panelRef, steps: plan, measuring };
}
