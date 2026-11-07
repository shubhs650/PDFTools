// Help → Help (M9: its own window) and Help → Send Error Report (M2-17, D-22, §10.2), and local
// recording of uncaught errors (codes and stack frames only, rule 10): they
// appear in a report's log only if the user sends one.
import { recordError } from '../../app/diagnostics';
import { registerCommand } from '../../app/commands/dispatch';
import { isAbortError } from '../../engine/errors';
import { currentHelpTopic, openHelp } from '../help/openHelp';
import { openReport } from './reportStore';

export function registerReportCommands(): () => void {
  const offs = [
    // Help in its own window, at the topic for what the user is doing (M9, ADR-026 D-46).
    registerCommand('help.help', {
      run: () => {
        openHelp(currentHelpTopic());
      },
    }),
    registerCommand('help.errorReport', {
      run: () => {
        openReport();
      },
    }),
  ];
  const onError = (e: ErrorEvent): void => {
    recordError('window', e.error);
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    if (
      isAbortError(e.reason) ||
      (e.reason instanceof DOMException && e.reason.name === 'AbortError')
    )
      return;
    recordError('promise', e.reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    for (const off of offs) off();
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
