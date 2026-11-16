// Whether files are being dragged over the window (M10-05): DropZone sets it, and the
// start screen's drop card highlights while it is true.
import { createStore, useStore } from 'zustand';

export const dragStore = createStore<{ over: boolean }>()(() => ({ over: false }));

export function useDragOver(): boolean {
  return useStore(dragStore, (s) => s.over);
}

export function setDragOver(over: boolean): void {
  if (dragStore.getState().over !== over) dragStore.setState({ over });
}
