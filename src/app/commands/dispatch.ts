// Command dispatch (D-01: every command acts on the active document). Feature
// code registers a handler per command id; the ribbon, quick access toolbar,
// backstage and (M1-11) keyboard shortcuts all go through `runCommand`.
import { msg, type MessageKey } from '../../i18n';
import { allows, type Capability, type Security } from '../../model/permissions';
import { COMMANDS } from '../commands';
import { documentStore, securityOf, selectActive } from '../store/documentStore';

export interface CommandContext {
  hasDocument: boolean;
  /** The active document's permission state (null without a document). */
  security: Security | null;
}

/** A point on a page: page index and page points (top-left origin, as displayed unrotated). */
export interface PagePoint {
  docId: string;
  page: number;
  x: number;
  y: number;
}

/** What a context menu adds to a command it runs (M6-02): where it was opened. */
export interface CommandArgs {
  /** The page point under the pointer (or the keyboard's anchor) when the menu opened. */
  at?: PagePoint;
}

export interface CommandHandler {
  run(ctx: CommandContext, args?: CommandArgs): void | Promise<void>;
  /** Needs an open document (disabled with a reason otherwise). */
  requiresDocument?: boolean;
  /**
   * What the active document's permission flags must allow (rule 9, D-19).
   * Disabled with "restricted by the document's security settings" otherwise.
   */
  requires?: Capability | readonly Capability[];
  /** Any other reason the command is unavailable right now (null: enabled). */
  disabledReason?(ctx: CommandContext): MessageKey | null;
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
export const INTERNAL_ACTIONS = [
  'tab.close',
  'tab.next',
  'tab.prev',
  'tool.cancel',
  // Shift+F10 / the Menu key in the document: its context menu (M6-02).
  'menu.context',
  'find.next',
  'find.prev',
  // Annotations (M3-05): cycle with Tab, nudge with the arrow keys (delete is
  // the ribbon command comment.delete).
  'annotation.next',
  'annotation.prev',
  'annotation.nudgeLeft',
  'annotation.nudgeRight',
  'annotation.nudgeUp',
  'annotation.nudgeDown',
  'annotation.nudgeLeftFar',
  'annotation.nudgeRightFar',
  'annotation.nudgeUpFar',
  'annotation.nudgeDownFar',
  // Drawing tools (M3-09): Enter places a note/text box or finishes a polyline.
  'tool.enter',
  // A selected text comment: F2 edits it (M7-03; Enter does too, via tool.enter).
  'annotation.editText',
] as const;
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
  const active = selectActive(documentStore.getState());
  return { hasDocument: active !== null, security: active ? securityOf(active.meta) : null };
}

export function commandState(id: string, ctx: CommandContext = commandContext()): CommandState {
  const h = handlers.get(id);
  const pressed = h?.isPressed?.() ?? false;
  if (!h) return { enabled: false, pressed, reason: msg('ribbon.notReady') };
  if ((h.requiresDocument || h.requires) && !ctx.hasDocument)
    return { enabled: false, pressed, reason: msg('ribbon.needsDocument') };
  const needs: readonly Capability[] =
    h.requires === undefined ? [] : typeof h.requires === 'string' ? [h.requires] : h.requires;
  if (ctx.security && needs.some((c) => ctx.security && !allows(ctx.security, c)))
    return { enabled: false, pressed, reason: msg('protect.restricted') };
  const reason = h.disabledReason?.(ctx) ?? null;
  if (reason) return { enabled: false, pressed, reason };
  return { enabled: true, pressed };
}

const beforeRun = new Set<(id: string) => void>();

/**
 * Runs `fn` before every enabled command (M7-02: a text comment being edited
 * is written first, so Ctrl+S or Close never miss it); returns the remover.
 */
export function onBeforeCommand(fn: (id: string) => void): () => void {
  beforeRun.add(fn);
  return () => {
    beforeRun.delete(fn);
  };
}

/** Runs a command if it is enabled; returns whether it ran. */
export async function runCommand(id: string, args?: CommandArgs): Promise<boolean> {
  const ctx = commandContext();
  if (!commandState(id, ctx).enabled) return false;
  for (const fn of beforeRun) fn(id);
  await handlers.get(id)?.run(ctx, args);
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
