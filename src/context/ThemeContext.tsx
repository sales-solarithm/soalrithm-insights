'use client';

import React, { createContext, useContext, useEffect, useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'solarithm_theme_mode';
export const LEGACY_THEME_STORAGE_KEY = 'solarithm_theme';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('storage', callback);
  window.addEventListener('solarithm_theme_changed', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('solarithm_theme_changed', callback);
  };
}

function getSnapshot(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored =
      localStorage.getItem(THEME_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'dark';
}

function getServerSnapshot(): Theme {
  return 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      localStorage.setItem(LEGACY_THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable
    }
    const root = document.documentElement;
    if (next === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    window.dispatchEvent(new CustomEvent('solarithm_theme_changed', { detail: { theme: next } }));
  }, []);

  const toggleTheme = useCallback(() => {
    const current = getSnapshot();
    const next: Theme = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return { theme: 'dark', toggleTheme: () => {}, setTheme: () => {} };
  }
  return ctx;
}
