// M6-12 (§7.12, ADR-022 decision 2): the Password Security form's pure model —
// implied and dependent permissions, the /P bits, validation (127 UTF-8
// bytes, confirmations, different passwords), the passwords applied, and who
// has owner rights.
import { describe, expect, it } from 'vitest';
import {
  ALL_ALLOWED,
  baseName,
  effectiveAllowed,
  encryptPlan,
  hasOwnerRights,
  isValid,
  MAX_PASSWORD_BYTES,
  passwordBytes,
  permissionFlags,
  validate,
  type PasswordSecurityForm,
} from '../../src/model/passwordSecurity';
import {
  allows,
  CAPABILITIES,
  PERM_ANNOTATE,
  PERM_FILL_FORMS,
  PERM_PRINT,
  type Capability,
} from '../../src/model/permissions';

const form = (patch: Partial<PasswordSecurityForm>): PasswordSecurityForm => ({
  openRequired: true,
  openPassword: 'open',
  openConfirm: 'open',
  restrict: false,
  permissionsPassword: '',
  permissionsConfirm: '',
  allowed: ALL_ALLOWED,
  ...patch,
});

describe('permissions', () => {
  it('annotate implies form filling, modify implies assembly', () => {
    expect([...effectiveAllowed(new Set<Capability>(['annotate']))]).toEqual([
      'annotate',
      'fillForms',
    ]);
    expect([...effectiveAllowed(new Set<Capability>(['modify']))]).toEqual(['modify', 'assemble']);
  });

  it('high-quality printing needs printing', () => {
    expect([...effectiveAllowed(new Set<Capability>(['printHighQuality']))]).toEqual([]);
    expect([...effectiveAllowed(new Set<Capability>(['print', 'printHighQuality']))]).toEqual([
      'print',
      'printHighQuality',
    ]);
  });

  it('the bits are the ISO 32000 ones, and allows() reads back what was ticked', () => {
    expect(permissionFlags(new Set())).toBe(0);
    expect(permissionFlags(new Set<Capability>(['print', 'annotate']))).toBe(
      PERM_PRINT | PERM_ANNOTATE | PERM_FILL_FORMS,
    );
    expect(permissionFlags(ALL_ALLOWED)).toBe(3900); // EmbedPDF's PdfPermissionFlag.AllowAll
    // Every subset, as an R6 file would report it.
    for (let mask = 0; mask < 2 ** CAPABILITIES.length; mask++) {
      const ticked = new Set(CAPABILITIES.filter((_, i) => mask & (1 << i)));
      const sec = { permissions: permissionFlags(ticked), revision: 6 };
      const want = effectiveAllowed(ticked);
      expect(CAPABILITIES.filter((c) => allows(sec, c))).toEqual(
        CAPABILITIES.filter((c) => want.has(c)),
      );
    }
  });
});

describe('validation', () => {
  it('needs at least one of the two options', () => {
    expect(validate(form({ openRequired: false }))).toEqual({ nothing: true });
  });

  it('checks empty, too long, confirmation and sameness', () => {
    expect(validate(form({ openPassword: '', openConfirm: '' }))).toEqual({
      openPassword: 'empty',
    });
    expect(validate(form({ openConfirm: 'opne' }))).toEqual({ openConfirm: 'mismatch' });
    const long = 'x'.repeat(MAX_PASSWORD_BYTES + 1);
    expect(validate(form({ openPassword: long, openConfirm: long }))).toEqual({
      openPassword: 'tooLong',
    });
    expect(
      validate(form({ restrict: true, permissionsPassword: 'open', permissionsConfirm: 'open' })),
    ).toEqual({ permissionsPassword: 'same' });
    expect(
      validate(form({ restrict: true, permissionsPassword: 'perm', permissionsConfirm: 'prem' })),
    ).toEqual({ permissionsConfirm: 'mismatch' });
    expect(isValid(validate(form({})))).toBe(true);
  });

  it('counts UTF-8 bytes, not characters (spike S18)', () => {
    const e127 = 'x'.repeat(127);
    expect(passwordBytes(e127)).toBe(127);
    expect(isValid(validate(form({ openPassword: e127, openConfirm: e127 })))).toBe(true);
    const accents = 'é'.repeat(64); // 128 bytes
    expect(passwordBytes(accents)).toBe(128);
    expect(validate(form({ openPassword: accents, openConfirm: accents })).openPassword).toBe(
      'tooLong',
    );
  });
});

describe('the passwords applied', () => {
  it('open password only: it is the owner password too, nothing restricted', () => {
    expect(encryptPlan(form({}))).toEqual({
      userPassword: 'open',
      ownerPassword: 'open',
      flags: 3900,
      allowed: [...CAPABILITIES],
    });
  });

  it('permissions password only: no open password, the ticked permissions', () => {
    const p = encryptPlan(
      form({
        openRequired: false,
        restrict: true,
        permissionsPassword: 'perm',
        permissionsConfirm: 'perm',
        allowed: new Set<Capability>(['print', 'copy']),
      }),
    );
    expect(p).toMatchObject({
      userPassword: '',
      ownerPassword: 'perm',
      allowed: ['print', 'copy'],
    });
  });

  it('a typed open password is ignored when the box is not ticked', () => {
    expect(
      encryptPlan(
        form({
          openRequired: false,
          restrict: true,
          permissionsPassword: 'perm',
          permissionsConfirm: 'perm',
        }),
      ).userPassword,
    ).toBe('');
  });
});

describe('owner rights', () => {
  it('plain files and owner-unlocked ones only', () => {
    expect(hasOwnerRights({ revision: -1, ownerUnlocked: false })).toBe(true);
    expect(hasOwnerRights({ revision: 6, ownerUnlocked: false })).toBe(false);
    expect(hasOwnerRights({ revision: 6, ownerUnlocked: true })).toBe(true);
    expect(hasOwnerRights({ revision: 2, ownerUnlocked: false })).toBe(false);
  });

  it('file names keep their base', () => {
    expect(baseName('plan.PDF')).toBe('plan');
    expect(baseName('.pdf')).toBe('.pdf');
  });
});
