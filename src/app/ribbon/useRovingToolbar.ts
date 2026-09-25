import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Roving tabindex for a horizontal toolbar (WAI-ARIA toolbar pattern): one
 * Tab stop; Left/Right/Home/End move between controls.
 */
export function useRovingToolbar(count: number) {
  const [current, setCurrent] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.min(current, Math.max(0, count - 1));

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const to: Record<string, number> = {
        ArrowRight: (index + 1) % count,
        ArrowLeft: (index - 1 + count) % count,
        Home: 0,
        End: count - 1,
      };
      const next = to[e.key];
      if (next === undefined || count === 0) return;
      e.preventDefault();
      setCurrent(next);
      refs.current[next]?.focus();
    },
    [count, index],
  );

  const register = (i: number) => (el: HTMLButtonElement | null) => {
    refs.current[i] = el;
  };

  return { index, setCurrent, onKeyDown, register };
}
