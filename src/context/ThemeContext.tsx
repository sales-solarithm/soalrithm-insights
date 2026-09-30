'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'solarithm_theme';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch (e) {
    // localStorage unavailable -- fall through to default
  }
  return 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Dark is the app's original/default look, so SSR and first paint use it;
  // the real persisted preference (if any) is applied in the effect below,
  // right after mount, before the user can perceive a flash of the wrong
  // theme in practice.
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    setThemeState(getInitialTheme());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (e) {
      // localStorage unavailable -- theme still applies for this session
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Defensive fallback so a component rendered outside the provider
    // (unlikely, but possible during incremental adoption) never crashes --
    // it just behaves as permanently dark with a no-op toggle.
    return { theme: 'dark', toggleTheme: () => {}, setTheme: () => {} };
  }
  return ctx;
}
