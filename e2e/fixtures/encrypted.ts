// Encrypted variants of self-made PDFs, made with the qpdf CLI (a CI tool,
// not a dependency — M1-07). Node only; generated at test time, never committed
// (CLAUDE.md rule 13). Promoted from spikes/s11-secure-print (ADR-013).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const hasQpdf = (): boolean => spawnSync('qpdf', ['--version']).status === 0;

export interface EncryptedVariant {
  name: string;
  /** qpdf arguments after `--encrypt user owner`. */
  args: string[];
  bytes: Uint8Array;
}

export const USER_PW = 'user-pw';
export const OWNER_PW = 'owner-pw';

/**
 * Encrypts `bytes` with qpdf: R2 (RC4-40), R3 (RC4-128), R4 (AES-128) and R6
 * (AES-256), each with a user and an owner password, with print, copy, modify,
 * annotate and form filling denied; plus an owner-password-only R6 variant.
 */
export function encryptedVariants(bytes: Uint8Array): EncryptedVariant[] {
  const deny128 = ['--print=none', '--modify=none', '--extract=n', '--annotate=n', '--form=n'];
  const specs: [string, string, string, string[]][] = [
    [
      'R2-rc4-40',
      USER_PW,
      OWNER_PW,
      ['40', '--print=n', '--modify=n', '--extract=n', '--annotate=n'],
    ],
    ['R3-rc4-128', USER_PW, OWNER_PW, ['128', '--use-aes=n', ...deny128]],
    ['R4-aes-128', USER_PW, OWNER_PW, ['128', '--use-aes=y', ...deny128]],
    ['R6-aes-256', USER_PW, OWNER_PW, ['256', ...deny128]],
    ['R6-owner-only', '', OWNER_PW, ['256', ...deny128]],
  ];
  return specs.map(([name, user, owner, args]) => ({
    name,
    args,
    bytes: qpdfEncrypt(bytes, user, owner, args),
  }));
}

/**
 * `qpdf --encrypt <user> <owner> <args…>`: e.g. `['256']` for AES-256 with no
 * restrictions, or `['256', '--print=none']`.
 */
export function qpdfEncrypt(
  bytes: Uint8Array,
  user: string,
  owner: string,
  args: string[],
): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'pdftools-enc-'));
  const src = join(dir, 'in.pdf');
  const out = join(dir, 'out.pdf');
  writeFileSync(src, bytes);
  const r = spawnSync('qpdf', [
    '--allow-weak-crypto',
    '--encrypt',
    user,
    owner,
    ...args,
    '--',
    src,
    out,
  ]);
  if (r.status !== 0 && r.status !== 3) throw new Error(`qpdf: ${r.stderr.toString()}`);
  return new Uint8Array(readFileSync(out));
}
