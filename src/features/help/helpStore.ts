// Whether Help → Help is showing (M2-17).
import { createStore } from 'zustand';

export const helpStore = createStore<{ open: boolean }>()(() => ({ open: false }));

export function openHelp(): void {
  helpStore.setState({ open: true });
}

export function closeHelp(): void {
  helpStore.setState({ open: false });
}
