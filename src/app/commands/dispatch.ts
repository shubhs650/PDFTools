// Command dispatch (D-01: every command acts on the active document). Feature
// code registers a handler per command id; the ribbon, quick access toolbar,
// backstage and (M1-11) keyboard shortcuts all go through `runCommand`.
import { msg, type MessageKey } from '../../i18n';
import { COMMANDS } from '../commands';
import { documentStore, selectActive } from '../store/documentStore';

export interface CommandContext {
  hasDocument: boolean;
}

export interface CommandHandler {
  run(ctx: CommandContext): void | Promise<void>;
  /** Needs an open document (disabled with a reason otherwise). */
  requiresDocument?: boolean;
  /** Pressed state for toggles (panes, tools, view modes). */
  isPressed?(): boolean;
}

export type CommandState =
  { enabled: true; pressed: boolean } | { enabled: false; pressed: boolean; reason: MessageKey };

const handlers = new Map<string, CommandHandler>();
const listeners = new Set<() => void>();

/**
 * Actions reachable from the keyboard (and other code) that are not ribbon
 * commands: tab management and cancelling the current tool (§8.1).
 */
export const INTERNAL_ACTIONS = ['tab.close', 'tab.next', 'tab.prev', 'tool.cancel'] as const;
export type InternalAction = (typeof INTERNAL_ACTIONS)[number];

const KNOWN = new Set<string>([...COMMANDS.map((c) => c.id), ...INTERNAL_ACTIONS]);

/** Registers the handler for a command id; returns an unregister function. */
export function registerCommand(id: string, handler: CommandHandler): () => void {
  if (!KNOWN.has(id)) throw new Error(`Unknown command ${id}`);
  handlers.set(id, handler);
  notify();
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
    notify();
  };
}

export function commandContext(): CommandContext {
  return { hasDocument: selectActive(documentStore.getState()) !== null };
}

export function commandState(id: string, ctx: CommandContext = commandContext()): CommandState {
  const h = handlers.get(id);
  const pressed = h?.isPressed?.() ?? false;
  if (!h) return { enabled: false, pressed, reason: msg('ribbon.notReady') };
  if (h.requiresDocument && !ctx.hasDocument)
    return { enabled: false, pressed, reason: msg('ribbon.needsDocument') };
  return { enabled: true, pressed };
}

/** Runs a command if it is enabled; returns whether it ran. */
export async function runCommand(id: string): Promise<boolean> {
  const ctx = commandContext();
  if (!commandState(id, ctx).enabled) return false;
  await handlers.get(id)?.run(ctx);
  notify();
  return true;
}

/** Re-evaluate states (handler registry changed or a toggle flipped). */
export function subscribeCommands(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify(): void {
  for (const l of listeners) l();
}
