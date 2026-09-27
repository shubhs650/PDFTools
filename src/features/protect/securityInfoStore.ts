// Protect → Security Info (M2-12): which document the dialog shows.
import { createStore, useStore } from 'zustand';

export const securityInfoStore = createStore<{ docId: string | null }>()(() => ({ docId: null }));

export function useSecurityInfo<T>(selector: (s: { docId: string | null }) => T): T {
  return useStore(securityInfoStore, selector);
}

export function openSecurityInfo(docId: string): void {
  securityInfoStore.setState({ docId });
}

export function closeSecurityInfo(): void {
  securityInfoStore.setState({ docId: null });
}
