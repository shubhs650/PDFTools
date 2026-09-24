// License policy for the dependency gate (D-12, CLAUDE.md rule 5).
// Pure functions only — the filesystem walk lives in check-licenses.ts.

export type SpdxNode =
  { type: 'license'; id: string } | { type: 'and' | 'or'; left: SpdxNode; right: SpdxNode };

export type LicenseStatus = 'allowed' | 'forbidden' | 'unknown';

export interface Evaluation {
  status: LicenseStatus;
  reason: string;
}

export interface PackageInfo {
  name: string;
  version: string;
  license: string | undefined;
  path: string;
}

export interface LicenseException {
  license: string;
  reason: string;
}

export type PackageResult = PackageInfo & Evaluation;

/**
 * Permissive licenses accepted without review (compared case-insensitively).
 * Approved in session 1 (answer to B2): the classic four plus other permissive
 * licenses that appear in a normal JS toolchain and in PDFium's bundled libs.
 */
export const ALLOWED: ReadonlySet<string> = new Set(
  [
    'MIT',
    'MIT-0',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    '0BSD',
    'BlueOak-1.0.0',
    'CC0-1.0',
    'Unlicense',
    'Zlib',
    'BSL-1.0',
    'Python-2.0',
    'CC-BY-3.0',
    'CC-BY-4.0',
    'FTL',
    'IJG',
    'Unicode-DFS-2016',
    'Unicode-3.0',
  ].map((id) => id.toUpperCase()),
);

/** Copyleft, source-available and non-commercial licenses. Matched by prefix. */
export const FORBIDDEN_PREFIXES: readonly string[] = [
  'GPL',
  'LGPL',
  'AGPL',
  'SSPL',
  'MPL',
  'EUPL',
  'CDDL',
  'EPL',
  'OSL',
  'CPAL',
  'RPL',
  'BUSL',
  'CC-BY-NC',
  'CC-BY-SA',
  'CC-BY-ND',
  'COMMONS-CLAUSE',
  'ELASTIC',
  'POLYFORM',
];

function tokenize(expr: string): string[] {
  return expr
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Parse an SPDX license expression. AND binds tighter than OR.
 * `X WITH exception` is reduced to `X`.
 */
export function parseSpdx(expr: string): SpdxNode {
  const tokens = tokenize(expr);
  let pos = 0;
  const isOp = (t: string | undefined, op: string) => t?.toUpperCase() === op;

  const parsePrimary = (): SpdxNode => {
    const tok = tokens[pos++];
    if (tok === undefined) throw new Error(`Unexpected end of SPDX expression: "${expr}"`);
    if (tok === '(') {
      const node = parseOr();
      if (tokens[pos++] !== ')') throw new Error(`Missing ")" in SPDX expression: "${expr}"`);
      return node;
    }
    if (tok === ')' || isOp(tok, 'AND') || isOp(tok, 'OR') || isOp(tok, 'WITH')) {
      throw new Error(`Unexpected "${tok}" in SPDX expression: "${expr}"`);
    }
    if (isOp(tokens[pos], 'WITH')) {
      pos++;
      if (tokens[pos++] === undefined) throw new Error(`Missing exception after WITH: "${expr}"`);
    }
    return { type: 'license', id: tok };
  };

  const parseAnd = (): SpdxNode => {
    let left = parsePrimary();
    while (isOp(tokens[pos], 'AND')) {
      pos++;
      left = { type: 'and', left, right: parsePrimary() };
    }
    return left;
  };

  const parseOr = (): SpdxNode => {
    let left = parseAnd();
    while (isOp(tokens[pos], 'OR')) {
      pos++;
      left = { type: 'or', left, right: parseAnd() };
    }
    return left;
  };

  if (tokens.length === 0) throw new Error('Empty SPDX expression');
  const node = parseOr();
  if (pos !== tokens.length) throw new Error(`Trailing tokens in SPDX expression: "${expr}"`);
  return node;
}

function classifyId(id: string): LicenseStatus {
  const normalized = id.toUpperCase().replace(/\+$/, '');
  if (ALLOWED.has(normalized)) return 'allowed';
  if (FORBIDDEN_PREFIXES.some((p) => normalized.startsWith(p))) return 'forbidden';
  return 'unknown';
}

/** Rank used to combine results: allowed < unknown < forbidden. */
const RANK: Record<LicenseStatus, number> = { allowed: 0, unknown: 1, forbidden: 2 };

const worst = (a: LicenseStatus, b: LicenseStatus): LicenseStatus => (RANK[a] >= RANK[b] ? a : b);

function evaluateNode(node: SpdxNode): LicenseStatus {
  if (node.type === 'license') return classifyId(node.id);
  const l = evaluateNode(node.left);
  const r = evaluateNode(node.right);
  if (node.type === 'or' && (l === 'allowed' || r === 'allowed')) return 'allowed';
  return worst(l, r);
}

/** Evaluate a package's license string against the policy. */
export function evaluateLicense(license: string | undefined): Evaluation {
  const trimmed = license?.trim() ?? '';
  if (trimmed === '') return { status: 'unknown', reason: 'no license declared' };
  if (/^SEE LICENSE IN/i.test(trimmed) || trimmed.toUpperCase() === 'UNLICENSED') {
    return { status: 'unknown', reason: `non-SPDX license "${trimmed}"` };
  }
  let node: SpdxNode;
  try {
    node = parseSpdx(trimmed);
  } catch {
    return { status: 'unknown', reason: `unparseable license "${trimmed}"` };
  }
  const status = evaluateNode(node);
  const reason =
    status === 'allowed'
      ? 'permissive'
      : status === 'forbidden'
        ? `forbidden license "${trimmed}"`
        : `unrecognised license "${trimmed}"`;
  return { status, reason };
}

function typeOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const { type } = value;
    if (typeof type === 'string') return type;
  }
  return undefined;
}

