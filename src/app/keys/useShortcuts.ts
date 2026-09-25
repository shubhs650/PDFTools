import { useEffect } from 'react';
import { commandState, runCommand } from '../commands/dispatch';
import { isMac, matches, type KeyLike } from './chord';
import { KEYMAP, type Binding } from './keymap';

/** Text fields where typed keys belong to the field, not to shortcuts. */
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(
      el.type,
    );
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

export interface FocusContext {
  editable: boolean;
  /** Focus is inside the document area. */
  inDocument: boolean;
}

/** The binding a key event triggers, honouring scopes and text fields (pure). */
export function resolveBinding(
  e: KeyLike,
  focus: FocusContext,
  mac: boolean,
  keymap: readonly Binding[] = KEYMAP,
): Binding | undefined {
  const binding = keymap.find((bnd) => bnd.chords.some((c) => matches(c, e, mac)));
  if (!binding) return undefined;
  const isEscape = e.key === 'Escape';
  if (focus.editable && !isEscape) return undefined;
  if (binding.scope === 'document' && !focus.inDocument) return undefined;
  return binding;
}

/**
 * Installs the single window-level shortcut listener. Matched keys are
 * preventDefault-ed (we override the browser's Ctrl+O/S/0/=/-), then run
 * through the command dispatcher, which ignores disabled commands.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const mac = isMac();
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return;
      const active = document.activeElement;
      const binding = resolveBinding(
        e,
        {
          editable: isEditable(active),
          inDocument: Boolean(active?.closest('#document-panel')),
        },
        mac,
      );
      if (!binding) return;
      if (binding.preventWhenDisabled === false && !commandState(binding.target).enabled) return;
      e.preventDefault();
      void runCommand(binding.target);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
