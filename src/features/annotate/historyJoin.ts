// Derived edits in one undo step (M3-16): a measurement's value (/Contents)
// and its grouped label follow its geometry, so they must undo and redo with
// the edit that caused them, never as steps of their own. plugin-history
// registers one command per plugin call; this hook on the plugin instance
// (like authoring.ts) wraps every command in a composite so that commands
// registered inside `joinStep` become parts of the last step, and commands
// registered inside `outsideHistory` just run (a scale change re-labels
// measurements: not undoable, like the scale itself).
import type { PluginRegistry } from '@embedpdf/core';

interface Command {
  execute(): void;
  undo(): void;
  metadata?: unknown;
}

interface HistoryPluginInternals {
  register(command: Command, topic: string, documentId: string): void;
}

interface Step extends Command {
  parts: Command[];
  /** Done (not undone): only then can parts join it. */
  active: boolean;
  topic: string;
}

let mode: 'join' | 'outside' | null = null;
let replaying = 0;
const lastStep = new Map<string, Step>();

/** True while undo/redo replays a step: derived edits must not be made again. */
export const isReplaying = (): boolean => replaying > 0;

function ids(parts: readonly Command[]): { annotationIds: string[] } {
  const all = parts.flatMap((p) => {
    const m = p.metadata as { annotationIds?: unknown } | undefined;
    return Array.isArray(m?.annotationIds) ? (m.annotationIds as string[]) : [];
  });
  return { annotationIds: [...new Set(all)] };
}

function step(first: Command, topic: string): Step {
  let ran = false;
  const s: Step = {
    parts: [first],
    active: false,
    topic,
    execute() {
      if (!ran) {
        // The registration itself: the user's action, whose events may add parts.
        ran = true;
        s.active = true;
        first.execute();
        return;
      }
      replaying++;
      try {
        for (const p of s.parts) p.execute();
      } finally {
        replaying--;
      }
      s.active = true;
    },
    undo() {
      replaying++;
      try {
        for (const p of [...s.parts].reverse()) p.undo();
      } finally {
        replaying--;
      }
      s.active = false;
    },
    get metadata() {
      return ids(s.parts);
    },
  };
  return s;
}

/** Called once the plugin registry is up (DocumentHost). */
export function installHistoryJoin(registry: PluginRegistry): void {
  const plugin = registry.getPlugin('history') as unknown as HistoryPluginInternals | null;
  if (!plugin || typeof plugin.register !== 'function') return;
  const register = plugin.register.bind(plugin);
  plugin.register = (command, topic, documentId) => {
    if (mode === 'outside') {
      command.execute();
      return;
    }
    const last = lastStep.get(documentId);
    if (mode === 'join' && last?.active && last.topic === topic) {
      last.parts.push(command);
      command.execute();
      return;
    }
    const s = step(command, topic);
    lastStep.set(documentId, s);
    register(s, topic, documentId);
  };
}

function withMode(m: 'join' | 'outside', fn: () => void): void {
  const prev = mode;
  mode = m;
  try {
    fn();
  } finally {
    mode = prev;
  }
}

/** Plugin calls made by `fn` join the document's last step (undone and redone with it). */
export function joinStep(fn: () => void): void {
  withMode('join', fn);
}

/** Plugin calls made by `fn` are applied but never undone. */
export function outsideHistory(fn: () => void): void {
  withMode('outside', fn);
}
