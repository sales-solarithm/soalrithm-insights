'use client';

import { useEffect, useRef } from 'react';
import { InactivityTracker, INACTIVITY_TIMEOUT_MS } from '@/src/lib/inactivity';

interface UseInactivityLogoutOptions {
  /** Only track while a verified owner is signed in. */
  enabled: boolean;
  /** Called once when the idle window elapses. */
  onExpire: () => void;
  timeoutMs?: number;
}

// Interactions that count as "the user is here". `scroll` is registered
// separately with capture (below) because scroll events don't bubble, and
// the dashboard scrolls inside an inner overflow container, not the window.
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'click',
  'keydown',
  'wheel',
  'touchstart',
  'touchmove'
];

export function useInactivityLogout({
  enabled,
  onExpire,
  timeoutMs = INACTIVITY_TIMEOUT_MS
}: UseInactivityLogoutOptions): void {
  // Keep the latest callback without re-creating the tracker (and silently
  // resetting the countdown) every time the parent re-renders.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null; // storage blocked -- per-tab tracking still works
    }

    const tracker = new InactivityTracker({
      timeoutMs,
      storage,
      onExpire: () => onExpireRef.current()
    });
    tracker.start();

    const onActivity = () => tracker.recordActivity();
    const listenerOptions: AddEventListenerOptions = { passive: true, capture: true };

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, listenerOptions));
    window.addEventListener('scroll', onActivity, listenerOptions);

    // Browsers throttle or suspend timers in background tabs and during
    // sleep, so re-check the moment the user comes back rather than waiting
    // for a late timer.
    const onReturn = () => {
      if (document.visibilityState === 'visible') tracker.check();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);

    return () => {
      tracker.stop();
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity, listenerOptions));
      window.removeEventListener('scroll', onActivity, listenerOptions);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [enabled, timeoutMs]);
}
