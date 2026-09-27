// Builds the error report (D-22, §10.2, M2-17) from what the app already
// keeps locally (app/diagnostics.ts: codes, stack frames, counts) plus the
// user's description. Browser and OS are coarse families only. The session
// id is random and lives in memory for this app session (never stored).
import type { DiagnosticEntry } from '../../app/diagnostics';
import {
  LIMITS,
  REPORT_VERSION,
  type ReportError,
  type ReportLogEntry,
  type ReportPayload,
} from '../../model/report';
import { redact, redactStack } from './redact';

let sessionId: string | undefined;

/** Anonymous id of this app session (memory only). */
export function reportSession(): string {
  sessionId ??= crypto.randomUUID();
  return sessionId;
}

interface UaBrand {
  brand: string;
  version: string;
}
export interface UaSource {
  userAgent: string;
  userAgentData?: { brands?: UaBrand[]; platform?: string };
}

/** "Chrome 151", "Edge 154", "Firefox 140", "Safari 18" or "Other". */
export function browserOf(nav: UaSource): string {
  const brands = nav.userAgentData?.brands ?? [];
  for (const [name, label] of [
    ['Microsoft Edge', 'Edge'],
    ['Opera', 'Opera'],
    ['Google Chrome', 'Chrome'],
    ['Chromium', 'Chromium'],
  ] as const) {
    const b = brands.find((x) => x.brand === name);
    if (b) return `${label} ${b.version.split('.')[0] ?? ''}`.trim();
  }
  const ua = nav.userAgent;
  const m = /\b(Edg|OPR|Firefox|Chrome)\/(\d+)/.exec(ua);
  if (m) {
    const names: Record<string, string> = { Edg: 'Edge', OPR: 'Opera' };
    const name = m[1] ?? '';
    return `${names[name] ?? name} ${m[2] ?? ''}`.trim();
  }
  const safari = /\bVersion\/(\d+).*Safari\//.exec(ua);
  return safari ? `Safari ${safari[1] ?? ''}`.trim() : 'Other';
}

/** "Windows", "macOS", "Linux", "Android", "iOS", "ChromeOS" or "Other". */
export function osOf(nav: UaSource): string {
  const p = `${nav.userAgentData?.platform ?? ''} ${nav.userAgent}`;
  if (/Android/i.test(p)) return 'Android';
  if (/iPhone|iPad|iPod|\biOS\b/i.test(p)) return 'iOS';
  if (/CrOS|Chrome OS|ChromeOS/i.test(p)) return 'ChromeOS';
  if (/Windows|Win(32|64)/i.test(p)) return 'Windows';
  if (/Mac/i.test(p)) return 'macOS';
  if (/Linux|X11/i.test(p)) return 'Linux';
  return 'Other';
}

/** A code, `where` or count name reduced to the schema's token characters. */
const token = (s: string): string =>
  redact(s, null)
    .replace(/[^\w.:+\- /()]/g, '')
    .slice(0, LIMITS.short);

export interface ReportInput {
  description: string;
  /** The error the report is about (from a caught error), or null. */
  error: DiagnosticEntry | null;
  /** Where the report was started: a boundary name, a feature, or "help". */
  feature: string;
  /** Local diagnostics, oldest first. */
  log: readonly DiagnosticEntry[];
  app: string;
  nav: UaSource;
  origin: string | null;
  session: string;
  now: number;
}

function errorOf(e: DiagnosticEntry, origin: string | null): ReportError {
  return {
    code: token(e.code),
    where: token(e.where),
    stack: redactStack(e.stack, origin, LIMITS.frames, LIMITS.frame),
  };
}

function logOf(entries: readonly DiagnosticEntry[], now: number): ReportLogEntry[] {
  return entries.slice(-LIMITS.log).map((e) => {
    const out: ReportLogEntry = {
      ago: Math.max(0, Math.round((now - e.at) / 1000)),
      where: token(e.where),
      code: token(e.code),
    };
    if (e.counts) {
      const counts = Object.entries(e.counts)
        .filter(([, n]) => Number.isFinite(n))
        .slice(0, 10)
        .map(([k, n]) => [token(k), n] as const);
      if (counts.length) out.counts = Object.fromEntries(counts);
    }
    return out;
  });
}

/** The exact payload shown to the user and, on Submit, sent. */
export function buildReport(input: ReportInput): ReportPayload {
  return {
    v: REPORT_VERSION,
    description: input.description.slice(0, LIMITS.description),
    app: token(input.app),
    browser: token(browserOf(input.nav)),
    os: osOf(input.nav),
    feature: token(input.feature),
    error: input.error ? errorOf(input.error, input.origin) : null,
    session: input.session,
    log: logOf(input.log, input.now),
  };
}

/** The payload as sent: this string is shown and posted byte for byte. */
export function reportJson(payload: ReportPayload): string {
  let json = JSON.stringify(payload, null, 2);
  // Keep within the endpoint's body limit: drop the oldest log entries first.
  const p = { ...payload, log: [...payload.log] };
  while (new TextEncoder().encode(json).length > LIMITS.bodyBytes && p.log.length > 0) {
    p.log.shift();
    json = JSON.stringify(p, null, 2);
  }
  return json;
}
