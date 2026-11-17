import type { KeyboardEvent, PointerEvent } from 'react';
import {
  PANE_WIDTH_MAX,
  PANE_WIDTH_MIN,
  widthForDrag,
  widthForKey,
  type PaneSide,
} from './paneSize';

export interface PaneSplitterProps {
  /** Which pane it resizes: the left pane (splitter on its right edge) or the Properties pane. */
  side: PaneSide;
  /** Accessible name (rule 12), translated (rule 11). */
  label: string;
  /** The pane's width in CSS px. */
  width: number;
  onWidth: (px: number) => void;
  testId?: string;
}

/**
 * A WAI-ARIA window splitter for a side pane (M2-08 left pane; M11-10 Properties pane, D-56):
 * drag with mouse, pen or touch, or focus it and use the arrows (16 px steps), Home and End.
 * The value is the pane's width, 160–480 px.
 */
export function PaneSplitter({ side, label, width, onWidth, testId }: PaneSplitterProps) {
  const onKeyDown = (e: KeyboardEvent): void => {
    const to = widthForKey(e.key, width, side);
    if (to === null) return;
    e.preventDefault();
    onWidth(to);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: globalThis.PointerEvent): void => {
      onWidth(widthForDrag(w0, ev.clientX - x0, side));
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
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={PANE_WIDTH_MIN}
      aria-valuemax={PANE_WIDTH_MAX}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a window splitter is focusable
      tabIndex={0}
      className="pane-resizer"
      data-testid={testId}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );
}
