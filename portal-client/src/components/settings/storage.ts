// Profile presentation fields are stored on this device. Notification choices
// use the account-backed notification-preferences API instead.
export const LS_PROFILE = 'prepship.settings.profile';

export function loadJSON<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}
