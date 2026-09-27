// The local reviewer profile (D-16, §7.2, M3-07): who is marking up. Stored on
// this device only (IndexedDB `profile`); the name becomes the author (/T) of
// every new annotation (M3-Q7), initials, discipline and company are used by
// stamps and the CRS. Pure: validation and derived initials.

export interface ReviewerProfile {
  name: string;
  initials: string;
  discipline: string;
  company: string;
}

export const PROFILE_LIMITS = { name: 64, initials: 5, discipline: 64, company: 64 } as const;

export type ProfileField = keyof ReviewerProfile;
export type ProfileError = 'required' | 'tooLong';
export type ProfileErrors = Partial<Record<ProfileField, ProfileError>>;

/** User-perceived characters (grapheme clusters): what "at most N characters" counts. */
function graphemes(s: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s),
    (g) => g.segment,
  );
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/gu, ' ').trim() : '');

/** Initials from a name: the first letter of up to three words, upper-cased ("Ana de Vries" → "ADV"). */
export function deriveInitials(name: string, locale?: string): string {
  return clean(name)
    .split(' ')
    .map((w) => graphemes(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? '')
    .filter(Boolean)
    .slice(0, 3)
    .join('')
    .toLocaleUpperCase(locale);
}

/**
 * Checks what the dialog collected: trimmed fields, a name, lengths within the
 * limits (counted in characters); empty initials are derived from the name.
 */
export function validateProfile(
  input: Partial<Record<ProfileField, unknown>>,
  locale?: string,
): { profile: ReviewerProfile; errors: null } | { profile: null; errors: ProfileErrors } {
  const p: ReviewerProfile = {
    name: clean(input.name),
    initials: clean(input.initials).replace(/ /gu, ''),
    discipline: clean(input.discipline),
    company: clean(input.company),
  };
  if (!p.initials) p.initials = deriveInitials(p.name, locale);
  const errors: ProfileErrors = {};
  if (!p.name) errors.name = 'required';
  for (const k of Object.keys(PROFILE_LIMITS) as ProfileField[])
    if (graphemes(p[k]).length > PROFILE_LIMITS[k]) errors[k] = 'tooLong';
  return Object.keys(errors).length ? { profile: null, errors } : { profile: p, errors: null };
}

/** A stored value read back from IndexedDB, or null if it isn't a valid profile. */
export function parseStoredProfile(value: unknown): ReviewerProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  return validateProfile(value).profile;
}
