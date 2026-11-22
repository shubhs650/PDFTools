import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { clampSplit, splitForKey } from '../../../model/compare/link';

/**
 * A splitter of the Review layout (D-62: draggable, the windows never swap): a
 * WAI-ARIA window splitter, dragged with mouse, pen or touch, or focused and
 * moved with the arrows (2 % steps), Home and End. Its value is the share of
 * the first window, in percent.
 */
export function Splitter({
  orientation,
  label,
  value,
  container,
  onChange,
  testId,
}: {
  /** vertical: between left and right; horizontal: between top and bottom. */
  orientation: 'vertical' | 'horizontal';
  label: string;
  /** The first window's share (0–1). */
  value: number;
  /** The element the share is measured in. */
  container: RefObject<HTMLElement | null>;
  onChange: (share: number) => void;
  testId?: string;
}) {
  const vertical = orientation === 'vertical';
  const total = (): number => {
    const r = container.current?.getBoundingClientRect();
    return r ? (vertical ? r.width : r.height) : 0;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const to = splitForKey(e.key, value, total());
    if (to === null) return;
    e.preventDefault();
    onChange(to);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent): void => {
      const r = container.current?.getBoundingClientRect();
      if (!r) return;
      const size = vertical ? r.width : r.height;
      const at = vertical ? ev.clientX - r.left : ev.clientY - r.top;
      if (size > 0) onChange(clampSplit(at / size, size));
    };
    const up = (): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- WAI-ARIA window splitter
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a window splitter is focusable
      tabIndex={0}
      className="review-splitter"
      data-orientation={orientation}
      data-testid={testId}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );
}
