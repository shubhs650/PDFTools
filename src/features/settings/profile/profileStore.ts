// The reviewer profile in memory (M3-07, D-16): loaded from IndexedDB once,
// saved there on every edit. The first markup of a session without a profile
// asks for one (requestProfile); Skip means "Anonymous" until the next session.
// The profile is never part of an error report (rule 10): nothing here is
// logged, and recordError gets codes only.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { parseStoredProfile, type ReviewerProfile } from '../../../model/reviewerProfile';
import { appDb } from '../../../storage/appDb';

export type ProfileDialogMode = 'first' | 'edit';

interface ProfileState {
  profile: ReviewerProfile | null;
  loaded: boolean;
  /** Skip was chosen this session: don't ask again until the next one. */
  skipped: boolean;
  dialog: ProfileDialogMode | null;
}

export const profileStore = createStore<ProfileState>()(() => ({
  profile: null,
  loaded: false,
  skipped: false,
  dialog: null,
}));

export function useProfile<T>(selector: (s: ProfileState) => T): T {
  return useStore(profileStore, selector);
}

let loading: Promise<void> | null = null;
/** Callers waiting for the first-markup dialog to close. */
let waiting: (() => void)[] = [];

export function loadProfile(): Promise<void> {
  loading ??= appDb()
    .then((db) => db.getProfile())
    .then((v) => {
      profileStore.setState({ profile: parseStoredProfile(v), loaded: true });
    })
    .catch((err: unknown) => {
      recordError('profile.load', err);
      profileStore.setState({ loaded: true });
    });
  return loading;
}

export async function saveProfile(profile: ReviewerProfile): Promise<boolean> {
  profileStore.setState({ profile, skipped: false });
  try {
    await (await appDb()).setProfile(profile);
    return true;
  } catch (err) {
    recordError('profile.save', err);
    return false;
  }
}

/**
 * Resolves once there is a profile or the user skipped this session: at once
 * when that is already so, otherwise after the first-markup dialog closes
 * (either way — the markup is made after it, with whichever author results).
 */
export async function requestProfile(): Promise<void> {
  await loadProfile();
  const s = profileStore.getState();
  if (s.profile || s.skipped) return;
  return new Promise((resolve) => {
    waiting.push(resolve);
    if (!profileStore.getState().dialog) profileStore.setState({ dialog: 'first' });
  });
}

export function openProfileDialog(): void {
  void loadProfile().then(() => {
    profileStore.setState({ dialog: 'edit' });
  });
}

/** Closes the dialog; Skip (or Esc) on the first-markup prompt means anonymous this session. */
export function closeProfileDialog(skip: boolean): void {
  const s = profileStore.getState();
  profileStore.setState({
    dialog: null,
    skipped: s.skipped || (skip && s.dialog === 'first' && !s.profile),
  });
  const w = waiting;
  waiting = [];
  for (const resolve of w) resolve();
}

/** "Clear all local data": the profile is gone; the next markup asks again. */
export function resetProfile(): void {
  loading = null;
  profileStore.setState({ profile: null, loaded: true, skipped: false });
}
