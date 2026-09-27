// POST /api/report (D-22, §10.2, M2-18): validate, rate-limit, store in D1,
// notify the developer. The one server-side piece of PDFTools; everything it
// accepts is the payload the user saw in the app (src/model/report.ts).
//
// - Only POST, `application/json`, ≤ 16 KB, exactly the report schema (no
//   extra fields). Responses never echo the input.
// - Same-origin only: a browser's cross-origin POST (Origin header of another
//   site) is refused.
// - Rate limit: 5 reports per IP per hour, keyed by a salted SHA-256 of the IP
//   (the IP itself is never stored); rows older than an hour are deleted.
// - The report row holds the validated JSON and a few indexed facts; the
//   notification carries the report id, version, error code and feature only.
// - No third-party calls: D1 and the mail binding are Cloudflare's own.
// Runtime-neutral (Web APIs only), so unit tests run it in Node with
// in-memory stand-ins for D1 and the mail binding.
import { isReportPayload, LIMITS, type ReportPayload } from '../../src/model/report';

/** The part of Cloudflare's D1 API used here. */
export interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
}

export interface Notice {
  id: string;
  app: string;
  code: string;
  feature: string;
  browser: string;
  os: string;
}

export interface ReportDeps {
  db: D1Like;
  /** Sends the developer notification; null when no mail binding is configured. */
  notify: ((notice: Notice) => Promise<void>) | null;
  /** Secret salt for the IP hash (REPORT_SALT). */
  salt: string;
  now: () => number;
  newId: () => string;
}

export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

export const SQL = {
  prune: 'DELETE FROM report_rate WHERE at < ?1',
  count: 'SELECT COUNT(*) AS n FROM report_rate WHERE ip_hash = ?1 AND at >= ?2',
  hit: 'INSERT INTO report_rate (ip_hash, at) VALUES (?1, ?2)',
  insert:
    'INSERT INTO reports (id, received_at, app, browser, os, feature, error_code, session, payload) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)',
} as const;

const HEADERS = { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' };

function reply(status: number, text: string, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : text, {
    status,
    headers: { ...HEADERS, ...extra },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The body, or null if it is over the limit (read no further than needed). */
async function readLimited(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > LIMITS.bodyBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.bodyBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}

export async function handleReport(request: Request, deps: ReportDeps): Promise<Response> {
  if (request.method !== 'POST') return reply(405, 'method not allowed', { allow: 'POST' });
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) return reply(403, 'forbidden');
  const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') return reply(415, 'unsupported media type');

  let text: string | null;
  try {
    text = await readLimited(request);
  } catch {
    return reply(400, 'bad request');
  }
  if (text === null) return reply(413, 'payload too large');
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return reply(400, 'bad request');
  }
  if (!isReportPayload(payload)) return reply(400, 'bad request');

  const now = deps.now();
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  try {
    const key = await sha256Hex(`${deps.salt}\u0000${ip}`);
    await deps.db
      .prepare(SQL.prune)
      .bind(now - RATE_WINDOW_MS)
      .run();
    const row = await deps.db
      .prepare(SQL.count)
      .bind(key, now - RATE_WINDOW_MS)
      .first<{ n: number }>();
    if ((row?.n ?? 0) >= RATE_LIMIT)
      return reply(429, 'too many requests', { 'retry-after': String(RATE_WINDOW_MS / 1000) });
    await deps.db.prepare(SQL.hit).bind(key, now).run();
    const id = deps.newId();
    await store(deps.db, id, now, payload);
    if (deps.notify) {
      try {
        await deps.notify(noticeOf(id, payload));
      } catch {
        // The report is stored; a failed notification loses nothing.
      }
    }
    return reply(204, '');
  } catch {
    return reply(500, 'server error');
  }
}

async function store(db: D1Like, id: string, now: number, p: ReportPayload): Promise<void> {
  await db
    .prepare(SQL.insert)
    .bind(
      id,
      now,
      p.app,
      p.browser,
      p.os,
      p.feature,
      p.error?.code ?? null,
      p.session,
      JSON.stringify(p),
    )
    .run();
}

function noticeOf(id: string, p: ReportPayload): Notice {
  return {
    id,
    app: p.app,
    code: p.error?.code ?? 'none',
    feature: p.feature,
    browser: p.browser,
    os: p.os,
  };
}

/** The notification e-mail (plain text, no description or stack: those stay in D1). */
export function noticeMail(n: Notice, from: string, to: string, date: Date): string {
  const lines = [
    `From: PDFTools reports <${from}>`,
    `To: <${to}>`,
    `Subject: PDFTools error report ${n.id}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${n.id}@${from.split('@')[1] ?? 'pdftools'}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Report ${n.id}`,
    `App: ${n.app}`,
    `Error: ${n.code}`,
    `Feature: ${n.feature}`,
    `Browser: ${n.browser} on ${n.os}`,
    '',
    'The full report is in the D1 table "reports".',
  ];
  return lines.join('\r\n');
}

// ------------------------------------------------------------------ Pages entry

/** The bindings and secrets the owner configures (docs/deploy/error-report.md). */
export interface Env {
  /** D1 database with functions/api/schema.sql applied. */
  REPORT_DB: D1Like;
  /** Secret salt for the rate limiter's IP hash. */
  REPORT_SALT: string;
  /** Optional `send_email` binding (Cloudflare Email Routing) for the notification. */
  REPORT_MAIL?: { send(message: unknown): Promise<void> };
  /** Sender (on a domain with Email Routing) and the verified destination address. */
  REPORT_MAIL_FROM?: string;
  REPORT_MAIL_TO?: string;
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const mail = env.REPORT_MAIL;
  const from = env.REPORT_MAIL_FROM;
  const to = env.REPORT_MAIL_TO;
  const notify =
    mail && from && to
      ? async (n: Notice) => {
          // Cloudflare's runtime module; imported only when a notification is sent.
          const { EmailMessage } = await import('cloudflare:email');
          await mail.send(new EmailMessage(from, to, noticeMail(n, from, to, new Date())));
        }
      : null;
  return handleReport(request, {
    db: env.REPORT_DB,
    notify,
    salt: env.REPORT_SALT,
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
  });
}
