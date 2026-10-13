/**
 * Solarithm Inactivity Session Management
 */

export const INACTIVITY_LOGOUT_MESSAGE = 'You have been signed out due to inactivity.';
export const INACTIVITY_STORAGE_KEY = 'solarithm_last_activity';
export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export function recordActivity(storage?: Storage): void {
  try {
    const s = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (s) {
      s.setItem(INACTIVITY_STORAGE_KEY, Date.now().toString());
    }
  } catch {
    // Storage access unavailable
  }
}

export function clearStoredActivity(storage?: Storage): void {
  try {
    const s = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (s) {
      s.removeItem(INACTIVITY_STORAGE_KEY);
    }
  } catch {
    // Storage access unavailable
  }
}

export function isSessionStale(storage: Storage | undefined, now: number): boolean {
  try {
    const s = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!s) return false;
    const lastStr = s.getItem(INACTIVITY_STORAGE_KEY);
    if (!lastStr) return false;
    const last = parseInt(lastStr, 10);
    if (isNaN(last)) return false;
    return now - last > INACTIVITY_TIMEOUT_MS;
  } catch {
    return false;
  }
}

export {};
