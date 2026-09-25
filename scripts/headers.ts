// Parser for Cloudflare Pages `_headers` files, used by scripts/serve.ts so
// local and CI runs get the production headers (ADR-003 decision 4).
// Supported: exact paths, a trailing `*` splat, header lines indented under a
// path, `#` comments. Later matching rules add to earlier ones, as on Pages.

export interface HeaderRule {
  pattern: string;
  headers: [string, string][];
}

export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: trimmed, headers: [] };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error(`Header line before any path: ${raw}`);
    const idx = raw.indexOf(':');
    if (idx < 0) throw new Error(`Malformed header line: ${raw}`);
    current.headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
  }
  return rules;
}

export function matchPattern(pattern: string, path: string): boolean {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

export function headersFor(rules: HeaderRule[], path: string): [string, string][] {
  return rules.filter((r) => matchPattern(r.pattern, path)).flatMap((r) => r.headers);
}
