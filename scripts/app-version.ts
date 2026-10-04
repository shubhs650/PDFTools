// The version shown in File → About (M1-26): package.json's version plus the
// short commit the build came from: git when available, else the commit
// Cloudflare builds from (Pages: CF_PAGES_COMMIT_SHA; Workers Builds:
// WORKERS_CI_COMMIT_SHA; D-11).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function appVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (sha) return `${pkg.version}+${sha}`;
  } catch {
    // no git: fall through
  }
  const sha = (process.env.CF_PAGES_COMMIT_SHA ?? process.env.WORKERS_CI_COMMIT_SHA)?.slice(0, 7);
  return sha ? `${pkg.version}+${sha}` : pkg.version;
}
