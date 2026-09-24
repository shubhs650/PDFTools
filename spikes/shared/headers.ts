// Minimal parser for Cloudflare Pages `_headers` files (M0-S8).
// Supports what the spike needs: exact paths and trailing `*` splats, header
// lines indented under a path, `#` comments. Later rules add to earlier ones.

export interface HeaderRule {
  pattern: string;
  headers: [string, string][];
}

export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
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
