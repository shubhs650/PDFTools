// The error report's payload (D-22, §10.2, M2-17/M2-18): one schema for the
// app, which builds it and shows it verbatim before anything is sent, and for
// the `/api/report` Pages Function, which accepts nothing else. Pure and
// dependency-free: imported by src/features/report and functions/api/report.ts.
//
// Rule 10: no document content. Apart from the description the user types,
// every field is either a fixed-vocabulary value (version, browser, OS, codes,
// counts) or stack frames that went through the sanitizer (report/redact.ts).

export const REPORT_VERSION = 1;

export const LIMITS = {
  /** The whole JSON body, in bytes (M2-18). */
  bodyBytes: 16 * 1024,
  description: 2000,
  frames: 20,
  frame: 300,
  log: 20,
  short: 80,
} as const;

export interface ReportLogEntry {
  /** Seconds before the report was made. */
  ago: number;
  where: string;
  code: string;
  /** Counts only (e.g. a save fallback's object count), never content. */
  counts?: Record<string, number>;
}

export interface ReportError {
  code: string;
  where: string;
  /** Sanitized stack frames, innermost first. */
  stack: string[];
}

export interface ReportPayload {
  v: typeof REPORT_VERSION;
  /** What the user typed (may be empty). */
  description: string;
  /** Package version + build commit. */
  app: string;
  /** Browser family and major version, e.g. "Chrome 151". */
  browser: string;
  /** Operating system family, e.g. "Windows". */
  os: string;
  /** Feature or module the report is about ("help" when sent from the Help tab). */
  feature: string;
  error: ReportError | null;
  /** Random per app session, kept in memory only; links reports of one session. */
  session: string;
  log: ReportLogEntry[];
}

const KEYS: (keyof ReportPayload)[] = [
  'v',
  'description',
  'app',
  'browser',
  'os',
  'feature',
  'error',
  'session',
  'log',
];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(o).every((k) => keys.includes(k));
const shortString = (v: unknown): v is string => typeof v === 'string' && v.length <= LIMITS.short;
/** Codes and names: letters, digits and a few separators, nothing that could hold prose. */
const token = (v: unknown): v is string => shortString(v) && /^[\w.:+\- /()]*$/.test(v);

function validLog(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > LIMITS.log) return false;
  return v.every((e) => {
    if (!isObject(e) || !onlyKeys(e, ['ago', 'where', 'code', 'counts'])) return false;
    if (typeof e['ago'] !== 'number' || !Number.isFinite(e['ago']) || e['ago'] < 0) return false;
    if (!token(e['where']) || !token(e['code'])) return false;
    const c = e['counts'];
    if (c === undefined) return true;
    return (
      isObject(c) &&
      Object.keys(c).length <= 10 &&
      Object.entries(c).every(([k, n]) => token(k) && typeof n === 'number' && Number.isFinite(n))
    );
  });
}

function validError(v: unknown): boolean {
  if (v === null) return true;
  if (!isObject(v) || !onlyKeys(v, ['code', 'where', 'stack'])) return false;
  const stack = v['stack'];
  return (
    token(v['code']) &&
    token(v['where']) &&
    Array.isArray(stack) &&
    stack.length <= LIMITS.frames &&
    stack.every((f) => typeof f === 'string' && f.length <= LIMITS.frame)
  );
}

/** Whether `v` is exactly a ReportPayload: every field present and valid, nothing else. */
export function isReportPayload(v: unknown): v is ReportPayload {
  if (!isObject(v) || !onlyKeys(v, KEYS)) return false;
  if (!KEYS.every((k) => k in v)) return false;
  return (
    v['v'] === REPORT_VERSION &&
    typeof v['description'] === 'string' &&
    v['description'].length <= LIMITS.description &&
    token(v['app']) &&
    token(v['browser']) &&
    token(v['os']) &&
    token(v['feature']) &&
    typeof v['session'] === 'string' &&
    /^[0-9a-f-]{8,64}$/.test(v['session']) &&
    validError(v['error']) &&
    validLog(v['log'])
  );
}
