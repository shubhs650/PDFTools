import { beforeEach, describe, expect, it } from 'vitest';
import {
  commandState,
  registerCommand,
  runCommand,
  subscribeCommands,
} from '../../src/app/commands/dispatch';
import { documentStore } from '../../src/app/store/documentStore';

beforeEach(() => {
  for (const id of documentStore.getState().order) documentStore.getState().close(id);
});

describe('command dispatch (D-01)', () => {
  it('a command without a handler is disabled as not ready', () => {
    expect(commandState('help.updates')).toEqual({
      enabled: false,
      pressed: false,
      reason: 'ribbon.notReady',
    });
  });

  it('document commands are disabled with a reason until a document is open', async () => {
    let runs = 0;
    const off = registerCommand('view.zoomIn', {
      requiresDocument: true,
      run: () => {
        runs++;
      },
    });
    expect(commandState('view.zoomIn')).toMatchObject({
      enabled: false,
      reason: 'ribbon.needsDocument',
    });
    expect(await runCommand('view.zoomIn')).toBe(false);
    documentStore
      .getState()
      .open({ id: 'd', name: 'd.pdf', pageCount: 1, permissions: -1, signatureCount: 0 });
    expect(commandState('view.zoomIn')).toEqual({ enabled: true, pressed: false });
    expect(await runCommand('view.zoomIn')).toBe(true);
    expect(runs).toBe(1);
    off();
    expect(commandState('view.zoomIn').enabled).toBe(false);
  });

  it('reports pressed state and notifies listeners after a run', async () => {
    let on = false;
    let notified = 0;
    const unsub = subscribeCommands(() => notified++);
    const off = registerCommand('view.leftPanes', {
      run: () => {
        on = !on;
      },
      isPressed: () => on,
    });
    await runCommand('view.leftPanes');
    expect(commandState('view.leftPanes').pressed).toBe(true);
    expect(notified).toBeGreaterThanOrEqual(2);
    off();
    unsub();
  });

  it('rejects handlers for unknown command ids', () => {
    expect(() => registerCommand('nope.nothing', { run: () => undefined })).toThrow(
      /Unknown command/,
    );
  });
});
