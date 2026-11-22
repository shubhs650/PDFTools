// The permission rules of a comparison (M12-08, D-58, ARCHITECTURE §7.16, CLAUDE.md rule 9).
// Each action follows each file's own flags: looking at a comparison is viewing and is
// always allowed; commenting needs that file's commenting permission; copying text from
// the list, Export Overlay…, the change register and Save comparison… need the
// content-copying permission of every file on both sides. The permissions password lifts
// a file's restrictions (unlock.ts); nothing is bypassed. A blocked action names the file
// and the reason. Pure.
import { allows, type Security } from '../../model/permissions';

export type CompareAction =
  'view' | 'comment' | 'copyText' | 'exportOverlay' | 'changeRegister' | 'saveComparison';

/** The actions that need the content-copying permission of every file. */
export const COPY_ACTIONS: readonly CompareAction[] = [
  'copyText',
  'exportOverlay',
  'changeRegister',
  'saveComparison',
];

export interface InputFile {
  docId: string;
  /** The file's name, to say which file blocks (never logged, rule 10). */
  name: string;
  security: Security;
}

/** Which file blocks an action and the permission it lacks. */
export interface Block {
  docId: string;
  name: string;
  capability: 'annotate' | 'copy';
}

/**
 * Whether `action` may run, given every file of the comparison; for 'comment', the file
 * the comment goes into (`target`). Null: allowed.
 */
export function blockFor(
  action: CompareAction,
  files: readonly InputFile[],
  target?: string,
): Block | null {
  if (action === 'view') return null;
  if (action === 'comment') {
    const f = files.find((x) => x.docId === target);
    return f && !allows(f.security, 'annotate')
      ? { docId: f.docId, name: f.name, capability: 'annotate' }
      : null;
  }
  const f = files.find((x) => !allows(x.security, 'copy'));
  return f ? { docId: f.docId, name: f.name, capability: 'copy' } : null;
}

/** What a file's restrictions turn off in a comparison, for the input window's notice. */
export interface FileLimits {
  /** Comments cannot be added to this file. */
  comment: boolean;
  /** The copy actions are off for the whole comparison because of this file. */
  copy: boolean;
}

export function limitsOf(security: Security): FileLimits {
  return { comment: !allows(security, 'annotate'), copy: !allows(security, 'copy') };
}
