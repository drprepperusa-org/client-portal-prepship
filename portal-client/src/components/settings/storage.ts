// Settings are user preferences with no operator-side endpoint, so we persist
// them to localStorage (per-browser, survives reloads).
export const LS_PROFILE = 'prepship.settings.profile';
export const LS_NOTIF = 'prepship.settings.notifications';

export function loadJSON<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}
