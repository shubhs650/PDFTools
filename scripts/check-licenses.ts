// Dependency license gate (D-12, CLAUDE.md rule 5).
// Walks every installed package under node_modules (runtime AND dev) and fails
// on forbidden, unknown or missing licenses unless a reviewed exception exists
// in scripts/license-exceptions.json. Packages npm marks dev-only in
// package-lock.json may additionally use DEV_ONLY_ALLOWED licenses (ADR-002).
//
// Usage: node scripts/check-licenses.ts [--verbose] [--notices <file>]
// --notices also writes the third-party notices of every runtime package
// (scripts/notices.ts; the build emits the same file, M1-26).

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkPackages,
  evaluateLicense,
  licenseFromManifest,
  type LicenseException,
  type PackageInfo,
} from './license-policy.ts';
import { collectNotices, renderNotices } from './notices.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');
const noticesAt = process.argv.indexOf('--notices');
const noticesFile = noticesAt >= 0 ? process.argv[noticesAt + 1] : undefined;

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** Relative paths ("node_modules/x/node_modules/y") that npm marks dev-only. */
function devOnlyPaths(): Set<string> {
  const lockFile = join(root, 'package-lock.json');
  const paths = new Set<string>();
  if (!existsSync(lockFile)) return paths;
  const lock = readJson(lockFile) as { packages?: Record<string, { dev?: boolean }> };
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    // `devOptional` or missing entries are treated as runtime (conservative).
    if (meta.dev === true) paths.add(path);
  }
  return paths;
}

function walk(nodeModules: string, out: Map<string, PackageInfo>): void {
  if (!existsSync(nodeModules)) return;
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    const full = join(nodeModules, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(full, { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) visit(join(full, scoped.name), out);
      }
    } else {
      visit(full, out);
    }
  }
}

function visit(dir: string, out: Map<string, PackageInfo>): void {
  const manifestPath = join(dir, 'package.json');
  if (existsSync(manifestPath)) {
    const manifest = readJson(manifestPath);
    const name = typeof manifest.name === 'string' ? manifest.name : relative(root, dir);
    const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    const key = `${name}@${version}`;
    if (!out.has(key)) {
      out.set(key, {
        name,
        version,
        license: licenseFromManifest(manifest),
        path: relative(root, dir),
      });
    }
  }
  walk(join(dir, 'node_modules'), out);
}

function main(): void {
  let failed = false;

  const rootLicense = licenseFromManifest(readJson(join(root, 'package.json')));
  if (rootLicense !== 'MIT') {
    console.error(`✖ Root package must be MIT (D-12), found: ${rootLicense ?? '(none)'}`);
    failed = true;
  }

  if (!existsSync(join(root, 'node_modules'))) {
    console.error('✖ node_modules not found — run `npm ci` first.');
    process.exit(1);
  }

  const packages = new Map<string, PackageInfo>();
  walk(join(root, 'node_modules'), packages);
  const devPaths = devOnlyPaths();
  for (const pkg of packages.values()) {
    pkg.dev = devPaths.has(pkg.path.split('\\').join('/'));
  }

  const exceptionsFile = join(root, 'scripts', 'license-exceptions.json');
  const exceptions = (existsSync(exceptionsFile) ? readJson(exceptionsFile).packages : {}) as
    Record<string, LicenseException> | undefined;

  const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
  const result = checkPackages(list, exceptions ?? {});

  const counts = new Map<string, number>();
  for (const p of list) {
    const key = p.license ?? '(none)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log(`License check: ${String(list.length)} installed packages\n`);
  for (const [license, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const id = license === '(none)' ? undefined : license;
    const { status } = evaluateLicense(id);
    const devOk = evaluateLicense(id, { dev: true }).status === 'allowed';
    const mark = status === 'allowed' ? '✔' : devOk ? 'd' : status === 'forbidden' ? '✖' : '?';
    const note = status !== 'allowed' && devOk ? '  (dev-only allowed)' : '';
    console.log(`  ${mark} ${license.padEnd(40)} ${String(count)}${note}`);
  }
  console.log('');

  if (verbose) {
    for (const p of result.allowed) {
      console.log(`  ok  ${p.name}@${p.version}  ${p.license ?? ''}`);
    }
  }
  if (result.devOnly.length > 0) {
    console.log('  Dev-only (not bundled), allowed by ADR-002:');
    for (const p of result.devOnly) {
      console.log(`  dev ${p.name}@${p.version}  ${p.license ?? ''}`);
    }
    console.log('');
  }
  for (const p of result.excepted) {
    console.log(`  exc ${p.name}@${p.version}  ${p.license ?? ''}  — ${p.reason}`);
  }
  for (const name of result.unusedExceptions) {
    console.warn(`⚠ Unused license exception: ${name}`);
  }
  for (const msg of result.configErrors) {
    console.error(`✖ ${msg}`);
    failed = true;
  }
  if (result.failures.length > 0) {
    failed = true;
    console.error(`✖ ${String(result.failures.length)} package(s) violate the license policy:\n`);
    for (const p of result.failures) {
      console.error(`  ${p.name}@${p.version}  [${p.status}] ${p.reason}  (${p.path})`);
    }
    console.error(
      '\nRemove the dependency, or — only for a genuinely permissive license — add a reviewed\n' +
        'entry to scripts/license-exceptions.json with the exact license string and a reason.',
    );
  }

  if (failed) process.exit(1);
  if (noticesFile) {
    const notices = collectNotices(root);
    writeFileSync(noticesFile, renderNotices(notices));
    console.log(
      `Third-party notices for ${String(notices.length)} runtime packages → ${noticesFile}`,
    );
  }
  console.log(
    `✔ All ${String(list.length)} packages comply (${String(result.devOnly.length)} dev-only, ` +
      `${String(result.excepted.length)} via reviewed exceptions).`,
  );
}

main();
