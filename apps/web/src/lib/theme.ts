'use client';

import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'auto' | 'light' | 'dark';
const KEY = 'hq-theme';

const read = (): ThemeChoice => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
};

/** Applique le thème : `auto` suit le système (prefers-color-scheme). */
export function applyTheme(choice: ThemeChoice = read()): void {
  const root = document.documentElement;
  if (choice === 'auto') delete root.dataset['theme'];
  else root.dataset['theme'] = choice;
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setThemeState] = useState<ThemeChoice>('auto');
  useEffect(() => setThemeState(read()), []);
  const setTheme = useCallback((t: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* stockage indisponible : thème pour cette session seulement */
    }
    applyTheme(t);
    setThemeState(t);
  }, []);
  return [theme, setTheme];
}
