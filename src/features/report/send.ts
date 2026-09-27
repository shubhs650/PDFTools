// Sends a report the user has seen and submitted (D-22, §10.2, M2-17): one
// POST to the same-origin `/api/report` (rule 4), nothing else. No cookies,
// no referrer, no cache.

export const REPORT_ENDPOINT = '/api/report';

export type SendResult = 'sent' | 'offline' | 'rateLimited' | 'failed';

export async function sendReport(
  json: string,
  fetchFn: typeof fetch = fetch,
  online: () => boolean = () => navigator.onLine,
): Promise<SendResult> {
  if (!online()) return 'offline';
  try {
    const res = await fetchFn(REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (res.status === 429) return 'rateLimited';
    return res.ok ? 'sent' : 'failed';
  } catch {
    return online() ? 'failed' : 'offline';
  }
}
