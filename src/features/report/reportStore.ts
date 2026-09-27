// Error-report dialog state (M2-17): what the report is about, the user's
// description, and the send result. The local log is snapshotted when the
// dialog opens, so the payload on screen doesn't change under the user.
import { createStore, useStore } from 'zustand';
import { diagnostics, type DiagnosticEntry } from '../../app/diagnostics';
import { APP_VERSION } from '../../app/version';
import type { ReportPayload } from '../../model/report';
import { buildReport, reportJson, reportSession } from './payload';
import { sendReport, type SendResult } from './send';

export type ReportStatus = 'idle' | 'sending' | SendResult;

interface ReportState {
  open: boolean;
  error: DiagnosticEntry | null;
  feature: string;
  description: string;
  log: readonly DiagnosticEntry[];
  at: number;
  status: ReportStatus;
  copied: boolean;
}

export const reportStore = createStore<ReportState>()(() => ({
  open: false,
  error: null,
  feature: 'help',
  description: '',
  log: [],
  at: 0,
  status: 'idle',
  copied: false,
}));

export function useReport<T>(selector: (s: ReportState) => T): T {
  return useStore(reportStore, selector);
}

/** Opens the dialog, about `error` (a caught error) or none (Help → Send Error Report). */
export function openReport(opts: { error?: DiagnosticEntry | null; feature?: string } = {}): void {
  const error = opts.error ?? null;
  reportStore.setState({
    open: true,
    error,
    feature: opts.feature ?? error?.where ?? 'help',
    description: '',
    // The report's own error is not repeated in the log.
    log: diagnostics().filter((e) => e !== error),
    at: Date.now(),
    status: 'idle',
    copied: false,
  });
}

export function closeReport(): void {
  reportStore.setState({ open: false, status: 'idle', copied: false });
}

export function setDescription(description: string): void {
  reportStore.setState({ description, status: 'idle', copied: false });
}

/** The payload as it stands (the dialog shows it; Submit sends it). */
export function currentPayload(s: ReportState = reportStore.getState()): ReportPayload {
  return buildReport({
    description: s.description,
    error: s.error,
    feature: s.feature,
    log: s.log,
    app: APP_VERSION,
    nav: navigator,
    origin: location.origin,
    session: reportSession(),
    now: s.at,
  });
}

export const currentJson = (s: ReportState = reportStore.getState()): string =>
  reportJson(currentPayload(s));

/** Submit: posts exactly the JSON shown. */
export async function submitReport(): Promise<void> {
  const s = reportStore.getState();
  if (!s.open || s.status === 'sending') return;
  const json = currentJson(s);
  reportStore.setState({ status: 'sending' });
  const result = await sendReport(json);
  reportStore.setState({ status: result });
}

/** The alternative when sending isn't possible: the same JSON on the clipboard. */
export async function copyReport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentJson());
    reportStore.setState({ copied: true });
  } catch {
    reportStore.setState({ copied: false });
  }
}
