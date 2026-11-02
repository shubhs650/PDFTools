// Password Security (M6-12, D-40 a, §7.12, ADR-022 decision 2): what the
// dialog asks for, turned into the open password, the permissions (owner)
// password and the permission bits an AES-256 file gets; who may change or
// remove a document's security. Pure and dependency-free: used by the dialog,
// the Render worker's gate and the Work worker's check, so all three agree.
import {
  CAPABILITIES,
  PERM_ACCESSIBILITY,
  PERM_ANNOTATE,
  PERM_ASSEMBLE,
  PERM_COPY,
  PERM_FILL_FORMS,
  PERM_MODIFY,
  PERM_PRINT,
  PERM_PRINT_HIGH,
  type Capability,
} from './permissions';

/**
 * AES-256 (`/V 5 /R 6`) passwords are at most 127 UTF-8 bytes (ISO 32000-2
 * 7.6.4.3.3). PDFium takes longer ones, but other readers (qpdf) then can't
 * open the file (spike S18).
 */
export const MAX_PASSWORD_BYTES = 127;

/** The security handler revision we write: AES-256, PDF 2.0. */
export const AES256_REVISION = 6;

const BIT: Record<Capability, number> = {
  print: PERM_PRINT,
  printHighQuality: PERM_PRINT_HIGH,
  copy: PERM_COPY,
  accessibility: PERM_ACCESSIBILITY,
  annotate: PERM_ANNOTATE,
  fillForms: PERM_FILL_FORMS,
  modify: PERM_MODIFY,
  assemble: PERM_ASSEMBLE,
};

/**
 * A tick box another one implies (ISO 32000-1 table 22): comments (bit 6)
 * also allow filling in forms, changes (bit 4) also allow page assembly. The
 * dialog shows the implied box ticked and disabled.
 */
export const IMPLIED_BY: Partial<Record<Capability, Capability>> = {
  fillForms: 'annotate',
  assemble: 'modify',
};

/** A tick box that needs another one: high-quality printing needs printing. */
export const NEEDS: Partial<Record<Capability, Capability>> = {
  printHighQuality: 'print',
};

/** What the file allows with the open password, given the ticked boxes. */
export function effectiveAllowed(ticked: ReadonlySet<Capability>): Set<Capability> {
  const out = new Set<Capability>();
  for (const c of CAPABILITIES) {
    const need = NEEDS[c];
    if (need && !ticked.has(need)) continue;
    const by = IMPLIED_BY[c];
    if (ticked.has(c) || (by && ticked.has(by))) out.add(c);
  }
  return out;
}

/** The `/P` bits for `setDocumentEncryption` (EmbedPDF's PdfPermissionFlag values). */
export function permissionFlags(ticked: ReadonlySet<Capability>): number {
  let flags = 0;
  for (const c of effectiveAllowed(ticked)) flags |= BIT[c];
  return flags;
}

export const ALL_ALLOWED: ReadonlySet<Capability> = new Set(CAPABILITIES);

export interface PasswordSecurityForm {
  openRequired: boolean;
  openPassword: string;
  openConfirm: string;
  restrict: boolean;
  permissionsPassword: string;
  permissionsConfirm: string;
  allowed: ReadonlySet<Capability>;
}

export type PasswordError = 'empty' | 'tooLong' | 'mismatch' | 'same';

export interface FormErrors {
  openPassword?: PasswordError;
  openConfirm?: PasswordError;
  permissionsPassword?: PasswordError;
  permissionsConfirm?: PasswordError;
  /** Neither box ticked: there is nothing to apply. */
  nothing?: true;
}

export const passwordBytes = (pw: string): number => new TextEncoder().encode(pw).length;

function checkPassword(pw: string): PasswordError | undefined {
  if (pw.length === 0) return 'empty';
  if (passwordBytes(pw) > MAX_PASSWORD_BYTES) return 'tooLong';
  return undefined;
}

/** Field errors (empty object: the form can be applied). */
export function validate(form: PasswordSecurityForm): FormErrors {
  const e: FormErrors = {};
  if (!form.openRequired && !form.restrict) e.nothing = true;
  if (form.openRequired) {
    const p = checkPassword(form.openPassword);
    if (p) e.openPassword = p;
    else if (form.openConfirm !== form.openPassword) e.openConfirm = 'mismatch';
  }
  if (form.restrict) {
    const p = checkPassword(form.permissionsPassword);
    if (p) e.permissionsPassword = p;
    else if (form.openRequired && form.permissionsPassword === form.openPassword)
      e.permissionsPassword = 'same';
    else if (form.permissionsConfirm !== form.permissionsPassword)
      e.permissionsConfirm = 'mismatch';
  }
  return e;
}

export const isValid = (e: FormErrors): boolean => Object.keys(e).length === 0;

/** What the Render worker applies to the copy (passwords: memory only, M2-Q7). */
export interface EncryptPlan {
  userPassword: string;
  ownerPassword: string;
  /** The `/P` bits asked for. */
  flags: number;
  /** What the open password must allow, for the Work worker's check. */
  allowed: Capability[];
}

/**
 * The form as passwords and bits. Without a permissions password the open
 * password is the owner password too and nothing is restricted, so whoever
 * can open the file can also change or remove its security (PDFium checks
 * the owner password first, so opening with it gives owner rights).
 */
export function encryptPlan(form: PasswordSecurityForm): EncryptPlan {
  const user = form.openRequired ? form.openPassword : '';
  if (!form.restrict) {
    return {
      userPassword: user,
      ownerPassword: user,
      flags: permissionFlags(ALL_ALLOWED),
      allowed: [...CAPABILITIES],
    };
  }
  const allowed = effectiveAllowed(form.allowed);
  return {
    userPassword: user,
    ownerPassword: form.permissionsPassword,
    flags: permissionFlags(form.allowed),
    allowed: CAPABILITIES.filter((c) => allowed.has(c)),
  };
}

/**
 * Owner rights (ADR-022 decision 2): an unencrypted document, or one opened
 * with (or unlocked by) its owner password. Changing or removing security
 * needs them; `modify` is not enough (PDFium removes encryption from a file
 * opened with the user password only).
 */
export function hasOwnerRights(sec: { revision: number; ownerUnlocked: boolean }): boolean {
  return sec.revision < 2 || sec.ownerUnlocked;
}

/** "plan.pdf" → "plan" (the dialog's file-name messages add the suffix). */
export const baseName = (name: string): string => name.replace(/\.pdf$/iu, '') || name;
