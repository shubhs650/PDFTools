// PDF permission flags → what the user may do (D-19, §7.12, CLAUDE.md rule 9).
// ISO 32000-1 Table 22. Bits 3–6 exist in every security handler revision;
// bits 9–12 only from revision 3 on. In revision 2 those four follow the older
// bits (ADR-013 finding 2): form filling follows "annotate" (6), accessibility
// "copy" (5), assembling "modify" (4) and high-quality printing "print" (3).
// Pure and dependency-free: used by the UI and by the Render worker's save
// tracker, so both apply the same rules.

export type Capability =
  | 'print'
  | 'printHighQuality'
  | 'copy'
  | 'annotate'
  | 'fillForms'
  | 'modify'
  | 'assemble'
  | 'accessibility';

/** In the order they are listed to the user. */
export const CAPABILITIES: readonly Capability[] = [
  'print',
  'printHighQuality',
  'copy',
  'accessibility',
  'annotate',
  'fillForms',
  'modify',
  'assemble',
];

const bit = (n: number): number => 2 ** (n - 1);
export const PERM_PRINT = bit(3);
export const PERM_MODIFY = bit(4);
export const PERM_COPY = bit(5);
export const PERM_ANNOTATE = bit(6);
export const PERM_FILL_FORMS = bit(9);
export const PERM_ACCESSIBILITY = bit(10);
export const PERM_ASSEMBLE = bit(11);
export const PERM_PRINT_HIGH = bit(12);

export interface Security {
  /** `FPDF_GetDocPermissions` (all bits set after an owner-password unlock). */
  permissions: number;
  /** `FPDF_GetSecurityHandlerRevision`: -1 when the file is not encrypted. */
  revision: number;
}

export const UNRESTRICTED: Security = { permissions: 0xffffffff, revision: -1 };

export function allows(sec: Security, cap: Capability): boolean {
  if (sec.revision < 2) return true; // not encrypted: nothing to honor
  const has = (mask: number): boolean => (sec.permissions & mask) !== 0;
  const legacy = sec.revision === 2;
  switch (cap) {
    case 'print':
      return has(PERM_PRINT);
    case 'modify':
      return has(PERM_MODIFY);
    case 'copy':
      return has(PERM_COPY);
    case 'annotate':
      return has(PERM_ANNOTATE);
    case 'fillForms':
      // R3+: bit 9, or bit 6 (which also allows filling in forms).
      return legacy ? has(PERM_ANNOTATE) : has(PERM_FILL_FORMS) || has(PERM_ANNOTATE);
    case 'accessibility':
      return legacy ? has(PERM_COPY) : has(PERM_ACCESSIBILITY);
    case 'assemble':
      // R3+: bit 11, or bit 4 (which also allows assembling).
      return legacy ? has(PERM_MODIFY) : has(PERM_ASSEMBLE) || has(PERM_MODIFY);
    case 'printHighQuality':
      return legacy ? has(PERM_PRINT) : has(PERM_PRINT) && has(PERM_PRINT_HIGH);
  }
}

/** The capabilities the document denies, in display order (empty: unrestricted). */
export function restrictions(sec: Security): Capability[] {
  return CAPABILITIES.filter((c) => !allows(sec, c));
}
