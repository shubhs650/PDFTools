import { describe, expect, it } from 'vitest';
import { keepOriginalAuthor } from '../../src/features/annotate/authoring';
import {
  deriveInitials,
  parseStoredProfile,
  validateProfile,
} from '../../src/model/reviewerProfile';

describe('reviewer profile (M3-07, D-16)', () => {
  it('derives initials from up to three words, locale-aware', () => {
    expect(deriveInitials('Ana de Vries')).toBe('ADV');
    expect(deriveInitials('  jean-luc   picard ')).toBe('JP');
    expect(deriveInitials('Å. Ørsted')).toBe('ÅØ');
    expect(deriveInitials('(Bob) Smith Jones Brown')).toBe('BSJ');
    expect(deriveInitials('ilkay', 'tr')).toBe('İ');
    expect(deriveInitials('')).toBe('');
  });

  it('requires a name, trims fields and derives blank initials', () => {
    expect(validateProfile({ name: '   ' })).toEqual({
      profile: null,
      errors: { name: 'required' },
    });
    expect(validateProfile({ name: ' Ana  de Vries ', discipline: ' Civil ' })).toEqual({
      profile: { name: 'Ana de Vries', initials: 'ADV', discipline: 'Civil', company: '' },
      errors: null,
    });
    expect(validateProfile({ name: 'Ana', initials: 'a b' }).profile?.initials).toBe('ab');
  });

  it('limits lengths in characters, not UTF-16 units', () => {
    expect(validateProfile({ name: '😀'.repeat(64) }).profile?.name).toHaveLength(128);
    expect(validateProfile({ name: 'x'.repeat(65), initials: 'ABCDEF' }).errors).toEqual({
      name: 'tooLong',
      initials: 'tooLong',
    });
  });

  it('reads back only valid stored values', () => {
    expect(parseStoredProfile(undefined)).toBeNull();
    expect(parseStoredProfile('Ana')).toBeNull();
    expect(parseStoredProfile({ name: 42 })).toBeNull();
    expect(parseStoredProfile({ name: 'Ana', initials: 'AV' })).toEqual({
      name: 'Ana',
      initials: 'AV',
      discipline: '',
      company: '',
    });
  });
});

describe('edits keep the annotation’s author (D-03)', () => {
  it('replaces the plugin’s configured author with the original one', () => {
    expect(keepOriginalAuthor({ author: 'Old viewer' }, { author: 'Me', opacity: 0.5 })).toEqual({
      author: 'Old viewer',
      opacity: 0.5,
    });
  });

  it('adds no author when the annotation has none', () => {
    expect(keepOriginalAuthor({}, { author: 'Me', opacity: 0.5 })).toEqual({ opacity: 0.5 });
  });
});
