import { useCallback, useSyncExternalStore } from 'react';

/** Who is checking and where. Kept on the device, so the checker types it once. */
export interface Profile {
  readonly checker: string;
  readonly place: string;
}

const STORAGE_KEY = 'plomba.profile';
const EMPTY: Profile = { checker: '', place: '' };
const listeners = new Set<() => void>();

let cached: { raw: string | null; profile: Profile } | undefined;

function read(): Profile {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (cached?.raw === raw) return cached.profile;
  let profile = EMPTY;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<Profile>) : {};
    profile = { checker: parsed.checker ?? '', place: parsed.place ?? '' };
  } catch {
    // A corrupted entry is replaced on the next save.
  }
  cached = { raw, profile };
  return profile;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useProfile(): [Profile, (profile: Profile) => void] {
  const profile = useSyncExternalStore(subscribe, read);
  const save = useCallback((next: Profile) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    for (const listener of listeners) listener();
  }, []);
  return [profile, save];
}

export function isComplete(profile: Profile): boolean {
  return profile.checker.trim() !== '' && profile.place.trim() !== '';
}
