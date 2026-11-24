import { Lightbulb20Regular } from '@fluentui/react-icons/svg/lightbulb';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../../i18n';
import { Button } from '../../../ui/components';
import {
  TIPS,
  hideTips,
  nextTip,
  offerTips,
  onReplay,
  skipTips,
  useTip,
  type TipId,
} from './tipsStore';

/** What each tip points at in the result, and where its card sits. */
const TIP: Record<
  TipId,
  { anchor: string; side: 'above' | 'left'; title: MessageKey; text: MessageKey }
> = {
  colours: {
    anchor: '[data-testid="overlay-key"]',
    side: 'above',
    title: msg('compare.tips.colours_title'),
    text: msg('compare.tips.colours_text'),
  },
  differences: {
    anchor: '[data-testid="diff-pane"]',
    side: 'left',
    title: msg('compare.tips.differences_title'),
    text: msg('compare.tips.differences_text'),
  },
  lineUp: {
    anchor: '[data-testid="line-up-button"]',
    side: 'above',
    title: msg('compare.tips.lineUp_title'),
    text: msg('compare.tips.lineUp_text'),
  },
};

/** The card's width (CSS px, as .compare-tip) and its gap from what it points at. */
const CARD_WIDTH = 300;
const GAP = 12;
const EDGE = 8;

interface Place {
  left: number;
  top: number;
  /** Below its point (`top` is its top) or above it (`top` is its bottom). */
  from: 'top' | 'bottom';
}

/** Where the card goes for an anchor's box, kept inside the window. */
function placeFor(r: DOMRect | null, side: 'above' | 'left'): Place {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number): number => Math.max(EDGE, Math.min(vw - CARD_WIDTH - EDGE, x));
  if (!r) return { left: clampX((vw - CARD_WIDTH) / 2), top: vh / 3, from: 'top' };
  if (side === 'left' && r.left - GAP - CARD_WIDTH >= EDGE)
    return { left: r.left - GAP - CARD_WIDTH, top: Math.max(EDGE, r.top + 48), from: 'top' };
  // Above the anchor (the floating bar is at the bottom), else below it.
  const x = clampX(r.left + r.width / 2 - CARD_WIDTH / 2);
  return r.top > vh / 3
    ? { left: x, top: vh - r.top + GAP, from: 'bottom' }
    : { left: x, top: r.bottom + GAP, from: 'top' };
}

/**
 * The first-time tips of Compare (M12-26, ADR-033 decision 7) on a PDF
 * overlay's result: a small card beside the colour key, the differences list
 * and the Line up button in turn, with Next / Got it and Skip tips; Escape
 * skips. Shown once per device; Help → "Show the Compare tips again" brings
 * them back (at once on a result on screen). The card is not modal: the
 * result stays usable behind it; it takes the focus so a keyboard reaches it,
 * and gives it back when the tips end. Seen to the end or skipped, they
 * never show again on this device.
 */
export function CompareTips({ id }: { id: string }) {
  const { t } = useTranslation();
  const shown = useTip(id);
  const host = useRef<HTMLSpanElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  const titleId = useId();
  const textId = useId();
  const card = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ tip: TipId; place: Place } | null>(null);

  // The first result on screen offers the tips; Help's replay shows them here at once.
  useEffect(() => {
    offerTips(id);
    const off = onReplay(() => {
      offerTips(id);
    });
    return () => {
      off();
      hideTips(id);
    };
  }, [id]);

  const tip = shown?.tip ?? null;
  // Placed beside its anchor; again when the window or the anchor changes size.
  useLayoutEffect(() => {
    if (!tip) return;
    const root = host.current?.closest('.overlay-result') ?? document;
    const anchor = root.querySelector<HTMLElement>(TIP[tip].anchor);
    const update = (): void => {
      setPlaced({ tip, place: placeFor(anchor?.getBoundingClientRect() ?? null, TIP[tip].side) });
    };
    update();
    anchor?.setAttribute('data-tip-target', 'true');
    const ro = new ResizeObserver(update);
    if (anchor) ro.observe(anchor);
    window.addEventListener('resize', update);
    return () => {
      anchor?.removeAttribute('data-tip-target');
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [tip]);

  // The focus goes to the card's button for each tip, and back where it was at the end.
  const showing = tip !== null;
  useEffect(() => {
    if (!showing) return;
    before.current = document.activeElement;
    return () => {
      const el = before.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
    };
  }, [showing]);
  const place = placed?.tip === tip ? placed.place : null;
  const ready = place !== null;
  useEffect(() => {
    if (ready) primary.current?.focus({ preventScroll: true });
  }, [tip, ready]);
  // Escape in the card skips the tips (a native listener: the card is not a control itself).
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      skipTips();
    };
    el.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('keydown', key);
    };
  }, [ready]);

  if (!shown || !tip) return <span ref={host} hidden />;
  const last = shown.step === TIPS.length - 1;
  return (
    <span ref={host}>
      {place ? (
        <div
          ref={card}
          className="compare-tip"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={textId}
          data-testid="compare-tip"
          data-tip={tip}
          data-from={place.from}
          style={
            place.from === 'top'
              ? { left: place.left, top: place.top }
              : { left: place.left, bottom: place.top }
          }
        >
          <p className="compare-tip-count">
            <span aria-hidden="true" className="compare-tip-icon">
              <Lightbulb20Regular />
            </span>
            {t('compare.tips.count', {
              n: format.number(shown.step + 1),
              count: format.number(TIPS.length),
            })}
          </p>
          <h2 id={titleId} className="compare-tip-title">
            {t(TIP[tip].title)}
          </h2>
          <p id={textId} className="compare-tip-text">
            {t(TIP[tip].text)}
          </p>
          <div className="compare-tip-actions">
            {last ? null : (
              <Button
                label={t('compare.tips.skip')}
                size="small"
                variant="subtle"
                onClick={skipTips}
              />
            )}
            <Button
              ref={primary}
              label={t(last ? msg('compare.tips.done') : msg('compare.tips.next'))}
              size="small"
              variant="primary"
              onClick={nextTip}
            />
          </div>
        </div>
      ) : null}
    </span>
  );
}