/** Extract the license string from a package.json object, including legacy forms. */
export function licenseFromManifest(manifest: Record<string, unknown>): string | undefined {
  const direct = typeOf(manifest.license);
  if (direct !== undefined) return direct;
  const legacy = manifest.licenses;
  if (Array.isArray(legacy)) {
    const types = legacy.map(typeOf).filter((t): t is string => t !== undefined);
    if (types.length > 0) return types.map((t) => `(${t})`).join(' OR ');
  }
  return undefined;
}

export interface CheckResult {
  allowed: PackageResult[];
  excepted: PackageResult[];
  failures: PackageResult[];
  configErrors: string[];
  unusedExceptions: string[];
}

/**
 * Apply the policy (and reviewed exceptions) to a list of installed packages.
 * An exception applies only if it has a non-empty reason and its `license`
 * matches the installed package's declared license exactly, so a license
 * change upstream re-triggers review.
 */
export function checkPackages(
  packages: readonly PackageInfo[],
  exceptions: Readonly<Record<string, LicenseException>>,
): CheckResult {
  const result: CheckResult = {
    allowed: [],
    excepted: [],
    failures: [],
    configErrors: [],
    unusedExceptions: [],
  };
  const used = new Set<string>();
  const hasReason = (ex: LicenseException) => ex.reason.trim() !== '';

  for (const [name, ex] of Object.entries(exceptions)) {
    if (!hasReason(ex)) result.configErrors.push(`Exception for "${name}" has no reason`);
  }

  for (const pkg of packages) {
    const evaluation = evaluateLicense(pkg.license);
    const entry: PackageResult = { ...pkg, ...evaluation };
    if (evaluation.status === 'allowed') {
      result.allowed.push(entry);
      continue;
    }
    const ex = exceptions[pkg.name];
    if (ex && hasReason(ex) && ex.license === pkg.license) {
      used.add(pkg.name);
      result.excepted.push({ ...entry, reason: `exception: ${ex.reason}` });
    } else {
      result.failures.push(entry);
    }
  }

  result.unusedExceptions = Object.keys(exceptions).filter((n) => !used.has(n));
  return result;
}
