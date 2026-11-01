// Full screen (M6-01, ADR-021 D-35): the whole app goes full screen (ribbon,
// panes and status bar stay), like a video player's maximize. The Fullscreen
// API on the document element; Esc (the browser's own) or the button leaves.
import { useSyncExternalStore } from 'react';

/** The browser allows full screen here (not in some iframes or on iOS Safari). */
export function canFullScreen(): boolean {
  if (typeof document === 'undefined') return false;
  // Missing where the API is (jsdom, old WebKit) although the DOM types say boolean.
  const doc: Partial<Pick<Document, 'fullscreenEnabled'>> = document;
  return doc.fullscreenEnabled ?? false;
}

export function isFullScreen(): boolean {
  // `undefined` where the API is missing (jsdom, old WebKit), `null` when not full screen.
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement);
}

/** Enters full screen on the app root, or leaves it. Refusals are ignored (no user gesture, policy). */
export async function toggleFullScreen(): Promise<void> {
  try {
    if (isFullScreen()) await document.exitFullscreen();
    else if (canFullScreen()) await document.documentElement.requestFullscreen();
  } catch {
    // The browser refused (e.g. not triggered by a user action): nothing changes.
  }
}

/** Calls `onChange` when full screen starts or ends; returns the unsubscribe function. */
export function subscribeFullScreen(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  return () => {
    document.removeEventListener('fullscreenchange', onChange);
  };
}

export function useFullScreen(): boolean {
  return useSyncExternalStore(subscribeFullScreen, isFullScreen, () => false);
}
