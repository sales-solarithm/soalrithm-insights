/**
 * Inactivity tracking for the owner console.
 *
 * Deliberately framework-free (no React, no DOM globals) so the timing logic
 * can be tested with a fake clock. The React hook in
 * src/hooks/useInactivityLogout.ts is a thin wrapper around this.
 */

export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 900,000 ms
export const INACTIVITY_LOGOUT_MESSAGE =
  'Session expired due to 15 minutes of inactivity. Please sign in again.';
export const LAST_ACTIVITY_STORAGE_KEY = 'solarithm_last_activity';

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Tolerated forward drift between tabs/clock reads before a stored value is distrusted. */
const FUTURE_TOLERANCE_MS = 60 * 1000;

/** Last-activity timestamp shared across tabs, or null if absent/invalid. */
export function readStoredActivity(storage: StorageLike | null | undefined, now: number): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    // A meaningfully future-dated value (clock changed, or tampering) is
    // ignored outright. Merely capping it to "now" would be wrong: "now"
    // counts as fresh activity on every check, so a bogus value would keep
    // the session alive forever. Small forward drift is tolerated and capped.
    if (n - now > FUTURE_TOLERANCE_MS) return null;
    return Math.min(n, now);
  } catch {
    return null;
  }
}

/**
 * True if a stored last-activity timestamp exists and is already older than
 * the timeout -- used when a persisted Firebase session is restored on page
 * load, so closing the tab and coming back after >15 minutes still requires
 * a fresh sign-in.
 */
export function isSessionStale(
  storage: StorageLike | null | undefined,
  now: number,
  timeoutMs: number = INACTIVITY_TIMEOUT_MS
): boolean {
  const stored = readStoredActivity(storage, now);
  return stored !== null && now - stored >= timeoutMs;
}

export function clearStoredActivity(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(LAST_ACTIVITY_STORAGE_KEY);
  } catch {
    // storage unavailable -- nothing to clear
  }
}

export interface InactivityTrackerOptions {
  onExpire: () => void;
  timeoutMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  storage?: StorageLike | null;
  /** Min gap between shared-storage writes; mousemove fires constantly. */
  storageWriteThrottleMs?: number;
}

export class InactivityTracker {
  private readonly timeoutMs: number;
  private readonly onExpire: () => void;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;
  private readonly storage: StorageLike | null;
  private readonly writeThrottleMs: number;

  private lastActivity = 0;
  private lastStorageWrite = 0;
  private timerId: unknown = null;
  private running = false;

  constructor(options: InactivityTrackerOptions) {
    this.onExpire = options.onExpire;
    this.timeoutMs = options.timeoutMs ?? INACTIVITY_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.storage = options.storage ?? null;
    this.writeThrottleMs = options.storageWriteThrottleMs ?? 1000;
  }

  start(): void {
    this.running = true;
    this.lastActivity = this.now();
    this.writeStorage(true);
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Called on every user interaction. Deliberately cheap: it only records a
   * timestamp. The already-scheduled timer re-arms itself for the remaining
   * time when it fires, so activity never causes timer churn.
   */
  recordActivity(): void {
    if (!this.running) return;
    this.lastActivity = this.now();
    this.writeStorage(false);
  }

  /** Expire now if the idle window has elapsed; otherwise re-arm the timer. */
  check(): void {
    if (!this.running) return;
    if (this.now() - this.effectiveLastActivity() >= this.timeoutMs) {
      this.stop();
      this.onExpire();
    } else {
      this.schedule();
    }
  }

  /** Most recent activity across this tab and any other open tab. */
  private effectiveLastActivity(): number {
    const now = this.now();
    const shared = readStoredActivity(this.storage, now);
    return shared !== null ? Math.max(this.lastActivity, shared) : this.lastActivity;
  }

  private schedule(): void {
    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
    }
    const remaining = this.timeoutMs - (this.now() - this.effectiveLastActivity());
    this.timerId = this.setTimer(() => {
      this.timerId = null;
      this.check();
    }, Math.max(0, remaining));
  }

  private writeStorage(force: boolean): void {
    if (!this.storage) return;
    const now = this.now();
    if (!force && now - this.lastStorageWrite < this.writeThrottleMs) return;
    try {
      this.storage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
      this.lastStorageWrite = now;
    } catch {
      // storage unavailable/full -- per-tab tracking still works
    }
  }
}
