// A mode with its own undo history (Review & Extract, M4-14) takes over Undo
// and Redo (Ctrl+Z, Ctrl+Y, the quick access toolbar) while it is open: its
// edits don't change the document, so the document's history is left alone.
import type { MessageKey } from '../../i18n';
import { notify } from './dispatch';

export interface UndoOverride {
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  /** Why Undo / Redo is disabled when there is nothing to undo or redo. */
  nothingToUndo: MessageKey;
  nothingToRedo: MessageKey;
}

let current: UndoOverride | null = null;

export function setUndoOverride(o: UndoOverride | null): void {
  current = o;
  notify();
}

export const undoOverride = (): UndoOverride | null => current;
