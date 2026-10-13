'use client';

import { useEffect, useRef } from 'react';
import { recordActivity, INACTIVITY_TIMEOUT_MS } from '../lib/inactivity';

export const SESSION_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // Exactly 15 minutes (Audit PERF-01)

interface UseInactivityLogoutOptions {
  enabled: boolean;
  onExpire: () => void;
  timeoutMs?: number; // Exactly 15 minutes (900,000 ms)
}

export function useInactivityLogout({
  enabled,
  onExpire,
  timeoutMs = INACTIVITY_TIMEOUT_MS || SESSION_INACTIVITY_TIMEOUT_MS,
}: UseInactivityLogoutOptions) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const resetTimer = () => {
      recordActivity();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onExpire();
      }, timeoutMs);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

    events.forEach((ev) => {
      window.addEventListener(ev, resetTimer, { passive: true });
    });

    // Start initial timer
    resetTimer();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((ev) => {
        window.removeEventListener(ev, resetTimer);
      });
    };
  }, [enabled, onExpire, timeoutMs]);
}

export {};
