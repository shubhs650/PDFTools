// Stamp state (M3-14): the code picked from the active scheme, each
// document's number and revision (asked once per document, kept in memory for
// the session and written only into its stamps), and the image chosen for
// Image Stamp.
import { createStore, useStore } from 'zustand';
import type { MessageKey } from '../../i18n';

export interface DocInfo {
  docNo: string;
  rev: string;
}

export interface StampImage {
  data: ArrayBuffer;
  mimeType: 'image/png' | 'image/jpeg' | 'application/pdf';
  /** Placed size, points. */
  width: number;
  height: number;
  name: string;
}

interface StampState {
  code: string | null;
  docInfo: Record<string, DocInfo>;
  /** The Stamp dialog (code, document number and revision). */
  pickerOpen: boolean;
  /** The Image Stamp dialog. */
  imageOpen: boolean;
  image: StampImage | null;
  /** Why the last stamp couldn't be made; the Stamp dialog shows it. */
  problem: MessageKey | null;
}

export const stampStore = createStore<StampState>()(() => ({
  code: null,
  docInfo: {},
  pickerOpen: false,
  imageOpen: false,
  image: null,
  problem: null,
}));

export function useStamps<T>(selector: (s: StampState) => T): T {
  return useStore(stampStore, selector);
}
